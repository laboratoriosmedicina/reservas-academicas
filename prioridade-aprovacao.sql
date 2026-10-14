-- ============================================================
-- Prioridade entre tipos de reserva + aprovação pendente + notificações
-- + correção de segurança na leitura das reservas.
-- Rode no SQL Editor do Supabase, depois de dias-habilitados.sql.
--
-- Prioridade (maior vence): professor (3) > monitoria (2) > grupo de estudos (1)
--
-- Quando alguém reserva um horário que colide com reserva(s) CONFIRMADA(S):
--   * se alguma tiver prioridade igual ou maior  -> bloqueado
--   * se todas tiverem prioridade menor          -> a nova reserva fica "pendente"
--     até a administração aprovar (aprovar confirma a nova e cancela as menores,
--     avisando seus donos; recusar descarta a nova).
-- ============================================================

-- 1) Status da reserva
alter table public.reservas add column if not exists status text not null default 'confirmada';
alter table public.reservas drop constraint if exists reservas_status_valido;
alter table public.reservas add constraint reservas_status_valido check (status in ('confirmada', 'pendente'));

-- 2) A regra "sem sobreposição" passa a valer só entre reservas confirmadas
alter table public.reservas drop constraint if exists reservas_sem_sobreposicao;
alter table public.reservas
  add constraint reservas_sem_sobreposicao
  exclude using gist (
    ambiente_id with =,
    tsrange((data + hora_inicio), (data + hora_fim), '[)') with &&
  )
  where (status = 'confirmada');

-- 3) Prioridade de cada tipo
create or replace function public.prioridade_tipo(p_tipo text)
returns int
language sql
immutable
as $$
  select case p_tipo when 'professor' then 3 when 'monitoria' then 2 when 'grupo_estudos' then 1 else 0 end;
$$;

-- 4) Notificações dentro do sistema (cada pessoa só vê as próprias)
create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  mensagem text not null,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notificacoes enable row level security;

drop policy if exists "Cada um lê as próprias notificações" on public.notificacoes;
create policy "Cada um lê as próprias notificações" on public.notificacoes
  for select using (auth.uid() = usuario_id);

drop policy if exists "Cada um marca as próprias como lidas" on public.notificacoes;
create policy "Cada um marca as próprias como lidas" on public.notificacoes
  for update using (auth.uid() = usuario_id);

-- 5) Aviso automático quando a reserva de alguém é cancelada por outra pessoa (a administração)
create or replace function public.notificar_cancelamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text;
  v_amb text;
  v_final text;
begin
  if auth.uid() is not null
     and auth.uid() is distinct from old.usuario_id
     and exists (select 1 from public.profiles where id = old.usuario_id) then

    v_motivo := coalesce(current_setting('app.motivo_cancelamento', true), '');
    select nome into v_amb from public.ambientes where id = old.ambiente_id;

    v_final := case v_motivo
      when 'prioridade' then 'foi cancelada pela administração para dar lugar a uma reserva de prioridade maior'
      when 'recusa' then 'foi recusada pela administração'
      else 'foi cancelada pela administração'
    end;

    insert into public.notificacoes (usuario_id, mensagem)
    values (
      old.usuario_id,
      format('Sua reserva "%s" (%s, %s das %s às %s) %s.',
        old.finalidade,
        coalesce(v_amb, 'ambiente removido'),
        to_char(old.data, 'DD/MM/YYYY'),
        to_char(old.hora_inicio, 'HH24:MI'),
        to_char(old.hora_fim, 'HH24:MI'),
        v_final)
    );
  end if;
  return old;
end;
$$;

drop trigger if exists trg_notificar_cancelamento on public.reservas;
create trigger trg_notificar_cancelamento
  after delete on public.reservas
  for each row execute function public.notificar_cancelamento();

