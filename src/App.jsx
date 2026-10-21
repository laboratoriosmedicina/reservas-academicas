import React, { useEffect, useState } from "react";
import { supabase, HASH_INICIAL } from "./supabaseClient";

// ---------------------------------------------------------------- Identidade visual
const COLORS = {
  ink: "#1B2430",
  inkSoft: "#5B6470",
  bg: "#EFF1EA",
  panel: "#FFFFFF",
  line: "#D6DAD2",
  teal: "#2F6F6B",
  tealSoft: "#E4EFEE",
  professor: "#8A5A20",
  professorSoft: "#FBF1DC",
  monitor: "#6B4FA0",
  monitorSoft: "#EEE8F7",
  danger: "#B23A48",
  dangerSoft: "#F7E4E0",
};

const CARGO_LABEL = { aluno: "Aluno", monitor: "Aluno monitor", professor: "Professor", admin: "Administração" };
const TIPO_AMBIENTE_LABEL = { laboratorio: "Laboratório", sala_tutoria: "Sala de tutoria" };
const TIPO_AMBIENTE_LABEL_PLURAL = { laboratorio: "Laboratórios", sala_tutoria: "Salas de tutoria" };
const TIPO_LABEL = { grupo_estudos: "Grupo de estudos", monitoria: "Monitoria", professor: "Professor" };
const TIPO_COLOR = { grupo_estudos: COLORS.teal, monitoria: COLORS.monitor, professor: COLORS.professor };
const TIPO_SOFT = { grupo_estudos: COLORS.tealSoft, monitoria: COLORS.monitorSoft, professor: COLORS.professorSoft };

const inputStyle = {
  width: "100%",
  padding: "9px 10px",
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  fontSize: 13.5,
  boxSizing: "border-box",
  background: "#fff",
};

const buttonStyle = {
  background: COLORS.ink,
  color: "#fff",
  border: "none",
  borderRadius: 4,
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const fonteTitulo = { fontFamily: "'Poppins', sans-serif" };

function Campo({ label, hint, children, style }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, fontSize: 13, color: "#333", ...style }}>
      {label}
      {children}
      {hint && <span style={{ fontSize: 11, color: COLORS.inkSoft, fontWeight: 400 }}>{hint}</span>}
    </label>
  );
}

