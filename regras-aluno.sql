-- ============================================================
-- Regras do aluno/monitor: mínimo de 3 participantes no grupo de estudos
-- em laboratório (sem mínimo em sala de tutoria).
-- Rode no SQL Editor do Supabase, depois de prioridade-aprovacao.sql.
--
-- (A monitoria recorrente do monitor não precisa de mudança no banco:
-- cada data vira uma reserva, validada uma a uma pelas regras que já existem.)
-- ============================================================

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

  -- Grupo de estudos em laboratório exige no mínimo 3 participantes (alunos e monitores)
  if tg_op = 'INSERT' and v_cargo in ('aluno', 'monitor') and new.tipo = 'grupo_estudos' and v_tipo = 'laboratorio' then
    if coalesce(new.qtd_pessoas, 0) < 3 then
      raise exception 'Grupo de estudos em laboratório exige no mínimo 3 participantes.';
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
