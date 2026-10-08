-- ============================================================
-- Dias da semana habilitados para reserva (sábado e domingo desativados
-- por padrão). Rode no SQL Editor do Supabase.
--
-- Vale para todos os cargos. Se a administração precisar de uma exceção
-- (ex.: evento num sábado), basta ativar o dia temporariamente.
-- ============================================================

create table if not exists public.config_sistema (
  id int primary key default 1,
  dias_habilitados int[] not null default '{1,2,3,4,5}', -- 0=Dom .. 6=Sáb
  constraint config_sistema_linha_unica check (id = 1)
);

insert into public.config_sistema (id, dias_habilitados)
values (1, '{1,2,3,4,5}')
on conflict (id) do nothing;

alter table public.config_sistema enable row level security;

drop policy if exists "Configuração visível para quem está logado" on public.config_sistema;
create policy "Configuração visível para quem está logado" on public.config_sistema
  for select using (auth.role() = 'authenticated');

drop policy if exists "Só admin altera a configuração" on public.config_sistema;
create policy "Só admin altera a configuração" on public.config_sistema
  for update using (public.is_admin());

-- Atualiza o gatilho de validação para também checar o dia da semana
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
  v_dias_habilitados int[];
  v_nomes_dias text[] := array['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
begin
  select cargo into v_cargo from public.profiles where id = new.usuario_id;
  select tipo, antecedencia_horas into v_tipo, v_antecedencia from public.ambientes where id = new.ambiente_id;
  select dias_habilitados into v_dias_habilitados from public.config_sistema where id = 1;
  v_hoje_fortaleza := (now() at time zone 'America/Fortaleza')::date;

  if new.hora_fim <= new.hora_inicio then
    raise exception 'O horário final precisa ser depois do inicial.';
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

  return new;
end;
$$;
