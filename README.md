# Lista Viva

**No ar: https://lista.rafarcs.com**

Lista de compras compartilhada. Quem está com a lista aberta vê os itens
sendo marcados, adicionados e removidos na hora — sem recarregar nada.

Next.js 16 (App Router) · Supabase (Postgres + Realtime + Auth) · Resend
· hospedado na Vercel

## Produção

| Peça | Onde |
|---|---|
| App | `lista.rafarcs.com` (CNAME → Vercel, projeto `rcs14/lista-viva`) |
| Banco e auth | Supabase `ajcghzkmokmbnvkavozp` |
| E-mail | Resend, domínio `rafarcs.com` verificado, remetente `login@rafarcs.com` |

Ao trocar de domínio, três lugares precisam acompanhar, senão o login
quebra: **Site URL** e **Redirect URLs** no Supabase, e o *Sender email* em
SMTP Settings.

Deploy: automático. Todo push em `master` publica em produção; cada Pull
Request ganha uma URL de preview própria. Para publicar manualmente sem
passar pelo Git, `vercel deploy --prod` na raiz do projeto.

> Projetos novos na Vercel nascem com *Deployment Protection* ligada — o
> site fica atrás do login da Vercel e ninguém de fora consegue abrir.
> Desligue em **Settings → Deployment Protection**.


---

## O que você precisa fazer antes de rodar

O código está pronto. Faltam três passos que só você pode fazer, porque
envolvem criar a sua conta no Supabase.

### 1. Criar o projeto no Supabase

