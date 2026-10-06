-- ============================================================
-- Períodos e disciplinas (cadastro do admin), usados na reserva de professor.
-- Rode no SQL Editor do Supabase.
-- ============================================================

create table if not exists public.periodos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.disciplinas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  periodo_id uuid not null references public.periodos(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.periodos enable row level security;
alter table public.disciplinas enable row level security;

drop policy if exists "Períodos visíveis para quem está logado" on public.periodos;
create policy "Períodos visíveis para quem está logado" on public.periodos
  for select using (auth.role() = 'authenticated');

drop policy if exists "Só admin cria períodos" on public.periodos;
create policy "Só admin cria períodos" on public.periodos
  for insert with check (public.is_admin());

drop policy if exists "Só admin edita períodos" on public.periodos;
create policy "Só admin edita períodos" on public.periodos
  for update using (public.is_admin());

drop policy if exists "Só admin remove períodos" on public.periodos;
create policy "Só admin remove períodos" on public.periodos
  for delete using (public.is_admin());

drop policy if exists "Disciplinas visíveis para quem está logado" on public.disciplinas;
create policy "Disciplinas visíveis para quem está logado" on public.disciplinas
  for select using (auth.role() = 'authenticated');

drop policy if exists "Só admin cria disciplinas" on public.disciplinas;
create policy "Só admin cria disciplinas" on public.disciplinas
  for insert with check (public.is_admin());

drop policy if exists "Só admin edita disciplinas" on public.disciplinas;
create policy "Só admin edita disciplinas" on public.disciplinas
  for update using (public.is_admin());

drop policy if exists "Só admin remove disciplinas" on public.disciplinas;
create policy "Só admin remove disciplinas" on public.disciplinas
  for delete using (public.is_admin());

-- Guarda o nome do período na própria reserva (texto "congelado" no momento da
-- criação), para continuar aparecendo certo mesmo se o período for renomeado
-- ou removido depois.
alter table public.reservas add column if not exists periodo_nome text;

-- Recria a view de reservas incluindo periodo_nome (mantém a mesma privacidade
-- de material e de responsável que já estava aplicada).
create or replace view public.reservas_visiveis
with (security_invoker = true) as
select
  r.id,
  r.ambiente_id,
  r.usuario_id,
  r.tipo,
  r.finalidade,
  r.periodo_nome,
  r.data,
  r.hora_inicio,
  r.hora_fim,
  r.qtd_pessoas,
  r.created_at,
  case
    when r.tipo = 'professor' and not (auth.uid() = r.usuario_id or public.is_admin())
      then null
    else coalesce(r.material, '')
  end as material,
  case
    when r.tipo = 'grupo_estudos' and not (auth.uid() = r.usuario_id or public.is_admin())
      then null
    when r.professor_associado_id is not null
      then pa.nome
    else p.nome
  end as responsavel_nome
from public.reservas r
left join public.profiles p on p.id = r.usuario_id
left join public.profiles pa on pa.id = r.professor_associado_id;

grant select on public.reservas_visiveis to authenticated;

-- Semente inicial (o admin pode editar, remover ou adicionar depois)
insert into public.periodos (nome) values
  ('1º período'), ('2º período'), ('3º período'), ('4º período'), ('5º período'), ('6º período')
on conflict do nothing;

insert into public.disciplinas (nome, periodo_id)
select d.nome, p.id
from public.periodos p
join (values
  ('1º período', 'Anatomia Humana I'),
  ('1º período', 'Bases Morfofuncionais'),
  ('2º período', 'Anatomia Humana II'),
  ('2º período', 'Histologia'),
  ('3º período', 'Fisiologia'),
  ('3º período', 'Bioquímica Aplicada'),
  ('4º período', 'Semiologia'),
  ('4º período', 'Farmacologia'),
  ('5º período', 'Patologia Geral'),
  ('5º período', 'Microbiologia'),
  ('6º período', 'Habilidades Clínicas'),
  ('6º período', 'Simulação Realística')
) as d(periodo_nome, nome) on d.periodo_nome = p.nome
on conflict do nothing;
