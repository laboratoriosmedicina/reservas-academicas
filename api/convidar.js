// Função do servidor (Vercel): convida um usuário por e-mail.
// Só funciona se quem chamou estiver logado E for admin.
// A chave SUPABASE_SERVICE_ROLE_KEY fica só aqui no servidor — nunca vai para o navegador.
import { createClient } from "@supabase/supabase-js";

const CARGOS = ["aluno", "monitor", "professor", "admin"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido." });
  }

  const url = process.env.VITE_SUPABASE_URL;
  const chaveServico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chaveServico) {
    return res.status(500).json({ erro: "Servidor sem configuração: falta SUPABASE_SERVICE_ROLE_KEY no Vercel." });
  }

  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!token) {
    return res.status(401).json({ erro: "Você precisa estar logado." });
  }

  const admin = createClient(url, chaveServico, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Quem está chamando?
  const { data: dadosUsuario, error: erroUsuario } = await admin.auth.getUser(token);
  if (erroUsuario || !dadosUsuario?.user) {
    return res.status(401).json({ erro: "Sessão inválida. Entre de novo." });
  }

  // 2) É admin? (conferido no banco, não em nada que o navegador mande)
  const { data: perfilChamador } = await admin
    .from("profiles")
    .select("cargo")
    .eq("id", dadosUsuario.user.id)
    .single();
  if (perfilChamador?.cargo !== "admin") {
    return res.status(403).json({ erro: "Só a administração pode convidar usuários." });
  }

  // 3) Dados do convite
  const { email, nome, cargo } = req.body || {};
  if (!email || !nome || !CARGOS.includes(cargo)) {
    return res.status(400).json({ erro: "Informe nome, e-mail e um cargo válido." });
  }

  const origem = req.headers.origin || `https://${req.headers.host}`;
  const { data: convite, error: erroConvite } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { nome },
    redirectTo: origem,
  });
  if (erroConvite) {
    return res.status(400).json({ erro: erroConvite.message });
  }

  // 4) O perfil já foi criado pelo gatilho como "aluno"; aqui o servidor define nome e cargo reais.
  const { error: erroPerfil } = await admin
    .from("profiles")
    .update({ nome, cargo })
    .eq("id", convite.user.id);
  if (erroPerfil) {
    return res.status(500).json({ erro: erroPerfil.message });
  }

  return res.status(200).json({ ok: true });
}
