# Lista Viva

Lista de compras compartilhada. Quem está com a lista aberta vê os itens
sendo marcados, adicionados e removidos na hora — sem recarregar nada.

Next.js 16 (App Router) · Supabase (Postgres + Realtime + Auth) · TypeScript

---

## O que você precisa fazer antes de rodar

O código está pronto. Faltam três passos que só você pode fazer, porque
envolvem criar a sua conta no Supabase.

### 1. Criar o projeto no Supabase

Vá em [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
Escolha a região `South America (São Paulo)` para a latência do realtime ficar boa.
Anote a senha do banco (você não vai precisar dela aqui, mas guarde).

### 2. Rodar o schema

No painel do projeto, abra **SQL Editor** → **New query**, cole o conteúdo
inteiro de [`supabase/schema.sql`](supabase/schema.sql) e execute.

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

## Como está organizado

```
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
| `list_invites` | Token do link de convite. |

### Duas decisões que não são óbvias

**`is_list_member()` é `SECURITY DEFINER`.** A política de `list_members`
precisa consultar `list_members` para saber quem é membro — o que faria o
Postgres entrar em recursão infinita. A função quebra o ciclo.

**`items` tem `REPLICA IDENTITY FULL`.** Sem isso, o payload de `DELETE`
do Realtime traz só a chave primária, e o filtro `list_id=eq.<id>` nunca
casaria — exclusões feitas por outra pessoa nunca chegariam na sua tela.
É também o que faz o `UPDATE` trazer a linha antiga, permitindo comparar
antes/depois e dizer *o que* mudou em vez de adivinhar pelo estado final.

## Decisões de UX

- **Cor é identidade.** Cada pessoa tem uma cor fixa, usada no avatar, no
  anel do cartão que ela mexeu e no toast. Quem fez o quê se lê num relance.
- **Tudo é otimista.** A tela muda no toque; o banco confirma depois. Se
  falhar, desfaz e avisa. Supermercado tem sinal ruim.
- **Desfazer em vez de confirmar.** Excluir acontece direto, com 5 segundos
  de *Desfazer*. Confirmação pune quem tem certeza; desfazer salva quem errou.
- **O comprado sai do caminho.** "No carrinho" nasce fechado — item concluído
  virou histórico.
- **Quantidade se edita no lugar.** Tocar no número troca o chip por um
  stepper na mesma posição; o item não abre tela nem diálogo. A escrita é
  adiada 450 ms, então quatro toques em "+" viram um `UPDATE`, e quem está
  do outro lado vê a quantidade final em vez de uma contagem.

## Próximos passos

- Editar o nome do item (a infra de `updated_by` e diff já cobre)
- Agrupar por categoria com detecção pelo nome do item
- Fila offline (hoje uma ação sem rede falha e desfaz)
- Sugestões a partir do histórico de compras
- PWA instalável
