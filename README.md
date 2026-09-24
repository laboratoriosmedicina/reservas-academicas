# Portal de Reservas Acadêmicas — Núcleo

Versão inicial real: login de verdade (Supabase Auth), ambientes e reservas
compartilhados entre todos que acessam o site.

## O que ainda NÃO tem nesta versão (vem depois)

- Recorrência de reserva, múltiplas salas, professor associado
- Prioridade entre tipos de reserva e aprovação pendente
- Dias da semana habilitados, períodos/disciplinas
- Privacidade de material e de "Grupo de Estudos"
- Convite de usuário pelo próprio admin (por enquanto, qualquer um cria conta e
  escolhe o próprio cargo — ajustamos isso assim que o núcleo estiver no ar)

## Deploy

1. Suba esta pasta inteira num repositório do GitHub.
2. Importe o repositório no Vercel.
3. Nas configurações do projeto no Vercel, em "Environment Variables", adicione:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   (veja os valores em `.env.example` — use os valores reais do seu projeto Supabase)
4. Clique em Deploy.
