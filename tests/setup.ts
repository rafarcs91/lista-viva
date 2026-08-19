import { config } from "dotenv";

// Um arquivo próprio, separado do .env.local da aplicação: apontar os
// testes para um banco é uma decisão deliberada, nunca herdada.
config({ path: ".env.test", quiet: true });

/**
 * Trava de segurança.
 *
 * A suíte cria e apaga listas, itens e associações. Se ela rodasse contra
 * o banco de produção por herdar NEXT_PUBLIC_SUPABASE_URL, apagaria dados
 * de gente de verdade. Por isso as variáveis têm nomes próprios
 * (TEST_*) e não há fallback: sem configuração explícita, nada roda.
 */
export function requireTestEnv() {
  const faltando = [
    "TEST_SUPABASE_URL",
    "TEST_SUPABASE_ANON_KEY",
    "TEST_USER_A_EMAIL",
    "TEST_USER_A_PASSWORD",
    "TEST_USER_B_EMAIL",
    "TEST_USER_B_PASSWORD",
    "TEST_USER_C_EMAIL",
    "TEST_USER_C_PASSWORD",
  ].filter((k) => !process.env[k]);

  if (faltando.length > 0) {
    throw new Error(
      `Faltam variáveis de teste: ${faltando.join(", ")}.\n` +
        `Copie .env.test.example para .env.test e preencha. Veja o README.`,
    );
  }

  return {
    url: process.env.TEST_SUPABASE_URL!,
    anonKey: process.env.TEST_SUPABASE_ANON_KEY!,
    usuarios: {
      a: {
        email: process.env.TEST_USER_A_EMAIL!,
        password: process.env.TEST_USER_A_PASSWORD!,
      },
      b: {
        email: process.env.TEST_USER_B_EMAIL!,
        password: process.env.TEST_USER_B_PASSWORD!,
      },
      c: {
        email: process.env.TEST_USER_C_EMAIL!,
        password: process.env.TEST_USER_C_PASSWORD!,
      },
    },
  };
}
