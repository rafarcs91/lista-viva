import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Os testes falam com um Postgres de verdade: paralelismo faria
    // um arquivo apagar a lista que outro acabou de criar.
    fileParallelism: false,
    // Realtime depende de rede; o padrão de 5s derruba testes bons.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
