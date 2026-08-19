import { describe, expect, test } from "vitest";
import {
  erroDaUrl,
  formatarEspera,
  traduzirErroLogin,
} from "../src/lib/erros-auth";

/**
 * Único arquivo da suíte que não fala com o banco: a tradução é função
 * pura. Roda em milissegundos e não precisa de credencial nenhuma.
 */
describe("intervalo entre pedidos de link", () => {
  test("extrai os segundos da mensagem do Supabase", () => {
    const r = traduzirErroLogin(
      "For security purposes, you can only request this after 38 seconds.",
    );

    expect(r.esperar).toBe(38);
    expect(r.texto).toContain("38 segundos");
    expect(r.texto).not.toMatch(/security purposes/i);
  });

  test("funciona no singular", () => {
    expect(
      traduzirErroLogin("you can only request this after 1 second.").esperar,
    ).toBe(1);
  });
});

describe("outros erros de envio", () => {
  test("limite de envios vira explicação em português", () => {
    const r = traduzirErroLogin("email rate limit exceeded");

    expect(r.esperar).toBeUndefined();
    expect(r.texto).toMatch(/minutos/);
    expect(r.texto).not.toMatch(/rate limit/i);
  });

  test("e-mail inválido", () => {
    const r = traduzirErroLogin('Email address "x@y" is invalid');
    expect(r.texto).toMatch(/não parece válido/);
  });

  test("falha de rede", () => {
    expect(traduzirErroLogin("Failed to fetch").texto).toMatch(/conexão/);
  });

  test("erro desconhecido não vaza texto do servidor", () => {
    const r = traduzirErroLogin("PGRST301: JWSError JWSInvalidSignature");

    expect(r.texto).not.toMatch(/PGRST|JWS/);
    expect(r.texto).toMatch(/Tente de novo/);
  });
});

describe("erros vindos do callback do link mágico", () => {
  test("link expirado explica que vale uma vez só", () => {
    const t = erroDaUrl("link_expirado");
    expect(t).toMatch(/uma hora/);
    expect(t).toMatch(/uma vez/);
  });

  test("link inválido sugere a causa mais comum", () => {
    expect(erroDaUrl("link_invalido")).toMatch(/cortam/);
  });

  test("sem código, nenhum aviso", () => {
    expect(erroDaUrl(undefined)).toBeNull();
    expect(erroDaUrl("qualquer-outra-coisa")).toBeNull();
  });
});

describe("formato da contagem", () => {
  test("abaixo de um minuto usa segundos", () => {
    expect(formatarEspera(47)).toBe("47s");
    expect(formatarEspera(9)).toBe("9s");
  });

  test("a partir de um minuto usa minuto:segundo", () => {
    expect(formatarEspera(60)).toBe("1:00");
    expect(formatarEspera(65)).toBe("1:05");
    expect(formatarEspera(125)).toBe("2:05");
  });
});