// Modal genérico: overlay + painel branco
function Modal({ largura = 460, onFechar, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,36,32,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={onFechar}>
      <div
        style={{ background: "#fff", width: largura, maxWidth: "100%", padding: "24px 24px 20px", maxHeight: "88vh", overflowY: "auto", borderRadius: 4 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// Prioridade entre os tipos de reserva (maior vence).
export const PRIORIDADE = { professor: 3, monitoria: 2, grupo_estudos: 1 };

// Procura uma reserva CONFIRMADA que impede o horário pedido: sobrepõe no tempo e tem prioridade
// igual ou maior que a do tipo pedido. (Sobreposição com prioridade menor não bloqueia: a nova
// reserva fica pendente de aprovação. Reservas pendentes não ocupam o horário.)
// Horários "HH:MM" comparam certo como texto. Reservas seguidas (fim = início) não colidem.
export function acharConflito(reservas, data, horaInicio, horaFim, tipo) {
  return (
    reservas.find(
      (r) =>
        r.data === data &&
        r.status !== "pendente" &&
        (PRIORIDADE[r.tipo] || 0) >= (PRIORIDADE[tipo] || 0) &&
        r.hora_inicio.slice(0, 5) < horaFim &&
        horaInicio < r.hora_fim.slice(0, 5),
    ) || null
  );
}

// Conta quantas reservas confirmadas, de prioridade MENOR, ficariam no caminho (a nova ficaria pendente).
export function contarMenoresNoCaminho(reservas, data, horaInicio, horaFim, tipo) {
  return reservas.filter(
    (r) =>
      r.data === data &&
      r.status !== "pendente" &&
      (PRIORIDADE[r.tipo] || 0) < (PRIORIDADE[tipo] || 0) &&
      r.hora_inicio.slice(0, 5) < horaFim &&
      horaInicio < r.hora_fim.slice(0, 5),
  ).length;
}

function validarLimites({ cargo, tipo, antecedenciaHoras, data, horaInicio, horaFim, agora = new Date() }) {
  if (horaFim <= horaInicio) return { erro: "O horário final precisa ser depois do inicial." };

  if (cargo === "aluno" || cargo === "monitor") {
    const limiteMin = tipo === "laboratorio" ? 120 : 180;
    const duracaoMin = toMinutosHHMM(horaFim) - toMinutosHHMM(horaInicio);
    if (duracaoMin > limiteMin) {
      return { erro: `Alunos podem reservar ${tipo === "laboratorio" ? "laboratório" : "sala de tutoria"} por, no máximo, ${limiteMin / 60}h.` };
    }
  }

  if (cargo !== "admin" && antecedenciaHoras > 0) {
    const inicio = new Date(`${data}T${horaInicio}:00`);
    const minutosAte = (inicio.getTime() - agora.getTime()) / 60000;
    if (minutosAte < antecedenciaHoras * 60) {
      const label = tipo === "laboratorio" ? "Laboratório" : "Sala de tutoria";
      const texto = antecedenciaHoras < 1 ? `${Math.round(antecedenciaHoras * 60)} min` : `${antecedenciaHoras}h`;
      return { erro: `${label} exige pelo menos ${texto} de antecedência.` };
    }
  }
  return { erro: null };
}

function diaSemanaDe(iso) {
  return new Date(`${iso}T00:00:00`).getDay();
}

function addDias(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Gera as datas (entre dataInicio e dataFim, incluindo ambas) cujo dia da semana está em diasSemana.
export function gerarOcorrencias(dataInicio, dataFim, diasSemana) {
  const datas = [];
  let cursor = dataInicio;
  let guarda = 0;
  while (cursor <= dataFim && guarda < 1000) {
    if (!diasSemana || diasSemana.length === 0 || diasSemana.includes(diaSemanaDe(cursor))) {
      datas.push(cursor);
    }
    cursor = addDias(cursor, 1);
    guarda++;
  }
  return datas;
}

// Procura, na lista de ocorrências (em ordem), a primeira que colide com uma reserva confirmada de
// prioridade igual ou maior (as de prioridade menor deixam a nova reserva pendente, não bloqueiam).
export function acharPrimeiroConflito(reservasExistentes, ocorrencias, horaInicio, horaFim, tipo) {
  for (const data of ocorrencias) {
    const r = acharConflito(reservasExistentes, data, horaInicio, horaFim, tipo);
    if (r) return { data, reserva: r };
  }
  return null;
}

// Uma série (recorrência) não pode ter datas demais: protege contra um ano digitado errado.
export const MAX_OCORRENCIAS = 120;

export function erroSerieGrande(qtd) {
  return qtd > MAX_OCORRENCIAS
    ? `Essa recorrência teria ${qtd} datas e o máximo é ${MAX_OCORRENCIAS}. Reduza o período (confira se o ano da data final está certo).`
    : null;
}

// Traduz os erros técnicos do banco para mensagens que a pessoa entende.
export function traduzirErroBanco(error) {
  if (error.code === "23P01") {
    return "Esse horário acabou de ser reservado por outra pessoa. Veja a lista atualizada e escolha outro horário.";
  }
  if (error.code === "23514") {
    const m = error.message || "";
    if (m.includes("reservas_horario_valido")) return "O horário final precisa ser depois do inicial.";
    if (m.includes("qtd_pessoas")) return "A quantidade de pessoas precisa ser maior que zero.";
    if (m.includes("tamanho")) return "Algum texto está longo demais (finalidade até 200 caracteres, material até 2000).";
  }
  return error.message;
}

// Grupo de estudos em laboratório exige no mínimo 3 participantes (vale para aluno e monitor).
export function erroMinimoParticipantes({ cargo, tipoReserva, tipoAmbiente, qtdPessoas }) {
  if ((cargo === "aluno" || cargo === "monitor") && tipoReserva === "grupo_estudos" && tipoAmbiente === "laboratorio" && Number(qtdPessoas) < 3) {
    return "Grupo de estudos em laboratório exige no mínimo 3 participantes.";
  }
  return null;
}

function toMinutosHHMM(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function dataBR(iso) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- Login
function TelaAutenticacao({ avisoInicial }) {
  const [modo, setModo] = useState("entrar"); // "entrar" | "esqueci"
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mensagem, setMensagem] = useState(avisoInicial || "");
  const [carregando, setCarregando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setMensagem("");
    setCarregando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) setMensagem("E-mail ou senha incorretos.");
  }

  async function enviarLinkDeSenha(e) {
    e.preventDefault();
    setMensagem("");
    setCarregando(true);
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setCarregando(false);
    setMensagem("Se esse e-mail tiver acesso ao sistema, você vai receber um link para definir a senha.");
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 380, width: "100%", margin: 20, padding: "32px 28px", background: "#fff", borderRadius: 6 }}>
        <h1 style={{ ...fonteTitulo, fontSize: 19, marginBottom: 4, color: COLORS.ink }}>Portal de Reservas Acadêmicas</h1>
        <p style={{ fontSize: 12, color: COLORS.inkSoft, marginBottom: 20 }}>
          {modo === "entrar" ? "Entre com o e-mail e a senha que você definiu pelo convite." : "Informe seu e-mail para receber um link de definição de senha."}
        </p>

        <form onSubmit={modo === "entrar" ? entrar : enviarLinkDeSenha}>
          <Campo label="E-mail">
            <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Campo>
          {modo === "entrar" && (
            <Campo label="Senha">
              <input type="password" style={inputStyle} value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </Campo>
          )}

          {mensagem && <p style={{ fontSize: 13, color: COLORS.danger, marginBottom: 12 }}>{mensagem}</p>}

          <button type="submit" disabled={carregando} style={{ ...buttonStyle, width: "100%" }}>
            {carregando ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Enviar link"}
          </button>
        </form>

        <p style={{ fontSize: 12, color: COLORS.inkSoft, marginTop: 16, textAlign: "center" }}>
          {modo === "entrar" ? (
            <>
              <button onClick={() => { setModo("esqueci"); setMensagem(""); }} style={{ background: "none", border: "none", color: COLORS.ink, textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>
                Esqueci minha senha / convite expirou
              </button>
              <br />
              Não tem acesso? Peça um convite à administração.
            </>
          ) : (
            <button onClick={() => { setModo("entrar"); setMensagem(""); }} style={{ background: "none", border: "none", color: COLORS.ink, textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>
              Voltar para o login
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------ Definir senha (convite / redefinição)
function TelaDefinirSenha({ onConcluido }) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (senha.length < 8) {
      setErro("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (senha !== confirmacao) {
      setErro("As senhas não coincidem.");
      return;
    }
    setCarregando(true);
    const { error } = await supabase.auth.updateUser({ password: senha, data: { senha_definida: true } });
    setCarregando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    onConcluido();
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 380, width: "100%", margin: 20, padding: "32px 28px", background: "#fff", borderRadius: 6 }}>
        <h1 style={{ ...fonteTitulo, fontSize: 19, marginBottom: 4, color: COLORS.ink }}>Defina sua senha</h1>
        <p style={{ fontSize: 12, color: COLORS.inkSoft, marginBottom: 20 }}>Escolha a senha que você vai usar para entrar no portal.</p>
        <form onSubmit={salvar}>
          <Campo label="Nova senha (mínimo 8 caracteres)">
            <input type="password" style={inputStyle} value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </Campo>
          <Campo label="Confirmar senha">
            <input type="password" style={inputStyle} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required />
          </Campo>
          {erro && <p style={{ fontSize: 13, color: COLORS.danger, marginBottom: 12 }}>{erro}</p>}
          <button type="submit" disabled={carregando} style={{ ...buttonStyle, width: "100%" }}>
            {carregando ? "Salvando…" : "Salvar senha e entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------ Admin: usuários e convites
function PainelUsuarios({ session }) {
  const [usuarios, setUsuarios] = useState([]);
  const [form, setForm] = useState({ nome: "", email: "", cargo: "aluno" });
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function carregar() {
    const { data, error } = await supabase.from("profiles").select("id, nome, cargo, profile_emails(email)").order("nome");
    if (error) {
      setMensagem(error.message);
      return;
    }
    setUsuarios(data);
  }

  useEffect(() => {
    carregar();
  }, []);

  function emailDe(p) {
    const e = p.profile_emails;
    return Array.isArray(e) ? e[0]?.email : e?.email;
  }

  async function convidar(e) {
    e.preventDefault();
    setMensagem("");
    setEnviando(true);
    try {
      const resp = await fetch("/api/convidar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(form),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setMensagem(json.erro || `Não foi possível enviar o convite (erro ${resp.status}).`);
      } else {
        setMensagem(`Convite enviado para ${form.email}.`);
        setForm({ nome: "", email: "", cargo: "aluno" });
        carregar();
      }
    } catch (err) {
      setMensagem("Falha de conexão ao enviar o convite.");
    }
    setEnviando(false);
  }

  async function alterarCargo(id, cargo) {
    const { error } = await supabase.from("profiles").update({ cargo }).eq("id", id);
    if (error) setMensagem(error.message);
    else carregar();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24 }}>
      <div>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, textTransform: "uppercase", letterSpacing: 0.3 }}>Convidar usuário</h3>
        <form onSubmit={convidar}>
          <Campo label="Nome completo">
            <input style={inputStyle} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
          </Campo>
          <Campo label="E-mail">
            <input type="email" style={inputStyle} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Campo>
          <Campo label="Cargo">
            <select style={inputStyle} value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })}>
              <option value="aluno">Aluno</option>
              <option value="monitor">Aluno monitor</option>
              <option value="professor">Professor</option>
              <option value="admin">Administração</option>
            </select>
          </Campo>
          <button type="submit" disabled={enviando} style={{ ...buttonStyle, width: "100%", background: COLORS.teal }}>
            {enviando ? "Enviando…" : "Enviar convite por e-mail"}
          </button>
        </form>
        {mensagem && <p style={{ fontSize: 13, color: "#333", marginTop: 12 }}>{mensagem}</p>}
      </div>

      <div>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, textTransform: "uppercase", letterSpacing: 0.3 }}>Usuários ({usuarios.length})</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {usuarios.map((u) => (
            <div key={u.id} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13 }}>{u.nome}</div>
                <div style={{ fontSize: 11, color: COLORS.inkSoft }}>{emailDe(u) || "—"}</div>
              </div>
              <select
                value={u.cargo}
                disabled={u.id === session.user.id}
                title={u.id === session.user.id ? "Você não pode alterar o próprio cargo" : undefined}
                onChange={(e) => alterarCargo(u.id, e.target.value)}
                style={{ ...inputStyle, width: "auto" }}
              >
                <option value="aluno">Aluno</option>
                <option value="monitor">Aluno monitor</option>
                <option value="professor">Professor</option>
                <option value="admin">Administração</option>
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------ Admin: edição dos ambientes
const FORM_AMBIENTE_VAZIO = { nome: "", tipo: "laboratorio", capacidade: 10, antecedenciaHoras: 48, regras: "" };

function FormAmbiente({ inicial, rotuloSalvar, onSalvar, onCancelar }) {
  const [v, setV] = useState(inicial);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setErro("");
    if (!v.nome.trim()) {
      setErro("Informe o nome do ambiente.");
      return;
    }
    if (Number(v.capacidade) < 1) {
      setErro("A capacidade precisa ser de pelo menos 1 pessoa.");
      return;
    }
    if (Number(v.antecedenciaHoras) < 0) {
      setErro("A antecedência não pode ser negativa.");
      return;
    }
    setSalvando(true);
    const mensagem = await onSalvar(v);
    setSalvando(false);
    if (mensagem) setErro(mensagem);
  }

  return (
    <form onSubmit={enviar} style={{ background: COLORS.tealSoft, border: `1px solid ${COLORS.teal}`, borderRadius: 4, padding: "12px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Campo label="Nome" style={{ flex: 2, minWidth: 180 }}>
          <input style={inputStyle} value={v.nome} maxLength={100} onChange={(e) => setV({ ...v, nome: e.target.value })} required />
        </Campo>
        <Campo label="Tipo" style={{ flex: 1, minWidth: 140 }}>
          <select style={inputStyle} value={v.tipo} onChange={(e) => setV({ ...v, tipo: e.target.value })}>
            <option value="laboratorio">Laboratório</option>
            <option value="sala_tutoria">Sala de tutoria</option>
          </select>
        </Campo>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Campo label="Capacidade (pessoas)" style={{ flex: 1, minWidth: 140 }}>
          <input type="number" min={1} style={inputStyle} value={v.capacidade} onChange={(e) => setV({ ...v, capacidade: e.target.value })} />
        </Campo>
        <Campo label="Antecedência mínima (horas)" hint="Ex.: 48 para laboratório, 0.5 para tutoria." style={{ flex: 1, minWidth: 160 }}>
          <input type="number" min={0} step="0.5" style={inputStyle} value={v.antecedenciaHoras} onChange={(e) => setV({ ...v, antecedenciaHoras: e.target.value })} />
        </Campo>
      </div>
      <Campo label="Regras de uso" hint="Aparecem para todos no detalhe de cada reserva deste ambiente.">
        <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 70 }} value={v.regras} maxLength={2000} onChange={(e) => setV({ ...v, regras: e.target.value })} placeholder="Ex.: Uso obrigatório de jaleco. Não é permitido consumir alimentos." />
      </Campo>
      {erro && <p style={{ fontSize: 12.5, color: COLORS.danger, marginBottom: 8 }}>{erro}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onCancelar} style={{ background: "transparent", border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
        <button type="submit" disabled={salvando} style={{ ...buttonStyle, background: COLORS.teal, padding: "7px 16px", fontSize: 12.5 }}>{salvando ? "Salvando…" : rotuloSalvar}</button>
      </div>
    </form>
  );
}

function PainelAmbientes({ ambientes, diasHabilitados, onAlternarDia, aoMudar }) {
  const [criando, setCriando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [mensagem, setMensagem] = useState("");

  function traduzir(error) {
    if (error.code === "23505") return "Já existe um ambiente com esse nome.";
    if (error.code === "23514") return "Valores inválidos: confira capacidade, antecedência e o tamanho dos textos.";
    return error.message;
  }

  function paraBanco(v) {
    return {
      nome: v.nome.trim(),
      tipo: v.tipo,
      capacidade: Number(v.capacidade),
      antecedencia_horas: Number(v.antecedenciaHoras),
      regras: v.regras.trim() || null,
    };
  }

  async function criar(v) {
    const { error } = await supabase.from("ambientes").insert(paraBanco(v));
    if (error) return traduzir(error);
    setCriando(false);
    setMensagem("");
    await aoMudar();
    return null;
  }

  async function salvarEdicao(id, v) {
    const { error } = await supabase.from("ambientes").update(paraBanco(v)).eq("id", id);
    if (error) return traduzir(error);
    setEditandoId(null);
    setMensagem("");
    await aoMudar();
    return null;
  }

  async function remover(a) {
    setMensagem("");
    const { count, error: erroContagem } = await supabase.from("reservas").select("id", { count: "exact", head: true }).eq("ambiente_id", a.id);
    if (erroContagem) {
      setMensagem(erroContagem.message);
      return;
    }
    if (count > 0) {
      setMensagem(`"${a.nome}" tem ${count} reserva(s) cadastrada(s) e não pode ser removido. Cancele as reservas primeiro, na aba Reservas.`);
      return;
    }
    if (!window.confirm(`Remover o ambiente "${a.nome}"?`)) return;
    const { error } = await supabase.from("ambientes").delete().eq("id", a.id);
    if (error) setMensagem(error.message);
    else await aoMudar();
  }

  const inicialDe = (a) => ({
    nome: a.nome,
    tipo: a.tipo,
    capacidade: a.capacidade,
    antecedenciaHoras: a.antecedencia_horas,
    regras: a.regras || "",
  });

  return (
    <div style={{ maxWidth: 720 }}>
      <h3 style={{ fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Dias habilitados para reserva</h3>
      <p style={{ fontSize: 11.5, color: COLORS.inkSoft, marginBottom: 8 }}>Dias desativados não podem ser escolhidos em nenhuma reserva, de nenhum ambiente.</p>
      <div style={{ display: "flex", gap: 6, marginBottom: 28, flexWrap: "wrap" }}>
        {DIAS_SEMANA_LABEL.map((label, i) => {
          const habilitado = diasHabilitados.includes(i);
          return (
            <button
              key={i}
              onClick={() => onAlternarDia(i)}
              title={habilitado ? "Clique para desativar" : "Clique para ativar"}
              style={{
                padding: "8px 12px", fontSize: 12, fontWeight: 600, borderRadius: 4, cursor: "pointer", minWidth: 64,
                background: habilitado ? COLORS.tealSoft : COLORS.dangerSoft,
                color: habilitado ? COLORS.teal : COLORS.danger,
                border: `1px solid ${habilitado ? COLORS.teal : COLORS.danger}`,
              }}
            >
              {label}
              <div style={{ fontSize: 10, fontWeight: 500, marginTop: 2 }}>{habilitado ? "Ativo" : "Desativado"}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, textTransform: "uppercase", letterSpacing: 0.3, margin: 0 }}>Ambientes ({ambientes.length})</h3>
        {!criando && (
          <button onClick={() => { setCriando(true); setEditandoId(null); }} style={{ ...buttonStyle, background: COLORS.teal, padding: "7px 12px", fontSize: 12.5 }}>+ Novo ambiente</button>
        )}
      </div>

      {mensagem && <p style={{ fontSize: 13, color: COLORS.danger, marginBottom: 10 }}>{mensagem}</p>}

      {criando && <FormAmbiente inicial={FORM_AMBIENTE_VAZIO} rotuloSalvar="Adicionar ambiente" onSalvar={criar} onCancelar={() => setCriando(false)} />}

      {Object.entries(TIPO_AMBIENTE_LABEL_PLURAL).map(([tipo, rotulo]) => (
        <div key={tipo} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, marginBottom: 6 }}>{rotulo}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ambientes.filter((a) => a.tipo === tipo).map((a) =>
              editandoId === a.id ? (
                <FormAmbiente key={a.id} inicial={inicialDe(a)} rotuloSalvar="Salvar alterações" onSalvar={(v) => salvarEdicao(a.id, v)} onCancelar={() => setEditandoId(null)} />
              ) : (
                <div key={a.id} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "10px 12px", background: COLORS.panel }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{a.nome}</div>
                      <div style={{ fontSize: 11.5, color: COLORS.inkSoft, marginTop: 2 }}>
                        capacidade {a.capacidade} · antecedência mínima {a.antecedencia_horas}h
                      </div>
                      <div style={{ fontSize: 11.5, color: COLORS.inkSoft, marginTop: 4, whiteSpace: "pre-wrap" }}>
                        {a.regras ? `Regras: ${a.regras}` : "Sem regras de uso cadastradas."}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, whiteSpace: "nowrap" }}>
                      <button onClick={() => { setEditandoId(a.id); setCriando(false); }} style={{ background: "transparent", border: "none", color: COLORS.ink, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Editar</button>
                      <button onClick={() => remover(a)} style={{ background: "transparent", border: "none", color: COLORS.danger, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Remover</button>
                    </div>
                  </div>
                </div>
              ),
            )}
            {ambientes.filter((a) => a.tipo === tipo).length === 0 && <p style={{ fontSize: 12, color: COLORS.inkSoft }}>Nenhum ambiente nesta categoria.</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------ Admin: todas as reservas e histórico
const EVENTO_LABEL = {
  criacao: "Reserva criada",
  solicitacao: "Reserva solicitada (aguardando aprovação)",
  aprovacao: "Reserva aprovada",
  cancelamento: "Reserva cancelada",
  recusa: "Reserva recusada",
};
const EVENTO_COR = { criacao: COLORS.teal, solicitacao: COLORS.professor, aprovacao: COLORS.teal, cancelamento: COLORS.danger, recusa: COLORS.danger };

function PainelReservasAdmin({ ambientes, aoMudar }) {
  const [subAba, setSubAba] = useState("reservas"); // "reservas" | "historico"
  const [filtros, setFiltros] = useState({ periodo: "proximas", ambienteId: "", tipo: "", status: "" });
  const [reservas, setReservas] = useState([]);
  const [nomes, setNomes] = useState({});
  const [historico, setHistorico] = useState([]);
  const [truncado, setTruncado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [carregando, setCarregando] = useState(true);

  async function carregarReservas() {
    setCarregando(true);
    setMensagem("");
    const hoje = hojeISO();
    let q = supabase.from("reservas").select("*");
    if (filtros.periodo === "proximas") q = q.gte("data", hoje).order("data", { ascending: true }).order("hora_inicio", { ascending: true });
    else if (filtros.periodo === "passadas") q = q.lt("data", hoje).order("data", { ascending: false }).order("hora_inicio", { ascending: false });
    else q = q.order("data", { ascending: false }).order("hora_inicio", { ascending: false });
    if (filtros.ambienteId) q = q.eq("ambiente_id", filtros.ambienteId);
    if (filtros.tipo) q = q.eq("tipo", filtros.tipo);
    if (filtros.status) q = q.eq("status", filtros.status);
    const { data, error } = await q.limit(301);
    if (error) {
      setMensagem(error.message);
      setCarregando(false);
      return;
    }
    setTruncado((data || []).length > 300);
    setReservas((data || []).slice(0, 300));
    const { data: perfis } = await supabase.from("profiles").select("id, nome");
    setNomes(Object.fromEntries((perfis || []).map((x) => [x.id, x.nome])));
    setCarregando(false);
  }

  async function carregarHistorico() {
    setCarregando(true);
    setMensagem("");
    const { data, error } = await supabase.from("historico_reservas").select("*").order("created_at", { ascending: false }).limit(150);
    if (error) setMensagem(error.message);
    setHistorico(data || []);
    setCarregando(false);
  }

  useEffect(() => {
    if (subAba === "reservas") carregarReservas();
    else carregarHistorico();
  }, [subAba, filtros]);

  async function cancelar(r) {
    if (!window.confirm("Cancelar esta reserva? O responsável será avisado.")) return;
    const { error } = await supabase.from("reservas").delete().eq("id", r.id);
    if (error) {
      setMensagem(error.message);
      return;
    }
    await carregarReservas();
    aoMudar();
  }

  const nomeAmbiente = (id) => ambientes.find((a) => a.id === id)?.nome || "Ambiente removido";
  const seletor = { ...inputStyle, width: "auto", padding: "7px 8px", fontSize: 12.5 };

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["reservas", "Todas as reservas"], ["historico", "Histórico"]].map(([id, rotulo]) => (
          <button
            key={id}
            onClick={() => setSubAba(id)}
            style={{
              padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 4, cursor: "pointer",
              background: subAba === id ? COLORS.teal : COLORS.panel,
              color: subAba === id ? "#fff" : COLORS.ink,
              border: `1px solid ${subAba === id ? COLORS.teal : COLORS.line}`,
            }}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {mensagem && <p style={{ fontSize: 13, color: COLORS.danger, marginBottom: 12 }}>{mensagem}</p>}

      {subAba === "reservas" ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <select style={seletor} value={filtros.periodo} onChange={(e) => setFiltros({ ...filtros, periodo: e.target.value })}>
              <option value="proximas">Próximas (de hoje em diante)</option>
              <option value="passadas">Já passadas</option>
              <option value="todas">Todas</option>
            </select>
            <select style={seletor} value={filtros.ambienteId} onChange={(e) => setFiltros({ ...filtros, ambienteId: e.target.value })}>
              <option value="">Todos os ambientes</option>
              {ambientes.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
            <select style={seletor} value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}>
              <option value="">Todos os tipos</option>
              {Object.entries(TIPO_LABEL).map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
            </select>
            <select style={seletor} value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
              <option value="">Qualquer situação</option>
              <option value="confirmada">Confirmadas</option>
              <option value="pendente">Pendentes</option>
            </select>
          </div>

          {carregando ? (
            <p style={{ fontSize: 13 }}>Carregando…</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {reservas.map((r) => (
                <div key={r.id} style={{ border: `1px solid ${COLORS.line}`, borderLeft: `3px solid ${TIPO_COLOR[r.tipo]}`, borderRadius: 4, padding: "9px 12px", background: COLORS.panel, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 13 }}>
                    <div>
                      <strong>{dataBR(r.data)}</strong> · {r.hora_inicio.slice(0, 5)}–{r.hora_fim.slice(0, 5)} · {nomeAmbiente(r.ambiente_id)}
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: TIPO_COLOR[r.tipo], background: TIPO_SOFT[r.tipo], padding: "1px 7px", borderRadius: 3, marginLeft: 8 }}>{TIPO_LABEL[r.tipo]}</span>
                      {r.status === "pendente" && (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: COLORS.professor, background: COLORS.professorSoft, padding: "1px 7px", borderRadius: 3, marginLeft: 6 }}>⏳ pendente</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>
                      {r.finalidade}{r.periodo_nome ? ` · ${r.periodo_nome}` : ""}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.inkSoft }}>
                      Responsável: {nomes[r.usuario_id] || "—"}
                      {r.professor_associado_id ? ` (exibida como ${nomes[r.professor_associado_id] || "—"})` : ""}
                      {r.qtd_pessoas ? ` · ${r.qtd_pessoas} pessoa(s)` : ""}
                    </div>
                    {r.material && <div style={{ fontSize: 11.5, color: COLORS.inkSoft, marginTop: 2 }}>🔒 Material: {r.material}</div>}
                  </div>
                  <button onClick={() => cancelar(r)} style={{ background: "transparent", border: "none", color: COLORS.danger, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Cancelar</button>
                </div>
              ))}
              {reservas.length === 0 && <p style={{ fontSize: 12.5, color: COLORS.inkSoft }}>Nenhuma reserva com esses filtros.</p>}
              {truncado && <p style={{ fontSize: 11.5, color: COLORS.inkSoft }}>Mostrando as primeiras 300. Use os filtros para ver as demais.</p>}
            </div>
          )}
        </>
      ) : carregando ? (
        <p style={{ fontSize: 13 }}>Carregando…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <p style={{ fontSize: 11.5, color: COLORS.inkSoft, marginBottom: 6 }}>Últimos 150 eventos. O histórico começou a ser registrado quando este recurso foi ativado.</p>
          {historico.map((h) => (
            <div key={h.id} style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderLeft: `3px solid ${EVENTO_COR[h.evento] || COLORS.line}`, borderRadius: 4, padding: "8px 12px", fontSize: 12 }}>
              <div>
                <strong>{new Date(h.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" })}</strong> · {EVENTO_LABEL[h.evento] || h.evento} · {h.ambiente_nome} · {TIPO_LABEL[h.tipo] || h.tipo}
              </div>
              <div style={{ color: COLORS.inkSoft, marginTop: 2 }}>
                {h.finalidade} — {h.data ? dataBR(h.data) : ""} {h.hora_inicio ? `${h.hora_inicio.slice(0, 5)}–${h.hora_fim.slice(0, 5)}` : ""} — dono: {h.dono_nome || "—"}
                {h.autor_nome && h.autor_nome !== h.dono_nome ? ` · por: ${h.autor_nome}` : ""}
              </div>
            </div>
          ))}
          {historico.length === 0 && <p style={{ fontSize: 12.5, color: COLORS.inkSoft }}>Nenhum evento registrado ainda.</p>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------ Admin: aprovações pendentes
function PainelAprovacoes({ ambientes, aoMudar }) {
  const [pendentes, setPendentes] = useState([]);
  const [confirmadas, setConfirmadas] = useState([]);
  const [nomes, setNomes] = useState({});
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const { data: pend, error } = await supabase.from("reservas").select("*").eq("status", "pendente").order("data").order("hora_inicio");
    if (error) {
      setMensagem(error.message);
      setCarregando(false);
      return;
    }
    setPendentes(pend || []);

    if ((pend || []).length > 0) {
      const ids = [...new Set(pend.map((r) => r.ambiente_id))];
      const datas = pend.map((r) => r.data).sort();
      const { data: conf } = await supabase
        .from("reservas")
        .select("*")
        .eq("status", "confirmada")
        .in("ambiente_id", ids)
        .gte("data", datas[0])
        .lte("data", datas[datas.length - 1]);
      setConfirmadas(conf || []);
    } else {
      setConfirmadas([]);
    }

    const { data: perfis } = await supabase.from("profiles").select("id, nome");
    setNomes(Object.fromEntries((perfis || []).map((p) => [p.id, p.nome])));
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  function noCaminho(p) {
    return confirmadas.filter(
      (c) =>
        c.ambiente_id === p.ambiente_id &&
        c.data === p.data &&
        c.hora_inicio.slice(0, 5) < p.hora_fim.slice(0, 5) &&
        p.hora_inicio.slice(0, 5) < c.hora_fim.slice(0, 5),
    );
  }

  async function decidir(id, acao) {
    setMensagem("");
    setOcupado(id);
    const { error } = await supabase.rpc(acao === "aprovar" ? "aprovar_reserva" : "recusar_reserva", { p_id: id });
    setOcupado(null);
    if (error) setMensagem(error.message);
    await carregar();
    aoMudar();
  }

  if (carregando) return <p style={{ fontSize: 13 }}>Carregando…</p>;

  return (
    <div style={{ maxWidth: 680 }}>
      <h3 style={{ fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Aprovações pendentes</h3>
      <p style={{ fontSize: 11.5, color: COLORS.inkSoft, marginBottom: 14 }}>
        Reservas de maior prioridade que colidiram com reservas de menor prioridade. Aprovar confirma esta reserva e cancela as menores (os donos são avisados); recusar descarta esta solicitação.
      </p>

      {mensagem && <p style={{ fontSize: 13, color: COLORS.danger, marginBottom: 12 }}>{mensagem}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {pendentes.map((p) => {
          const ambiente = ambientes.find((a) => a.id === p.ambiente_id);
          const doCaminho = noCaminho(p);
          const menores = doCaminho.filter((c) => (PRIORIDADE[c.tipo] || 0) < (PRIORIDADE[p.tipo] || 0));
          const bloqueia = doCaminho.some((c) => (PRIORIDADE[c.tipo] || 0) >= (PRIORIDADE[p.tipo] || 0));
          return (
            <div key={p.id} style={{ background: COLORS.professorSoft, border: `1px solid ${COLORS.professor}`, borderRadius: 4, padding: "10px 14px" }}>
              <div style={{ fontSize: 13.5 }}>
                {ambiente?.nome || "Ambiente removido"} — {nomes[p.usuario_id] || "—"} ({TIPO_LABEL[p.tipo]})
              </div>
              <div style={{ fontSize: 12, color: COLORS.inkSoft, marginBottom: 6 }}>
                {p.finalidade}{p.periodo_nome ? ` · ${p.periodo_nome}` : ""} · {dataBR(p.data)}, {p.hora_inicio.slice(0, 5)}–{p.hora_fim.slice(0, 5)}
              </div>
              <div style={{ fontSize: 12, marginBottom: 8, color: bloqueia ? COLORS.danger : COLORS.ink }}>
                {bloqueia
                  ? "Já existe uma reserva de prioridade igual ou maior confirmada neste horário — só é possível recusar."
                  : menores.length > 0
                    ? `Se aprovada, cancela: ${menores.map((c) => `${TIPO_LABEL[c.tipo]} de ${nomes[c.usuario_id] || "—"} (${c.hora_inicio.slice(0, 5)}–${c.hora_fim.slice(0, 5)})`).join(", ")}`
                    : "O horário já foi liberado — aprovar apenas confirma esta reserva."}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  disabled={ocupado === p.id || bloqueia}
                  onClick={() => decidir(p.id, "aprovar")}
                  style={{ ...buttonStyle, background: bloqueia ? COLORS.line : COLORS.teal, padding: "7px 14px", fontSize: 12.5, cursor: bloqueia ? "not-allowed" : "pointer" }}
                >
                  Aprovar
                </button>
                <button
                  disabled={ocupado === p.id}
                  onClick={() => decidir(p.id, "recusar")}
                  style={{ background: "transparent", border: `1px solid ${COLORS.danger}`, color: COLORS.danger, borderRadius: 4, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                >
                  Recusar
                </button>
              </div>
            </div>
          );
        })}
        {pendentes.length === 0 && <p style={{ fontSize: 12.5, color: COLORS.inkSoft }}>Nenhuma aprovação pendente no momento.</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------ Admin: períodos e disciplinas
function PainelPeriodos() {
  const [periodos, setPeriodos] = useState([]);
  const [disciplinas, setDisciplinas] = useState([]);
  const [mensagem, setMensagem] = useState("");
  const [novoPeriodo, setNovoPeriodo] = useState("");
  const [editandoPeriodoId, setEditandoPeriodoId] = useState(null);
  const [nomeEdicao, setNomeEdicao] = useState("");
  const [novaDisciplinaEm, setNovaDisciplinaEm] = useState(null); // id do período
  const [nomeNovaDisciplina, setNomeNovaDisciplina] = useState("");
  const [editandoDisciplinaId, setEditandoDisciplinaId] = useState(null);
  const [nomeDisciplinaEdicao, setNomeDisciplinaEdicao] = useState("");

  async function carregar() {
    const [{ data: p, error: ep }, { data: d, error: ed }] = await Promise.all([
      supabase.from("periodos").select("*").order("nome"),
      supabase.from("disciplinas").select("*").order("nome"),
    ]);
    if (ep) setMensagem(ep.message);
    else if (ed) setMensagem(ed.message);
    setPeriodos(p || []);
    setDisciplinas(d || []);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function criarPeriodo(e) {
    e.preventDefault();
    if (!novoPeriodo.trim()) return;
    const { error } = await supabase.from("periodos").insert({ nome: novoPeriodo.trim() });
    if (error) setMensagem(error.message);
    else {
      setNovoPeriodo("");
      carregar();
    }
  }

  async function salvarEdicaoPeriodo(id) {
    if (!nomeEdicao.trim()) return;
    const { error } = await supabase.from("periodos").update({ nome: nomeEdicao.trim() }).eq("id", id);
    if (error) setMensagem(error.message);
    else {
      setEditandoPeriodoId(null);
      carregar();
    }
  }

  async function removerPeriodo(id) {
    const { error } = await supabase.from("periodos").delete().eq("id", id);
    if (error) setMensagem(error.message);
    else carregar();
  }

  async function criarDisciplina(periodoId) {
    if (!nomeNovaDisciplina.trim()) return;
    const { error } = await supabase.from("disciplinas").insert({ nome: nomeNovaDisciplina.trim(), periodo_id: periodoId });
    if (error) setMensagem(error.message);
    else {
      setNomeNovaDisciplina("");
      setNovaDisciplinaEm(null);
      carregar();
    }
  }

  async function salvarEdicaoDisciplina(id) {
    if (!nomeDisciplinaEdicao.trim()) return;
    const { error } = await supabase.from("disciplinas").update({ nome: nomeDisciplinaEdicao.trim() }).eq("id", id);
    if (error) setMensagem(error.message);
    else {
      setEditandoDisciplinaId(null);
      carregar();
    }
  }

  async function removerDisciplina(id) {
    const { error } = await supabase.from("disciplinas").delete().eq("id", id);
    if (error) setMensagem(error.message);
    else carregar();
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Períodos e disciplinas</h3>
      <p style={{ fontSize: 11.5, color: COLORS.inkSoft, marginBottom: 14 }}>Usados na reserva de professor, para vincular a reserva a uma turma e disciplina.</p>

      {mensagem && <p style={{ fontSize: 13, color: COLORS.danger, marginBottom: 12 }}>{mensagem}</p>}

      <form onSubmit={criarPeriodo} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input style={inputStyle} placeholder="Ex.: 7º período" value={novoPeriodo} onChange={(e) => setNovoPeriodo(e.target.value)} />
        <button type="submit" style={{ ...buttonStyle, background: COLORS.teal, whiteSpace: "nowrap" }}>+ Novo período</button>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {periodos.map((p) => (
          <div key={p.id} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "10px 12px" }}>
            {editandoPeriodoId === p.id ? (
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input style={inputStyle} value={nomeEdicao} onChange={(e) => setNomeEdicao(e.target.value)} />
                <button onClick={() => salvarEdicaoPeriodo(p.id)} style={{ ...buttonStyle, background: COLORS.teal, padding: "6px 10px", fontSize: 12 }}>Salvar</button>
                <button onClick={() => setEditandoPeriodoId(null)} style={{ background: "transparent", border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>Cancelar</button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.nome}</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => { setEditandoPeriodoId(p.id); setNomeEdicao(p.nome); }} style={{ background: "transparent", border: "none", color: COLORS.ink, fontSize: 12, cursor: "pointer" }}>Editar</button>
                  <button onClick={() => removerPeriodo(p.id)} style={{ background: "transparent", border: "none", color: COLORS.danger, fontSize: 12, cursor: "pointer" }}>Remover</button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingLeft: 4 }}>
              {disciplinas.filter((d) => d.periodo_id === p.id).map((d) =>
                editandoDisciplinaId === d.id ? (
                  <div key={d.id} style={{ display: "flex", gap: 6 }}>
                    <input style={{ ...inputStyle, fontSize: 12.5 }} value={nomeDisciplinaEdicao} onChange={(e) => setNomeDisciplinaEdicao(e.target.value)} />
                    <button onClick={() => salvarEdicaoDisciplina(d.id)} style={{ ...buttonStyle, background: COLORS.teal, padding: "5px 10px", fontSize: 11.5 }}>Salvar</button>
                    <button onClick={() => setEditandoDisciplinaId(null)} style={{ background: "transparent", border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}>Cancelar</button>
                  </div>
                ) : (
                  <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: COLORS.bg, padding: "6px 10px", fontSize: 12.5, borderRadius: 4 }}>
                    <span>{d.nome}</span>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => { setEditandoDisciplinaId(d.id); setNomeDisciplinaEdicao(d.nome); }} style={{ background: "transparent", border: "none", color: COLORS.ink, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Editar</button>
                      <button onClick={() => removerDisciplina(d.id)} style={{ background: "transparent", border: "none", color: COLORS.danger, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Remover</button>
                    </div>
                  </div>
                ),
              )}

              {novaDisciplinaEm === p.id ? (
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <input style={{ ...inputStyle, fontSize: 12.5 }} placeholder="Ex.: Imunologia" value={nomeNovaDisciplina} onChange={(e) => setNomeNovaDisciplina(e.target.value)} />
                  <button onClick={() => criarDisciplina(p.id)} style={{ ...buttonStyle, background: COLORS.teal, padding: "5px 10px", fontSize: 11.5 }}>Salvar</button>
                  <button onClick={() => setNovaDisciplinaEm(null)} style={{ background: "transparent", border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}>Cancelar</button>
                </div>
              ) : (
                <button onClick={() => { setNovaDisciplinaEm(p.id); setNomeNovaDisciplina(""); }} style={{ alignSelf: "flex-start", background: "transparent", border: `1px dashed ${COLORS.line}`, color: COLORS.inkSoft, fontSize: 11.5, padding: "5px 10px", marginTop: 4, borderRadius: 4, cursor: "pointer" }}>
                  + Adicionar disciplina
                </button>
              )}
            </div>
          </div>
        ))}
        {periodos.length === 0 && <p style={{ fontSize: 12.5, color: COLORS.inkSoft }}>Nenhum período cadastrado.</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------ Modal: nova reserva
function ModalNovaReserva({ ambiente, cargo, diasHabilitados, valores, onMudar, onFechar, onConfirmar, mensagem }) {
  const tiposPermitidos = cargo === "monitor" ? ["monitoria", "grupo_estudos"] : ["grupo_estudos"];
  return (
    <Modal onFechar={onFechar}>
      <div style={{ ...fonteTitulo, fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Nova reserva</div>
      <div style={{ fontSize: 12, color: COLORS.inkSoft, marginBottom: 18 }}>
        {ambiente?.nome} — {TIPO_AMBIENTE_LABEL[ambiente?.tipo]} · capacidade {ambiente?.capacidade} · antecedência mínima {ambiente?.antecedencia_horas}h
      </div>

      <form onSubmit={onConfirmar}>
        <Campo label="Tipo">
          <select style={inputStyle} value={valores.tipo} onChange={(e) => onMudar({ ...valores, tipo: e.target.value })}>
            {tiposPermitidos.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
          </select>
        </Campo>
        <Campo label="Finalidade">
          <input style={inputStyle} value={valores.finalidade} maxLength={200} onChange={(e) => onMudar({ ...valores, finalidade: e.target.value })} required />
        </Campo>
        <Campo label={valores.tipo === "monitoria" ? "Data inicial" : "Data"}>
          <input type="date" style={inputStyle} value={valores.data} onChange={(e) => onMudar({ ...valores, data: e.target.value })} required />
        </Campo>

        {valores.tipo === "monitoria" && (
          <>
            <Campo label="Repetir até (opcional)" hint="Deixe em branco para uma reserva única; preencha para repetir toda semana nos dias marcados.">
              <input type="date" min={valores.data} style={inputStyle} value={valores.dataFimRecorrencia} onChange={(e) => onMudar({ ...valores, dataFimRecorrencia: e.target.value })} />
            </Campo>
            {valores.dataFimRecorrencia && valores.dataFimRecorrencia > valores.data && (
              <Campo label="Dias da semana considerados">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {DIAS_SEMANA_LABEL.map((label, i) => {
                    const habilitado = diasHabilitados.includes(i);
                    const marcado = valores.diasSemana.includes(i);
                    return (
                      <button
                        type="button"
                        key={i}
                        disabled={!habilitado}
                        title={habilitado ? undefined : "Dia desativado pela administração"}
                        onClick={() => onMudar({ ...valores, diasSemana: marcado ? valores.diasSemana.filter((d) => d !== i) : [...valores.diasSemana, i].sort() })}
                        style={{
                          padding: "6px 10px", fontSize: 12, borderRadius: 4,
                          cursor: habilitado ? "pointer" : "not-allowed",
                          opacity: habilitado ? 1 : 0.35,
                          textDecoration: habilitado ? "none" : "line-through",
                          border: `1px solid ${marcado ? COLORS.monitor : COLORS.line}`,
                          background: marcado ? COLORS.monitorSoft : "#fff",
                          color: marcado ? COLORS.monitor : COLORS.inkSoft,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </Campo>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Campo label="Início">
              <input type="time" style={inputStyle} value={valores.horaInicio} onChange={(e) => onMudar({ ...valores, horaInicio: e.target.value })} required />
            </Campo>
          </div>
          <div style={{ flex: 1 }}>
            <Campo label="Fim">
              <input type="time" style={inputStyle} value={valores.horaFim} onChange={(e) => onMudar({ ...valores, horaFim: e.target.value })} required />
            </Campo>
          </div>
        </div>
        <Campo
          label="Quantidade de pessoas"
          hint={valores.tipo === "grupo_estudos" ? (ambiente?.tipo === "laboratorio" ? "Mínimo de 3 participantes para laboratório." : "Sem mínimo para sala de tutoria.") : undefined}
        >
          <input type="number" min={1} style={inputStyle} value={valores.qtdPessoas} onChange={(e) => onMudar({ ...valores, qtdPessoas: e.target.value })} />
        </Campo>

        {valores.tipo === "professor" && (
          <Campo label="Material necessário" hint="Visível apenas para você e para a administração.">
            <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} value={valores.material} maxLength={2000} onChange={(e) => onMudar({ ...valores, material: e.target.value })} placeholder="Ex.: manequim de simulação, kit de suturas, projetor…" />
          </Campo>
        )}

        {mensagem && (
          <div style={{ display: "flex", gap: 8, background: COLORS.dangerSoft, border: `1px solid ${COLORS.danger}`, color: COLORS.danger, fontSize: 12.5, padding: "10px 12px", marginBottom: 12, borderRadius: 4 }}>
            <span>⚠️</span>
            <span>{mensagem}</span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onFechar} style={{ background: "transparent", border: `1px solid ${COLORS.line}`, padding: "9px 16px", fontSize: 13.5, borderRadius: 4, cursor: "pointer" }}>
            Cancelar
          </button>
          <button type="submit" style={{ ...buttonStyle, background: COLORS.teal }}>
            Confirmar reserva
          </button>
        </div>
      </form>
    </Modal>
  );
}

const DIAS_SEMANA_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ------------------------------------------------ Modal: reserva do professor (múltiplas salas + recorrência)
function ModalReservaProfessor({ session, perfil, ambientes, professores, dataInicial, diasHabilitados, onFechar, onConcluido }) {
  const [tipo, setTipo] = useState("professor");
  const [finalidade, setFinalidade] = useState("");
  const [material, setMaterial] = useState("");
  const [qtdPessoas, setQtdPessoas] = useState(1);
  const [salasSel, setSalasSel] = useState([]); // { ambienteId, professorAssociadoId }
  const [dataInicio, setDataInicio] = useState(dataInicial);
  const [dataFim, setDataFim] = useState(dataInicial);
  const [diasSemana, setDiasSemana] = useState(diasHabilitados.includes(diaSemanaDe(dataInicial)) ? [diaSemanaDe(dataInicial)] : []);
  const [horaInicio, setHoraInicio] = useState("08:00");
  const [horaFim, setHoraFim] = useState("09:00");
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null); // { sucesso, totalReservas, bloqueadas: [{nome, motivo}] }
  const [periodos, setPeriodos] = useState([]);
  const [disciplinas, setDisciplinas] = useState([]);
  const [periodoId, setPeriodoId] = useState("");
  const [disciplinaId, setDisciplinaId] = useState("");

  const ehAdmin = perfil?.cargo === "admin";
  const disciplinasDoPeriodo = disciplinas.filter((d) => d.periodo_id === periodoId);

  useEffect(() => {
    Promise.all([supabase.from("periodos").select("*").order("nome"), supabase.from("disciplinas").select("*").order("nome")]).then(
      ([{ data: p }, { data: d }]) => {
        setPeriodos(p || []);
        setDisciplinas(d || []);
      },
    );
  }, []);

  function alternarSala(id) {
    setSalasSel((prev) => (prev.some((s) => s.ambienteId === id) ? prev.filter((s) => s.ambienteId !== id) : [...prev, { ambienteId: id, professorAssociadoId: "" }]));
  }
  function setAssociado(id, profId) {
    setSalasSel((prev) => prev.map((s) => (s.ambienteId === id ? { ...s, professorAssociadoId: profId } : s)));
  }
  function alternarDia(d) {
    setDiasSemana((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  async function confirmar(e) {
    e.preventDefault();
    setMensagem("");

    if (salasSel.length === 0) {
      setMensagem("Selecione ao menos uma sala.");
      return;
    }
    if (tipo === "professor" && (!periodoId || !disciplinaId)) {
      setMensagem("Selecione o período da turma e a disciplina.");
      return;
    }
    if (dataFim < dataInicio) {
      setMensagem("A data final não pode ser antes da data inicial.");
      return;
    }
    if (horaFim <= horaInicio) {
      setMensagem("O horário final precisa ser depois do inicial.");
      return;
    }
    const dias = diasSemana.length > 0 ? diasSemana : [diaSemanaDe(dataInicio)];
    const ocorrencias = gerarOcorrencias(dataInicio, dataFim, dias);
    const erroGrande = erroSerieGrande(ocorrencias.length);
    if (erroGrande) {
      setMensagem(erroGrande);
      return;
    }
    if (ocorrencias.length === 0) {
      setMensagem("Nenhuma data válida nesse intervalo com os dias da semana selecionados.");
      return;
    }

    setEnviando(true);

    const idsAmbientes = salasSel.map((s) => s.ambienteId);
    const { data: existentes, error: erroBusca } = await supabase
      .from("reservas_visiveis")
      .select("ambiente_id, data, hora_inicio, hora_fim, finalidade, tipo, status")
      .in("ambiente_id", idsAmbientes)
      .gte("data", dataInicio)
      .lte("data", dataFim);

    if (erroBusca) {
      setMensagem(erroBusca.message);
      setEnviando(false);
      return;
    }

    let totalSucesso = 0;
    let totalPendentes = 0;
    const bloqueadas = [];

    for (const sala of salasSel) {
      const ambiente = ambientes.find((a) => a.id === sala.ambienteId);

      const limite = validarLimites({
        cargo: perfil?.cargo,
        tipo: ambiente.tipo,
        antecedenciaHoras: Number(ambiente.antecedencia_horas) || 0,
        data: ocorrencias[0],
        horaInicio,
        horaFim,
      });
      if (limite.erro) {
        bloqueadas.push({ nome: ambiente.nome, motivo: limite.erro });
        continue;
      }

      const existentesDaSala = existentes.filter((r) => r.ambiente_id === sala.ambienteId);
      const conflito = acharPrimeiroConflito(existentesDaSala, ocorrencias, horaInicio, horaFim, tipo);
      if (conflito) {
        bloqueadas.push({
          nome: ambiente.nome,
          motivo: `já ocupado em ${dataBR(conflito.data)} das ${conflito.reserva.hora_inicio.slice(0, 5)} às ${conflito.reserva.hora_fim.slice(0, 5)} (${conflito.reserva.finalidade})`,
        });
        continue;
      }

      const disciplinaEscolhida = tipo === "professor" ? disciplinas.find((d) => d.id === disciplinaId) : null;
      const periodoEscolhido = tipo === "professor" ? periodos.find((p) => p.id === periodoId) : null;
      const finalidadeFinal = tipo === "professor" ? disciplinaEscolhida?.nome || finalidade : finalidade;

      const linhas = ocorrencias.map((data) => ({
        ambiente_id: sala.ambienteId,
        usuario_id: session.user.id,
        professor_associado_id: salasSel.length > 1 ? sala.professorAssociadoId || null : null,
        tipo,
        finalidade: finalidadeFinal,
        periodo_nome: periodoEscolhido?.nome || null,
        data,
        hora_inicio: horaInicio,
        hora_fim: horaFim,
        qtd_pessoas: qtdPessoas || null,
        material: tipo === "professor" ? material || null : null,
      }));

      const { data: inseridas, error: erroInsercao } = await supabase.from("reservas").insert(linhas).select("status");
      if (erroInsercao) {
        const motivo =
          erroInsercao.code === "23P01"
            ? "alguém reservou um desses horários enquanto você preenchia o formulário"
            : traduzirErroBanco(erroInsercao);
        bloqueadas.push({ nome: ambiente.nome, motivo });
      } else {
        totalSucesso += linhas.length;
        totalPendentes += (inseridas || []).filter((x) => x.status === "pendente").length;
      }
    }

    setEnviando(false);
    setResultado({ totalSucesso, totalPendentes, salasOk: salasSel.length - bloqueadas.length, bloqueadas });
  }

  if (resultado) {
    return (
      <Modal largura={520} onFechar={() => onConcluido()}>
        <div style={{ ...fonteTitulo, fontSize: 18, fontWeight: 600, marginBottom: 14 }}>Resultado do lançamento</div>
        {resultado.totalSucesso > 0 && (
          <div style={{ fontSize: 13.5, color: COLORS.teal, marginBottom: 12 }}>
            {resultado.salasOk} sala(s) lançada(s), totalizando {resultado.totalSucesso} reserva(s)
            {resultado.totalPendentes > 0 ? `: ${resultado.totalSucesso - resultado.totalPendentes} confirmada(s) e ${resultado.totalPendentes} aguardando aprovação.` : ", todas confirmadas."}
          </div>
        )}
        {resultado.totalPendentes > 0 && (
          <div style={{ fontSize: 12.5, background: COLORS.professorSoft, color: COLORS.professor, padding: "8px 10px", borderRadius: 4, marginBottom: 12 }}>
            ⏳ As reservas pendentes colidem com reservas de menor prioridade (aluno/monitor). Só passam a valer quando a administração aprovar — e, ao aprovar, as reservas menores são canceladas e seus donos avisados.
          </div>
        )}
        {resultado.bloqueadas.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.danger, marginBottom: 6 }}>
              Não foi possível reservar em {resultado.bloqueadas.length} sala(s):
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {resultado.bloqueadas.map((b, i) => (
                <div key={i} style={{ fontSize: 12.5, background: COLORS.dangerSoft, color: COLORS.danger, padding: "8px 10px", borderRadius: 4 }}>
                  <strong>{b.nome}</strong> — {b.motivo}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button onClick={() => onConcluido()} style={{ ...buttonStyle, background: COLORS.teal }}>Fechar</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal largura={620} onFechar={onFechar}>
      <div style={{ ...fonteTitulo, fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Nova reserva</div>
      <div style={{ fontSize: 12, color: COLORS.inkSoft, marginBottom: 18 }}>
        Selecione uma ou mais salas. Se a data final for depois da inicial, a reserva se repete nos dias da semana marcados.
      </div>

      <form onSubmit={confirmar}>
        <div style={{ display: "flex", gap: 12 }}>
          <Campo label="Tipo" style={{ flex: 1 }}>
            <select style={inputStyle} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="professor">Professor</option>
              <option value="monitoria">Monitoria</option>
              <option value="grupo_estudos">Grupo de estudos</option>
            </select>
          </Campo>
          <Campo label="Quantidade de pessoas" style={{ flex: 1 }}>
            <input type="number" min={1} style={inputStyle} value={qtdPessoas} onChange={(e) => setQtdPessoas(e.target.value)} />
          </Campo>
        </div>

        {tipo === "professor" ? (
          <div style={{ display: "flex", gap: 12 }}>
            <Campo label="Período da turma" style={{ flex: 1 }}>
              <select style={inputStyle} value={periodoId} onChange={(e) => { setPeriodoId(e.target.value); setDisciplinaId(""); }} required>
                <option value="">Selecione</option>
                {periodos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Disciplina" style={{ flex: 1 }}>
              <select style={inputStyle} value={disciplinaId} onChange={(e) => setDisciplinaId(e.target.value)} disabled={!periodoId} required>
                <option value="">{periodoId ? "Selecione" : "Escolha um período"}</option>
                {disciplinasDoPeriodo.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
              </select>
            </Campo>
          </div>
        ) : (
          <Campo label="Finalidade">
            <input style={inputStyle} value={finalidade} maxLength={200} onChange={(e) => setFinalidade(e.target.value)} required />
          </Campo>
        )}

        <Campo label="Salas (uma ou mais)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ambientes.map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => alternarSala(a.id)}
                style={{
                  padding: "6px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer",
                  border: `1px solid ${salasSel.some((s) => s.ambienteId === a.id) ? COLORS.teal : COLORS.line}`,
                  background: salasSel.some((s) => s.ambienteId === a.id) ? COLORS.tealSoft : "#fff",
                  color: salasSel.some((s) => s.ambienteId === a.id) ? COLORS.teal : COLORS.inkSoft,
                }}
              >
                {a.nome}
              </button>
            ))}
          </div>
        </Campo>

        {salasSel.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            {salasSel.map((s) => {
              const ambiente = ambientes.find((a) => a.id === s.ambienteId);
              return (
                <div key={s.ambienteId} style={{ display: "flex", alignItems: "center", gap: 8, background: COLORS.bg, padding: "8px 10px", fontSize: 12.5, borderRadius: 4, flexWrap: "wrap" }}>
                  <span style={{ minWidth: 150 }}>{ambiente?.nome}</span>
                  {salasSel.length > 1 && (
                    <>
                      <span style={{ color: COLORS.inkSoft, whiteSpace: "nowrap" }}>mostrar como responsável:</span>
                      <select value={s.professorAssociadoId} onChange={(e) => setAssociado(s.ambienteId, e.target.value)} style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 12.5 }}>
                        <option value="">Você</option>
                        {professores.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </select>
                    </>
                  )}
                </div>
              );
            })}
            {salasSel.length > 1 && (
              <div style={{ fontSize: 11, color: COLORS.inkSoft }}>
                Isso só muda o nome exibido para quem vê a reserva — ela continua sendo sua (só você pode cancelá-la).
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <Campo label="Data inicial" style={{ flex: 1 }}>
            <input type="date" style={inputStyle} value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); if (dataFim < e.target.value) setDataFim(e.target.value); }} required />
          </Campo>
          <Campo label="Data final" style={{ flex: 1 }}>
            <input type="date" style={inputStyle} value={dataFim} onChange={(e) => setDataFim(e.target.value)} required />
          </Campo>
        </div>

        <Campo label="Dias da semana considerados">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DIAS_SEMANA_LABEL.map((label, i) => {
              const habilitado = diasHabilitados.includes(i);
              return (
                <button
                  type="button"
                  key={i}
                  disabled={!habilitado}
                  title={habilitado ? undefined : "Dia desativado pela administração"}
                  onClick={() => alternarDia(i)}
                  style={{
                    padding: "6px 10px", fontSize: 12, borderRadius: 4,
                    cursor: habilitado ? "pointer" : "not-allowed",
                    opacity: habilitado ? 1 : 0.35,
                    textDecoration: habilitado ? "none" : "line-through",
                    border: `1px solid ${diasSemana.includes(i) ? COLORS.professor : COLORS.line}`,
                    background: diasSemana.includes(i) ? COLORS.professorSoft : "#fff",
                    color: diasSemana.includes(i) ? COLORS.professor : COLORS.inkSoft,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Campo>

        <div style={{ display: "flex", gap: 12 }}>
          <Campo label="Início" style={{ flex: 1 }}>
            <input type="time" style={inputStyle} value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} required />
          </Campo>
          <Campo label="Fim" style={{ flex: 1 }}>
            <input type="time" style={inputStyle} value={horaFim} onChange={(e) => setHoraFim(e.target.value)} required />
          </Campo>
        </div>

        {tipo === "professor" && (
          <Campo label="Material necessário" hint="Visível apenas para você e para a administração.">
            <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} value={material} maxLength={2000} onChange={(e) => setMaterial(e.target.value)} placeholder="Ex.: manequim de simulação, kit de suturas, projetor…" />
          </Campo>
        )}

        {mensagem && (
          <div style={{ display: "flex", gap: 8, background: COLORS.dangerSoft, border: `1px solid ${COLORS.danger}`, color: COLORS.danger, fontSize: 12.5, padding: "10px 12px", marginBottom: 12, borderRadius: 4 }}>
            <span>⚠️</span>
            <span>{mensagem}</span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onFechar} style={{ background: "transparent", border: `1px solid ${COLORS.line}`, padding: "9px 16px", fontSize: 13.5, borderRadius: 4, cursor: "pointer" }}>
            Cancelar
          </button>
          <button type="submit" disabled={enviando} style={{ ...buttonStyle, background: COLORS.teal }}>
            {enviando ? "Lançando…" : "Confirmar reserva"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------ Modal: detalhe da reserva
function ModalDetalheReserva({ reserva, ambiente, podeCancelar, onFechar, onCancelar }) {
  return (
    <Modal onFechar={onFechar}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div style={{ ...fonteTitulo, fontSize: 17, fontWeight: 600 }}>{TIPO_LABEL[reserva.tipo]}</div>
        <span style={{ fontSize: 11, padding: "3px 8px", background: TIPO_SOFT[reserva.tipo], color: TIPO_COLOR[reserva.tipo], fontWeight: 600, borderRadius: 3 }}>{ambiente?.nome}</span>
      </div>
      <div style={{ fontSize: 13.5, color: COLORS.ink, marginBottom: 14 }}>{reserva.finalidade}{reserva.periodo_nome ? ` · ${reserva.periodo_nome}` : ""}</div>

      {reserva.status === "pendente" && (
        <div style={{ background: COLORS.professorSoft, color: COLORS.professor, fontSize: 12, padding: "8px 10px", marginBottom: 14, borderRadius: 4 }}>
          ⏳ Aguardando aprovação da administração. Esta reserva colide com outra de menor prioridade e só passa a valer se for aprovada.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, marginBottom: 14 }}>
        {reserva.tipo === "grupo_estudos" && !reserva.responsavel_nome ? (
          <div style={{ color: COLORS.inkSoft, fontStyle: "italic" }}>O responsável por este grupo de estudos é visível apenas para a administração.</div>
        ) : (
          <div><span style={{ color: COLORS.inkSoft }}>Responsável: </span>{reserva.responsavel_nome || "—"}</div>
        )}
        {!!reserva.qtd_pessoas && <div><span style={{ color: COLORS.inkSoft }}>Participantes: </span>{reserva.qtd_pessoas}</div>}
        <div><span style={{ color: COLORS.inkSoft }}>Data: </span>{dataBR(reserva.data)}</div>
        <div><span style={{ color: COLORS.inkSoft }}>Horário: </span>{reserva.hora_inicio.slice(0, 5)}–{reserva.hora_fim.slice(0, 5)}</div>
      </div>

      {reserva.tipo === "professor" && (
        <div style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink, marginBottom: 6 }}>Material necessário</div>
          {reserva.material !== null && reserva.material !== undefined ? (
            reserva.material ? (
              <div style={{ fontSize: 13, color: COLORS.ink, background: COLORS.bg, padding: "10px 12px", borderRadius: 4, whiteSpace: "pre-wrap" }}>{reserva.material}</div>
            ) : (
              <div style={{ fontSize: 12.5, color: COLORS.inkSoft }}>Nenhum material informado.</div>
            )
          ) : (
            <div style={{ fontSize: 12.5, color: COLORS.inkSoft }}>🔒 Visível apenas para o responsável pela reserva e para a administração.</div>
          )}
        </div>
      )}

      {ambiente?.regras && (
        <div style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink, marginBottom: 6 }}>Regras de uso — {ambiente.nome}</div>
          <div style={{ fontSize: 12.5, color: COLORS.inkSoft, background: COLORS.bg, padding: "10px 12px", borderRadius: 4, whiteSpace: "pre-wrap" }}>{ambiente.regras}</div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        {podeCancelar && (
          <button onClick={() => onCancelar(reserva.id)} style={{ background: "transparent", border: `1px solid ${COLORS.danger}`, color: COLORS.danger, padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 4, cursor: "pointer" }}>
            Cancelar reserva
          </button>
        )}
        <button onClick={onFechar} style={{ ...buttonStyle, background: COLORS.teal }}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------ Grade de horários (agenda de um dia)
function GradeAgenda({ reservasDoDia, onAbrirDetalhe }) {
  const horaBase = 7;
  const horaTopo = 21;
  const altura = 720;
  const totalMin = (horaTopo - horaBase) * 60;

  const sobrepoe = (a, b) => a.hora_inicio.slice(0, 5) < b.hora_fim.slice(0, 5) && b.hora_inicio.slice(0, 5) < a.hora_fim.slice(0, 5);

  return (
    <div style={{ display: "flex", border: `1px solid ${COLORS.line}`, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: 46, borderRight: `1px solid ${COLORS.line}`, position: "relative", height: altura, flexShrink: 0 }}>
        {Array.from({ length: horaTopo - horaBase + 1 }, (_, i) => horaBase + i).map((h) => (
          <div key={h} style={{ position: "absolute", top: ((h - horaBase) * 60 / totalMin) * altura - 6, right: 6, fontSize: 10.5, color: COLORS.inkSoft }}>
            {String(h).padStart(2, "0")}h
          </div>
        ))}
      </div>
      <div style={{ position: "relative", flex: 1, height: altura, background: `repeating-linear-gradient(180deg, transparent, transparent calc(${altura / (horaTopo - horaBase)}px - 1px), ${COLORS.line} calc(${altura / (horaTopo - horaBase)}px - 1px), ${COLORS.line} calc(${altura / (horaTopo - horaBase)}px))` }}>
        {reservasDoDia.map((r) => {
          const ini = r.hora_inicio.slice(0, 5);
          const fim = r.hora_fim.slice(0, 5);
          const top = ((toMinutosHHMM(ini) - horaBase * 60) / totalMin) * altura;
          const height = ((toMinutosHHMM(fim) - toMinutosHHMM(ini)) / totalMin) * altura;
          const pendente = r.status === "pendente";
          // Quando uma reserva pendente disputa o horário de outra, as duas ficam lado a lado
          const disputando = reservasDoDia.some((o) => o.id !== r.id && (o.status === "pendente") !== pendente && sobrepoe(o, r));
          const esquerda = disputando && pendente ? "50%" : 8;
          const direita = disputando && !pendente ? "52%" : 8;
          return (
            <button
              key={r.id}
              onClick={() => onAbrirDetalhe(r)}
              title={pendente ? "Aguardando aprovação da administração" : "Clique para ver os detalhes"}
              style={{
                position: "absolute", top, height: Math.max(height, 40), left: esquerda, right: direita,
                background: TIPO_SOFT[r.tipo],
                padding: "4px 10px", fontSize: 12, overflow: "hidden", textAlign: "left",
                border: pendente ? `1px dashed ${TIPO_COLOR[r.tipo]}` : "none",
                borderLeftWidth: 3, borderLeftStyle: "solid", borderLeftColor: TIPO_COLOR[r.tipo],
                opacity: pendente ? 0.8 : 1,
                cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "center", gap: 1, borderRadius: 2,
              }}
            >
              <div style={{ fontWeight: 600, color: TIPO_COLOR[r.tipo], whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", fontSize: 11 }}>
                {ini}–{fim} · {TIPO_LABEL[r.tipo]}{pendente ? " · ⏳ pendente" : ""}
              </div>
              <div style={{ color: COLORS.inkSoft, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                {r.finalidade}{r.responsavel_nome ? ` — ${r.responsavel_nome}` : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------ Tela principal
function TelaPrincipal({ session, perfil }) {
  const [aba, setAba] = useState("agenda"); // "agenda" | "reservas" | "aprovacoes" | "ambientes" | "periodos" | "usuarios"
  const [notificacoes, setNotificacoes] = useState([]);
  const [totalPendentes, setTotalPendentes] = useState(0);
  const [categoria, setCategoria] = useState("laboratorio");
  const [diasHabilitados, setDiasHabilitados] = useState([1, 2, 3, 4, 5]);
  const [ambientes, setAmbientes] = useState([]);
  const [ambienteSelecionado, setAmbienteSelecionado] = useState(null);
  const [dataSelecionada, setDataSelecionada] = useState(hojeISO());
  const [reservas, setReservas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState("");
  const [aviso, setAviso] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [modalProfessorAberto, setModalProfessorAberto] = useState(false);
  const [detalhe, setDetalhe] = useState(null);
  const [professores, setProfessores] = useState([]);

  const [novaReserva, setNovaReserva] = useState({ tipo: "grupo_estudos", finalidade: "", data: hojeISO(), horaInicio: "", horaFim: "", qtdPessoas: 1, material: "", dataFimRecorrencia: "", diasSemana: [] });

  async function carregarAmbientes() {
    const { data, error } = await supabase.from("ambientes").select("*").order("nome");
    if (error) {
      setMensagem(error.message);
      return;
    }
    setAmbientes(data);
    if (!ambienteSelecionado || !data.some((a) => a.id === ambienteSelecionado)) {
      const primeiro = data.find((a) => a.tipo === categoria) || data[0];
      setAmbienteSelecionado(primeiro ? primeiro.id : null);
    }
  }

  async function carregarNotificacoes() {
    const { data } = await supabase.from("notificacoes").select("*").eq("lida", false).order("created_at", { ascending: false });
    setNotificacoes(data || []);
  }

  async function dispensarNotificacao(id) {
    setNotificacoes((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notificacoes").update({ lida: true }).eq("id", id);
  }

  async function carregarTotalPendentes() {
    const { count } = await supabase.from("reservas").select("id", { count: "exact", head: true }).eq("status", "pendente");
    setTotalPendentes(count || 0);
  }

  async function carregarConfig() {
    const { data, error } = await supabase.from("config_sistema").select("dias_habilitados").eq("id", 1).single();
    if (!error && data) setDiasHabilitados(data.dias_habilitados);
  }

  async function alternarDiaHabilitado(dia) {
    const novo = diasHabilitados.includes(dia) ? diasHabilitados.filter((d) => d !== dia) : [...diasHabilitados, dia].sort();
    setDiasHabilitados(novo);
    const { error } = await supabase.from("config_sistema").update({ dias_habilitados: novo }).eq("id", 1);
    if (error) setMensagem(error.message);
  }

  async function carregarReservas(ambienteId) {
    if (!ambienteId) return;
    const { data, error } = await supabase
      .from("reservas_visiveis")
      .select("*")
      .eq("ambiente_id", ambienteId)
      .order("data")
      .order("hora_inicio");
    if (error) {
      setMensagem(error.message);
      return;
    }
    setReservas(data);
  }

  useEffect(() => {
    carregarAmbientes().finally(() => setCarregando(false));
    carregarConfig();
    carregarNotificacoes();
    const timer = setInterval(() => {
      carregarNotificacoes();
      if (perfil?.cargo === "admin") carregarTotalPendentes();
    }, 60000);
    return () => clearInterval(timer);
  }, [perfil?.cargo]);

  useEffect(() => {
    if (perfil?.cargo === "admin") carregarTotalPendentes();
  }, [perfil?.cargo]);

  useEffect(() => {
    if (perfil?.cargo === "professor" || perfil?.cargo === "admin") {
      supabase
        .from("profiles")
        .select("id, nome")
        .eq("cargo", "professor")
        .neq("id", session.user.id)
        .then(({ data }) => setProfessores(data || []));
    }
  }, [perfil?.cargo]);

  useEffect(() => {
    if (ambienteSelecionado) carregarReservas(ambienteSelecionado);
  }, [ambienteSelecionado]);

  function selecionarCategoria(tipo) {
    setCategoria(tipo);
    const primeiro = ambientes.find((a) => a.tipo === tipo);
    if (primeiro) setAmbienteSelecionado(primeiro.id);
  }

  function abrirModalNovaReserva() {
    setMensagem("");
    if (perfil?.cargo === "professor" || perfil?.cargo === "admin") {
      setModalProfessorAberto(true);
    } else {
      setNovaReserva({
        tipo: "grupo_estudos", finalidade: "", data: dataSelecionada, horaInicio: "", horaFim: "", qtdPessoas: 1, material: "",
        dataFimRecorrencia: "",
        diasSemana: diasHabilitados.includes(diaSemanaDe(dataSelecionada)) ? [diaSemanaDe(dataSelecionada)] : [],
      });
      setModalAberto(true);
    }
  }

  function concluirReservaProfessor() {
    setModalProfessorAberto(false);
    carregarReservas(ambienteSelecionado);
  }

  async function criarReserva(e) {
    e.preventDefault();
    setMensagem("");
    setAviso("");

    const ehMonitoria = novaReserva.tipo === "monitoria";
    if (ehMonitoria && novaReserva.dataFimRecorrencia && novaReserva.dataFimRecorrencia < novaReserva.data) {
      setMensagem("A data de término não pode ser antes da data inicial.");
      return;
    }
    const ehSerie = ehMonitoria && !!novaReserva.dataFimRecorrencia && novaReserva.dataFimRecorrencia > novaReserva.data;
    if (ehSerie && novaReserva.diasSemana.length === 0) {
      setMensagem("Selecione ao menos um dia da semana para a recorrência.");
      return;
    }
    const ocorrencias = ehSerie ? gerarOcorrencias(novaReserva.data, novaReserva.dataFimRecorrencia, novaReserva.diasSemana) : [novaReserva.data];
    const erroGrande = erroSerieGrande(ocorrencias.length);
    if (erroGrande) {
      setMensagem(erroGrande);
      return;
    }
    if (ocorrencias.length === 0) {
      setMensagem("Nenhuma data válida nesse intervalo com os dias da semana selecionados.");
      return;
    }

    const diaDesativado = ocorrencias.find((d) => !diasHabilitados.includes(diaSemanaDe(d)));
    if (diaDesativado) {
      setMensagem(`A administração desativou reservas aos ${DIAS_SEMANA_LABEL[diaSemanaDe(diaDesativado)]}.`);
      return;
    }

    const erroMin = erroMinimoParticipantes({
      cargo: perfil?.cargo,
      tipoReserva: novaReserva.tipo,
      tipoAmbiente: ambiente?.tipo,
      qtdPessoas: novaReserva.qtdPessoas,
    });
    if (erroMin) {
      setMensagem(erroMin);
      return;
    }

    const limite = validarLimites({
      cargo: perfil?.cargo,
      tipo: ambiente?.tipo,
      antecedenciaHoras: Number(ambiente?.antecedencia_horas) || 0,
      data: ocorrencias[0],
      horaInicio: novaReserva.horaInicio,
      horaFim: novaReserva.horaFim,
    });
    if (limite.erro) {
      setMensagem(limite.erro);
      return;
    }

    // Checagem rápida com o que já está na tela (o banco é quem garante de verdade, logo abaixo)
    const conflito = acharPrimeiroConflito(reservas, ocorrencias, novaReserva.horaInicio, novaReserva.horaFim, novaReserva.tipo);
    if (conflito) {
      setMensagem(
        `Esse horário já está ocupado em ${ambiente?.nome || "este ambiente"}: ${dataBR(conflito.data)}, das ${conflito.reserva.hora_inicio.slice(0, 5)} às ${conflito.reserva.hora_fim.slice(0, 5)} (${conflito.reserva.finalidade}). ${ehSerie ? "Nenhuma data da série foi reservada." : "Escolha outro horário."}`,
      );
      return;
    }

    const linhas = ocorrencias.map((data) => ({
      ambiente_id: ambienteSelecionado,
      usuario_id: session.user.id,
      tipo: novaReserva.tipo,
      finalidade: novaReserva.finalidade,
      data,
      hora_inicio: novaReserva.horaInicio,
      hora_fim: novaReserva.horaFim,
      qtd_pessoas: novaReserva.qtdPessoas || null,
      material: novaReserva.tipo === "professor" ? novaReserva.material || null : null,
    }));

    const { data: criadas, error } = await supabase.from("reservas").insert(linhas).select("status");
    if (error) {
      setMensagem(traduzirErroBanco(error));
      if (error.code === "23P01") carregarReservas(ambienteSelecionado);
    } else {
      const pendentes = (criadas || []).filter((x) => x.status === "pendente").length;
      if (linhas.length === 1) {
        setAviso(
          pendentes > 0
            ? "Seu horário colide com uma reserva de menor prioridade, então sua reserva foi enviada para aprovação da administração. Ela só passa a valer se for aprovada."
            : "Reserva criada.",
        );
      } else {
        setAviso(
          `${linhas.length} reservas criadas${pendentes > 0 ? `, sendo ${pendentes} aguardando aprovação da administração (colidem com reservas de menor prioridade)` : ""}.`,
        );
      }
      setModalAberto(false);
      setDataSelecionada(novaReserva.data);
      carregarReservas(ambienteSelecionado);
    }
  }

  async function cancelarReserva(id) {
    setAviso("");
    const { error } = await supabase.from("reservas").delete().eq("id", id);
    if (error) {
      setMensagem(error.message);
    } else {
      setDetalhe(null);
      carregarReservas(ambienteSelecionado);
    }
  }

  const ambiente = ambientes.find((a) => a.id === ambienteSelecionado);
  const ehAdmin = perfil?.cargo === "admin";
  const ambientesDaCategoria = ambientes.filter((a) => a.tipo === categoria);
  const reservasDoDia = reservas.filter((r) => r.data === dataSelecionada).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));

  if (carregando) return <p style={{ padding: 24, fontFamily: "sans-serif" }}>Carregando…</p>;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'Inter', sans-serif", color: COLORS.ink }}>
      <header style={{ background: COLORS.ink, color: "#fff", padding: "18px 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ ...fonteTitulo, fontSize: 18, margin: 0 }}>Portal de Reservas Acadêmicas</h1>
            <p style={{ fontSize: 12, opacity: 0.75, margin: "4px 0 0" }}>
              {perfil?.nome} — {CARGO_LABEL[perfil?.cargo] || perfil?.cargo}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {ehAdmin && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[
                  ["agenda", "Agenda"],
                  ["reservas", "Reservas"],
                  ["aprovacoes", `Aprovações${totalPendentes > 0 ? ` (${totalPendentes})` : ""}`],
                  ["ambientes", "Ambientes"],
                  ["periodos", "Períodos"],
                  ["usuarios", "Usuários"],
                ].map(([id, rotulo]) => (
                  <button
                    key={id}
                    onClick={() => { setAba(id); if (id === "aprovacoes") carregarTotalPendentes(); }}
                    style={{ background: aba === id ? "#fff" : "transparent", color: aba === id ? COLORS.ink : "#fff", border: "1px solid rgba(255,255,255,0.4)", padding: "7px 12px", fontSize: 12.5, borderRadius: 4, cursor: "pointer" }}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => supabase.auth.signOut()} style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.4)", padding: "7px 12px", fontSize: 12.5, borderRadius: 4, cursor: "pointer" }}>
              Sair
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px 64px" }}>
        {notificacoes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
            {notificacoes.map((n) => (
              <div key={n.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: COLORS.professorSoft, border: `1px solid ${COLORS.professor}`, color: COLORS.ink, fontSize: 13, padding: "10px 14px", borderRadius: 4 }}>
                <span>🔔 {n.mensagem}</span>
                <button onClick={() => dispensarNotificacao(n.id)} style={{ background: "transparent", border: "none", color: COLORS.professor, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Dispensar
                </button>
              </div>
            ))}
          </div>
        )}

        {aba === "usuarios" && ehAdmin ? (
          <PainelUsuarios session={session} />
        ) : aba === "periodos" && ehAdmin ? (
          <PainelPeriodos />
        ) : aba === "ambientes" && ehAdmin ? (
          <PainelAmbientes ambientes={ambientes} diasHabilitados={diasHabilitados} onAlternarDia={alternarDiaHabilitado} aoMudar={carregarAmbientes} />
        ) : aba === "reservas" && ehAdmin ? (
          <PainelReservasAdmin
            ambientes={ambientes}
            aoMudar={() => { carregarTotalPendentes(); carregarReservas(ambienteSelecionado); }}
          />
        ) : aba === "aprovacoes" && ehAdmin ? (
          <PainelAprovacoes
            ambientes={ambientes}
            aoMudar={() => { carregarTotalPendentes(); carregarReservas(ambienteSelecionado); }}
          />
        ) : (
          <>
            {mensagem && <p style={{ fontSize: 13, color: COLORS.danger, marginBottom: 16 }}>{mensagem}</p>}
            {aviso && <p style={{ fontSize: 13, color: COLORS.teal, marginBottom: 16 }}>{aviso}</p>}

            <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 24 }}>
              <div>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {Object.entries(TIPO_AMBIENTE_LABEL_PLURAL).map(([tipo, label]) => (
                    <button
                      key={tipo}
                      onClick={() => selecionarCategoria(tipo)}
                      style={{
                        flex: 1, textAlign: "center", padding: "9px 8px", fontSize: 12.5, fontWeight: 600, borderRadius: 4, cursor: "pointer",
                        background: categoria === tipo ? COLORS.teal : COLORS.panel,
                        color: categoria === tipo ? "#fff" : COLORS.ink,
                        border: `1px solid ${categoria === tipo ? COLORS.teal : COLORS.line}`,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, marginBottom: 8 }}>
                  {TIPO_AMBIENTE_LABEL_PLURAL[categoria]} ({ambientesDaCategoria.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {ambientesDaCategoria.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAmbienteSelecionado(a.id)}
                      style={{
                        textAlign: "left", padding: "10px 12px", borderRadius: 4, cursor: "pointer", fontSize: 13.5,
                        border: `1px solid ${a.id === ambienteSelecionado ? COLORS.teal : COLORS.line}`,
                        background: a.id === ambienteSelecionado ? COLORS.tealSoft : COLORS.panel,
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{a.nome}</div>
                      <div style={{ fontSize: 11, color: COLORS.inkSoft, marginTop: 2 }}>capacidade {a.capacidade} · antecedência {a.antecedencia_horas}h</div>
                    </button>
                  ))}
                  {ambientesDaCategoria.length === 0 && <p style={{ fontSize: 12, color: COLORS.inkSoft }}>Nenhum ambiente nesta categoria.</p>}
                </div>
              </div>

              <div>
                {ambiente && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
                      <div>
                        <h2 style={{ ...fonteTitulo, fontSize: 17, margin: 0 }}>{ambiente.nome}</h2>
                        <p style={{ fontSize: 12, color: COLORS.inkSoft, margin: "4px 0 0" }}>
                          {TIPO_AMBIENTE_LABEL[ambiente.tipo]} · capacidade {ambiente.capacidade} · antecedência mínima {ambiente.antecedencia_horas}h
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input type="date" style={{ ...inputStyle, width: "auto" }} value={dataSelecionada} onChange={(e) => setDataSelecionada(e.target.value)} />
                        <button onClick={abrirModalNovaReserva} style={{ ...buttonStyle, background: COLORS.teal, whiteSpace: "nowrap" }}>
                          + Nova reserva
                        </button>
                      </div>
                    </div>

                    <GradeAgenda reservasDoDia={reservasDoDia} onAbrirDetalhe={setDetalhe} />

                    <p style={{ fontSize: 11.5, color: COLORS.inkSoft, marginTop: 10 }}>
                      Clique em uma reserva para ver os detalhes. Você pode cancelar suas próprias reservas; a administração pode cancelar qualquer uma.
                    </p>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {modalAberto && (
        <ModalNovaReserva
          ambiente={ambiente}
          cargo={perfil?.cargo}
          diasHabilitados={diasHabilitados}
          valores={novaReserva}
          onMudar={setNovaReserva}
          onFechar={() => setModalAberto(false)}
          onConfirmar={criarReserva}
          mensagem={mensagem}
        />
      )}

      {modalProfessorAberto && (
        <ModalReservaProfessor
          session={session}
          perfil={perfil}
          ambientes={ambientes}
          professores={professores}
          dataInicial={dataSelecionada}
          diasHabilitados={diasHabilitados}
          onFechar={() => setModalProfessorAberto(false)}
          onConcluido={concluirReservaProfessor}
        />
      )}

      {detalhe && (
        <ModalDetalheReserva
          reserva={detalhe}
          ambiente={ambiente}
          podeCancelar={detalhe.eh_minha || ehAdmin}
          onFechar={() => setDetalhe(null)}
          onCancelar={cancelarReserva}
        />
      )}
    </div>
  );
}

// ------------------------------------------------ Raiz
export default function App() {
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [senhaPendente, setSenhaPendente] = useState(/type=(invite|recovery)/.test(HASH_INICIAL));
  const [senhaConcluida, setSenhaConcluida] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCarregando(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((evento, novaSessao) => {
      setSession(novaSessao);
      if (evento === "PASSWORD_RECOVERY") setSenhaPendente(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setPerfil(null);
      return;
    }
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setPerfil(data));
  }, [session]);

  if (carregando) return <p style={{ padding: 24, fontFamily: "sans-serif" }}>Carregando…</p>;

  const avisoLinkExpirado = /error_code=otp_expired|error=access_denied/.test(HASH_INICIAL)
    ? "Esse link expirou ou já foi usado. Use \"Esqueci minha senha\" para receber um novo."
    : "";
  if (!session) return <TelaAutenticacao avisoInicial={avisoLinkExpirado} />;

  const convidadoSemSenha = !!session.user.invited_at && !session.user.user_metadata?.senha_definida;
  if (!senhaConcluida && (senhaPendente || convidadoSemSenha)) {
    return <TelaDefinirSenha onConcluido={() => { setSenhaConcluida(true); setSenhaPendente(false); }} />;
  }

  return <TelaPrincipal session={session} perfil={perfil} />;
}
