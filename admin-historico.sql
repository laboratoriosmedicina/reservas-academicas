-- ============================================================
-- Histórico de reservas (para a aba de Reservas do admin) e limites nos ambientes.
-- Rode no SQL Editor do Supabase, depois de seguranca-final.sql.
-- ============================================================

-- 1) Histórico: cada criação, solicitação, aprovação, recusa e cancelamento fica registrado.
--    Só a administração lê; ninguém escreve direto (só os gatilhos abaixo).
create table if not exists public.historico_reservas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  evento text not null check (evento in ('criacao', 'solicitacao', 'aprovacao', 'cancelamento', 'recusa')),
  reserva_id uuid,
  ambiente_nome text,
  tipo text,
  finalidade text,
  data date,
  hora_inicio time,
  hora_fim time,
  dono_nome text,
  autor_nome text
);

alter table public.historico_reservas enable row level security;

drop policy if exists "Só admin lê o histórico" on public.historico_reservas;
create policy "Só admin lê o histórico" on public.historico_reservas
  for select using (public.is_admin());

create or replace function public.registrar_historico_reserva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reservas%rowtype;
  v_evento text;
  v_amb text;
  v_dono text;
  v_autor text;
  v_motivo text;
begin
  if tg_op = 'DELETE' then
    r := old;
    v_motivo := coalesce(current_setting('app.motivo_cancelamento', true), '');
    v_evento := case when v_motivo = 'recusa' then 'recusa' else 'cancelamento' end;
  elsif tg_op = 'UPDATE' then
    r := new;
    v_evento := 'aprovacao';
  else
    r := new;
    v_evento := case when r.status = 'pendente' then 'solicitacao' else 'criacao' end;
  end if;

  select nome into v_amb from public.ambientes where id = r.ambiente_id;
  select nome into v_dono from public.profiles where id = r.usuario_id;
  select nome into v_autor from public.profiles where id = auth.uid();

  insert into public.historico_reservas
    (evento, reserva_id, ambiente_nome, tipo, finalidade, data, hora_inicio, hora_fim, dono_nome, autor_nome)
  values
    (v_evento, r.id, coalesce(v_amb, 'ambiente removido'), r.tipo, r.finalidade, r.data, r.hora_inicio, r.hora_fim,
     v_dono, coalesce(v_autor, 'sistema'));

  return null;
end;
$$;

drop trigger if exists trg_hist_insert on public.reservas;
create trigger trg_hist_insert
  after insert on public.reservas
  for each row execute function public.registrar_historico_reserva();

drop trigger if exists trg_hist_delete on public.reservas;
create trigger trg_hist_delete
  after delete on public.reservas
  for each row execute function public.registrar_historico_reserva();

drop trigger if exists trg_hist_aprovacao on public.reservas;
create trigger trg_hist_aprovacao
  after update on public.reservas
  for each row
  when (old.status = 'pendente' and new.status = 'confirmada')
  execute function public.registrar_historico_reserva();

-- 2) Limites básicos nos ambientes (valem para o que for criado/editado de agora em diante)
alter table public.ambientes drop constraint if exists ambientes_capacidade_positiva;
alter table public.ambientes add constraint ambientes_capacidade_positiva check (capacidade > 0) not valid;

alter table public.ambientes drop constraint if exists ambientes_antecedencia_valida;
alter table public.ambientes add constraint ambientes_antecedencia_valida check (antecedencia_horas >= 0) not valid;

alter table public.ambientes drop constraint if exists ambientes_nome_tamanho;
alter table public.ambientes add constraint ambientes_nome_tamanho check (char_length(nome) between 1 and 100) not valid;

alter table public.ambientes drop constraint if exists ambientes_regras_tamanho;
alter table public.ambientes add constraint ambientes_regras_tamanho check (regras is null or char_length(regras) <= 2000) not valid;
