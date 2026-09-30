-- ============================================================
-- Correção: fuso horário na checagem de antecedência e de tutoria ativa
-- Rode no SQL Editor do Supabase, depois de limites-tempo.sql.
--
-- O banco guarda data/hora "soltas" (sem fuso), exatamente como digitadas no
-- site — ou seja, já em horário de Fortaleza. Mas now() e current_date, no
-- Postgres, seguem UTC. Sem converter, o sistema comparava a reserva como se
-- ela já estivesse em UTC, "adiantando" o horário em 3h e achando que a
-- reserva era no passado.
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
  v_antecedencia numeric;
  v_duracao_min int;
  v_limite_min int;
  v_outro record;
  v_ativa_fim time;
  v_hoje_fortaleza date;
begin
  select cargo into v_cargo from public.profiles where id = new.usuario_id;
  select tipo, antecedencia_horas into v_tipo, v_antecedencia from public.ambientes where id = new.ambiente_id;
  v_hoje_fortaleza := (now() at time zone 'America/Fortaleza')::date;

  if new.hora_fim <= new.hora_inicio then
    raise exception 'O horário final precisa ser depois do inicial.';
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

  -- Antecedência mínima: todo mundo, exceto admin (agora comparando corretamente
  -- o horário digitado, que é horário de Fortaleza, com o instante atual real)
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

    -- Tutoria em andamento agora, com mais de 30 min restantes (usando o dia e o
    -- instante atuais em horário de Fortaleza, não em UTC)
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

  return new;
end;
$$;
