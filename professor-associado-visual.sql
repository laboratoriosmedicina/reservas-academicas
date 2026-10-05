-- ============================================================
-- "Professor associado" como rótulo visual, não como dono da reserva.
-- Rode no SQL Editor do Supabase. NÃO é preciso rodar fix-professor-associado.sql.
--
-- A reserva continua pertencendo a quem criou (só ele cancela, é a reserva
-- "dele" no sistema). O professor associado é só o nome mostrado pra quem vê.
-- ============================================================

alter table public.reservas add column if not exists professor_associado_id uuid references public.profiles(id);

create or replace view public.reservas_visiveis
with (security_invoker = true) as
select
  r.id,
  r.ambiente_id,
  r.usuario_id,
  r.tipo,
  r.finalidade,
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
