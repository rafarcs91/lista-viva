import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireTestEnv } from "./setup";

export type Sessao = {
  sb: SupabaseClient;
  id: string;
  rotulo: string;
};

const env = requireTestEnv();

/**
 * Entra com uma das contas de teste. Cada sessão tem seu próprio cliente:
 * compartilhar um cliente entre "pessoas" faria o RLS enxergar sempre o
 * mesmo auth.uid() e os testes de isolamento passariam por engano.
 */
export async function entrar(rotulo: "a" | "b" | "c"): Promise<Sessao> {
  const { email, password } = env.usuarios[rotulo];
  const sb = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(
      `Não consegui entrar como "${rotulo}" (${email}): ${error.message}. ` +
        `Confira se o usuário existe e está confirmado no Supabase.`,
    );
  }

  return { sb, id: data.user.id, rotulo };
}

/**
 * Toda lista criada pelos testes carrega este prefixo, e só listas com ele
 * podem ser apagadas. É a rede de segurança que permite rodar a suíte
 * contra o banco de produção: mesmo um teste futuro mal escrito não
 * consegue apagar a lista de compras de ninguém.
 */
export const PREFIXO_TESTE = "[teste]";

export async function criarLista(dono: Sessao, titulo = "teste automatizado") {
  const { data, error } = await dono.sb
    .from("lists")
    .insert({ title: `${PREFIXO_TESTE} ${titulo}`, owner_id: dono.id })
    .select("*")
    .single();

  if (error) throw new Error(`Falha ao criar lista: ${error.message}`);
  return data as { id: string; title: string; owner_id: string };
}

/** Apaga uma lista, recusando qualquer uma que não tenha sido criada aqui. */
export async function apagarLista(dono: Sessao, listaId: string) {
  const { data } = await dono.sb
    .from("lists")
    .select("title")
    .eq("id", listaId)
    .maybeSingle();

  // Já sumiu (ou nunca foi visível): nada a fazer.
  if (!data) return;

  if (!data.title.startsWith(PREFIXO_TESTE)) {
    throw new Error(
      `Recusando apagar "${data.title}": não é uma lista de teste. ` +
        `Os testes só podem apagar listas que eles mesmos criaram, com o ` +
        `prefixo "${PREFIXO_TESTE}". Use criarLista() em vez de inserir à mão.`,
    );
  }

  await dono.sb.from("lists").delete().eq("id", listaId);
}

/**
 * Varre listas de teste que tenham sobrado — acontece quando a suíte é
 * interrompida no meio e o afterAll não roda.
 */
export async function limparResiduos(sessao: Sessao) {
  const { data } = await sessao.sb
    .from("lists")
    .select("id, title")
    .like("title", `${PREFIXO_TESTE}%`);

  for (const lista of data ?? []) {
    await sessao.sb.from("lists").delete().eq("id", lista.id);
  }
  return data?.length ?? 0;
}

export async function adicionarItem(
  sessao: Sessao,
  listaId: string,
  nome: string,
  qty = 1,
) {
  const { data, error } = await sessao.sb
    .from("items")
    .insert({ list_id: listaId, name: nome, qty, added_by: sessao.id })
    .select("*")
    .single();

  if (error) throw new Error(`Falha ao adicionar item: ${error.message}`);
  return data;
}

export const esperar = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Inscreve num canal e só devolve quando a replicação está mesmo pronta.
 *
 * O status SUBSCRIBED chega antes de o Postgres atrelar a replicação —
 * medimos uma janela de ~3s em que eventos se perdem. Foi por causa dela
 * que a aplicação passou a reconciliar o estado ao inscrever. Aqui a folga
 * evita que o teste acuse falha que é de temporização, não de código.
 */
export async function inscrever(
  sessao: Sessao,
  nome: string,
  configurar: (canal: ReturnType<SupabaseClient["channel"]>) => void,
) {
  const canal = sessao.sb.channel(nome);
  configurar(canal);

  await new Promise<void>((resolve, reject) => {
    const limite = setTimeout(
      () => reject(new Error(`timeout ao inscrever em ${nome}`)),
      15_000,
    );
    canal.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(limite);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(limite);
        reject(new Error(`canal ${nome} falhou: ${status}`));
      }
    });
  });

  await esperar(3000);
  return canal;
}
