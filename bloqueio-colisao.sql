-- ============================================================
-- Bloqueio de colisão de reservas
-- Rode no SQL Editor do Supabase.
--
-- Depois disto, o próprio banco recusa uma reserva que se sobreponha a outra
-- no mesmo ambiente (mesmo que duas pessoas cliquem ao mesmo tempo).
-- Reservas seguidas são permitidas: 10:00-12:00 e 12:00-14:00 NÃO colidem.
--
-- SE DER ERRO dizendo que já existem reservas sobrepostas e elas são só de teste,
-- rode primeiro esta linha para apagar as reservas de teste e depois rode tudo de novo:
--
--   delete from public.reservas;
--
-- ============================================================

create extension if not exists btree_gist;

-- Confere se já existe algo que impediria a regra de valer (dados de teste antigos)
do $$
declare
  invalidas int;
  sobrepostas int;
begin
  select count(*) into invalidas
  from public.reservas
  where hora_fim <= hora_inicio;

  if invalidas > 0 then
    raise exception 'Existem % reserva(s) com horário final igual ou anterior ao inicial. Cancele-as (ou rode: delete from public.reservas;) e execute de novo.', invalidas;
  end if;

  select count(*) into sobrepostas
  from public.reservas a
  join public.reservas b
    on a.ambiente_id = b.ambiente_id
   and a.id < b.id
   and (a.data + a.hora_inicio, a.data + a.hora_fim) overlaps (b.data + b.hora_inicio, b.data + b.hora_fim);

  if sobrepostas > 0 then
    raise exception 'Existem % par(es) de reservas sobrepostas no mesmo ambiente. Cancele-as no site (ou rode: delete from public.reservas; se forem só de teste) e execute de novo.', sobrepostas;
  end if;
end;
$$;

-- O horário final precisa ser depois do inicial
alter table public.reservas
  drop constraint if exists reservas_horario_valido;
alter table public.reservas
  add constraint reservas_horario_valido check (hora_fim > hora_inicio);

-- Nenhuma reserva pode se sobrepor a outra no mesmo ambiente
alter table public.reservas
  drop constraint if exists reservas_sem_sobreposicao;
alter table public.reservas
  add constraint reservas_sem_sobreposicao
  exclude using gist (
    ambiente_id with =,
    tsrange((data + hora_inicio), (data + hora_fim), '[)') with &&
  );
