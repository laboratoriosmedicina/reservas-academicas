import React, { useEffect, useState } from "react";
import { supabase, HASH_INICIAL } from "./supabaseClient";

const CARGO_LABEL = { aluno: "Aluno", monitor: "Aluno monitor", professor: "Professor", admin: "Administração" };
const TIPO_AMBIENTE_LABEL = { laboratorio: "Laboratório", sala_tutoria: "Sala de tutoria" };

const inputStyle = {
  width: "100%",
  padding: "9px 10px",
  border: "1px solid #D6DAD2",
  borderRadius: 4,
  fontSize: 14,
  boxSizing: "border-box",
};

const buttonStyle = {
  background: "#1B2430",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

function Campo({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, fontSize: 13, color: "#333" }}>
      {label}
      {children}
    </label>
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

function toMinutosHHMM(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function dataBR(iso) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
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
    <div style={{ maxWidth: 380, margin: "60px auto", padding: 24, border: "1px solid #D6DAD2", borderRadius: 8, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Portal de Reservas Acadêmicas</h1>
      <p style={{ fontSize: 12, color: "#666", marginBottom: 20 }}>
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

        {mensagem && <p style={{ fontSize: 13, color: "#B23A48", marginBottom: 12 }}>{mensagem}</p>}

        <button type="submit" disabled={carregando} style={{ ...buttonStyle, width: "100%" }}>
          {carregando ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Enviar link"}
        </button>
      </form>

      <p style={{ fontSize: 12, color: "#666", marginTop: 16, textAlign: "center" }}>
        {modo === "entrar" ? (
          <>
            <button onClick={() => { setModo("esqueci"); setMensagem(""); }} style={{ background: "none", border: "none", color: "#1B2430", textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>
              Esqueci minha senha / convite expirou
            </button>
            <br />
            Não tem acesso? Peça um convite à administração.
          </>
        ) : (
          <button onClick={() => { setModo("entrar"); setMensagem(""); }} style={{ background: "none", border: "none", color: "#1B2430", textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>
            Voltar para o login
          </button>
        )}
      </p>
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
    <div style={{ maxWidth: 380, margin: "60px auto", padding: 24, border: "1px solid #D6DAD2", borderRadius: 8, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Defina sua senha</h1>
      <p style={{ fontSize: 12, color: "#666", marginBottom: 20 }}>Escolha a senha que você vai usar para entrar no portal.</p>
      <form onSubmit={salvar}>
        <Campo label="Nova senha (mínimo 8 caracteres)">
          <input type="password" style={inputStyle} value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </Campo>
        <Campo label="Confirmar senha">
          <input type="password" style={inputStyle} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required />
        </Campo>
        {erro && <p style={{ fontSize: 13, color: "#B23A48", marginBottom: 12 }}>{erro}</p>}
        <button type="submit" disabled={carregando} style={{ ...buttonStyle, width: "100%" }}>
          {carregando ? "Salvando…" : "Salvar senha e entrar"}
        </button>
      </form>
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
        <h3 style={{ fontSize: 13, color: "#666" }}>Convidar usuário</h3>
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
          <button type="submit" disabled={enviando} style={{ ...buttonStyle, width: "100%" }}>
            {enviando ? "Enviando…" : "Enviar convite por e-mail"}
          </button>
        </form>
        {mensagem && <p style={{ fontSize: 13, color: "#333", marginTop: 12 }}>{mensagem}</p>}
      </div>

      <div>
        <h3 style={{ fontSize: 13, color: "#666" }}>Usuários ({usuarios.length})</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {usuarios.map((u) => (
            <div key={u.id} style={{ border: "1px solid #D6DAD2", borderRadius: 4, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13 }}>{u.nome}</div>
                <div style={{ fontSize: 11, color: "#888" }}>{emailDe(u) || "—"}</div>
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

// ------------------------------------------------ Tela principal
function TelaPrincipal({ session, perfil }) {
  const [aba, setAba] = useState("reservas"); // "reservas" | "usuarios"
  const [ambientes, setAmbientes] = useState([]);
  const [ambienteSelecionado, setAmbienteSelecionado] = useState(null);
  const [reservas, setReservas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState("");
  const [aviso, setAviso] = useState("");

  const [novaReserva, setNovaReserva] = useState({ tipo: "grupo_estudos", finalidade: "", data: "", horaInicio: "", horaFim: "", qtdPessoas: 1 });
  const [novoAmbiente, setNovoAmbiente] = useState({ nome: "", tipo: "laboratorio", capacidade: 10, antecedenciaHoras: 48 });

  async function carregarAmbientes() {
    const { data, error } = await supabase.from("ambientes").select("*").order("nome");
    if (error) {
      setMensagem(error.message);
      return;
    }
    setAmbientes(data);
    if (data.length > 0 && !ambienteSelecionado) setAmbienteSelecionado(data[0].id);
  }

  async function carregarReservas(ambienteId) {
    if (!ambienteId) return;
    const { data, error } = await supabase
      .from("reservas")
      .select("*, profiles(nome)")
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
    if (ambienteSelecionado) carregarReservas(ambienteSelecionado);
  }, [ambienteSelecionado]);

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
    });
    if (error) {
      if (error.code === "23P01") {
        // Alguém reservou esse horário no meio tempo: atualiza a lista e avisa
        setMensagem("Esse horário acabou de ser reservado por outra pessoa. Veja a lista atualizada e escolha outro horário.");
        carregarReservas(ambienteSelecionado);
      } else if (error.code === "23514") {
        setMensagem("O horário final precisa ser depois do inicial.");
      } else {
        setMensagem(error.message);
      }
    } else {
      setAviso("Reserva criada.");
      setNovaReserva({ tipo: "grupo_estudos", finalidade: "", data: "", horaInicio: "", horaFim: "", qtdPessoas: 1 });
      carregarReservas(ambienteSelecionado);
    }
  }

  async function cancelarReserva(id) {
    setAviso("");
    const { error } = await supabase.from("reservas").delete().eq("id", id);
    if (error) setMensagem(error.message);
    else carregarReservas(ambienteSelecionado);
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

  if (carregando) return <p style={{ padding: 24, fontFamily: "sans-serif" }}>Carregando…</p>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "sans-serif", color: "#1B2430" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Portal de Reservas Acadêmicas</h1>
          <p style={{ fontSize: 12, color: "#666", margin: "4px 0 0" }}>
            {perfil?.nome} — {CARGO_LABEL[perfil?.cargo] || perfil?.cargo}
          </p>
        </div>
        <button onClick={() => supabase.auth.signOut()} style={{ ...buttonStyle, background: "transparent", color: "#1B2430", border: "1px solid #D6DAD2" }}>
          Sair
        </button>
      </header>

      {ehAdmin && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button onClick={() => setAba("reservas")} style={{ ...buttonStyle, background: aba === "reservas" ? "#1B2430" : "#eee", color: aba === "reservas" ? "#fff" : "#333" }}>
            Reservas
          </button>
          <button onClick={() => setAba("usuarios")} style={{ ...buttonStyle, background: aba === "usuarios" ? "#1B2430" : "#eee", color: aba === "usuarios" ? "#fff" : "#333" }}>
            Usuários
          </button>
        </div>
      )}

      {aba === "usuarios" && ehAdmin ? (
        <PainelUsuarios session={session} />
      ) : (
        <>
          {mensagem && <p style={{ fontSize: 13, color: "#B23A48", marginBottom: 16 }}>{mensagem}</p>}
          {aviso && <p style={{ fontSize: 13, color: "#2F6F6B", marginBottom: 16 }}>{aviso}</p>}

          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24 }}>
            <div>
              <h3 style={{ fontSize: 13, color: "#666" }}>Ambientes</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ambientes.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAmbienteSelecionado(a.id)}
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: 4,
                      border: `1px solid ${a.id === ambienteSelecionado ? "#1B2430" : "#D6DAD2"}`,
                      background: a.id === ambienteSelecionado ? "#EFF1EA" : "#fff",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    <div>{a.nome}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{TIPO_AMBIENTE_LABEL[a.tipo]}</div>
                  </button>
                ))}
                {ambientes.length === 0 && <p style={{ fontSize: 12, color: "#888" }}>Nenhum ambiente cadastrado.</p>}
              </div>

              {ehAdmin && (
                <div style={{ marginTop: 24 }}>
                  <h3 style={{ fontSize: 13, color: "#666" }}>Novo ambiente (admin)</h3>
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
                  <h2 style={{ fontSize: 16 }}>{ambiente.nome}</h2>
                  <p style={{ fontSize: 12, color: "#888", marginTop: -8 }}>
                    {TIPO_AMBIENTE_LABEL[ambiente.tipo]} · capacidade {ambiente.capacidade} · antecedência mínima {ambiente.antecedencia_horas}h
                  </p>

                  <h3 style={{ fontSize: 13, color: "#666", marginTop: 20 }}>Reservas</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
                    {reservas.map((r) => (
                      <div key={r.id} style={{ border: "1px solid #D6DAD2", borderRadius: 4, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                        <div>
                          <div>
                            {r.data} · {r.hora_inicio.slice(0, 5)}–{r.hora_fim.slice(0, 5)} · {r.finalidade}
                          </div>
                          <div style={{ fontSize: 11, color: "#888" }}>
                            {r.profiles?.nome || "—"} · {r.tipo}
                          </div>
                        </div>
                        {(r.usuario_id === session.user.id || ehAdmin) && (
                          <button onClick={() => cancelarReserva(r.id)} style={{ background: "transparent", border: "none", color: "#B23A48", cursor: "pointer", fontSize: 12 }}>
                            Cancelar
                          </button>
                        )}
                      </div>
                    ))}
                    {reservas.length === 0 && <p style={{ fontSize: 12, color: "#888" }}>Nenhuma reserva ainda para este ambiente.</p>}
                  </div>

                  <h3 style={{ fontSize: 13, color: "#666" }}>Nova reserva</h3>
                  <form onSubmit={criarReserva} style={{ maxWidth: 400 }}>
                    <Campo label="Tipo">
                      <select style={inputStyle} value={novaReserva.tipo} onChange={(e) => setNovaReserva({ ...novaReserva, tipo: e.target.value })}>
                        <option value="grupo_estudos">Grupo de estudos</option>
                        <option value="monitoria">Monitoria</option>
                        <option value="professor">Professor</option>
                      </select>
                    </Campo>
                    <Campo label="Finalidade">
                      <input style={inputStyle} value={novaReserva.finalidade} onChange={(e) => setNovaReserva({ ...novaReserva, finalidade: e.target.value })} required />
                    </Campo>
                    <Campo label="Data">
                      <input type="date" style={inputStyle} value={novaReserva.data} onChange={(e) => setNovaReserva({ ...novaReserva, data: e.target.value })} required />
                    </Campo>
                    <div style={{ display: "flex", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <Campo label="Início">
                          <input type="time" style={inputStyle} value={novaReserva.horaInicio} onChange={(e) => setNovaReserva({ ...novaReserva, horaInicio: e.target.value })} required />
                        </Campo>
                      </div>
                      <div style={{ flex: 1 }}>
                        <Campo label="Fim">
                          <input type="time" style={inputStyle} value={novaReserva.horaFim} onChange={(e) => setNovaReserva({ ...novaReserva, horaFim: e.target.value })} required />
                        </Campo>
                      </div>
                    </div>
                    <Campo label="Quantidade de pessoas">
                      <input type="number" min={1} style={inputStyle} value={novaReserva.qtdPessoas} onChange={(e) => setNovaReserva({ ...novaReserva, qtdPessoas: e.target.value })} />
                    </Campo>
                    <button type="submit" style={{ ...buttonStyle, width: "100%" }}>Confirmar reserva</button>
                  </form>
                </>
              )}
            </div>
          </div>
        </>
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

  // Convidado que ainda não escolheu senha (ou pediu redefinição): tela de definir senha antes de tudo.
  const convidadoSemSenha = !!session.user.invited_at && !session.user.user_metadata?.senha_definida;
  if (!senhaConcluida && (senhaPendente || convidadoSemSenha)) {
    return <TelaDefinirSenha onConcluido={() => { setSenhaConcluida(true); setSenhaPendente(false); }} />;
  }

  return <TelaPrincipal session={session} perfil={perfil} />;
}
