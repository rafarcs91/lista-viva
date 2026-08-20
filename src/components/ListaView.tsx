"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Item, Member, PersonColor, Profile } from "@/lib/types";
import {
  aplicar,
  carregar,
  ehFalhaDeRede,
  ehTemporario,
  enfileirar,
  executarOperacao,
  idsPendentes,
  salvar,
  type Operacao,
  type OperacaoNova,
} from "@/lib/fila-offline";
import Avatar from "./Avatar";
import ItemRow from "./ItemRow";
import ShareSheet from "./ShareSheet";
import ListSettingsSheet from "./ListSettingsSheet";

type Toast = {
  id: number;
  text: string;
  actor?: Profile;
  action?: { label: string; run: () => void };
};

const REMOTE_FLASH_MS = 2100;

/** Mesma normalização do índice único no banco, para os dois concordarem. */
const chaveDoNome = (nome: string) => nome.trim().toLowerCase();
const QTY_COMMIT_MS = 450;

/**
 * O que mudou, em português. Como `items` está com REPLICA IDENTITY FULL,
 * o payload de UPDATE traz a linha antiga inteira — dá para comparar em vez
 * de adivinhar pelo estado final. Retorna null quando nada visível mudou.
 */
function describeChange(
  event: string,
  fresh: Item,
  previous?: Item,
): string | null {
  if (event === "INSERT") return `adicionou ${fresh.name}`;
  if (!previous) return `mexeu em ${fresh.name}`;
  if (previous.done !== fresh.done)
    return `${fresh.done ? "marcou" : "desmarcou"} ${fresh.name}`;
  if (previous.qty !== fresh.qty)
    return `mudou ${fresh.name} para ${fresh.qty} un`;
  if (previous.name !== fresh.name)
    return `renomeou ${previous.name} para ${fresh.name}`;
  return null;
}

