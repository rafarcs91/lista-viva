import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { executarOperacao, type Operacao } from "../src/lib/fila-offline";
import { apagarLista, criarLista, entrar, type Sessao } from "./helpers";

/**
 * A fila em si é testada sem rede em fila-offline.test.ts. Aqui o alvo é o
 * outro lado: a tradução de cada operação na escrita correspondente, contra
 * um Postgres de verdade.
 *
 * É onde um campo esquecido corrompe dados em silêncio. Um item criado já
 * marcado sem `checked_by`, por exemplo, entraria no banco sem autor — e o
 * app mostraria "marcado por alguém" para sempre, sem erro nenhum.
 */
describe("reenvio da fila contra o banco", () => {
  let dona: Sessao;
  let listaId: string;

  const ctx = () => ({ listaId, usuarioId: dona.id });

  beforeAll(async () => {
    dona = await entrar("a");
    const lista = await criarLista(dona, "fila offline");
    listaId = lista.id;
  });

  afterAll(async () => {
    if (listaId) await apagarLista(dona, listaId);
  });

  test("criar grava todos os campos do rascunho", async () => {
    const op: Operacao = {
      tipo: "criar",
      id: "tmp-1",
      campos: { name: "Leite integral", qty: 3, done: false },
      em: Date.now(),
    };

    const r = await executarOperacao(dona.sb, op, ctx());

    expect(r.estado).toBe("ok");
    if (r.estado !== "ok") return;
    expect(r.item).toMatchObject({
      name: "Leite integral",
      qty: 3,
      done: false,
      added_by: dona.id,
    });
  });

  test("item criado já marcado registra quem marcou", async () => {
    // O caso que mais fácil se esquece: marcar e criar na mesma operação,
    // porque a coalescência funde as duas coisas num rascunho só.
    const op: Operacao = {
      tipo: "criar",
      id: "tmp-2",
      campos: { name: "Arroz", qty: 1, done: true },
      em: Date.now(),
    };

    const r = await executarOperacao(dona.sb, op, ctx());

    expect(r.estado).toBe("ok");
    if (r.estado !== "ok") return;
    expect(r.item?.done).toBe(true);
    expect(r.item?.checked_by).toBe(dona.id);
  });

  test("atualizar aplica os campos e credita o autor", async () => {
    const criado = await executarOperacao(
      dona.sb,
      { tipo: "criar", id: "tmp-3", campos: { name: "Café", qty: 1, done: false }, em: Date.now() },
      ctx(),
    );
    if (criado.estado !== "ok" || !criado.item) throw new Error("setup falhou");

    const r = await executarOperacao(
      dona.sb,
      {
        tipo: "atualizar",
        id: criado.item.id,
        campos: { name: "Café em grãos", qty: 2, done: true },
        em: Date.now(),
      },
      ctx(),
    );

    expect(r.estado).toBe("ok");

    const { data } = await dona.sb
      .from("items")
      .select("*")
      .eq("id", criado.item.id)
      .single();

    expect(data).toMatchObject({
      name: "Café em grãos",
      qty: 2,
      done: true,
      checked_by: dona.id,
      updated_by: dona.id,
    });
  });

  test("desmarcar pela fila limpa quem marcou", async () => {
    const criado = await executarOperacao(
      dona.sb,
      { tipo: "criar", id: "tmp-4", campos: { name: "Pão", qty: 1, done: true }, em: Date.now() },
      ctx(),
    );
    if (criado.estado !== "ok" || !criado.item) throw new Error("setup falhou");

    await executarOperacao(
      dona.sb,
      { tipo: "atualizar", id: criado.item.id, campos: { done: false }, em: Date.now() },
      ctx(),
    );

    const { data } = await dona.sb
      .from("items")
      .select("done, checked_by")
      .eq("id", criado.item.id)
      .single();

    expect(data?.done).toBe(false);
    expect(data?.checked_by).toBeNull();
  });

  test("excluir remove do banco", async () => {
    const criado = await executarOperacao(
      dona.sb,
      { tipo: "criar", id: "tmp-5", campos: { name: "Sabão", qty: 1, done: false }, em: Date.now() },
      ctx(),
    );
    if (criado.estado !== "ok" || !criado.item) throw new Error("setup falhou");

    const r = await executarOperacao(
      dona.sb,
      { tipo: "excluir", id: criado.item.id, em: Date.now() },
      ctx(),
    );

    expect(r.estado).toBe("ok");

    const { data } = await dona.sb
      .from("items")
      .select("id")
      .eq("id", criado.item.id)
      .maybeSingle();
    expect(data).toBeNull();
  });

  test("erro de permissão é reportado como erro, não como falta de rede", async () => {
    // A distinção decide o destino da operação: rede volta para a fila,
    // erro é descartado. Confundir os dois trava a sincronização para sempre.
    const estranha = await entrar("c");

    const r = await executarOperacao(
      estranha.sb,
      { tipo: "criar", id: "tmp-6", campos: { name: "invasao", qty: 1, done: false }, em: Date.now() },
      { listaId, usuarioId: estranha.id },
    );

    expect(r.estado).toBe("erro");
  });
});
