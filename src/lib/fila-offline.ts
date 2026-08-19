import type { SupabaseClient } from "@supabase/supabase-js";
import type { Item } from "./types";

/**
 * Fila de alterações feitas sem rede.
 *
 * O problema que ela resolve não é guardar ações — é o que acontece quando
 * elas voltam a ser enviadas. Um item criado offline não existe no
 * servidor, então marcar ou renomear esse item não pode virar uma operação
 * separada: ela referenciaria um id que vai deixar de existir assim que o
 * insert acontecer.
 *
 * A saída é **coalescer**: alterações sobre o mesmo item se fundem em vez
 * de se acumular. Marcar e renomear um item recém-criado apenas atualiza o
 * `criar` que já está na fila. Assim nunca é preciso reescrever ids, a fila
 * fica pequena, e o reenvio é uma passada só.
 */

export type Campos = Partial<Pick<Item, "name" | "qty" | "done">>;

export type Operacao =
  | { tipo: "criar"; id: string; campos: Required<Campos>; em: number }
  | { tipo: "atualizar"; id: string; campos: Campos; em: number }
  | { tipo: "excluir"; id: string; em: number };

/** A operação como quem chama a descreve; o instante é carimbado depois. */
type SemQuando<T> = T extends unknown ? Omit<T, "em"> : never;
export type OperacaoNova = SemQuando<Operacao>;

const CHAVE = (listaId: string) => `lista-viva:fila:${listaId}`;

/** Ids de itens que ainda não existem no servidor. */
export const ehTemporario = (id: string) => id.startsWith("tmp-");

/* ─────────── persistência ─────────── */

export function carregar(listaId: string): Operacao[] {
  if (typeof window === "undefined") return [];
  try {
    const cru = window.localStorage.getItem(CHAVE(listaId));
    return cru ? (JSON.parse(cru) as Operacao[]) : [];
  } catch {
    // Armazenamento cheio, desativado ou com conteúdo corrompido: seguir
    // sem fila é pior que perfeito, mas melhor que travar o app.
    return [];
  }
}

export function salvar(listaId: string, fila: Operacao[]) {
  if (typeof window === "undefined") return;
  try {
    if (fila.length === 0) window.localStorage.removeItem(CHAVE(listaId));
    else window.localStorage.setItem(CHAVE(listaId), JSON.stringify(fila));
  } catch {
    // idem
  }
}

/* ─────────── coalescência ─────────── */

/**
 * Junta uma operação nova à fila, fundindo com o que já existe sobre o
 * mesmo item. A ordem relativa entre itens diferentes é preservada.
 */
export function enfileirar(fila: Operacao[], nova: Operacao): Operacao[] {
  const anteriores = fila.filter((o) => o.id === nova.id);
  const outras = fila.filter((o) => o.id !== nova.id);

  // Excluir apaga todo o histórico do item. Se ele nem chegou ao servidor,
  // a exclusão também some: criar e apagar offline não deixa rastro.
  if (nova.tipo === "excluir") {
    if (ehTemporario(nova.id)) return outras;
    return [...outras, nova];
  }

  const criar = anteriores.find((o) => o.tipo === "criar");
  if (criar && nova.tipo === "atualizar") {
    // O item ainda é um rascunho local: alterar significa reescrever o
    // rascunho, nunca enfileirar um update para um id que vai mudar.
    const fundido: Operacao = {
      ...criar,
      campos: { ...criar.campos, ...nova.campos },
    };
    return [...outras, fundido];
  }

  if (nova.tipo === "atualizar") {
    const update = anteriores.find((o) => o.tipo === "atualizar");
    if (update) {
      const fundido: Operacao = {
        ...update,
        campos: { ...update.campos, ...nova.campos },
        em: nova.em,
      };
      return [...outras, fundido];
    }
  }

  return [...outras, nova];
}

/* ─────────── projeção ─────────── */

/**
 * Estado exibido = estado do servidor + operações pendentes.
 *
 * É o que impede a reconciliação de "desfazer" na tela algo que a pessoa
 * fez offline: os dados chegam do servidor e a fila é reaplicada por cima.
 */