export default function ListaView({
  list,
  initialItems,
  initialMembers,
  me,
}: {
  list: { id: string; title: string; owner_id: string };
  initialItems: Item[];
  initialMembers: Member[];
  me: Profile;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [items, setItems] = useState<Item[]>(initialItems);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [remote, setRemote] = useState<Record<string, PersonColor>>({});
  const [activity, setActivity] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [title, setTitle] = useState(list.title);
  const [error, setError] = useState("");

  const [draft, setDraft] = useState("");
  const [qty, setQty] = useState(1);
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const [compondo, setCompondo] = useState(false);

  const toastSeq = useRef(0);
  const flashTimers = useRef<Map<string, number>>(new Map());
  const qtyTimers = useRef<Map<string, number>>(new Map());
  const qtyBaseline = useRef<Map<string, number>>(new Map());

  /* ─────────── fila offline ─────────── */

  const [fila, setFila] = useState<Operacao[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [semRede, setSemRede] = useState(false);
  const filaRef = useRef<Operacao[]>([]);

  useEffect(() => {
    filaRef.current = fila;
  }, [fila]);

  // A fila sobrevive a fechar o app: sem isso, sair do mercado e voltar
  // depois perderia tudo que foi feito sem sinal.
  //
  // A leitura fica para o tick seguinte por dois motivos: o estado inicial
  // vazio casa com o HTML vindo do servidor, evitando divergência de
  // hidratação; e o React não precisa renderizar duas vezes no mesmo commit.
  useEffect(() => {
    const agendado = window.setTimeout(() => {
      const guardada = carregar(list.id);
      if (guardada.length > 0) {
        filaRef.current = guardada;
        setFila(guardada);
      }
    }, 0);
    return () => window.clearTimeout(agendado);
  }, [list.id]);

  const anotar = useCallback(
    (op: OperacaoNova) => {
      const carimbada = { ...op, em: Date.now() } as Operacao;
      setFila((atual) => {
        const nova = enfileirar(atual, carimbada);
        salvar(list.id, nova);
        filaRef.current = nova;
        return nova;
      });
    },
    [list.id],
  );

  const descartar = useCallback(
    (alvo: Operacao) => {
      setFila((atual) => {
        const nova = atual.filter((o) => o !== alvo);
        salvar(list.id, nova);
        filaRef.current = nova;
        return nova;
      });
    },
    [list.id],
  );

  const profiles = useMemo(() => {
    const map: Record<string, Profile> = {};
    for (const m of members) map[m.id] = m;
    map[me.id] = me;
    return map;
  }, [members, me]);

  // O handler do realtime lê os perfis por ref: se dependesse do objeto,
  // cada pessoa que entrasse recriaria o canal e os eventos da troca se perderiam.
  const profilesRef = useRef(profiles);
  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  /* ─────────── feedback ─────────── */

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { ...toast, id }]);
    window.setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      toast.action ? 5000 : 3200,
    );
  }, []);

  const flashRemote = useCallback((itemId: string, color: PersonColor) => {
    setRemote((r) => ({ ...r, [itemId]: color }));
    const existing = flashTimers.current.get(itemId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      setRemote((r) => {
        const next = { ...r };
        delete next[itemId];
        return next;
      });
      flashTimers.current.delete(itemId);
    }, REMOTE_FLASH_MS);
    flashTimers.current.set(itemId, timer);
  }, []);

  /* ─────────── perfis que chegam depois ─────────── */

  const ensureProfile = useCallback(
    async (userId: string | null) => {
      if (!userId || profilesRef.current[userId]) return;
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, color")
        .eq("id", userId)
        .maybeSingle();
      if (data) {
        setMembers((m) =>
          m.some((x) => x.id === data.id) ? m : [...m, { ...data, role: "editor" }],
        );
      }
    },
    [supabase],
  );


  /**
   * Reenvia a fila. Para na primeira falha de rede e guarda o resto: sem
   * conexão não adianta insistir nas seguintes, e a ordem importa.
   * Operação que falha por outro motivo é descartada — repeti-la eternamente
   * deixaria a pessoa com uma pendência que nunca some.
   */
  const sincronizar = useCallback(async () => {
    const pendentes = filaRef.current;
    if (pendentes.length === 0) return;

    setSincronizando(true);

    for (const op of pendentes) {
      const r = await executarOperacao(supabase, op, {
        listaId: list.id,
        usuarioId: me.id,
      });

      // Sem rede não adianta tentar as seguintes; o resto fica para depois.
      if (r.estado === "rede") break;

      if (r.estado === "ok" && op.tipo === "criar" && r.item) {
        // O provisório dá lugar ao real, sem duplicar caso o realtime já
        // tenha trazido a linha.
        const real = r.item;
        setItems((l) => {
          const semTemp = l.filter((i) => i.id !== op.id);
          return semTemp.some((i) => i.id === real.id) ? semTemp : [...semTemp, real];
        });
      }

      descartar(op);

      if (r.estado === "erro") {
        setError("Uma alteração não pôde ser salva e foi descartada.");
      }
    }

    setSincronizando(false);
  }, [supabase, list.id, me.id, descartar]);

  // Volta a rede, volta a fila. O evento `online` é a deixa mais confiável;
  // a checagem periódica cobre o caso de o navegador achar que está online
  // mas o servidor seguir inacessível.
  useEffect(() => {
    const aoVoltar = () => {
      setSemRede(false);
      void sincronizar();
    };
    const aoCair = () => setSemRede(true);

    window.addEventListener("online", aoVoltar);
    window.addEventListener("offline", aoCair);

    void Promise.resolve().then(() => {
      if (typeof navigator !== "undefined") setSemRede(!navigator.onLine);
      return sincronizar();
    });
    const relogio = window.setInterval(() => void sincronizar(), 20_000);

    return () => {
      window.removeEventListener("online", aoVoltar);
      window.removeEventListener("offline", aoCair);
      window.clearInterval(relogio);
    };
  }, [sincronizar]);

  /* ─────────── sugestões pelo histórico ─────────── */

  /**
   * Busca só quando a barra de composição ganha foco: é o único momento em
   * que a sugestão serve, e evita uma consulta em toda abertura de lista.
   */
  const buscarSugestoes = useCallback(async () => {
    const { data } = await supabase.rpc("item_suggestions", {
      p_list: list.id,
      p_limit: 12,
    });
    const linhas = (data ?? []) as { name: string }[];
    setSugestoes(linhas.map((linha) => linha.name));
  }, [supabase, list.id]);

  /* ─────────── reconciliação ─────────── */

  /**
   * O status SUBSCRIBED chega antes de a replicação estar atrelada de fato:
   * medimos uma janela de ~3s em que eventos se perdem. Quem abre a lista
   * enquanto outra pessoa mexe nela ficaria vendo dado velho até recarregar.
   * Buscar o estado atual logo após inscrever fecha essa janela.
   */
  const reconcile = useCallback(async () => {
    const { data } = await supabase
      .from("items")
      .select("*")
      .eq("list_id", list.id)
      .order("created_at", { ascending: true })
      .returns<Item[]>();
    if (!data) return;

    // Estado do servidor + fila pendente. Sem reaplicar a fila, a
    // reconciliação desfaria na tela tudo que foi feito sem sinal.
    setItems(aplicar(data, filaRef.current, { listaId: list.id, usuarioId: me.id }));
  }, [supabase, list.id, me.id]);

  /* ─────────── realtime: mudanças nos itens ─────────── */

  useEffect(() => {
    const channel = supabase
      .channel(`itens:${list.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "items",
          filter: `list_id=eq.${list.id}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as Item;
          if (!row?.id) return;

          if (payload.eventType === "DELETE") {
            setItems((list) => list.filter((i) => i.id !== row.id));
            return;
          }

          const fresh = payload.new as Item;
          const previous = payload.old as Item | undefined;
          const actorId =
            payload.eventType === "INSERT" ? fresh.added_by : fresh.updated_by;
          const mine = actorId === me.id;

          setItems((list) => {
            const idx = list.findIndex((i) => i.id === fresh.id);
            if (idx === -1) return [...list, fresh];
            const next = [...list];
            next[idx] = fresh;
            return next;
          });

          // A minha própria ação já apareceu na tela na hora do toque.
          if (mine) return;

          const phrase = describeChange(payload.eventType, fresh, previous);
          if (!phrase) return;

          void ensureProfile(actorId);
          const actor = actorId ? profilesRef.current[actorId] : undefined;
          const name = actor?.display_name ?? "Alguém";
          const color = actor?.color ?? "violet";

          flashRemote(fresh.id, color);
          setActivity(`${name} ${phrase}`);
          pushToast({ text: `${name} ${phrase}`, actor });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void reconcile();
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, list.id, me.id, ensureProfile, flashRemote, pushToast, reconcile]);

  /* ─────────── realtime: a lista em si ─────────── */

  useEffect(() => {
    const channel = supabase
      .channel(`lista:${list.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lists",
          filter: `id=eq.${list.id}`,
        },
        (payload) => {
          // Apagada por quem é dona: ninguém fica editando o que não existe.
          if (payload.eventType === "DELETE") {
            router.push("/listas");
            router.refresh();
            return;
          }
          const fresh = payload.new as { title?: string };
          if (fresh.title) setTitle(fresh.title);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, list.id, router]);

  /* ─────────── realtime: quem entra e quem sai ─────────── */

  useEffect(() => {
    const channel = supabase
      .channel(`membros:${list.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "list_members",
          filter: `list_id=eq.${list.id}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const saiu = (payload.old as { user_id?: string })?.user_id;
            if (!saiu) return;

            // Fui removida: continuar na tela seria editar uma lista a que
            // já não tenho acesso, e toda escrita passaria a falhar por RLS.
            if (saiu === me.id) {
              router.push("/listas");
              router.refresh();
              return;
            }

            setMembers((m) => m.filter((x) => x.id !== saiu));
            return;
          }

          if (payload.eventType !== "INSERT") return;

          const linha = payload.new as { user_id: string; role: "owner" | "editor" };
          if (linha.user_id === me.id) return;

          void (async () => {
            const { data } = await supabase
              .from("profiles")
              .select("id, display_name, color")
              .eq("id", linha.user_id)
              .maybeSingle();
            if (!data) return;

            setMembers((m) =>
              m.some((x) => x.id === data.id) ? m : [...m, { ...data, role: linha.role }],
            );
            setActivity(`${data.display_name} entrou na lista`);
            pushToast({ text: `${data.display_name} entrou na lista`, actor: data });
          })();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, list.id, me.id, router, pushToast]);

  /* ─────────── realtime: quem está com a lista aberta ─────────── */

  useEffect(() => {
    let channel: RealtimeChannel | null = null;

    channel = supabase.channel(`presenca:${list.id}`, {
      config: { presence: { key: me.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel!.presenceState();
        setOnline(new Set(Object.keys(state)));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel!.track({ at: Date.now() });
        }
      });

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, list.id, me.id]);

  useEffect(() => {
    const flashes = flashTimers.current;
    const qtys = qtyTimers.current;
    return () => {
      flashes.forEach((t) => window.clearTimeout(t));
      flashes.clear();
      qtys.forEach((t) => window.clearTimeout(t));
      qtys.clear();
    };
  }, []);

  /* ─────────── ações (otimistas) ─────────── */

  const markPending = (id: string, on: boolean) =>
    setPending((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;

    const quantidade = qty;
    setDraft("");
    setQty(1);
    setError("");

    // Se o nome já está na lista, adicionar significa precisar de mais —
    // não de uma segunda linha igual. O banco garante o mesmo por índice
    // único; aqui é só para a tela responder na hora.
    const existente = items.find(
      (i) => chaveDoNome(i.name) === chaveDoNome(name),
    );

    if (existente) {
      const somada = Math.min(existente.qty + quantidade, 999);

      setItems((l) =>
        l.map((i) =>
          i.id === existente.id
            ? { ...i, qty: somada, done: false, checked_by: null }
            : i,
        ),
      );

      // Sem isto a fusão pareceria um bug: a linha alterada pode estar
      // fora da tela, e o campo simplesmente esvaziaria sem nada aparecer.
      flashRemote(existente.id, me.color);
      pushToast({
        text: `${existente.name}: ${existente.qty} → ${somada} un`,
        actor: me,
      });
      window.setTimeout(() => {
        document
          .querySelector(`.item[data-id="${existente.id}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);

      if (ehTemporario(existente.id)) {
        anotar({
          tipo: "atualizar",
          id: existente.id,
          campos: { qty: somada, done: false },
        });
        return;
      }

      const { error: err } = await supabase
        .from("items")
        .update({ qty: somada, done: false, checked_by: null, updated_by: me.id })
        .eq("id", existente.id);

      if (err && ehFalhaDeRede(err)) {
        anotar({
          tipo: "atualizar",
          id: existente.id,
          campos: { qty: somada, done: false },
        });
        return;
      }
      if (err) {
        setItems((l) => l.map((i) => (i.id === existente.id ? existente : i)));
        setError("Não consegui somar a quantidade.");
      }
      return;
    }

    const tempId = `tmp-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const optimistic: Item = {
      id: tempId,
      list_id: list.id,
      name,
      qty: quantidade,
      done: false,
      added_by: me.id,
      checked_by: null,
      updated_by: null,
      created_at: now,
      updated_at: now,
    };

    setItems((l) => [...l, optimistic]);
    markPending(tempId, true);

    // add_or_bump_item resolve a corrida: se outra pessoa inseriu o mesmo
    // nome no intervalo, o banco soma em vez de recusar por duplicidade.
    const { data, error: err } = await supabase
      .rpc("add_or_bump_item", { p_list: list.id, p_name: name, p_qty: quantidade })
      .single<Item>();

    markPending(tempId, false);

    if (err && ehFalhaDeRede(err)) {
      anotar({
        tipo: "criar",
        id: tempId,
        campos: { name, qty: quantidade, done: false },
      });
      return;
    }

    if (err || !data) {
      setItems((l) => l.filter((i) => i.id !== tempId));
      setError("Não consegui adicionar o item.");
      return;
    }

    setItems((l) => {
      const semTemp = l.filter((i) => i.id !== tempId);
      const idx = semTemp.findIndex((i) => i.id === data.id);
      if (idx === -1) return [...semTemp, data];
      const proxima = [...semTemp];
      proxima[idx] = data;
      return proxima;
    });
  }

  function usarSugestao(nome: string) {
    setDraft(nome);
    setSugestoes((s) => s.filter((x) => x !== nome));
  }

  async function toggleItem(item: Item) {
    const before = item.done;
    const next = !before;

    setItems((l) =>
      l.map((i) => (i.id === item.id ? { ...i, done: next, checked_by: me.id } : i)),
    );
    markPending(item.id, true);
    setError("");

    // Item que ainda não existe no servidor não tem o que atualizar lá:
    // a alteração vai direto para o rascunho na fila.
    if (ehTemporario(item.id)) {
      anotar({ tipo: "atualizar", id: item.id, campos: { done: next } });
      markPending(item.id, false);
      return;
    }

    const { error: err } = await supabase
      .from("items")
      .update({ done: next, checked_by: me.id, updated_by: me.id })
      .eq("id", item.id);

    markPending(item.id, false);

    if (err && ehFalhaDeRede(err)) {
      anotar({ tipo: "atualizar", id: item.id, campos: { done: next } });
      return;
    }

    if (err) {
      setItems((l) =>
        l.map((i) => (i.id === item.id ? { ...i, done: before, checked_by: item.checked_by } : i)),
      );
      setError("Não consegui salvar. Tente de novo.");
    }
  }

  /**
   * A tela reage a cada toque; o banco recebe uma escrita só no fim da
   * sequência. Quem toca "+" quatro vezes gera um UPDATE, não quatro —
   * e o outro lado vê a quantidade final, sem contagem regressiva.
   */
  function changeQty(item: Item, next: number) {
    const value = Math.max(1, Math.min(999, next));
    if (value === item.qty) return;

    if (!qtyBaseline.current.has(item.id)) {
      qtyBaseline.current.set(item.id, item.qty);
    }

    setItems((l) => l.map((i) => (i.id === item.id ? { ...i, qty: value } : i)));
    setError("");

    const running = qtyTimers.current.get(item.id);
    if (running) window.clearTimeout(running);

    const timer = window.setTimeout(async () => {
      qtyTimers.current.delete(item.id);
      const baseline = qtyBaseline.current.get(item.id) ?? item.qty;
      qtyBaseline.current.delete(item.id);

      if (ehTemporario(item.id)) {
        anotar({ tipo: "atualizar", id: item.id, campos: { qty: value } });
        return;
      }

      const { error: err } = await supabase
        .from("items")
        .update({ qty: value, updated_by: me.id })
        .eq("id", item.id);

      if (err && ehFalhaDeRede(err)) {
        anotar({ tipo: "atualizar", id: item.id, campos: { qty: value } });
        return;
      }

      if (err) {
        setItems((l) =>
          l.map((i) => (i.id === item.id ? { ...i, qty: baseline } : i)),
        );
        setError("Não consegui salvar a quantidade.");
      }
    }, QTY_COMMIT_MS);

    qtyTimers.current.set(item.id, timer);
  }

  /**
   * Só a dona chega aqui — a política de RLS é quem garante isso de fato,
   * a interface apenas não oferece o botão para os demais.
   */
  async function removerMembro(userId: string) {
    const antes = members;
    setMembers((m) => m.filter((x) => x.id !== userId));
    setError("");

    const { error: err } = await supabase
      .from("list_members")
      .delete()
      .eq("list_id", list.id)
      .eq("user_id", userId);

    if (err) {
      setMembers(antes);
      setError("Não consegui remover essa pessoa.");
    }
  }

  async function renameItem(item: Item, novoNome: string) {
    const anterior = item.name;

    setItems((l) =>
      l.map((i) => (i.id === item.id ? { ...i, name: novoNome } : i)),
    );
    markPending(item.id, true);
    setError("");

    if (ehTemporario(item.id)) {
      anotar({ tipo: "atualizar", id: item.id, campos: { name: novoNome } });
      markPending(item.id, false);
      return;
    }

    const { error: err } = await supabase
      .from("items")
      .update({ name: novoNome, updated_by: me.id })
      .eq("id", item.id);

    markPending(item.id, false);

    if (err && ehFalhaDeRede(err)) {
      anotar({ tipo: "atualizar", id: item.id, campos: { name: novoNome } });
      return;
    }

    if (err) {
      setItems((l) =>
        l.map((i) => (i.id === item.id ? { ...i, name: anterior } : i)),
      );
      // 23505 = violação do índice único por lista e nome. Fundir os dois
      // itens porque alguém digitou um nome seria surpreendente demais.
      setError(
        err.code === "23505"
          ? `Já existe "${novoNome}" nesta lista.`
          : "Não consegui renomear o item.",
      );
    }
  }

  async function deleteItem(item: Item) {
    setItems((l) => l.filter((i) => i.id !== item.id));
    setError("");

    if (ehTemporario(item.id)) {
      // Criado e apagado sem sinal: o servidor nunca soube que existiu.
      anotar({ tipo: "excluir", id: item.id });
      return;
    }

    const { error: err } = await supabase.from("items").delete().eq("id", item.id);

    if (err && ehFalhaDeRede(err)) {
      anotar({ tipo: "excluir", id: item.id });
      return;
    }

    if (err) {
      setItems((l) => [...l, item]);
      setError("Não consegui remover o item.");
      return;
    }

    // Sem diálogo de confirmação: quem errou tem 5 segundos para voltar atrás.
    pushToast({
      text: `${item.name} removido`,
      action: {
        label: "Desfazer",
        run: async () => {
          const { data } = await supabase
            .from("items")
            .insert({
              list_id: list.id,
              name: item.name,
              qty: item.qty,
              done: item.done,
              added_by: me.id,
              checked_by: item.done ? me.id : null,
            })
            .select("*")
            .single<Item>();
          if (data) {
            setItems((l) => (l.some((i) => i.id === data.id) ? l : [...l, data]));
          }
        },
      },
    });
  }

  /* ─────────── render ─────────── */

  // Filtra conforme se digita: com poucas listas a sugestão bruta é curta,
  // e é digitando que ela vira atalho de verdade.
  const busca = draft.trim().toLowerCase();
  const naLista = new Set(items.map((i) => i.name.trim().toLowerCase()));
  const sugestoesVisiveis = sugestoes
    .filter((nome) => !naLista.has(nome.trim().toLowerCase()))
    .filter((nome) => (busca ? nome.toLowerCase().includes(busca) : true))
    .slice(0, 8);

  const naFila = idsPendentes(fila);
  const aguardando = (id: string) => pending.has(id) || naFila.has(id);

  const pendingItems = items.filter((i) => !i.done);
  const doneItems = items.filter((i) => i.done);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-row">
          <Link href="/listas" className="back">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Listas
          </Link>

          <button
            className="icon-btn"
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Ajustes da lista"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.9" />
              <circle cx="12" cy="12" r="1.9" />
              <circle cx="19" cy="12" r="1.9" />
            </svg>
          </button>
        </div>

        <h1 className="title">{title}</h1>

        <div className="presence">
          <div className="avatars">
            {members.map((m) => (
              <Avatar
                key={m.id}
                name={m.id === me.id ? "Você" : m.display_name}
                color={m.color}
                live={online.has(m.id) && m.id !== me.id}
              />
            ))}
          </div>
          <button className="btn-ghost" type="button" onClick={() => setSharing(true)}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            convidar
          </button>
        </div>

        <p className="live-line is-fresh" key={activity ?? "idle"} aria-live="polite">
          <span className="dot" />
          <span>
            {activity ? (
              <>
                {activity} · <b>agora</b>
              </>
            ) : online.size > 1 ? (
              <>
                <b>{online.size - 1}</b>{" "}
                {online.size - 1 === 1 ? "pessoa está" : "pessoas estão"} com a lista aberta
              </>
            ) : (
              "Só você por aqui agora"
            )}
          </span>
        </p>
      </header>

      <div className="scroll">
        {pendingItems.length === 0 ? (
          <div className="empty" style={{ marginTop: 8 }}>
            {items.length === 0
              ? "Lista vazia. Adicione o primeiro item abaixo."
              : "Tudo no carrinho. Boa compra!"}
          </div>
        ) : (
          <ul className="items">
            {pendingItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                actor={profiles[item.added_by ?? ""]}
                isMe={item.added_by === me.id}
                remoteColor={remote[item.id]}
                isPending={aguardando(item.id)}
                onToggle={() => toggleItem(item)}
                onDelete={() => deleteItem(item)}
                onQty={(next) => changeQty(item, next)}
                onRename={(nome) => renameItem(item, nome)}
              />
            ))}
          </ul>
        )}

        {doneItems.length > 0 && (
          <>
            <div className="sec">
              <span>No carrinho · {doneItems.length}</span>
              <i className="rule" />
              <button type="button" onClick={() => setShowDone((s) => !s)}>
                {showDone ? "ocultar" : "mostrar"}
              </button>
            </div>
            {showDone && (
              <ul className="items">
                {doneItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    actor={profiles[item.checked_by ?? item.added_by ?? ""]}
                    isMe={(item.checked_by ?? item.added_by) === me.id}
                    remoteColor={remote[item.id]}
                    isPending={aguardando(item.id)}
                    onToggle={() => toggleItem(item)}
                    onDelete={() => deleteItem(item)}
                    onQty={(next) => changeQty(item, next)}
                    onRename={(nome) => renameItem(item, nome)}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {error && (
          <div className="notice is-error" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.actor && <Avatar name={t.actor.display_name} color={t.actor.color} />}
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {compondo && sugestoesVisiveis.length > 0 && (
        <div className="sugestoes" role="group" aria-label="Itens que você já comprou">
          {sugestoesVisiveis.map((nome) => (
            <button
              key={nome}
              type="button"
              // onMouseDown em vez de onClick: o clique dispara depois do
              // blur do campo, que já teria escondido a linha de sugestões.
              onMouseDown={(e) => {
                e.preventDefault();
                usarSugestao(nome);
              }}
            >
              {nome}
            </button>
          ))}
        </div>
      )}

      {fila.length > 0 && (
        <div className={`sync-bar${semRede ? " is-offline" : ""}`} role="status">
          <span className="sync-dot" />
          <span>
            {sincronizando
              ? "Enviando alterações…"
              : semRede
                ? `Sem conexão · ${fila.length} ${fila.length === 1 ? "alteração guardada" : "alterações guardadas"}`
                : `${fila.length} ${fila.length === 1 ? "alteração aguardando" : "alterações aguardando"}`}
          </span>
          {!sincronizando && !semRede && (
            <button type="button" onClick={() => void sincronizar()}>
              tentar agora
            </button>
          )}
        </div>
      )}

      <form className="compose" onSubmit={addItem}>
        <div className="compose-field">
          <input
            type="text"
            placeholder="Adicionar item…"
            aria-label="Nome do item"
            autoComplete="off"
            maxLength={120}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => {
              setCompondo(true);
              void buscarSugestoes();
            }}
            onBlur={() => setCompondo(false)}
          />
          <div className="qty-step">
            <button
              type="button"
              aria-label="Diminuir quantidade"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <output>{qty}</output>
            <button
              type="button"
              aria-label="Aumentar quantidade"
              onClick={() => setQty((q) => Math.min(999, q + 1))}
            >
              +
            </button>
          </div>
        </div>
        <button className="send" type="submit" disabled={!draft.trim()} aria-label="Adicionar à lista">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </form>

      {sharing && (
        <ShareSheet
          listId={list.id}
          members={members}
          meId={me.id}
          souDona={list.owner_id === me.id}
          online={online}
          onClose={() => setSharing(false)}
          onRemover={removerMembro}
        />
      )}

      {settingsOpen && (
        <ListSettingsSheet
          listId={list.id}
          title={title}
          isOwner={list.owner_id === me.id}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
