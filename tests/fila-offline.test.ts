import { describe, expect, test } from "vitest";
import {
  aplicar,
  ehFalhaDeRede,
  enfileirar,
  idsPendentes,
  type Operacao,
} from "../src/lib/fila-offline";
import type { Item } from "../src/lib/types";

const ctx = { listaId: "lista-1", usuarioId: "eu" };

const criar = (id: string, name = "Leite", qty = 1, done = false): Operacao => ({
  tipo: "criar",
  id,
  campos: { name, qty, done },
  em: 1,
});

const upd = (id: string, campos: Record<string, unknown>, em = 2): Operacao =>
  ({ tipo: "atualizar", id, campos, em }) as Operacao;

const excluir = (id: string, em = 3): Operacao => ({ tipo: "excluir", id, em });

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  list_id: "lista-1",
  name: "Leite",
  qty: 1,
  done: false,
  added_by: "outra",
  checked_by: null,
  updated_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("coalescência: itens criados offline", () => {
  test("alterar um item recém-criado reescreve o rascunho", () => {
    // O ponto central: um update solto referenciaria um id temporário que
    // deixa de existir no momento do insert.
    let fila = enfileirar([], criar("tmp-1", "Leite"));
    fila = enfileirar(fila, upd("tmp-1", { name: "Leite integral" }));
    fila = enfileirar(fila, upd("tmp-1", { qty: 3 }));

    expect(fila).toHaveLength(1);
    expect(fila[0].tipo).toBe("criar");
    expect(fila[0]).toMatchObject({
      campos: { name: "Leite integral", qty: 3, done: false },
    });
  });

  test("criar e apagar offline não deixa rastro", () => {
    let fila = enfileirar([], criar("tmp-1"));
    fila = enfileirar(fila, excluir("tmp-1"));

    expect(fila).toEqual([]);
  });

  test("marcar um item criado offline entra no próprio rascunho", () => {
    let fila = enfileirar([], criar("tmp-1"));
    fila = enfileirar(fila, upd("tmp-1", { done: true }));

    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ tipo: "criar", campos: { done: true } });
  });
});

describe("coalescência: itens que já existem no servidor", () => {
  test("updates sobre o mesmo item se fundem campo a campo", () => {
    let fila = enfileirar([], upd("real-1", { done: true }));
    fila = enfileirar(fila, upd("real-1", { qty: 5 }));

    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ campos: { done: true, qty: 5 } });
  });

  test("o valor mais recente vence no mesmo campo", () => {
    let fila = enfileirar([], upd("real-1", { qty: 2 }));
    fila = enfileirar(fila, upd("real-1", { qty: 9 }));

    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ campos: { qty: 9 } });
  });

  test("excluir descarta as alterações anteriores do item", () => {
    let fila = enfileirar([], upd("real-1", { name: "irrelevante" }));
    fila = enfileirar(fila, excluir("real-1"));

    expect(fila).toEqual([expect.objectContaining({ tipo: "excluir" })]);
  });

  test("itens diferentes não interferem entre si", () => {
    let fila = enfileirar([], upd("real-1", { done: true }));
    fila = enfileirar(fila, upd("real-2", { qty: 4 }));
    fila = enfileirar(fila, excluir("real-3"));

    expect(fila).toHaveLength(3);
    expect(idsPendentes(fila)).toEqual(new Set(["real-1", "real-2", "real-3"]));
  });
});

describe("projeção sobre o estado do servidor", () => {
  test("o que veio do servidor aparece como está", () => {
    expect(aplicar([item("a")], [], ctx)).toHaveLength(1);
  });

  test("a fila é reaplicada por cima dos dados do servidor", () => {
    // Sem isto, a reconciliação após reconectar desfaria na tela o que a
    // pessoa fez offline.
    const servidor = [item("real-1", { done: false, qty: 1 })];
    const fila = [upd("real-1", { done: true, qty: 7 })];

    const [resultado] = aplicar(servidor, fila, ctx);
    expect(resultado.done).toBe(true);
    expect(resultado.qty).toBe(7);
  });

  test("marcar offline registra quem marcou", () => {
    const [r] = aplicar([item("real-1")], [upd("real-1", { done: true })], ctx);
    expect(r.checked_by).toBe("eu");
  });

  test("desmarcar limpa quem marcou", () => {
    const servidor = [item("real-1", { done: true, checked_by: "outra" })];
    const [r] = aplicar(servidor, [upd("real-1", { done: false })], ctx);
    expect(r.checked_by).toBeNull();
  });

  test("item criado offline aparece na lista", () => {
    const r = aplicar([], [criar("tmp-1", "Café", 2)], ctx);

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      id: "tmp-1",
      name: "Café",
      qty: 2,
      list_id: "lista-1",
      added_by: "eu",
    });
  });

  test("item excluído offline some, mesmo vindo do servidor", () => {
    const r = aplicar([item("real-1"), item("real-2")], [excluir("real-1")], ctx);

    expect(r.map((i) => i.id)).toEqual(["real-2"]);
  });

  test("update para item inexistente não quebra nem inventa item", () => {
    const r = aplicar([item("real-1")], [upd("sumiu", { done: true })], ctx);
    expect(r).toHaveLength(1);
  });
});

describe("o que entra na fila e o que vira erro", () => {
  test("falha de rede entra na fila", () => {
    expect(ehFalhaDeRede(new TypeError("Failed to fetch"))).toBe(true);
    expect(ehFalhaDeRede({ message: "NetworkError when attempting to fetch" })).toBe(true);
    expect(ehFalhaDeRede({ message: "Load failed" })).toBe(true);
  });

  test("erro de permissão NÃO entra na fila", () => {
    // Repetir um 42501 nunca vai funcionar: viraria pendência eterna, e a
    // pessoa nunca entenderia por que a sincronização não termina.
    expect(ehFalhaDeRede({ code: "42501", message: "permission denied" })).toBe(false);
  });

  test("erro de validação NÃO entra na fila", () => {
    expect(ehFalhaDeRede({ code: "23514", message: "check constraint" })).toBe(false);
    expect(ehFalhaDeRede({ status: 400, message: "Bad Request" })).toBe(false);
  });

  test("sem erro nenhum, nada a enfileirar", () => {
    expect(ehFalhaDeRede(null)).toBe(false);
  });
});