Vá em [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
Escolha a região `South America (São Paulo)` para a latência do realtime ficar boa.
Anote a senha do banco (você não vai precisar dela aqui, mas guarde).

### 2. Rodar o schema

Na primeira vez, no painel do projeto: **SQL Editor** → **New query**, cole o
conteúdo inteiro de [`supabase/schema.sql`](supabase/schema.sql) e execute.

Depois disso, prefira o comando:

```bash
npm run db:push
```

Ele aplica o arquivo inteiro e lista as funções criadas, para confirmar que
tudo entrou. Precisa de um `.env.db.local` (fora do git) com
`SUPABASE_DB_REF`, `SUPABASE_DB_PASSWORD` e `SUPABASE_DB_REGION` — pegue em
**Settings → Database**. Essa credencial é só para migração; o app usa a
chave anon, sob RLS.

> Existe porque colar um arquivo de trezentas linhas no editor já falhou
> uma vez: a seleção não pegou até o fim, a última função não foi criada, e
> o erro só apareceu no teste.

Isso cria as cinco tabelas, as políticas de RLS, os triggers e liga o
Realtime na tabela `items`. O arquivo é idempotente — pode rodar de novo
sem quebrar nada.

### 3. Preencher as chaves

Em **Project Settings**:

- **Data API** → copie a *Project URL*
- **API Keys** → copie a chave *anon* (também chamada de *publishable*)

Cole as duas em `.env.local` (crie a partir de `.env.local.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

A chave *anon* é pública por natureza — quem protege os dados é o RLS,
não o segredo da chave. **Nunca** coloque a *service_role* aqui.

### 4. Liberar a URL de retorno do login

Em **Authentication** → **URL Configuration**, adicione em *Redirect URLs*:

```
http://localhost:3000/auth/callback
```

Quando publicar, adicione também a URL de produção.

---

## Rodar

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>.

### Testar o tempo real de verdade

1. Entre com o seu e-mail e crie uma lista.
2. Toque em **convidar** e copie o link.
3. Abra o link **numa janela anônima** e entre com **outro e-mail**.
4. Deixe as duas janelas lado a lado e marque um item numa delas.

A outra janela mostra o anel colorido no cartão, o toast com o avatar de
quem mexeu e a linha de atividade no topo — sem recarregar.

> Sem servidor de e-mail configurado, o Supabase limita os envios do link
> mágico. Para testar rápido, pegue o link direto em **Authentication** →
> **Users** → o usuário → *Send magic link*, ou use o Inbucket do
> ambiente local (`supabase start`).

---

### 5. Servidor de e-mail (Resend)

Sem SMTP próprio, o Supabase limita o envio a **2 e-mails por hora** — o
terceiro login da hora simplesmente não recebe o link. Para qualquer uso
real isso precisa ser resolvido.

1. Crie a conta em [resend.com](https://resend.com).
2. **API Keys** → **Create API Key**, permissão *Sending access*. Copie a
   chave (`re_...`), ela só aparece uma vez.
3. No Supabase: **Authentication** → **Emails** → **SMTP Settings** →
   ligue **Enable Custom SMTP** e preencha:

   | Campo | Valor |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | a chave `re_...` |
   | Sender email | `onboarding@resend.dev` |
   | Sender name | `Lista Viva` |

4. **Authentication** → **Rate Limits** → suba *Rate limit for sending
   emails* de 2 para algo como 100 por hora. O limite antigo continua
   valendo até você mudar isto, mesmo com o SMTP configurado.

**Enquanto não houver domínio próprio:** o remetente `onboarding@resend.dev`
só entrega no e-mail dono da conta Resend. Endereços de terceiros são aceitos
pela API mas não chegam. Para testar mais de uma pessoa, use os apelidos do
Gmail (`voce+ana@gmail.com`, `voce+leo@gmail.com`) — para o Supabase são
contas distintas, e tudo cai na mesma caixa de entrada.

Para publicar de verdade, registre um domínio, verifique-o no Resend
(**Domains** → adicionar → 3 registros DNS) e troque o *Sender email* para
algo como `ola@seudominio.com.br`.

## Testes de regressão

90 casos, verdes contra um Supabase real em ~55 s.

```bash
npm test          # roda a suíte uma vez
npm run test:watch
```

A suíte fala com um Supabase de verdade, porque é exatamente isso que ela
protege: políticas de RLS e configuração de Realtime não têm como ser
testadas com mock — o mock passaria mesmo com a política errada.

### O que ela cobre

| Arquivo | Protege |
|---|---|
| `tests/rls.test.ts` | Isolamento entre pessoas: quem não é membro não lê, não escreve, não vê perfis. Triggers de perfil e de dona. Cascade. |
| `tests/convite.test.ts` | Token do convite, acesso concedido, entrada repetida sem duplicar, saída revogando acesso. |
| `tests/realtime.test.ts` | Os dois ajustes de banco mais fáceis de perder numa migração (ver abaixo). |
| `tests/seguranca.test.ts` | Que os testes não conseguem apagar dados que não criaram. |
| `tests/erros-auth.test.ts` | Tradução das mensagens de login. Função pura: roda sem banco nem credencial. |
| `tests/fila-offline.test.ts` | Coalescência e projeção da fila offline. Também sem banco. |
| `tests/fila-reenvio.test.ts` | A tradução de cada operação da fila na escrita correspondente, contra o banco. |
| `tests/service-worker.test.ts` | Que o SW não guarda HTML autenticado nem intercepta o Supabase. Sem banco. |
| `tests/sugestoes.test.ts` | Sugestões pelo histórico — inclusive que elas não vazam itens de listas alheias. |

### Por que estes testes existem

Dois achados da verificação inicial motivaram a suíte, porque quebram **em
silêncio** — sem erro de build, sem exceção, sem log:

- **`replica identity full` na tabela `items`.** Se sair, o payload de
  DELETE passa a trazer só a chave primária, o filtro `list_id=eq.…` nunca
  casa, e exclusões feitas por outra pessoa somem da tela de quem está
  junto. O mesmo ajuste é o que faz o UPDATE trazer a linha antiga, base
  para a interface dizer *o que* mudou.
- **`updated_by` em `items`.** Sem ele, uma mudança de quantidade seria
  creditada a quem marcou o item por último, e a linha de atividade
  passaria a mentir.

Um `using (true)` colado por engano numa política também não quebra build
nem lint — só remove o isolamento entre famílias diferentes.

### Configurar

Os testes **criam e apagam** listas, itens e associações. Por isso as
variáveis têm nomes próprios (`TEST_*`) e não herdam nada do `.env.local`:
apontar o alvo precisa ser uma decisão consciente. Sem `.env.test`, a suíte
recusa rodar em vez de adivinhar.

### Rodando contra o banco de produção

Foi a escolha deste projeto: um Supabase separado custaria a última vaga do
plano gratuito. Para que isso seja seguro, a disciplina é verificada por
código, não confiada à memória de quem escrever o próximo teste:

- Toda lista criada pelos testes nasce com o prefixo `[teste]`.
- `apagarLista()` **recusa** qualquer lista sem esse prefixo, com erro
  explicando o porquê. Um teste futuro que tente apagar dado real falha.
- `tests/seguranca.test.ts` verifica essa recusa a cada execução.
- Uma varredura no fim remove listas de teste órfãs, caso a suíte caia no
  meio e o `afterAll` não rode.

Para migrar a um projeto dedicado depois, basta trocar `TEST_SUPABASE_URL`
e `TEST_SUPABASE_ANON_KEY` — no `.env.test` e nos secrets do repositório.

1. Crie o projeto de teste e rode `supabase/schema.sql` nele.
2. Em **Authentication → Users → Add user**, crie três contas com
   **Auto Confirm User** marcado. Podem compartilhar a senha.
3. `cp .env.test.example .env.test` e preencha.

No CI, os mesmos valores vão como *secrets* do repositório. Se não
existirem, o job de regressão é pulado em vez de falhar — assim um fork
continua verde.

## Como está organizado

```
tests/
  setup.ts                    Trava: sem .env.test, nada roda
  helpers.ts                  Sessões por pessoa, fixtures, inscrição em canal
  rls.test.ts                 Isolamento entre pessoas
  convite.test.ts             Token, acesso, saída
  realtime.test.ts            Eventos, payload.old, DELETE filtrado
  seguranca.test.ts           Trava contra apagar dado real
  erros-auth.test.ts          Tradução dos erros (puro, sem rede)
  fila-offline.test.ts        Coalescência da fila (puro, sem rede)
  fila-reenvio.test.ts        Reenvio da fila contra o banco
  service-worker.test.ts      Regras do SW (puro, sem rede)
  sugestoes.test.ts           Sugestões e o que elas não podem vazar
scripts/
  db-push.mjs                 Aplica o schema.sql no banco
src/
  proxy.ts                    Renova a sessão e protege as rotas
  app/
    entrar/                   Login por link mágico
    auth/callback/            Troca o code pela sessão
    auth/sair/                Logout
    listas/                   Suas listas + criar lista
    listas/[id]/              A lista aberta
    j/[token]/                Entrar por convite
  components/
    Home.tsx                  Cartões de lista com progresso
    ListaView.tsx             Realtime, presença e ações otimistas
    ItemRow.tsx               Cartão do item + arrastar para excluir
    ShareSheet.tsx            Link de convite e participantes
  lib/
    supabase/client.ts        Cliente do navegador
    supabase/server.ts        Cliente de servidor
    types.ts
supabase/
  schema.sql                  Tabelas, RLS, triggers, realtime
prototipo.html                Protótipo de UI original (referência de design)
```

## Modelo de dados

| Tabela | Para quê |
|---|---|
| `profiles` | Nome e cor de cada pessoa. Criado por trigger no cadastro. |
| `lists` | A lista. `owner_id` é quem criou. |
| `list_members` | Quem participa de qual lista, e com que papel. |
| `items` | O item. `added_by`, `checked_by` e `updated_by` alimentam a linha de atividade. |
| `list_invites` | Token do link de convite, com prazo de sete dias. |

### Duas decisões que não são óbvias

**`is_list_member()` é `SECURITY DEFINER`.** A política de `list_members`
precisa consultar `list_members` para saber quem é membro — o que faria o
Postgres entrar em recursão infinita. A função quebra o ciclo.

**`items` tem `REPLICA IDENTITY FULL`.** Sem isso, o payload de `DELETE`
do Realtime traz só a chave primária, e o filtro `list_id=eq.<id>` nunca
casaria — exclusões feitas por outra pessoa nunca chegariam na sua tela.
É também o que faz o `UPDATE` trazer a linha antiga, permitindo comparar
antes/depois e dizer *o que* mudou em vez de adivinhar pelo estado final.

## Verificado contra o banco real

21 checagens automatizadas passaram contra um projeto Supabase de verdade,
cobrindo RLS entre usuários distintos, realtime, convite e cascade. O que
elas mostraram de não-óbvio:

- O status `SUBSCRIBED` do Realtime chega **antes** de a replicação estar
  atrelada no Postgres. Medimos uma janela de ~3 s em que eventos se perdem.
  Por isso `ListaView` busca o estado atual dos itens logo após inscrever —
  sem isso, quem abre a lista enquanto outra pessoa mexe nela veria dado
  velho até recarregar.
- `payload.old` chega completo nos UPDATEs, confirmando que o
  `REPLICA IDENTITY FULL` está valendo — é o que sustenta a linha de
  atividade dizer *o que* mudou.

## Decisões de UX

- **O convite vale sete dias e pode ser revogado.** Um link eterno faria de
  remover alguém um teatro: a pessoa voltaria pelo link que ainda tem no
  celular. Gerar um link novo invalida o anterior; quem já entrou continua.
  Link vencido recebe uma explicação própria, diferente da de link quebrado.
- **Só a dona remove participantes.** O botão aparece apenas para ela, e
  pede um segundo toque — remover afeta outra pessoa. Quem é removido perde
  o acesso na hora, mas os itens que adicionou continuam na lista: o leite
  que ela pôs lá continua sendo necessário para a compra.
- **Presença é ao vivo, inclusive quem chega.** Aceitar um convite faz o
  avatar aparecer na hora para quem já está na lista, com aviso. Quem é
  removido volta para "Suas listas" em vez de seguir editando algo a que
  perdeu acesso — sem isso, cada toque falharia por RLS sem explicação.
- **Cor é identidade.** Cada pessoa tem uma cor fixa, usada no avatar, no
  anel do cartão que ela mexeu e no toast. Quem fez o quê se lê num relance.
- **Tudo é otimista, e sem rede nada se perde.** A tela muda no toque. Se a
  escrita falhar por falta de conexão, a alteração vai para uma fila que
  sobrevive a fechar o app e é reenviada quando o sinal volta — supermercado
  tem sinal ruim, e é justamente lá que o app precisa funcionar. Falha de
  permissão ou validação continua desfazendo e avisando: repetir isso nunca
  daria certo.
- **Desfazer em vez de confirmar.** Excluir acontece direto, com 5 segundos
  de *Desfazer*. Confirmação pune quem tem certeza; desfazer salva quem errou.
- **O comprado sai do caminho.** "No carrinho" nasce fechado — item concluído
  virou histórico.
- **Nome e quantidade se editam no lugar.** Tocar em qualquer um dos dois
  troca o texto por um campo na mesma posição — nada de tela de detalhe.
  Só itens pendentes: o que já está no carrinho virou histórico.
- **Quantidade se edita no lugar.** Tocar no número troca o chip por um
  stepper na mesma posição; o item não abre tela nem diálogo. A escrita é
  adiada 450 ms, então quatro toques em "+" viram um `UPDATE`, e quem está
  do outro lado vê a quantidade final em vez de uma contagem.

## Próximos passos

- Editar o nome do item (a infra de `updated_by` e diff já cobre)
- Agrupar por categoria com detecção pelo nome do item
- Transferir a propriedade da lista
- Agrupar por categoria com detecção pelo nome do item
- Ver a lista offline na primeira abertura (hoje o SW guarda só a casca;
  mostrar os dados exigiria renderizar a lista no cliente)
