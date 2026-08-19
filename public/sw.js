/*
 * Service worker do Lista Viva.
 *
 * Um service worker mal escrito não degrada: ele quebra o site de forma
 * persistente, porque continua servindo o que cacheou mesmo depois do
 * conserto. Por isso as regras aqui são deliberadamente restritas.
 *
 * O QUE É CACHEADO
 *   Apenas `/_next/static/*` — arquivos com hash no nome, imutáveis por
 *   construção: a mesma URL nunca muda de conteúdo. E a página `/offline`,
 *   que é estática e igual para todo mundo.
 *
 * O QUE NUNCA É CACHEADO
 *   HTML das páginas autenticadas. Elas são renderizadas no servidor com os
 *   dados de quem está logado; guardá-las no disco faria a lista de uma
 *   pessoa aparecer para a próxima que usasse o aparelho.
 *
 *   Qualquer requisição para outra origem, o que inclui todo o Supabase.
 *   Dados e sessão passam longe daqui.
 */

const VERSAO = "lista-viva-v1";
const ESTATICOS = `${VERSAO}-estaticos`;
const CASCA = `${VERSAO}-casca`;
const PAGINA_OFFLINE = "/offline";

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CASCA)
      .then((cache) => cache.add(PAGINA_OFFLINE))
      // Sem a página offline o SW ainda é útil para os estáticos; falhar a
      // instalação inteira por causa dela seria pior.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes
            .filter((nome) => !nome.startsWith(VERSAO))
            .map((nome) => caches.delete(nome)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Válvula de escape: se algo der errado, a página pode mandar o SW se
 * desinstalar e limpar tudo, sem depender de o usuário saber mexer nas
 * ferramentas do navegador.
 */
self.addEventListener("message", (evento) => {
  if (evento.data === "desinstalar") {
    evento.waitUntil(
      caches
        .keys()
        .then((nomes) => Promise.all(nomes.map((n) => caches.delete(n))))
        .then(() => self.registration.unregister()),
    );
  }
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;

  // Só GET, só a nossa origem. Escritas e chamadas ao Supabase seguem
  // direto para a rede — a fila offline do app é quem cuida delas.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Estáticos com hash: o conteúdo de uma URL nunca muda, então servir do
  // cache é sempre correto e evita rede em toda navegação.
  if (url.pathname.startsWith("/_next/static/")) {
    evento.respondWith(
      caches.match(req).then(
        (achado) =>
          achado ??
          fetch(req).then((resposta) => {
            if (resposta.ok) {
              const copia = resposta.clone();
              caches.open(ESTATICOS).then((cache) => cache.put(req, copia));
            }
            return resposta;
          }),
      ),
    );
    return;
  }

  // Navegação: sempre rede primeiro, porque o HTML depende da sessão.
  // Sem rede, a pessoa recebe uma explicação em vez da tela de erro do
  // navegador. O HTML em si nunca é guardado.
  if (req.mode === "navigate") {
    evento.respondWith(
      fetch(req).catch(() =>
        caches
          .match(PAGINA_OFFLINE)
          .then(
            (achado) =>
              achado ??
              new Response("Sem conexão.", {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              }),
          ),
      ),
    );
  }
});
