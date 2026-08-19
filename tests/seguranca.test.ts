import { afterAll, describe, expect, test } from "vitest";
import {
  apagarLista,
  criarLista,
  entrar,
  limparResiduos,
  PREFIXO_TESTE,
} from "./helpers";

/**
 * A suíte roda contra o mesmo banco da aplicação. Foi uma decisão
 * consciente — projeto separado custaria a última vaga do plano gratuito —
 * mas ela só se sustenta enquanto os testes tocarem apenas o que criaram.
 *
 * Estes casos existem para que essa disciplina seja verificada por código,
 * e não confiada à memória de quem escrever o próximo teste.
 */
describe("proteção contra apagar dados reais", () => {
  test("toda lista criada pelos testes é identificável", async () => {
    const dona = await entrar("a");
    const lista = await criarLista(dona, "identificavel");

    expect(lista.title.startsWith(PREFIXO_TESTE)).toBe(true);

    await apagarLista(dona, lista.id);
  });

  test("apagar recusa lista que não foi criada pelos testes", async () => {
    const dona = await entrar("a");

    // Simula uma lista "de verdade": inserida sem passar por criarLista().
    const { data: real } = await dona.sb
      .from("lists")
      .insert({ title: "Compras da semana", owner_id: dona.id })
      .select("*")
      .single();

    await expect(apagarLista(dona, real!.id)).rejects.toThrow(
      /Recusando apagar/,
    );

    // Continua lá — a trava impediu a exclusão.
    const { data: aindaExiste } = await dona.sb
      .from("lists")
      .select("id")
      .eq("id", real!.id)
      .maybeSingle();
    expect(aindaExiste?.id).toBe(real!.id);

    // Limpeza direta: esta o teste criou de propósito, fora do padrão.
    await dona.sb.from("lists").delete().eq("id", real!.id);
  });

  afterAll(async () => {
    // Última linha de defesa: se algum teste caiu no meio e deixou lista
    // para trás, ela some aqui em vez de acumular no banco a cada push.
    const dona = await entrar("a");
    const sobraram = await limparResiduos(dona);
    if (sobraram > 0) {
      console.warn(`Limpei ${sobraram} lista(s) de teste que sobraram.`);
    }
  });
});
