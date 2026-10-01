-- ============================================================
-- Privacidade: material da reserva de professor e responsável de Grupo de Estudos
-- Rode no SQL Editor do Supabase.
--
-- O material só é visível para quem fez a reserva e para o admin.
-- O nome de quem fez uma reserva de "Grupo de estudos" só é visível para
-- quem fez e para o admin — para os demais, aparece oculto.
--
-- Como RLS esconde linha inteira (não coluna), a forma correta de esconder só
-- um campo é através de uma "visão" (view): o site passa a ler as reservas por
-- essa visão, que devolve null nesses campos quando quem está olhando não tem
-- permissão. INSERT e DELETE continuam na tabela normal.
-- ============================================================

-- 1) Novo campo, só preenchido para reservas do tipo "professor"
alter table public.reservas add column if not exists material text;

-- 2) Visão com a privacidade aplicada
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
      then null -- null = oculto (sem permissão); string vazia = visível mas sem material informado
    else coalesce(r.material, '')
  end as material,
  case
    when r.tipo = 'grupo_estudos' and not (auth.uid() = r.usuario_id or public.is_admin())
      then null
    else p.nome
  end as responsavel_nome
from public.reservas r
left join public.profiles p on p.id = r.usuario_id;

grant select on public.reservas_visiveis to authenticated;
