import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  adicionarItem,
  apagarLista,
  criarLista,
  entrar,
  esperar,
  inscrever,
  type Sessao,
} from "./helpers";

type Evento = {
  eventType: string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
};

/**
 * Estes testes cobrem as duas configurações de banco mais fáceis de perder
 * numa migração futura, e cujo estrago é invisível:
 *
 * 1. `alter table items replica identity full` — sem isso o payload de
 *    DELETE traz só a chave primária, o filtro por list_id nunca casa, e
 *    exclusões feitas por outra pessoa somem da tela de quem está junto.
 *    O mesmo ajuste é o que faz o UPDATE trazer a linha antiga, base para
 *    a interface dizer *o que* mudou em vez de adivinhar.
 *
 * 2. `alter publication supabase_realtime add table ...` — se a tabela sair
 *    da publicação, nenhum evento chega e o app vira uma lista comum, sem
 *    erro nenhum aparecendo.
 */
describe("sincronização em tempo real", () => {
  let ana: Sessao;
  let leo: Sessao;
  let listaId: string;
  let itemId: string;
  let canal: RealtimeChannel;
  const eventos: Evento[] = [];

  beforeAll(async () => {
    [ana, leo] = await Promise.all([entrar("a"), entrar("b")]);

    const lista = await criarLista(ana, "realtime");
    listaId = lista.id;

    const { data: convite } = await ana.sb
      .from("list_invites")
      .insert({ list_id: listaId, created_by: ana.id })
      .select("token")
      .single();
    await leo.sb.rpc("join_list_with_token", { p_token: convite!.token });

    const item = await adicionarItem(ana, listaId, "Leite integral", 2);
    itemId = item.id;

    // Ana escuta; Léo age. É o cenário real: duas pessoas, telas separadas.
    canal = await inscrever(ana, `itens:${listaId}`, (c) =>
      c.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "items",
          filter: `list_id=eq.${listaId}`,
        },
        (payload) => eventos.push(payload as unknown as Evento),
      ),
    );
  });

  afterAll(async () => {
    if (canal) await ana.sb.removeChannel(canal);
    if (listaId) await apagarLista(ana, listaId);
  });

  test("marcar um item chega para quem está junto", async () => {
    await leo.sb
      .from("items")
      .update({ done: true, checked_by: leo.id, updated_by: leo.id })
      .eq("id", itemId);
    await esperar(2500);

    const evento = eventos.find(
      (e) => e.eventType === "UPDATE" && e.new?.done === true,
    );
    expect(evento).toBeDefined();
  });

  test("o evento identifica quem mexeu", async () => {
    // Sem updated_by, uma mudança de quantidade seria creditada a quem
    // marcou o item por último — a linha de atividade mentiria.
    const evento = eventos.find(
      (e) => e.eventType === "UPDATE" && e.new?.done === true,
    );
    expect(evento?.new?.updated_by).toBe(leo.id);
  });

  test("o UPDATE traz a linha antiga (REPLICA IDENTITY FULL)", async () => {
    const evento = eventos.find(
      (e) => e.eventType === "UPDATE" && e.new?.done === true,
    );

    expect(evento?.old).toBeDefined();
    expect(Object.keys(evento!.old!).length).toBeGreaterThan(1);
    expect(evento!.old!.done).toBe(false);
  });

  test("mudar a quantidade sincroniza", async () => {
    await leo.sb
      .from("items")
      .update({ qty: 5, updated_by: leo.id })
      .eq("id", itemId);
    await esperar(2500);

    const evento = eventos.find(
      (e) => e.eventType === "UPDATE" && e.new?.qty === 5,
    );
    expect(evento).toBeDefined();
    expect(evento?.old?.qty).toBe(2);
  });

  test("adicionar um item chega para quem está junto", async () => {
    await adicionarItem(leo, listaId, "Guardanapo", 2);
    await esperar(2500);

    const evento = eventos.find(
      (e) => e.eventType === "INSERT" && e.new?.name === "Guardanapo",
    );
    expect(evento).toBeDefined();
    expect(evento?.new?.added_by).toBe(leo.id);
  });

  test("excluir chega apesar do filtro por list_id", async () => {
    await leo.sb.from("items").delete().eq("id", itemId);
    await esperar(2500);

    const evento = eventos.find((e) => e.eventType === "DELETE");
    expect(evento).toBeDefined();
    expect(evento?.old?.id).toBe(itemId);
  });
});

describe("a lista em si também sincroniza", () => {
  let ana: Sessao;
  let listaId: string;
  let canal: RealtimeChannel;
  const eventos: Evento[] = [];

  beforeAll(async () => {
    ana = await entrar("a");
    const lista = await criarLista(ana, "titulo");
    listaId = lista.id;

    canal = await inscrever(ana, `lista:${listaId}`, (c) =>
      c.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lists",
          filter: `id=eq.${listaId}`,
        },
        (payload) => eventos.push(payload as unknown as Evento),
      ),
    );
  });

  afterAll(async () => {
    if (canal) await ana.sb.removeChannel(canal);
    if (listaId) await apagarLista(ana, listaId);
  });

  test("renomear aparece para quem está com a lista aberta", async () => {
    await ana.sb
      .from("lists")
      .update({ title: "[teste] titulo novo" })
      .eq("id", listaId);
    await esperar(2500);

    const evento = eventos.find((e) => e.eventType === "UPDATE");
    expect(evento?.new?.title).toBe("[teste] titulo novo");
  });
});
