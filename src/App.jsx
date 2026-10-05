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

// Procura uma reserva que se sobreponha ao horário pedido (mesma data).
// Horários "HH:MM" comparam certo como texto. Reservas seguidas (fim = início) não colidem.
export function acharConflito(reservas, data, horaInicio, horaFim) {
  return (
    reservas.find(
      (r) => r.data === data && r.hora_inicio.slice(0, 5) < horaFim && horaInicio < r.hora_fim.slice(0, 5),
    ) || null
  );
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

// Procura, na lista de ocorrências (em ordem), a primeira que colide com alguma reserva existente.
export function acharPrimeiroConflito(reservasExistentes, ocorrencias, horaInicio, horaFim) {
  for (const data of ocorrencias) {
    const r = reservasExistentes.find(
      (x) => x.data === data && x.hora_inicio.slice(0, 5) < horaFim && horaInicio < x.hora_fim.slice(0, 5),
    );
    if (r) return { data, reserva: r };
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

// ------------------------------------------------ Modal: nova reserva
function ModalNovaReserva({ ambiente, valores, onMudar, onFechar, onConfirmar, mensagem }) {
  return (
    <Modal onFechar={onFechar}>
      <div style={{ ...fonteTitulo, fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Nova reserva</div>
      <div style={{ fontSize: 12, color: COLORS.inkSoft, marginBottom: 18 }}>
        {ambiente?.nome} — {TIPO_AMBIENTE_LABEL[ambiente?.tipo]} · capacidade {ambiente?.capacidade} · antecedência mínima {ambiente?.antecedencia_horas}h
      </div>

      <form onSubmit={onConfirmar}>
        <Campo label="Tipo">
          <select style={inputStyle} value={valores.tipo} onChange={(e) => onMudar({ ...valores, tipo: e.target.value })}>
            <option value="grupo_estudos">Grupo de estudos</option>
            <option value="monitoria">Monitoria</option>
            <option value="professor">Professor</option>
          </select>
        </Campo>
        <Campo label="Finalidade">
          <input style={inputStyle} value={valores.finalidade} onChange={(e) => onMudar({ ...valores, finalidade: e.target.value })} required />
        </Campo>
        <Campo label="Data">
          <input type="date" style={inputStyle} value={valores.data} onChange={(e) => onMudar({ ...valores, data: e.target.value })} required />
        </Campo>
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
        <Campo label="Quantidade de pessoas">
          <input type="number" min={1} style={inputStyle} value={valores.qtdPessoas} onChange={(e) => onMudar({ ...valores, qtdPessoas: e.target.value })} />
        </Campo>

        {valores.tipo === "professor" && (
          <Campo label="Material necessário" hint="Visível apenas para você e para a administração.">
            <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} value={valores.material} onChange={(e) => onMudar({ ...valores, material: e.target.value })} placeholder="Ex.: manequim de simulação, kit de suturas, projetor…" />
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
function ModalReservaProfessor({ session, perfil, ambientes, professores, dataInicial, onFechar, onConcluido }) {
  const [tipo, setTipo] = useState("professor");
  const [finalidade, setFinalidade] = useState("");
  const [material, setMaterial] = useState("");
  const [qtdPessoas, setQtdPessoas] = useState(1);
  const [salasSel, setSalasSel] = useState([]); // { ambienteId, professorAssociadoId }
  const [dataInicio, setDataInicio] = useState(dataInicial);
  const [dataFim, setDataFim] = useState(dataInicial);
  const [diasSemana, setDiasSemana] = useState([diaSemanaDe(dataInicial)]);
  const [horaInicio, setHoraInicio] = useState("08:00");
  const [horaFim, setHoraFim] = useState("09:00");
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null); // { sucesso, totalReservas, bloqueadas: [{nome, motivo}] }

  const ehAdmin = perfil?.cargo === "admin";

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
    if (ocorrencias.length === 0) {
      setMensagem("Nenhuma data válida nesse intervalo com os dias da semana selecionados.");
      return;
    }

    setEnviando(true);

    const idsAmbientes = salasSel.map((s) => s.ambienteId);
    const { data: existentes, error: erroBusca } = await supabase
      .from("reservas")
      .select("ambiente_id, data, hora_inicio, hora_fim, finalidade")
      .in("ambiente_id", idsAmbientes)
      .gte("data", dataInicio)
      .lte("data", dataFim);

    if (erroBusca) {
      setMensagem(erroBusca.message);
      setEnviando(false);
      return;
    }

    let totalSucesso = 0;
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
      const conflito = acharPrimeiroConflito(existentesDaSala, ocorrencias, horaInicio, horaFim);
      if (conflito) {
        bloqueadas.push({
          nome: ambiente.nome,
          motivo: `já ocupado em ${dataBR(conflito.data)} das ${conflito.reserva.hora_inicio.slice(0, 5)} às ${conflito.reserva.hora_fim.slice(0, 5)} (${conflito.reserva.finalidade})`,
        });
        continue;
      }

      const linhas = ocorrencias.map((data) => ({
        ambiente_id: sala.ambienteId,
        usuario_id: session.user.id,
        professor_associado_id: salasSel.length > 1 ? sala.professorAssociadoId || null : null,
        tipo,
        finalidade,
        data,
        hora_inicio: horaInicio,
        hora_fim: horaFim,
        qtd_pessoas: qtdPessoas || null,
        material: tipo === "professor" ? material || null : null,
      }));

      const { error: erroInsercao } = await supabase.from("reservas").insert(linhas);
      if (erroInsercao) {
        const motivo =
          erroInsercao.code === "23P01"
            ? "alguém reservou um desses horários enquanto você preenchia o formulário"
            : erroInsercao.message;
        bloqueadas.push({ nome: ambiente.nome, motivo });
      } else {
        totalSucesso += linhas.length;
      }
    }

    setEnviando(false);
    setResultado({ totalSucesso, salasOk: salasSel.length - bloqueadas.length, bloqueadas });
  }

  if (resultado) {
    return (
      <Modal largura={520} onFechar={() => onConcluido()}>
        <div style={{ ...fonteTitulo, fontSize: 18, fontWeight: 600, marginBottom: 14 }}>Resultado do lançamento</div>
        {resultado.totalSucesso > 0 && (
          <div style={{ fontSize: 13.5, color: COLORS.teal, marginBottom: 12 }}>
            {resultado.salasOk} sala(s) confirmada(s), totalizando {resultado.totalSucesso} reserva(s).
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

        <Campo label="Finalidade">
          <input style={inputStyle} value={finalidade} onChange={(e) => setFinalidade(e.target.value)} required />
        </Campo>

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
            {DIAS_SEMANA_LABEL.map((label, i) => (
              <button
                type="button"
                key={i}
                onClick={() => alternarDia(i)}
                style={{
                  padding: "6px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer",
                  border: `1px solid ${diasSemana.includes(i) ? COLORS.professor : COLORS.line}`,
                  background: diasSemana.includes(i) ? COLORS.professorSoft : "#fff",
                  color: diasSemana.includes(i) ? COLORS.professor : COLORS.inkSoft,
                }}
              >
                {label}
              </button>
            ))}
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
            <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Ex.: manequim de simulação, kit de suturas, projetor…" />
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
      <div style={{ fontSize: 13.5, color: COLORS.ink, marginBottom: 14 }}>{reserva.finalidade}</div>

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
          return (
            <button
              key={r.id}
              onClick={() => onAbrirDetalhe(r)}
              title="Clique para ver os detalhes"
              style={{
                position: "absolute", top, height: Math.max(height, 40), left: 8, right: 8,
                background: TIPO_SOFT[r.tipo], borderLeft: `3px solid ${TIPO_COLOR[r.tipo]}`,
                padding: "4px 10px", fontSize: 12, overflow: "hidden", textAlign: "left",
                border: "none", borderLeftWidth: 3, borderLeftStyle: "solid", borderLeftColor: TIPO_COLOR[r.tipo],
                cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "center", gap: 1, borderRadius: 2,
              }}
            >
              <div style={{ fontWeight: 600, color: TIPO_COLOR[r.tipo], whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", fontSize: 11 }}>
                {ini}–{fim} · {TIPO_LABEL[r.tipo]}
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
  const [aba, setAba] = useState("reservas"); // "reservas" | "usuarios"
  const [categoria, setCategoria] = useState("laboratorio");
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

  const [novaReserva, setNovaReserva] = useState({ tipo: "grupo_estudos", finalidade: "", data: hojeISO(), horaInicio: "", horaFim: "", qtdPessoas: 1, material: "" });
  const [novoAmbiente, setNovoAmbiente] = useState({ nome: "", tipo: "laboratorio", capacidade: 10, antecedenciaHoras: 48 });

  async function carregarAmbientes() {
    const { data, error } = await supabase.from("ambientes").select("*").order("nome");
    if (error) {
      setMensagem(error.message);
      return;
    }
    setAmbientes(data);
    if (!ambienteSelecionado) {
      const primeiro = data.find((a) => a.tipo === categoria) || data[0];
      if (primeiro) setAmbienteSelecionado(primeiro.id);
    }
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
  }, []);

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
      setNovaReserva({ tipo: "grupo_estudos", finalidade: "", data: dataSelecionada, horaInicio: "", horaFim: "", qtdPessoas: 1, material: "" });
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

    const limite = validarLimites({
      cargo: perfil?.cargo,
      tipo: ambiente?.tipo,
      antecedenciaHoras: Number(ambiente?.antecedencia_horas) || 0,
      data: novaReserva.data,
      horaInicio: novaReserva.horaInicio,
      horaFim: novaReserva.horaFim,
    });
    if (limite.erro) {
      setMensagem(limite.erro);
      return;
    }

    // Checagem rápida com o que já está na tela (o banco é quem garante de verdade, logo abaixo)
    const conflito = acharConflito(reservas, novaReserva.data, novaReserva.horaInicio, novaReserva.horaFim);
    if (conflito) {
      setMensagem(
        `Esse horário já está ocupado em ${ambiente?.nome || "este ambiente"}: ${dataBR(conflito.data)}, das ${conflito.hora_inicio.slice(0, 5)} às ${conflito.hora_fim.slice(0, 5)} (${conflito.finalidade}). Escolha outro horário.`,
      );
      return;
    }

    const { error } = await supabase.from("reservas").insert({
      ambiente_id: ambienteSelecionado,
      usuario_id: session.user.id,
      tipo: novaReserva.tipo,
      finalidade: novaReserva.finalidade,
      data: novaReserva.data,
      hora_inicio: novaReserva.horaInicio,
      hora_fim: novaReserva.horaFim,
      qtd_pessoas: novaReserva.qtdPessoas || null,
      material: novaReserva.tipo === "professor" ? novaReserva.material || null : null,
    });
    if (error) {
      if (error.code === "23P01") {
        setMensagem("Esse horário acabou de ser reservado por outra pessoa. Veja a lista atualizada e escolha outro horário.");
        carregarReservas(ambienteSelecionado);
      } else if (error.code === "23514") {
        setMensagem("O horário final precisa ser depois do inicial.");
      } else {
        setMensagem(error.message);
      }
    } else {
      setAviso("Reserva criada.");
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

  async function criarAmbiente(e) {
    e.preventDefault();
    setMensagem("");
    const { error } = await supabase.from("ambientes").insert({
      nome: novoAmbiente.nome,
      tipo: novoAmbiente.tipo,
      capacidade: Number(novoAmbiente.capacidade),
      antecedencia_horas: Number(novoAmbiente.antecedenciaHoras),
    });
    if (error) {
      setMensagem(error.message);
    } else {
      setNovoAmbiente({ nome: "", tipo: "laboratorio", capacidade: 10, antecedenciaHoras: 48 });
      carregarAmbientes();
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
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setAba("reservas")} style={{ background: aba === "reservas" ? "#fff" : "transparent", color: aba === "reservas" ? COLORS.ink : "#fff", border: "1px solid rgba(255,255,255,0.4)", padding: "7px 12px", fontSize: 12.5, borderRadius: 4, cursor: "pointer" }}>
                  Reservas
                </button>
                <button onClick={() => setAba("usuarios")} style={{ background: aba === "usuarios" ? "#fff" : "transparent", color: aba === "usuarios" ? COLORS.ink : "#fff", border: "1px solid rgba(255,255,255,0.4)", padding: "7px 12px", fontSize: 12.5, borderRadius: 4, cursor: "pointer" }}>
                  Usuários
                </button>
              </div>
            )}
            <button onClick={() => supabase.auth.signOut()} style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.4)", padding: "7px 12px", fontSize: 12.5, borderRadius: 4, cursor: "pointer" }}>
              Sair
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px 64px" }}>
        {aba === "usuarios" && ehAdmin ? (
          <PainelUsuarios session={session} />
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

                {ehAdmin && (
                  <div style={{ marginTop: 24 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.inkSoft, marginBottom: 8 }}>Novo ambiente (admin)</div>
                    <form onSubmit={criarAmbiente}>
                      <Campo label="Nome">
                        <input style={inputStyle} value={novoAmbiente.nome} onChange={(e) => setNovoAmbiente({ ...novoAmbiente, nome: e.target.value })} required />
                      </Campo>
                      <Campo label="Tipo">
                        <select style={inputStyle} value={novoAmbiente.tipo} onChange={(e) => setNovoAmbiente({ ...novoAmbiente, tipo: e.target.value })}>
                          <option value="laboratorio">Laboratório</option>
                          <option value="sala_tutoria">Sala de tutoria</option>
                        </select>
                      </Campo>
                      <Campo label="Capacidade">
                        <input type="number" min={1} style={inputStyle} value={novoAmbiente.capacidade} onChange={(e) => setNovoAmbiente({ ...novoAmbiente, capacidade: e.target.value })} />
                      </Campo>
                      <Campo label="Antecedência (horas)">
                        <input type="number" min={0} step="0.5" style={inputStyle} value={novoAmbiente.antecedenciaHoras} onChange={(e) => setNovoAmbiente({ ...novoAmbiente, antecedenciaHoras: e.target.value })} />
                      </Campo>
                      <button type="submit" style={{ ...buttonStyle, width: "100%" }}>Adicionar ambiente</button>
                    </form>
                  </div>
                )}
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
          onFechar={() => setModalProfessorAberto(false)}
          onConcluido={concluirReservaProfessor}
        />
      )}

      {detalhe && (
        <ModalDetalheReserva
          reserva={detalhe}
          ambiente={ambiente}
          podeCancelar={detalhe.usuario_id === session.user.id || ehAdmin}
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
