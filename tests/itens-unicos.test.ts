import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { adicionarItem, apagarLista, criarLista, entrar, type Sessao } from "./helpers";
import type { Item } from "../src/lib/types";

async function adicionarOuSomar(
  sessao: Sessao,
  listaId: string,
  nome: string,
  qty = 1,
) {
  const { data, error } = await sessao.sb
    .rpc("add_or_bump_item", { p_list: listaId, p_name: nome, p_qty: qty })
    .single<Item>();
  return { item: data, error };
}

/**
 * Adicionar algo que já está na lista deve somar, nunca criar uma segunda
 * linha. A checagem no aplicativo resolve o caso comum, mas não a corrida:
 * duas pessoas adicionando o mesmo nome ao mesmo tempo não enxergam o item
 * uma da outra. Estes testes cobrem o que só o banco pode garantir.
 */
describe("um item, uma linha", () => {
  let dona: Sessao;
  let listaId: string;

  beforeAll(async () => {
    dona = await entrar("a");
    listaId = (await criarLista(dona, "unicos")).id;
  });

  afterAll(async () => {
    if (listaId) await apagarLista(dona, listaId);
  });

  test("adicionar duas vezes soma em vez de duplicar", async () => {
    await adicionarOuSomar(dona, listaId, "Leite", 2);
    const { item } = await adicionarOuSomar(dona, listaId, "Leite", 3);

    expect(item?.qty).toBe(5);

    const { data } = await dona.sb
      .from("items")
      .select("id")
      .eq("list_id", listaId);
    expect(data).toHaveLength(1);
  });

  test("maiúsculas e espaços não criam item novo", async () => {
    const { item } = await adicionarOuSomar(dona, listaId, "  LEITE  ", 1);

    expect(item?.qty).toBe(6);
    const { data } = await dona.sb.from("items").select("id").eq("list_id", listaId);
    expect(data).toHaveLength(1);
  });

  test("nomes diferentes continuam sendo itens diferentes", async () => {
    // Nada de correspondência aproximada: adivinhar aqui daria errado.
    await adicionarOuSomar(dona, listaId, "Leite integral", 1);

    const { data } = await dona.sb.from("items").select("name").eq("list_id", listaId);
    expect(data).toHaveLength(2);
  });

  test("somar num item riscado devolve ele para os pendentes", async () => {
    const { data: leite } = await dona.sb
      .from("items")
      .select("id")
      .eq("list_id", listaId)
      .ilike("name", "leite")
      .single();

    await dona.sb
      .from("items")
      .update({ done: true, checked_by: dona.id })
      .eq("id", leite!.id);

    const { item } = await adicionarOuSomar(dona, listaId, "Leite", 1);

    // Quem adiciona de novo algo que já está no carrinho precisa comprar
    // mais — deixar riscado esconderia isso na seção fechada.
    expect(item?.done).toBe(false);
    expect(item?.checked_by).toBeNull();
    expect(item?.qty).toBe(7);
  });

  test("o banco recusa duplicata inserida por fora", async () => {
    const { error } = await dona.sb.from("items").insert({
      list_id: listaId,
      name: "leite",
      qty: 1,
      added_by: dona.id,
    });

    expect(error?.code).toBe("23505");
  });

  test("renomear para um nome que já existe é recusado", async () => {
    const { data: outro } = await dona.sb
      .from("items")
      .select("id")
      .eq("list_id", listaId)
      .ilike("name", "leite integral")
      .single();

    const { error } = await dona.sb
      .from("items")
      .update({ name: "Leite" })
      .eq("id", outro!.id);

    expect(error?.code).toBe("23505");
  });
});

describe("duas pessoas adicionando ao mesmo tempo", () => {
  let dona: Sessao;
  let convidada: Sessao;
  let listaId: string;

  beforeAll(async () => {
    [dona, convidada] = await Promise.all([entrar("a"), entrar("b")]);
    listaId = (await criarLista(dona, "corrida")).id;

    const { data } = await dona.sb
      .from("list_invites")
      .insert({ list_id: listaId, created_by: dona.id })
      .select("token")
      .single();
    await convidada.sb.rpc("join_list_with_token", { p_token: data!.token });
  });

  afterAll(async () => {
    if (listaId) await apagarLista(dona, listaId);
  });

  test("nenhuma das duas cria linha repetida", async () => {
    // É o caso que a checagem no aplicativo não cobre: nenhum dos dois
    // celulares vê o item do outro no instante do toque.
    const [a, b] = await Promise.all([
      adicionarOuSomar(dona, listaId, "Café", 2),
      adicionarOuSomar(convidada, listaId, "Café", 3),
    ]);

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    const { data } = await dona.sb
      .from("items")
      .select("qty")
      .eq("list_id", listaId);

    expect(data).toHaveLength(1);
    // Nada se perde: as duas quantidades entram.
    expect(data![0].qty).toBe(5);
  });
});

describe("o RLS continua valendo na função", () => {
  test("quem não é membro não consegue adicionar", async () => {
    const dona = await entrar("a");
    const estranha = await entrar("c");
    const lista = await criarLista(dona, "unicos rls");

    const { error } = await adicionarOuSomar(estranha, lista.id, "invasao", 1);
    expect(error).not.toBeNull();

    const { data } = await dona.sb.from("items").select("id").eq("list_id", lista.id);
    expect(data).toEqual([]);

    await apagarLista(dona, lista.id);
  });
});

describe("os helpers dos outros testes seguem funcionando", () => {
  test("adicionarItem direto ainda cria item", async () => {
    const dona = await entrar("a");
    const lista = await criarLista(dona, "unicos helper");

    const item = await adicionarItem(dona, lista.id, "Pão", 1);
    expect(item.name).toBe("Pão");

    await apagarLista(dona, lista.id);
  });
});
