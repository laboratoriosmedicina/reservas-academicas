-- Correção de segurança: só admin pode alterar cargo/perfil de outra pessoa.
-- Usuários comuns não podem mais editar a própria linha (evita se promoverem a admin).
-- Rode isso no SQL Editor do Supabase, depois do schema-nucleo.sql.

drop policy if exists "Cada um edita o próprio perfil, admin edita qualquer um" on public.profiles;

create policy "Só admin edita perfis" on public.profiles
  for update using (public.is_admin());
