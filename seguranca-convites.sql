-- ============================================================
-- Segurança: cargo definido só pelo admin + convite por e-mail
-- Rode no SQL Editor do Supabase (pode rodar mais de uma vez sem problema).
-- ============================================================

-- 1) E-mail de cada usuário, visível só para o admin e para o próprio usuário
create table if not exists public.profile_emails (
  id uuid primary key references public.profiles(id) on delete cascade,
  email text not null
);

alter table public.profile_emails enable row level security;

drop policy if exists "Admin ou o próprio usuário vê o e-mail" on public.profile_emails;
create policy "Admin ou o próprio usuário vê o e-mail" on public.profile_emails
  for select using (public.is_admin() or auth.uid() = id);

-- Preenche o e-mail de quem já tem conta
insert into public.profile_emails (id, email)
select u.id, u.email
from auth.users u
join public.profiles p on p.id = u.id
on conflict (id) do nothing;

-- 2) Gatilho: todo usuário novo nasce como "aluno".
--    O cargo real é definido só pelo servidor (função de convite) ou pelo admin,
--    nunca por algo que o navegador consiga enviar.
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
    'aluno'
  );
  insert into public.profile_emails (id, email)
  values (new.id, new.email);
  return new;
end;
$$;