export function aplicar(
  servidor: Item[],
  fila: Operacao[],
  contexto: { listaId: string; usuarioId: string },
): Item[] {
  let resultado = [...servidor];

  for (const op of fila) {
    if (op.tipo === "criar") {
      const agora = new Date(op.em).toISOString();
      resultado.push({
        id: op.id,
        list_id: contexto.listaId,
        name: op.campos.name,
        qty: op.campos.qty,
        done: op.campos.done,
        added_by: contexto.usuarioId,
        checked_by: op.campos.done ? contexto.usuarioId : null,
        updated_by: null,
        created_at: agora,
        updated_at: agora,
      });
      continue;
    }

    if (op.tipo === "excluir") {
      resultado = resultado.filter((i) => i.id !== op.id);
      continue;
    }

    resultado = resultado.map((i) =>
      i.id === op.id
        ? {
            ...i,
            ...op.campos,
            checked_by:
              op.campos.done === undefined
                ? i.checked_by
                : op.campos.done
                  ? contexto.usuarioId
                  : null,
          }
        : i,
    );
  }

  return resultado;
}

/** Ids com alteração ainda não confirmada, para a interface marcar. */
export function idsPendentes(fila: Operacao[]): Set<string> {
  return new Set(fila.map((o) => o.id));
}

/* ─────────── classificação de erro ─────────── */

/**
 * Só falha de rede vai para a fila. Um erro de permissão (RLS) ou de
 * validação nunca vai passar por repetição — enfileirar isso criaria uma
 * pendência eterna e a pessoa nunca entenderia por que nada sincroniza.
 */
export function ehFalhaDeRede(erro: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  if (!erro) return false;

  const e = erro as { message?: string; code?: string; status?: number };

  // Códigos do Postgres/PostgREST significam que o servidor respondeu.
  if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) return false;
  if (typeof e.status === "number" && e.status >= 400 && e.status < 500) {
    return false;
  }

  const texto = (e.message ?? "").toLowerCase();
  return (
    texto.includes("failed to fetch") ||
    texto.includes("networkerror") ||
    texto.includes("network request failed") ||
    texto.includes("load failed") ||
    texto.includes("timeout") ||
    texto.includes("fetch failed")
  );
}

/* ─────────── reenvio ─────────── */

export type Resultado =
  | { estado: "ok"; item?: Item }
  | { estado: "rede" }
  | { estado: "erro"; erro: unknown };

/**
 * Traduz uma operação da fila na escrita correspondente.
 *
 * Vive aqui, e não dentro do componente, para poder ser exercitada contra
 * um banco real: é o trecho onde um campo esquecido (o `checked_by` de um
 * item criado já marcado, por exemplo) corromperia dados silenciosamente,
 * e só apareceria como "quem marcou isso?" semanas depois.
 */
export async function executarOperacao(
  sb: SupabaseClient,
  op: Operacao,
  contexto: { listaId: string; usuarioId: string },
): Promise<Resultado> {
  const { listaId, usuarioId } = contexto;

  if (op.tipo === "criar") {
    const { data, error } = await sb
      .from("items")
      .insert({
        list_id: listaId,
        name: op.campos.name,
        qty: op.campos.qty,
        done: op.campos.done,
        added_by: usuarioId,
        // Um item criado já marcado precisa dizer quem o marcou, senão a
        // linha de atividade fica sem autor.
        checked_by: op.campos.done ? usuarioId : null,
        updated_by: usuarioId,
      })
      .select("*")
      .single<Item>();

    if (!error) return { estado: "ok", item: data ?? undefined };
    return ehFalhaDeRede(error) ? { estado: "rede" } : { estado: "erro", erro: error };
  }

  if (op.tipo === "atualizar") {
    const patch: Record<string, unknown> = { ...op.campos, updated_by: usuarioId };
    if (op.campos.done !== undefined) {
      patch.checked_by = op.campos.done ? usuarioId : null;
    }

    const { error } = await sb.from("items").update(patch).eq("id", op.id);
    if (!error) return { estado: "ok" };
    return ehFalhaDeRede(error) ? { estado: "rede" } : { estado: "erro", erro: error };
  }

  const { error } = await sb.from("items").delete().eq("id", op.id);
  if (!error) return { estado: "ok" };
  return ehFalhaDeRede(error) ? { estado: "rede" } : { estado: "erro", erro: error };
}
