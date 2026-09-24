-- ============================================================
-- NÚCLEO do Portal de Reservas Acadêmicas — Supabase
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- ============================================================

-- Perfis (dados de app ligados ao usuário real de autenticação do Supabase)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  cargo text not null check (cargo in ('aluno','monitor','professor','admin')),
  created_at timestamptz not null default now()
);

-- Ambientes (laboratórios e salas de tutoria)
create table public.ambientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  tipo text not null check (tipo in ('laboratorio','sala_tutoria')),
  capacidade int not null default 1,
  antecedencia_horas numeric not null default 0,
  regras text,
  created_at timestamptz not null default now()
);

-- Reservas (núcleo: uma data e um horário por reserva — recorrência e prioridade vêm depois)
create table public.reservas (
  id uuid primary key default gen_random_uuid(),
  ambiente_id uuid not null references public.ambientes(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('grupo_estudos','monitoria','professor')),
  finalidade text not null,
  data date not null,
  hora_inicio time not null,
  hora_fim time not null,
  qtd_pessoas int,
  created_at timestamptz not null default now()
);

-- Função auxiliar: o usuário logado é admin? (evita recursão nas regras de segurança)
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and cargo = 'admin'
  );
$$;

-- Quando o admin convida alguém (Supabase Auth cria o usuário), este gatilho cria
-- automaticamente o perfil (nome e cargo) a partir dos dados enviados no convite.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, cargo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.email),
    coalesce(new.raw_user_meta_data->>'cargo', 'aluno')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Regras de segurança (Row Level Security) — cada tabela só permite o que faz sentido
alter table public.profiles enable row level security;
alter table public.ambientes enable row level security;
alter table public.reservas enable row level security;

create policy "Perfis visíveis para quem está logado" on public.profiles
  for select using (auth.role() = 'authenticated');

create policy "Cada um edita o próprio perfil, admin edita qualquer um" on public.profiles
  for update using (auth.uid() = id or public.is_admin());

create policy "Ambientes visíveis para quem está logado" on public.ambientes
  for select using (auth.role() = 'authenticated');

create policy "Só admin cria ambientes" on public.ambientes
  for insert with check (public.is_admin());

create policy "Só admin edita ambientes" on public.ambientes
  for update using (public.is_admin());

create policy "Só admin remove ambientes" on public.ambientes
  for delete using (public.is_admin());

create policy "Reservas visíveis para quem está logado" on public.reservas
  for select using (auth.role() = 'authenticated');

create policy "Usuário logado cria reserva em seu próprio nome" on public.reservas
  for insert with check (auth.uid() = usuario_id);

create policy "Dono ou admin cancela a reserva" on public.reservas
  for delete using (auth.uid() = usuario_id or public.is_admin());

-- Ambientes iniciais (a lista real da instituição)
insert into public.ambientes (nome, tipo, capacidade, antecedencia_horas, regras) values
  ('Anatomia', 'laboratorio', 24, 48, 'Uso obrigatório de jaleco, luvas e máscara.'),
  ('Hospital Simulado', 'laboratorio', 16, 48, 'Uso obrigatório de jaleco.'),
  ('Simulação Realística 1', 'laboratorio', 12, 48, null),
  ('Simulação Realística 2', 'laboratorio', 12, 48, null),
  ('Morfofuncional', 'laboratorio', 20, 48, null),
  ('Microscopia Óptica 2', 'laboratorio', 20, 48, null),
  ('Multifuncional 1', 'laboratorio', 20, 48, null),
  ('Multifuncional 2', 'laboratorio', 20, 48, null),
  ('Tutoria 1', 'sala_tutoria', 10, 0.5, null),
  ('Tutoria 2', 'sala_tutoria', 10, 0.5, null),
  ('Tutoria 3', 'sala_tutoria', 10, 0.5, null),
  ('Tutoria 4', 'sala_tutoria', 10, 0.5, null),
  ('Tutoria 5', 'sala_tutoria', 10, 0.5, null),
  ('Tutoria 6', 'sala_tutoria', 10, 0.5, null),
  ('Tutoria 7', 'sala_tutoria', 10, 0.5, null);
