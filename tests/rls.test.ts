import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  adicionarItem,
  apagarLista,
  criarLista,
  entrar,
  type Sessao,
} from "./helpers";

/**
 * O RLS é a única coisa entre a lista de compras de uma família e o resto
 * da internet. Um `using (true)` colado por engano numa política não
 * quebra build nem lint — some silenciosamente com o isolamento. É o que
 * estes testes existem para pegar.
 */
describe("isolamento entre pessoas (RLS)", () => {
  let dona: Sessao;
  let convidada: Sessao;
  let estranha: Sessao;
  let listaId: string;

  beforeAll(async () => {
    [dona, convidada, estranha] = await Promise.all([
      entrar("a"),
      entrar("b"),
      entrar("c"),
    ]);
    const lista = await criarLista(dona, "isolamento");
    listaId = lista.id;
    await adicionarItem(dona, listaId, "Leite integral", 2);
  });

  afterAll(async () => {
    if (listaId) await apagarLista(dona, listaId);
  });

  test("quem criou a lista vira dona por trigger", async () => {
    const { data } = await dona.sb
      .from("list_members")
      .select("role")
      .eq("list_id", listaId)
      .eq("user_id", dona.id)
      .maybeSingle();

    expect(data?.role).toBe("owner");
  });

  test("todo usuário tem perfil com nome e cor", async () => {
    const { data } = await dona.sb
      .from("profiles")
      .select("display_name, color")
      .eq("id", dona.id)
      .maybeSingle();

    expect(data?.display_name).toBeTruthy();
    expect(["mint", "violet", "amber", "coral", "sky"]).toContain(data?.color);
  });

  test("quem não é membro não enxerga a lista", async () => {
    const { data } = await estranha.sb
      .from("lists")
      .select("*")
      .eq("id", listaId);

    expect(data).toEqual([]);
  });

  test("quem não é membro não enxerga os itens", async () => {
    const { data } = await estranha.sb
      .from("items")
      .select("*")
      .eq("list_id", listaId);

    expect(data).toEqual([]);
  });

  test("quem não é membro não consegue inserir item", async () => {
    const { error } = await estranha.sb.from("items").insert({
      list_id: listaId,
      name: "invasao",
      qty: 1,
      added_by: estranha.id,
    });

    // 42501 = insufficient_privilege, a política barrando a escrita.
    expect(error?.code).toBe("42501");
  });

  test("não dá para inserir item se passando por outra pessoa", async () => {
    // A política exige added_by = auth.uid(): sem isso, um membro poderia
    // creditar itens a terceiros e a linha de atividade viraria mentira.
    const { error } = await convidada.sb.from("items").insert({
      list_id: listaId,
      name: "atribuicao falsa",
      qty: 1,
      added_by: dona.id,
    });

    expect(error).not.toBeNull();
  });

  test("quem não é membro não consegue renomear item", async () => {
    const { data: item } = await dona.sb
      .from("items")
      .select("id, name")
      .eq("list_id", listaId)
      .limit(1)
      .single();

    await estranha.sb
      .from("items")
      .update({ name: "sequestrado", updated_by: estranha.id })
      .eq("id", item!.id);

    const { data: depois } = await dona.sb
      .from("items")
      .select("name")
      .eq("id", item!.id)
      .maybeSingle();

    expect(depois?.name).toBe(item!.name);
  });

  test("quem não divide lista não enxerga o perfil alheio", async () => {
    const { data } = await estranha.sb
      .from("profiles")
      .select("*")
      .eq("id", dona.id);

    expect(data).toEqual([]);
  });

  test("participante não consegue renomear a lista", async () => {
    await convidada.sb
      .from("lists")
      .update({ title: "[teste] sequestro" })
      .eq("id", listaId);

    const { data } = await dona.sb
      .from("lists")
      .select("title")
      .eq("id", listaId)
      .maybeSingle();

    expect(data?.title).toContain("isolamento");
  });

  test("participante não consegue apagar a lista", async () => {
    await convidada.sb.from("lists").delete().eq("id", listaId);

    const { data } = await dona.sb
      .from("lists")
      .select("id")
      .eq("id", listaId)
      .maybeSingle();

    expect(data?.id).toBe(listaId);
  });
});

describe("apagar em cascata", () => {
  test("apagar a lista leva os itens junto", async () => {
    const dona = await entrar("a");
    const lista = await criarLista(dona, "cascata");
    await adicionarItem(dona, lista.id, "Café", 1);

    await apagarLista(dona, lista.id);

    const { data } = await dona.sb
      .from("items")
      .select("*")
      .eq("list_id", lista.id);

    expect(data).toEqual([]);
  });
});

describe("a dona remove participantes", () => {
  let dona: Sessao;
  let convidada: Sessao;
  let outra: Sessao;
  let listaId: string;

  async function convidar(quem: Sessao) {
    const { data } = await dona.sb
      .from("list_invites")
      .insert({ list_id: listaId, created_by: dona.id })
      .select("token")
      .single();
    await quem.sb.rpc("join_list_with_token", { p_token: data!.token });
  }

  beforeAll(async () => {
    [dona, convidada, outra] = await Promise.all([
      entrar("a"),
      entrar("b"),
      entrar("c"),
    ]);
    const lista = await criarLista(dona, "remocao");
    listaId = lista.id;
    await convidar(convidada);
    await convidar(outra);
  });

  afterAll(async () => {
    if (listaId) await apagarLista(dona, listaId);
  });

  test("participante NÃO consegue remover outro participante", async () => {
    // Sem isto, qualquer convidado poderia expulsar os demais da lista.
    await convidada.sb
      .from("list_members")
      .delete()
      .eq("list_id", listaId)
      .eq("user_id", outra.id);

    const { data } = await outra.sb.from("lists").select("id").eq("id", listaId);
    expect(data).toHaveLength(1);
  });

  test("a dona remove um participante", async () => {
    await dona.sb
      .from("list_members")
      .delete()
      .eq("list_id", listaId)
      .eq("user_id", outra.id);

    const { data } = await dona.sb
      .from("list_members")
      .select("user_id")
      .eq("list_id", listaId)
      .eq("user_id", outra.id);
    expect(data).toEqual([]);
  });

  test("quem foi removido perde o acesso na hora", async () => {
    const { data } = await outra.sb.from("lists").select("id").eq("id", listaId);
    expect(data).toEqual([]);
  });

  test("os itens de quem saiu continuam na lista", async () => {
    // Remover alguém não é apagar o que a pessoa contribuiu: o leite que
    // ela adicionou continua sendo necessário para a compra.
    await adicionarItem(convidada, listaId, "Item da convidada", 1);

    await dona.sb
      .from("list_members")
      .delete()
      .eq("list_id", listaId)
      .eq("user_id", convidada.id);

    const { data } = await dona.sb
      .from("items")
      .select("name")
      .eq("list_id", listaId);

    expect(data?.map((i) => i.name)).toContain("Item da convidada");
  });
});
