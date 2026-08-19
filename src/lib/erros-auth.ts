/**
 * O Supabase devolve erros de autenticação em inglês e em linguagem de
 * servidor ("For security purposes, you can only request this after 38
 * seconds."). Quem está tentando entrar não deveria ler isso.
 *
 * Função pura de propósito: é a parte com regra de verdade, e dá para
 * testar sem rede nem banco.
 */

export type ErroLogin = {
  texto: string;
  /** Segundos até poder tentar de novo, quando o erro for de espera. */
  esperar?: number;
};

/** Erros que o callback do link mágico sinaliza pela URL. */
export function erroDaUrl(codigo: string | undefined): string | null {
  if (codigo === "link_expirado") {
    return "Esse link já venceu. Cada link vale por uma hora e só funciona uma vez — peça um novo abaixo.";
  }
  if (codigo === "link_invalido") {
    return "Esse link não funcionou. Alguns aplicativos de e-mail cortam endereços longos; tente abrir de novo pelo e-mail, ou peça um link novo.";
  }
  return null;
}

export function traduzirErroLogin(mensagem: string): ErroLogin {
  const original = mensagem ?? "";
  const minuscula = original.toLowerCase();

  // "For security purposes, you can only request this after 38 seconds."
  const espera = original.match(/after (\d+) seconds?/i);
  if (espera) {
    const segundos = Number(espera[1]);
    return {
      esperar: segundos,
      texto: `Você acabou de pedir um link. Espere ${segundos} segundos para pedir outro.`,
    };
  }

  if (minuscula.includes("rate limit")) {
    return {
      texto:
        "Pedimos links demais em pouco tempo. Espere alguns minutos e tente de novo.",
    };
  }

  if (minuscula.includes("invalid") && minuscula.includes("email")) {
    return { texto: "Esse endereço de e-mail não parece válido." };
  }

  if (minuscula.includes("signups not allowed") || minuscula.includes("disabled")) {
    return {
      texto: "O cadastro está fechado no momento. Fale com quem administra o app.",
    };
  }

  if (
    minuscula.includes("failed to fetch") ||
    minuscula.includes("network") ||
    minuscula.includes("load failed")
  ) {
    return {
      texto: "Sem conexão para enviar o link. Verifique a internet e tente de novo.",
    };
  }

  return {
    texto: "Não consegui enviar o link agora. Tente de novo em instantes.",
  };
}

/** "1:05" para contagens longas, "47s" para as curtas. */
export function formatarEspera(segundos: number): string {
  if (segundos >= 60) {
    const min = Math.floor(segundos / 60);
    const seg = segundos % 60;
    return `${min}:${String(seg).padStart(2, "0")}`;
  }
  return `${segundos}s`;
}
