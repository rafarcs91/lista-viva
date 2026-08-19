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

/** Cria uma lista com título rastreável, para facilitar limpeza manual. */
export async function criarLista(dono: Sessao, titulo = "teste automatizado") {
  const { data, error } = await dono.sb
    .from("lists")
    .insert({ title: `[teste] ${titulo}`, owner_id: dono.id })
    .select("*")
    .single();

  if (error) throw new Error(`Falha ao criar lista: ${error.message}`);
  return data as { id: string; title: string; owner_id: string };
}

export async function apagarLista(dono: Sessao, listaId: string) {
  await dono.sb.from("lists").delete().eq("id", listaId);
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
