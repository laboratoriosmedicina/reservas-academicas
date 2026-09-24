import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

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

function TelaAutenticacao() {
  const [modo, setModo] = useState("entrar"); // "entrar" | "cadastrar"
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [cargo, setCargo] = useState("aluno");
  const [mensagem, setMensagem] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setMensagem("");
    setCarregando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) setMensagem(error.message);
  }

  async function cadastrar(e) {
    e.preventDefault();
    setMensagem("");
    setCarregando(true);
    const { error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: { data: { nome, cargo } },
    });
    setCarregando(false);
    if (error) {
      setMensagem(error.message);
    } else {
      setMensagem("Conta criada! Verifique seu e-mail para confirmar antes de entrar.");
      setModo("entrar");
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: "60px auto", padding: 24, border: "1px solid #D6DAD2", borderRadius: 8, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Portal de Reservas Acadêmicas</h1>
      <p style={{ fontSize: 12, color: "#666", marginBottom: 20 }}>Núcleo — login real via Supabase.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setModo("entrar")} style={{ ...buttonStyle, flex: 1, background: modo === "entrar" ? "#1B2430" : "#eee", color: modo === "entrar" ? "#fff" : "#333" }}>
          Entrar
        </button>
        <button onClick={() => setModo("cadastrar")} style={{ ...buttonStyle, flex: 1, background: modo === "cadastrar" ? "#1B2430" : "#eee", color: modo === "cadastrar" ? "#fff" : "#333" }}>
          Criar conta
        </button>
      </div>

      <form onSubmit={modo === "entrar" ? entrar : cadastrar}>
        {modo === "cadastrar" && (
          <Campo label="Nome completo">
            <input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} required />
          </Campo>
        )}
        <Campo label="E-mail">
          <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Campo>
        <Campo label="Senha">
          <input type="password" style={inputStyle} value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} />
        </Campo>
        {modo === "cadastrar" && (
          <Campo label="Cargo (só para teste do núcleo — depois isso vira controle do admin)">
            <select style={inputStyle} value={cargo} onChange={(e) => setCargo(e.target.value)}>
              <option value="aluno">Aluno</option>
              <option value="monitor">Aluno monitor</option>
              <option value="professor">Professor</option>
              <option value="admin">Administração</option>
            </select>
          </Campo>
        )}

        {mensagem && <p style={{ fontSize: 13, color: "#B23A48", marginBottom: 12 }}>{mensagem}</p>}

        <button type="submit" disabled={carregando} style={{ ...buttonStyle, width: "100%" }}>
          {carregando ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>
      </form>
    </div>
  );
}

function TelaPrincipal({ session, perfil }) {
  const [ambientes, setAmbientes] = useState([]);
  const [ambienteSelecionado, setAmbienteSelecionado] = useState(null);
  const [reservas, setReservas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState("");

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
      setMensagem(error.message);
    } else {
      setMensagem("Reserva criada.");
      setNovaReserva({ tipo: "grupo_estudos", finalidade: "", data: "", horaInicio: "", horaFim: "", qtdPessoas: 1 });
      carregarReservas(ambienteSelecionado);
    }
  }

  async function cancelarReserva(id) {
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

  if (carregando) return <p style={{ padding: 24, fontFamily: "sans-serif" }}>Carregando…</p>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "sans-serif", color: "#1B2430" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
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

      {mensagem && <p style={{ fontSize: 13, color: "#B23A48", marginBottom: 16 }}>{mensagem}</p>}

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

          {perfil?.cargo === "admin" && (
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
                    {(r.usuario_id === session.user.id || perfil?.cargo === "admin") && (
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
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCarregando(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, novaSessao) => {
      setSession(novaSessao);
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
  if (!session) return <TelaAutenticacao />;
  return <TelaPrincipal session={session} perfil={perfil} />;
}
