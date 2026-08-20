import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  adicionarItem,
  apagarLista,
  criarLista,
  entrar,
  type Sessao,
} from "./helpers";

type Sugestao = { name: string; vezes: number };

async function sugerir(sessao: Sessao, listaId: string) {
  const { data, error } = await sessao.sb.rpc("item_suggestions", {
    p_list: listaId,
    p_limit: 12,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Sugestao[];
}

describe("sugestões pelo histórico", () => {
  let dona: Sessao;
  let estranha: Sessao;
  let antiga: string;
  let atual: string;
  let alheia: string;

  beforeAll(async () => {
    [dona, estranha] = await Promise.all([entrar("a"), entrar("c")]);

    // Uma lista anterior, que faz as vezes de histórico.
    antiga = (await criarLista(dona, "sugestoes antiga")).id;
    await adicionarItem(dona, antiga, "Leite integral", 1);
    await adicionarItem(dona, antiga, "Café em grãos", 1);
    await adicionarItem(dona, antiga, "Pão", 1);

    // A lista aberta agora, onde as sugestões vão aparecer.
    atual = (await criarLista(dona, "sugestoes atual")).id;
    await adicionarItem(dona, atual, "Pão", 1);

    // Lista de outra pessoa, que jamais deve influenciar.
    alheia = (await criarLista(estranha, "sugestoes alheia")).id;
    await adicionarItem(estranha, alheia, "Caviar", 1);
  });

  afterAll(async () => {
    await apagarLista(dona, antiga);
    await apagarLista(dona, atual);
    await apagarLista(estranha, alheia);
  });

  test("sugere o que já foi comprado em outra lista", async () => {
    const nomes = (await sugerir(dona, atual)).map((s) => s.name);

    expect(nomes).toContain("Leite integral");
    expect(nomes).toContain("Café em grãos");
  });

  test("não sugere o que já está na lista aberta", async () => {
    // "Pão" existe nas duas listas. Sugeri-lo seria oferecer à pessoa algo
    // que ela está olhando na tela.
    const nomes = (await sugerir(dona, atual)).map((s) => s.name);
    expect(nomes).not.toContain("Pão");
  });

  test("NÃO vaza itens de listas de outras pessoas", async () => {
    // O risco real da função: escrita como SECURITY DEFINER, ela devolveria
    // a lista de compras de estranhos como sugestão.
    const nomes = (await sugerir(dona, atual)).map((s) => s.name);
    expect(nomes).not.toContain("Caviar");
  });

  test("quem tem mais repetições vem primeiro", async () => {
    const extra = (await criarLista(dona, "sugestoes repetida")).id;
    await adicionarItem(dona, extra, "Leite integral", 1);

    const sugestoes = await sugerir(dona, atual);
    const leite = sugestoes.find((s) => s.name === "Leite integral");
    const cafe = sugestoes.find((s) => s.name === "Café em grãos");

    expect(Number(leite?.vezes)).toBeGreaterThan(Number(cafe?.vezes));
    expect(sugestoes[0].name).toBe("Leite integral");

    await apagarLista(dona, extra);
  });

  test("o limite pedido é respeitado", async () => {
    const { data } = await dona.sb.rpc("item_suggestions", {
      p_list: atual,
      p_limit: 1,
    });
    expect((data ?? []).length).toBe(1);
  });

  test("quem não tem histórico não recebe sugestão", async () => {
    const semNada = await entrar("b");
    const lista = await criarLista(semNada, "sugestoes vazias");

    const nomes = (await sugerir(semNada, lista.id)).map((s) => s.name);
    expect(nomes).not.toContain("Leite integral");

    await apagarLista(semNada, lista.id);
  });
});
