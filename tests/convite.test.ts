import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  adicionarItem,
  apagarLista,
  criarLista,
  entrar,
  type Sessao,
} from "./helpers";

describe("entrar por convite", () => {
  let dona: Sessao;
  let convidada: Sessao;
  let listaId: string;
  let token: string;

  beforeAll(async () => {
    [dona, convidada] = await Promise.all([entrar("a"), entrar("b")]);
    const lista = await criarLista(dona, "convite");
    listaId = lista.id;
    await adicionarItem(dona, listaId, "Pão", 1);

    const { data } = await dona.sb
      .from("list_invites")
      .insert({ list_id: listaId, created_by: dona.id })
      .select("token")
      .single();
    token = data!.token;
  });

  afterAll(async () => {
    if (listaId) await apagarLista(dona, listaId);
  });

  test("o token gerado é curto e seguro para URL", () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(10);
  });

  test("antes de entrar, a convidada não vê nada", async () => {
    const { data } = await convidada.sb
      .from("lists")
      .select("*")
      .eq("id", listaId);

    expect(data).toEqual([]);
  });

  test("token inválido é recusado", async () => {
    const { error } = await convidada.sb.rpc("join_list_with_token", {
      p_token: "token-que-nao-existe",
    });

    expect(error).not.toBeNull();
  });

  test("o convite dá acesso à lista", async () => {
    const { data, error } = await convidada.sb.rpc("join_list_with_token", {
      p_token: token,
    });

    expect(error).toBeNull();
    expect(data).toBe(listaId);
  });

  test("depois de entrar, a convidada vê os itens", async () => {
    const { data } = await convidada.sb
      .from("items")
      .select("*")
      .eq("list_id", listaId);

    expect(data).toHaveLength(1);
    expect(data![0].name).toBe("Pão");
  });

  test("membros passam a enxergar o perfil um do outro", async () => {
    // É o que permite mostrar nome e cor de quem mexeu num item.
    const { data } = await convidada.sb
      .from("profiles")
      .select("display_name")
      .eq("id", dona.id)
      .maybeSingle();

    expect(data?.display_name).toBeTruthy();
  });

  test("usar o convite duas vezes não duplica a associação", async () => {
    await convidada.sb.rpc("join_list_with_token", { p_token: token });

    const { data } = await convidada.sb
      .from("list_members")
      .select("user_id")
      .eq("list_id", listaId)
      .eq("user_id", convidada.id);

    expect(data).toHaveLength(1);
  });

  test("quem sai da lista perde o acesso", async () => {
    await convidada.sb
      .from("list_members")
      .delete()
      .eq("list_id", listaId)
      .eq("user_id", convidada.id);

    const { data } = await convidada.sb
      .from("lists")
      .select("*")
      .eq("id", listaId);

    expect(data).toEqual([]);
  });
});

describe("validade e revogação do convite", () => {
  let dona: Sessao;
  let convidada: Sessao;
  let listaId: string;

  beforeAll(async () => {
    [dona, convidada] = await Promise.all([entrar("a"), entrar("b")]);
    const lista = await criarLista(dona, "validade");
    listaId = lista.id;
  });

  afterAll(async () => {
    if (listaId) await apagarLista(dona, listaId);
  });

  test("todo convite nasce com prazo", async () => {
    const { data } = await dona.sb
      .from("list_invites")
      .insert({ list_id: listaId, created_by: dona.id })
      .select("expires_at")
      .single();

    expect(data?.expires_at).toBeTruthy();

    const prazo = new Date(data!.expires_at).getTime() - Date.now();
    const dia = 24 * 60 * 60 * 1000;
    expect(prazo).toBeGreaterThan(6 * dia);
    expect(prazo).toBeLessThan(8 * dia);
  });

  test("convite vencido é recusado", async () => {
    const { data } = await dona.sb
      .from("list_invites")
      .insert({
        list_id: listaId,
        created_by: dona.id,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      })
      .select("token")
      .single();

    const { error } = await convidada.sb.rpc("join_list_with_token", {
      p_token: data!.token,
    });

    expect(error).not.toBeNull();
    // Vencido e inexistente são situações diferentes para quem recebeu o
    // link, e a tela precisa poder explicar cada uma.
    expect(error?.message).toMatch(/expirado/i);
  });

  test("token inexistente dá erro distinto de vencido", async () => {
    const { error } = await convidada.sb.rpc("join_list_with_token", {
      p_token: "nao-existe-mesmo",
    });

    expect(error?.message).toMatch(/inválido/i);
    expect(error?.message).not.toMatch(/expirado/i);
  });

  test("gerar link novo invalida o anterior", async () => {
    // É o que dá sentido a remover alguém: sem revogar, a pessoa removida
    // voltaria pelo link que ainda tem no celular.
    const { data: antigo } = await dona.sb
      .from("list_invites")
      .insert({ list_id: listaId, created_by: dona.id })
      .select("token")
      .single();

    await dona.sb.from("list_invites").delete().eq("list_id", listaId);

    const { data: novo } = await dona.sb
      .from("list_invites")
      .insert({ list_id: listaId, created_by: dona.id })
      .select("token")
      .single();

    expect(novo!.token).not.toBe(antigo!.token);

    const velho = await convidada.sb.rpc("join_list_with_token", {
      p_token: antigo!.token,
    });
    expect(velho.error).not.toBeNull();

    const atual = await convidada.sb.rpc("join_list_with_token", {
      p_token: novo!.token,
    });
    expect(atual.error).toBeNull();
    expect(atual.data).toBe(listaId);
  });

  test("quem não é membro não consegue revogar convites alheios", async () => {
    const estranha = await entrar("c");

    const { data: antes } = await dona.sb
      .from("list_invites")
      .select("token")
      .eq("list_id", listaId);

    await estranha.sb.from("list_invites").delete().eq("list_id", listaId);

    const { data: depois } = await dona.sb
      .from("list_invites")
      .select("token")
      .eq("list_id", listaId);

    expect(depois?.length).toBe(antes?.length);
  });
});