-- 6) Validação das reservas (acrescenta: tipo permitido por cargo e prioridade/pendência)
create or replace function public.validar_reserva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cargo text;
  v_tipo text;
  v_amb_nome text;
  v_antecedencia numeric;
  v_duracao_min int;
  v_limite_min int;
  v_outro record;
  v_conf record;
  v_conf_prio int;
  v_ativa_fim time;
  v_hoje_fortaleza date;
  v_dias_habilitados int[];
  v_nomes_dias text[] := array['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
begin
  -- Aprovar/recusar mexe só no status: não precisa revalidar nada
  if tg_op = 'UPDATE' then
    if old.ambiente_id = new.ambiente_id
       and old.data = new.data
       and old.hora_inicio = new.hora_inicio
       and old.hora_fim = new.hora_fim
       and old.usuario_id = new.usuario_id
       and old.tipo = new.tipo then
      return new;
    end if;
  end if;

  select cargo into v_cargo from public.profiles where id = new.usuario_id;
  select tipo, antecedencia_horas, nome into v_tipo, v_antecedencia, v_amb_nome from public.ambientes where id = new.ambiente_id;
  select dias_habilitados into v_dias_habilitados from public.config_sistema where id = 1;
  v_hoje_fortaleza := (now() at time zone 'America/Fortaleza')::date;

  if new.hora_fim <= new.hora_inicio then
    raise exception 'O horário final precisa ser depois do inicial.';
  end if;

  -- Cada cargo só pode usar certos tipos de reserva
  if tg_op = 'INSERT' then
    if v_cargo = 'aluno' and new.tipo <> 'grupo_estudos' then
      raise exception 'Alunos só podem reservar como grupo de estudos.';
    elsif v_cargo = 'monitor' and new.tipo not in ('monitoria', 'grupo_estudos') then
      raise exception 'Alunos monitores só podem reservar monitoria ou grupo de estudos.';
    end if;
  end if;

  if v_dias_habilitados is not null and not (extract(dow from new.data)::int = any(v_dias_habilitados)) then
    raise exception 'A administração desativou reservas aos %.', v_nomes_dias[extract(dow from new.data)::int + 1];
  end if;

  v_duracao_min := extract(epoch from (new.hora_fim - new.hora_inicio)) / 60;

  if v_cargo in ('aluno', 'monitor') then
    v_limite_min := case when v_tipo = 'laboratorio' then 120 else 180 end;
    if v_duracao_min > v_limite_min then
      raise exception 'Alunos podem reservar % por, no máximo, %h.',
        case when v_tipo = 'laboratorio' then 'laboratório' else 'sala de tutoria' end,
        (v_limite_min / 60);
    end if;
  end if;

  if v_cargo <> 'admin' and coalesce(v_antecedencia, 0) > 0 then
    if (((new.data + new.hora_inicio) at time zone 'America/Fortaleza') - now()) < (v_antecedencia * interval '1 hour') then
      raise exception '% exige pelo menos %h de antecedência.',
        case when v_tipo = 'laboratorio' then 'Laboratório' else 'Sala de tutoria' end,
        v_antecedencia;
    end if;
  end if;

  if v_cargo in ('aluno', 'monitor') then

    for v_outro in
      select r.hora_inicio, r.hora_fim, a.nome as nome, a.tipo as tipo
      from public.reservas r
      join public.ambientes a on a.id = r.ambiente_id
      where r.usuario_id = new.usuario_id
        and r.data = new.data
        and r.id is distinct from new.id
        and a.tipo in ('laboratorio', 'sala_tutoria')
    loop
      if (new.hora_inicio, new.hora_fim) overlaps (v_outro.hora_inicio, v_outro.hora_fim) then
        raise exception 'Você já tem % (%) das % às % nesse dia — não é possível estar em dois lugares ao mesmo tempo.',
          case when v_outro.tipo = 'laboratorio' then 'laboratório' else 'sala de tutoria' end,
          v_outro.nome, to_char(v_outro.hora_inicio, 'HH24:MI'), to_char(v_outro.hora_fim, 'HH24:MI');
      elsif v_outro.tipo = v_tipo then
        if new.hora_inicio >= v_outro.hora_fim then
          if new.hora_inicio - v_outro.hora_fim < interval '120 min' then
            raise exception 'É preciso um intervalo de pelo menos 2h entre reservas de % no mesmo dia. Você já tem % das % às %.',
              case when v_tipo = 'laboratorio' then 'laboratório' else 'sala de tutoria' end,
              v_outro.nome, to_char(v_outro.hora_inicio, 'HH24:MI'), to_char(v_outro.hora_fim, 'HH24:MI');
          end if;
        else
          if v_outro.hora_inicio - new.hora_fim < interval '120 min' then
            raise exception 'É preciso um intervalo de pelo menos 2h entre reservas de % no mesmo dia. Você já tem % das % às %.',
              case when v_tipo = 'laboratorio' then 'laboratório' else 'sala de tutoria' end,
              v_outro.nome, to_char(v_outro.hora_inicio, 'HH24:MI'), to_char(v_outro.hora_fim, 'HH24:MI');
          end if;
        end if;
      end if;
    end loop;

    if v_tipo = 'sala_tutoria' then
      select r.hora_fim into v_ativa_fim
      from public.reservas r
      join public.ambientes a on a.id = r.ambiente_id
      where r.usuario_id = new.usuario_id
        and a.tipo = 'sala_tutoria'
        and r.data = v_hoje_fortaleza
        and r.id is distinct from new.id
        and now() >= ((r.data + r.hora_inicio) at time zone 'America/Fortaleza')
        and now() < ((r.data + r.hora_fim) at time zone 'America/Fortaleza')
      limit 1;

      if v_ativa_fim is not null
         and (((v_hoje_fortaleza + v_ativa_fim) at time zone 'America/Fortaleza') - now()) > interval '30 min' then
        raise exception 'Você ainda tem uma tutoria em andamento (termina às %). Só é possível reservar outra tutoria quando faltarem 30 minutos ou menos para o fim da atual.',
          to_char(v_ativa_fim, 'HH24:MI');
      end if;
    end if;
  end if;

  -- Prioridade: colisão com reservas confirmadas no mesmo ambiente
  if tg_op = 'INSERT' then
    new.status := 'confirmada';

    select max(public.prioridade_tipo(r.tipo)) into v_conf_prio
    from public.reservas r
    where r.ambiente_id = new.ambiente_id
      and r.status = 'confirmada'
      and r.id is distinct from new.id
      and tsrange(r.data + r.hora_inicio, r.data + r.hora_fim, '[)')
          && tsrange(new.data + new.hora_inicio, new.data + new.hora_fim, '[)');

    if v_conf_prio is not null then
      if v_conf_prio >= public.prioridade_tipo(new.tipo) then
        select r.data, r.hora_inicio, r.hora_fim, r.finalidade into v_conf
        from public.reservas r
        where r.ambiente_id = new.ambiente_id
          and r.status = 'confirmada'
          and r.id is distinct from new.id
          and public.prioridade_tipo(r.tipo) >= public.prioridade_tipo(new.tipo)
          and tsrange(r.data + r.hora_inicio, r.data + r.hora_fim, '[)')
              && tsrange(new.data + new.hora_inicio, new.data + new.hora_fim, '[)')
        order by r.data, r.hora_inicio
        limit 1;

        raise exception 'Esse horário já está ocupado em %: % das % às % (%). Escolha outro horário.',
          v_amb_nome,
          to_char(v_conf.data, 'DD/MM/YYYY'),
          to_char(v_conf.hora_inicio, 'HH24:MI'),
          to_char(v_conf.hora_fim, 'HH24:MI'),
          v_conf.finalidade;
      else
        new.status := 'pendente';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_reserva on public.reservas;
create trigger trg_validar_reserva
  before insert or update on public.reservas
  for each row execute function public.validar_reserva();

-- 7) Aprovar e recusar (só a administração)
create or replace function public.aprovar_reserva(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservas%rowtype;
  v_maior int;
  v_amb text;
begin
  if not public.is_admin() then
    raise exception 'Só a administração pode aprovar reservas.';
  end if;

  select * into v_res from public.reservas where id = p_id for update;
  if not found then
    raise exception 'Reserva não encontrada.';
  end if;
  if v_res.status <> 'pendente' then
    raise exception 'Esta reserva não está pendente.';
  end if;

  select max(public.prioridade_tipo(r.tipo)) into v_maior
  from public.reservas r
  where r.ambiente_id = v_res.ambiente_id
    and r.status = 'confirmada'
    and r.id <> p_id
    and tsrange(r.data + r.hora_inicio, r.data + r.hora_fim, '[)')
        && tsrange(v_res.data + v_res.hora_inicio, v_res.data + v_res.hora_fim, '[)');

  if v_maior is not null and v_maior >= public.prioridade_tipo(v_res.tipo) then
    raise exception 'Já existe uma reserva de prioridade igual ou maior confirmada nesse horário. Recuse esta solicitação.';
  end if;

  -- Cancela as reservas de menor prioridade que estão no caminho (os donos são avisados pelo gatilho)
  perform set_config('app.motivo_cancelamento', 'prioridade', true);
  delete from public.reservas r
  where r.ambiente_id = v_res.ambiente_id
    and r.status = 'confirmada'
    and r.id <> p_id
    and tsrange(r.data + r.hora_inicio, r.data + r.hora_fim, '[)')
        && tsrange(v_res.data + v_res.hora_inicio, v_res.data + v_res.hora_fim, '[)');

  update public.reservas set status = 'confirmada' where id = p_id;

  select nome into v_amb from public.ambientes where id = v_res.ambiente_id;
  insert into public.notificacoes (usuario_id, mensagem)
  values (
    v_res.usuario_id,
    format('Sua reserva "%s" (%s, %s das %s às %s) foi aprovada e confirmada.',
      v_res.finalidade,
      coalesce(v_amb, 'ambiente removido'),
      to_char(v_res.data, 'DD/MM/YYYY'),
      to_char(v_res.hora_inicio, 'HH24:MI'),
      to_char(v_res.hora_fim, 'HH24:MI'))
  );
end;
$$;

create or replace function public.recusar_reserva(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Só a administração pode recusar reservas.';
  end if;

  select status into v_status from public.reservas where id = p_id for update;
  if v_status is null then
    raise exception 'Reserva não encontrada.';
  end if;
  if v_status <> 'pendente' then
    raise exception 'Esta reserva não está pendente.';
  end if;

  perform set_config('app.motivo_cancelamento', 'recusa', true);
  delete from public.reservas where id = p_id;
end;
$$;

revoke execute on function public.aprovar_reserva(uuid) from public, anon;
grant execute on function public.aprovar_reserva(uuid) to authenticated;
revoke execute on function public.recusar_reserva(uuid) from public, anon;
grant execute on function public.recusar_reserva(uuid) to authenticated;

-- 8) CORREÇÃO DE SEGURANÇA na leitura das reservas.
--
-- Antes, qualquer pessoa logada podia consultar a tabela "reservas" direto pela API
-- e ver o material e quem fez cada reserva, passando por cima da view com privacidade.
-- Agora a tabela só pode ser lida pelo dono da reserva e pela administração, e todo
-- mundo lê pela view, que devolve esses campos ocultos. A view também deixa de expor
-- o id de quem reservou (devolve só "eh_minha"), senão o id poderia ser cruzado com
-- a lista de nomes para descobrir o responsável de um grupo de estudos.
drop policy if exists "Reservas visíveis para quem está logado" on public.reservas;
drop policy if exists "Dono ou admin lê reservas" on public.reservas;
create policy "Dono ou admin lê reservas" on public.reservas
  for select using (auth.uid() = usuario_id or public.is_admin());

drop view if exists public.reservas_visiveis;

create view public.reservas_visiveis as
select
  r.id,
  r.ambiente_id,
  (auth.uid() = r.usuario_id) as eh_minha,
  r.tipo,
  r.finalidade,
  r.periodo_nome,
  r.data,
  r.hora_inicio,
  r.hora_fim,
  r.qtd_pessoas,
  r.status,
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
left join public.profiles pa on pa.id = r.professor_associado_id
where auth.uid() is not null;

revoke all on public.reservas_visiveis from anon;
grant select on public.reservas_visiveis to authenticated;
