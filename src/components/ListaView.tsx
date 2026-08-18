"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Item, Member, PersonColor, Profile } from "@/lib/types";
import Avatar from "./Avatar";
import ItemRow from "./ItemRow";
import ShareSheet from "./ShareSheet";

type Toast = {
  id: number;
  text: string;
  actor?: Profile;
  action?: { label: string; run: () => void };
};

const REMOTE_FLASH_MS = 2100;

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
  const [error, setError] = useState("");

  const [draft, setDraft] = useState("");
  const [qty, setQty] = useState(1);

  const toastSeq = useRef(0);
  const flashTimers = useRef<Map<string, number>>(new Map());

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
          const actorId = payload.eventType === "INSERT" ? fresh.added_by : fresh.checked_by;
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

          void ensureProfile(actorId);
          const actor = actorId ? profilesRef.current[actorId] : undefined;
          const name = actor?.display_name ?? "Alguém";
          const color = actor?.color ?? "violet";

          flashRemote(fresh.id, color);

          const verb =
            payload.eventType === "INSERT"
              ? "adicionou"
              : fresh.done
                ? "marcou"
                : "desmarcou";

          setActivity(`${name} ${verb} ${fresh.name}`);
          pushToast({ text: `${name} ${verb} ${fresh.name}`, actor });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, list.id, me.id, ensureProfile, flashRemote, pushToast]);

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
    const timers = flashTimers.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
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

    const tempId = `tmp-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const optimistic: Item = {
      id: tempId,
      list_id: list.id,
      name,
      qty,
      done: false,
      added_by: me.id,
      checked_by: null,
      created_at: now,
      updated_at: now,
    };

    setItems((l) => [...l, optimistic]);
    markPending(tempId, true);
    setDraft("");
    setQty(1);
    setError("");

    const { data, error: err } = await supabase
      .from("items")
      .insert({ list_id: list.id, name, qty, added_by: me.id })
      .select("*")
      .single<Item>();

    markPending(tempId, false);

    if (err || !data) {
      setItems((l) => l.filter((i) => i.id !== tempId));
      setError(err?.message ?? "Não consegui adicionar o item.");
      return;
    }

    // Troca o provisório pelo real, sem duplicar se o realtime chegou antes.
    setItems((l) => {
      const withoutTemp = l.filter((i) => i.id !== tempId);
      return withoutTemp.some((i) => i.id === data.id) ? withoutTemp : [...withoutTemp, data];
    });
  }

  async function toggleItem(item: Item) {
    const before = item.done;
    const next = !before;

    setItems((l) =>
      l.map((i) => (i.id === item.id ? { ...i, done: next, checked_by: me.id } : i)),
    );
    markPending(item.id, true);
    setError("");

    const { error: err } = await supabase
      .from("items")
      .update({ done: next, checked_by: me.id })
      .eq("id", item.id);

    markPending(item.id, false);

    if (err) {
      setItems((l) =>
        l.map((i) => (i.id === item.id ? { ...i, done: before, checked_by: item.checked_by } : i)),
      );
      setError("Não consegui salvar. Tente de novo.");
    }
  }

  async function deleteItem(item: Item) {
    setItems((l) => l.filter((i) => i.id !== item.id));
    setError("");

    const { error: err } = await supabase.from("items").delete().eq("id", item.id);

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
        </div>

        <h1 className="title">{list.title}</h1>

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
                isPending={pending.has(item.id)}
                onToggle={() => toggleItem(item)}
                onDelete={() => deleteItem(item)}
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
                    isPending={pending.has(item.id)}
                    onToggle={() => toggleItem(item)}
                    onDelete={() => deleteItem(item)}
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
          online={online}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
