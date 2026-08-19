import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * O service worker é o único código do projeto que, com defeito, quebra o
 * site de forma **persistente**: ele continua servindo o que cacheou mesmo
 * depois do conserto ser publicado. Um erro aqui não é um bug, é um
 * incidente.
 *
 * Estes testes carregam o arquivo real num contexto isolado, com `self`,
 * `caches` e `fetch` falsos, e verificam as regras que protegem contra os
 * dois desastres possíveis: guardar página autenticada e interceptar o
 * Supabase.
 */

const ORIGEM = "https://lista.rafarcs.com";

type Handlers = Record<string, (evento: unknown) => void>;

function carregarSW() {
  const codigo = readFileSync("public/sw.js", "utf8");
  const handlers: Handlers = {};
  const guardados = new Map<string, unknown>();

  const cacheFalso = {
    add: vi.fn(async () => undefined),
    put: vi.fn(async (req: { url: string }, resp: unknown) => {
      guardados.set(req.url, resp);
    }),
    match: vi.fn(async (req: { url: string }) => guardados.get(req.url)),
  };

  const caches = {
    open: vi.fn(async () => cacheFalso),
    keys: vi.fn(async () => ["lista-viva-v0-antigo", "lista-viva-v1-estaticos"]),
    delete: vi.fn(async () => true),
    match: vi.fn(async (chave: unknown) => {
      const url = typeof chave === "string" ? chave : (chave as { url: string }).url;
      return guardados.get(url);
    }),
  };

  const self = {
    addEventListener: (nome: string, fn: (e: unknown) => void) => {
      handlers[nome] = fn;
    },
    location: { origin: ORIGEM },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    registration: { unregister: vi.fn(async () => undefined) },
  };

  const fetchFalso = vi.fn();

  runInNewContext(codigo, {
    self,
    caches,
    fetch: fetchFalso,
    Response,
    URL,
    Promise,
    console,
  });

  return { handlers, caches, cacheFalso, fetchFalso, self, guardados };
}

/** Dispara um `fetch` no SW e devolve o que ele respondeu, ou null se ignorou. */
async function pedir(
  sw: ReturnType<typeof carregarSW>,
  req: { url: string; method?: string; mode?: string },
) {
  let resposta: Promise<unknown> | null = null;
  sw.handlers.fetch?.({
    request: { method: "GET", mode: "no-cors", ...req },
    respondWith: (p: Promise<unknown>) => {
      resposta = p;
    },
  });
  return resposta ? await resposta : null;
}

describe("o que o service worker NÃO pode fazer", () => {
  let sw: ReturnType<typeof carregarSW>;

  beforeEach(() => {
    sw = carregarSW();
  });

  test("não intercepta o Supabase nem nenhuma outra origem", async () => {
    // Guardar resposta de outra origem colocaria dados e sessão num cache
    // do dispositivo. A fila offline do app é quem cuida dessas chamadas.
    const r = await pedir(sw, {
      url: "https://ajcghzkmokmbnvkavozp.supabase.co/rest/v1/items",
    });

    expect(r).toBeNull();
    expect(sw.fetchFalso).not.toHaveBeenCalled();
  });

  test("não intercepta escritas", async () => {
    const r = await pedir(sw, { url: `${ORIGEM}/listas`, method: "POST" });
    expect(r).toBeNull();
  });

  test("não guarda o HTML de página autenticada", async () => {
    // O HTML da lista é renderizado com os dados de quem está logado.
    // Cacheá-lo faria a lista de uma pessoa aparecer para a próxima que
    // usasse o aparelho.
    sw.fetchFalso.mockResolvedValueOnce(new Response("<html>lista secreta</html>"));

    await pedir(sw, { url: `${ORIGEM}/listas/abc`, mode: "navigate" });

    expect(sw.cacheFalso.put).not.toHaveBeenCalled();
    expect([...sw.guardados.keys()]).not.toContain(`${ORIGEM}/listas/abc`);
  });
});

describe("o que ele faz", () => {
  let sw: ReturnType<typeof carregarSW>;

  beforeEach(() => {
    sw = carregarSW();
  });

  test("guarda estáticos com hash, que são imutáveis", async () => {
    const url = `${ORIGEM}/_next/static/chunks/abc123.js`;
    sw.fetchFalso.mockResolvedValueOnce(new Response("codigo", { status: 200 }));

    await pedir(sw, { url });

    expect(sw.fetchFalso).toHaveBeenCalled();
    expect(sw.cacheFalso.put).toHaveBeenCalled();
  });

  test("na segunda vez serve do cache, sem rede", async () => {
    const url = `${ORIGEM}/_next/static/chunks/abc123.js`;
    sw.guardados.set(url, new Response("do cache"));

    await pedir(sw, { url });

    expect(sw.fetchFalso).not.toHaveBeenCalled();
  });

  test("navegação sem rede cai na página offline", async () => {
    sw.guardados.set("/offline", new Response("pagina offline"));
    sw.fetchFalso.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const r = (await pedir(sw, {
      url: `${ORIGEM}/listas`,
      mode: "navigate",
    })) as Response;

    expect(await r.text()).toBe("pagina offline");
  });

  test("sem rede e sem página offline guardada, responde 503 legível", async () => {
    sw.fetchFalso.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const r = (await pedir(sw, {
      url: `${ORIGEM}/listas`,
      mode: "navigate",
    })) as Response;

    expect(r.status).toBe(503);
  });
});

describe("ciclo de vida", () => {
  test("ativar apaga caches de versões anteriores", async () => {
    // Sem esta limpeza, cada publicação deixaria lixo acumulado no
    // dispositivo até o navegador decidir despejar.
    const sw = carregarSW();
    let espera: Promise<unknown> | null = null;

    sw.handlers.activate?.({
      waitUntil: (p: Promise<unknown>) => {
        espera = p;
      },
    });
    await espera;

    expect(sw.caches.delete).toHaveBeenCalledWith("lista-viva-v0-antigo");
    expect(sw.caches.delete).not.toHaveBeenCalledWith("lista-viva-v1-estaticos");
  });

  test("existe uma saída de emergência para desinstalar", async () => {
    const sw = carregarSW();
    let espera: Promise<unknown> | null = null;

    sw.handlers.message?.({
      data: "desinstalar",
      waitUntil: (p: Promise<unknown>) => {
        espera = p;
      },
    });
    await espera;

    expect(sw.self.registration.unregister).toHaveBeenCalled();
  });
});
