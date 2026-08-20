-- ═══════════════════════════════════════════════════════════════
--  Lista Viva — schema completo
--  Rode este arquivo inteiro no SQL Editor do Supabase.
--  É idempotente: pode rodar de novo sem quebrar nada.
-- ═══════════════════════════════════════════════════════════════

-- ── Tabelas ────────────────────────────────────────────────────

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text,
  display_name text not null,
  color        text not null default 'mint',
  created_at   timestamptz not null default now()
);

create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(trim(title)) between 1 and 80),
  owner_id   uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.list_members (
  list_id   uuid not null references public.lists on delete cascade,
  user_id   uuid not null references public.profiles on delete cascade,
  role      text not null default 'editor' check (role in ('owner', 'editor')),
  joined_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.lists on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 120),
  qty        integer not null default 1 check (qty between 1 and 999),
  done       boolean not null default false,
  added_by   uuid references public.profiles on delete set null,
  checked_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.list_invites (
  token      text primary key
             default replace(replace(encode(gen_random_bytes(9), 'base64'), '+', '-'), '/', '_'),
  list_id    uuid not null references public.lists on delete cascade,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists items_list_id_idx        on public.items (list_id);
create index if not exists list_members_user_id_idx on public.list_members (user_id);
create index if not exists list_invites_list_id_idx on public.list_invites (list_id);

-- ── Funções auxiliares ─────────────────────────────────────────
-- SECURITY DEFINER: as políticas de list_members não podem consultar
-- list_members diretamente, senão o Postgres entra em recursão infinita.

create or replace function public.is_list_member(p_list uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.list_members
    where list_id = p_list and user_id = auth.uid()
  );
$$;

create or replace function public.shares_list_with(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.list_members mine
    join public.list_members theirs on theirs.list_id = mine.list_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$$;

-- Entrar numa lista pelo token do convite. Roda como definer porque
-- quem ainda não é membro não enxerga nem a lista nem o convite.
create or replace function public.join_list_with_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list uuid;
begin
  if auth.uid() is null then
    raise exception 'Precisa estar autenticado';
  end if;

  select list_id into v_list from public.list_invites where token = p_token;

  if v_list is null then
    raise exception 'Convite inválido ou expirado';
  end if;

  insert into public.list_members (list_id, user_id, role)
  values (v_list, auth.uid(), 'editor')
  on conflict (list_id, user_id) do nothing;

  return v_list;
end;
$$;

-- ── Triggers ───────────────────────────────────────────────────

-- Todo usuário novo ganha um perfil e uma cor estável.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, color)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'alguem'), '@', 1)
    ),
    (array['mint', 'violet', 'amber', 'coral', 'sky'])[
      1 + ((hashtext(new.id::text) % 5) + 5) % 5
    ]
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Quem cria a lista já entra como dona.
create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.list_members (list_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (list_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_list_created on public.lists;
create trigger on_list_created
  after insert on public.lists
  for each row execute function public.add_owner_as_member();

-- updated_at sempre fresco — é o que ordena a linha de atividade.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_item_updated on public.items;
create trigger on_item_updated
  before update on public.items
  for each row execute function public.touch_updated_at();

-- ── RLS ────────────────────────────────────────────────────────

alter table public.profiles     enable row level security;
alter table public.lists        enable row level security;
alter table public.list_members enable row level security;
alter table public.items        enable row level security;
alter table public.list_invites enable row level security;

-- profiles: você, e quem divide alguma lista com você.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_list_with(id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- lists: membros leem; qualquer autenticado cria a sua; só a dona altera/apaga.
-- O `owner_id = auth.uid()` no select cobre o RETURNING do INSERT,
-- que roda antes do trigger que cria a associação.
drop policy if exists lists_select on public.lists;
create policy lists_select on public.lists for select
  using (owner_id = auth.uid() or public.is_list_member(id));

drop policy if exists lists_insert on public.lists;
create policy lists_insert on public.lists for insert
  with check (owner_id = auth.uid());

drop policy if exists lists_update on public.lists;
create policy lists_update on public.lists for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists lists_delete on public.lists;
create policy lists_delete on public.lists for delete
  using (owner_id = auth.uid());

-- list_members: membros se enxergam. Entrar é só pela função do convite;
-- sair (deletar a si mesma) é permitido.
drop policy if exists list_members_select on public.list_members;
create policy list_members_select on public.list_members for select
  using (user_id = auth.uid() or public.is_list_member(list_id));

drop policy if exists list_members_delete on public.list_members;
create policy list_members_delete on public.list_members for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid())
  );

-- items: membro da lista faz tudo.
drop policy if exists items_select on public.items;
create policy items_select on public.items for select
  using (public.is_list_member(list_id));

drop policy if exists items_insert on public.items;
create policy items_insert on public.items for insert
  with check (public.is_list_member(list_id) and added_by = auth.uid());

drop policy if exists items_update on public.items;
create policy items_update on public.items for update
  using (public.is_list_member(list_id)) with check (public.is_list_member(list_id));

drop policy if exists items_delete on public.items;
create policy items_delete on public.items for delete
  using (public.is_list_member(list_id));

-- list_invites: membro vê e cria convites da própria lista.
drop policy if exists list_invites_select on public.list_invites;
create policy list_invites_select on public.list_invites for select
  using (public.is_list_member(list_id));

drop policy if exists list_invites_insert on public.list_invites;
create policy list_invites_insert on public.list_invites for insert
  with check (public.is_list_member(list_id) and created_by = auth.uid());

-- ── Realtime ───────────────────────────────────────────────────
-- REPLICA IDENTITY FULL é obrigatório: sem isso o payload de DELETE
-- traz só a PK, e o filtro `list_id=eq.<id>` nunca casa no cliente.

alter table public.items replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.items;
exception
  when duplicate_object then null;
end;
$$;

-- ── Quem mexeu por último ──────────────────────────────────────
-- `checked_by` só responde "quem marcou". Para uma alteração de
-- quantidade o autor é outro, e a linha de atividade precisa saber.
-- Separado do bloco de criação para valer também em bancos já criados.

alter table public.items
  add column if not exists updated_by uuid references public.profiles on delete set null;

-- A lista em si também é tempo real: renomear aparece na hora para quem
-- está com ela aberta, e apagar tira essas pessoas da tela em vez de
-- deixá-las editando algo que não existe mais.

alter table public.lists replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.lists;
exception
  when duplicate_object then null;
end;
$$;

-- Quem entra e quem sai também é tempo real: numa tela cujo assunto é
-- presença, o avatar de quem acabou de aceitar o convite não deveria
-- esperar um recarregamento para aparecer.
--
-- Sem REPLICA IDENTITY FULL de propósito: a chave primária de list_members
-- é (list_id, user_id), então o payload de DELETE já carrega as duas
-- colunas — o filtro por list_id casa, e ninguém precisa pagar WAL extra.

do $$
begin
  alter publication supabase_realtime add table public.list_members;
exception
  when duplicate_object then null;
end;
$$;

-- ── Convites com prazo ─────────────────────────────────────────
-- Um link eterno é meia porta: remover alguém da lista não adianta se a
-- pessoa ainda tem um convite que funciona para sempre.
--
-- A coluna entra sem default e é preenchida a partir de `created_at`, para
-- que convites antigos herdem a idade real que têm em vez de ganharem sete
-- dias novos na migração. O default passa a valer depois, para os próximos.

alter table public.list_invites
  add column if not exists expires_at timestamptz;

update public.list_invites
   set expires_at = created_at + interval '7 days'
 where expires_at is null;

alter table public.list_invites
  alter column expires_at set default (now() + interval '7 days');

-- Revogar é apagar: qualquer membro pode gerar um link novo, na mesma
-- lógica de que qualquer membro pode convidar.
drop policy if exists list_invites_delete on public.list_invites;
create policy list_invites_delete on public.list_invites for delete
  using (public.is_list_member(list_id));

-- Recusar token vencido, distinguindo do inexistente: são situações
-- diferentes para quem recebeu o link, e merecem explicações diferentes.
create or replace function public.join_list_with_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_convite public.list_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Precisa estar autenticado';
  end if;

  select * into v_convite from public.list_invites where token = p_token;

  if not found then
    raise exception 'Convite inválido' using errcode = 'P0002';
  end if;

  if v_convite.expires_at is not null and v_convite.expires_at <= now() then
    raise exception 'Convite expirado' using errcode = 'P0003';
  end if;

  insert into public.list_members (list_id, user_id, role)
  values (v_convite.list_id, auth.uid(), 'editor')
  on conflict (list_id, user_id) do nothing;

  return v_convite.list_id;
end;
$$;

-- ── Sugestões pelo histórico ───────────────────────────────────
-- O que a pessoa já colocou nas listas dela, do mais frequente para o
-- menos, tirando o que já está na lista aberta.
--
-- SECURITY INVOKER de propósito (é o padrão, explicitado aqui porque a
-- escolha importa): a função roda com as permissões de quem chama, então o
-- RLS de `items` continua valendo e ninguém recebe sugestão vinda da lista
-- de outra família.

create or replace function public.item_suggestions(
  p_list uuid,
  p_limit integer default 8
)
returns table (name text, vezes bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select i.name, count(*) as vezes
  from public.items i
  where i.list_id <> p_list
    and lower(trim(i.name)) not in (
      select lower(trim(a.name)) from public.items a where a.list_id = p_list
    )
  group by i.name
  order by count(*) desc, max(i.created_at) desc
  limit greatest(1, least(p_limit, 30));
$$;

-- ── Um item, uma linha ─────────────────────────────────────────
-- Adicionar algo que já está na lista deve somar a quantidade, nunca criar
-- uma segunda linha com o mesmo nome.
--
-- A checagem no aplicativo não basta: duas pessoas adicionando "Leite" ao
-- mesmo tempo não enxergam o item uma da outra, ambas inserem, e a
-- duplicata volta. Só uma restrição no banco fecha essa corrida.

-- Primeiro fundir o que já está duplicado — o índice único falharia com
-- essas linhas presentes. A quantidade é somada e a linha mais antiga
-- sobrevive; o resultado só continua marcado se todas as cópias estavam.
do $$
declare
  g record;
  v_manter uuid;
begin
  for g in
    select list_id,
           lower(trim(name)) as chave,
           sum(qty) as soma,
           bool_and(done) as todas_marcadas
      from public.items
     group by list_id, lower(trim(name))
    having count(*) > 1
  loop
    select id into v_manter
      from public.items
     where list_id = g.list_id and lower(trim(name)) = g.chave
     order by created_at, id
     limit 1;

    update public.items
       set qty = least(g.soma, 999),
           done = g.todas_marcadas,
           checked_by = case when g.todas_marcadas then checked_by else null end
     where id = v_manter;

    delete from public.items
     where list_id = g.list_id
       and lower(trim(name)) = g.chave
       and id <> v_manter;
  end loop;
end;
$$;

create unique index if not exists items_lista_nome_uniq
  on public.items (list_id, lower(trim(name)));

/**
 * Insere o item ou soma na linha que já existe, numa operação só.
 *
 * SECURITY INVOKER: o RLS de `items` continua valendo, então ninguém
 * acrescenta item em lista de que não participa.
 *
 * Ao somar, o item volta a ficar pendente: quem adiciona de novo algo que
 * já está no carrinho está dizendo que precisa comprar mais.
 */
create or replace function public.add_or_bump_item(
  p_list uuid,
  p_name text,
  p_qty integer default 1
)
returns public.items
language sql
security invoker
volatile
set search_path = public
as $$
  insert into public.items (list_id, name, qty, done, added_by, updated_by)
  values (p_list, trim(p_name), greatest(1, least(p_qty, 999)), false, auth.uid(), auth.uid())
  on conflict (list_id, (lower(trim(name))))
  do update
     set qty = least(public.items.qty + excluded.qty, 999),
         done = false,
         checked_by = null,
         updated_by = auth.uid()
  returning *;
$$;
