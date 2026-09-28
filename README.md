# Portal de Reservas Acadêmicas — Núcleo

Versão real: login de verdade (Supabase Auth), ambientes e reservas compartilhados.

## Segurança (esta versão)

- Cadastro livre desligado: só entra quem o admin convidou por e-mail.
- O convite é enviado pela função `api/convidar.js` (roda no servidor do Vercel),
  que confere no banco se quem chamou é admin. A chave secreta fica só no Vercel.
- O cargo de cada pessoa é definido só pelo admin (no convite ou na aba "Usuários").
- O convidado escolhe a própria senha ao abrir o link do e-mail.

## O que ainda NÃO tem (vem depois)

- Layout do protótipo (agenda em grade, abas, modais)
- Bloqueio de colisão, limites de duração e antecedência, prioridades e aprovação pendente
- Recorrência, múltiplas salas, professor associado, períodos/disciplinas, dias habilitados
- Privacidade de material e de "Grupo de Estudos"

## Variáveis de ambiente (Vercel > Settings > Environment Variables)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (secreta — só no Vercel)

Depois de mudar variáveis, faça um novo deploy (Deployments > Redeploy).
