// coach.jsx — AI Coach powered by Groq API (no form tags)

const _ACT_LABEL = { corsa: "corsa", bike: "bike", hiit: "HIIT", camminata: "camminata", ellittica: "ellittica" };

const _QUICK_PROMPTS = [
  "Cosa mangio oggi?",
  "Posso aumentare il peso?",
  "Sostituisci esercizio",
  "Allenamento 45 min",
  "Riposo o cardio?",
  "Recupero ottimale",
];

function _buildSystemPrompt({ activities, checkIn, hydration, weekNum, bodyWeight }) {
  const sess = window.getTodaySession ? window.getTodaySession() : null;
  const sessLabel = sess ? `${sess.label} (${sess.muscles.join(", ")})` : "Riposo";

  let prompt = `Sei il personal coach di Lorenzo Faraoni: preciso, motivante, conoscenza profonda di allenamento powerbuilding (RPE, mesocicli, progressione) e nutrizione (bulk lento, manipolazione carbo, timing proteine). Rispondi in italiano, conciso (2-5 frasi max), tono diretto come un coach che lo conosce bene da anni.

Lorenzo: ${bodyWeight || 77.5}kg, 178cm, Settimana ${weekNum || 3} di 8 del mesociclo Upper/Lower 3×. Oggi: ${sessLabel}.
Piano: Upper A (Lun), Lower (Mer), Upper B (Ven). Cardio: camminata + ellittica nei giorni di riposo.
Dieta: bulk lento — ~2700 kcal allenamento, ~2400 riposo. Proteine: ~180g/die. Integratori: MGK pre-WO, Omnia intra, Barretta 45g (quando ore 17/21/22).
ESCLUDERE SEMPRE dalla dieta: pasta di ceci, lenticchie, piselli, bevanda di mandorla.`;

  if (checkIn) {
    const lvl = (v) => ["","pessimo","basso","medio","buono","ottimo"][Math.max(1, Math.min(5, v || 3))] || "medio";
    prompt += `\n\nCheck-in oggi: sonno ${lvl(checkIn.sleep)} (${checkIn.sleep}/5), energia ${lvl(checkIn.energy)} (${checkIn.energy}/5)${checkIn.ailments ? `, fastidi segnalati: "${checkIn.ailments}"` : ""}.`;
    if (checkIn.sleep <= 2 || checkIn.energy <= 2) {
      prompt += ` ⚠️ Recupero scarso — suggerisci RPE −1 o taglio ultima serie se rilevante.`;
    }
  }
  if (typeof hydration === "number") {
    const liters = (hydration * 0.25).toFixed(2);
    prompt += `\nIdratazione attuale: ${hydration}/12 (${liters}L su 3L target).`;
  }
  if (activities && activities.length > 0) {
    const recent = activities.slice(0, 5).map(a =>
      `• ${a.when}: ${_ACT_LABEL[a.type] || a.type} ${a.min}min${a.km ? " " + a.km + "km" : ""}${a.note ? " ("+a.note+")" : ""}`
    ).join("\n");
    prompt += `\n\nCardio recente:\n${recent}`;
  }

  // Session notes from today
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0,10);
  const sessionNotes = window.storage ? window.storage.get(`notes_${today}`, "") : "";
  if (sessionNotes) {
    prompt += `\n\nNote scheda di oggi: "${sessionNotes}"`;
  }

  return prompt;
}

// ── Avatar ─────────────────────────────────────────────────────────────────
const CoachAvatar = ({ small }) => (
  <div style={{
    width: small ? 26 : 32, height: small ? 26 : 32,
    borderRadius: 999, flexShrink: 0,
    background: "linear-gradient(135deg, #0A84FF 0%, #5e5ce6 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
  }}>
    <Icon name="spark" size={small ? 13 : 16} color="#fff" strokeWidth={2.2} />
  </div>
);

// ── Typing indicator ───────────────────────────────────────────────────────
const TypingDots = () => (
  <span style={{ display: "inline-flex", gap: 3, alignItems: "center", padding: "4px 2px" }}>
    {[0,1,2].map(i => (
      <span key={i} style={{
        width: 6, height: 6, borderRadius: 999, background: "var(--text-2)",
        animation: `coachBounce 1.2s infinite ${i * 0.15}s`,
      }} />
    ))}
    <style>{`@keyframes coachBounce { 0%,60%,100% { opacity:0.3; transform:translateY(0); } 30% { opacity:1; transform:translateY(-3px); } }`}</style>
  </span>
);

// ── Message bubble ─────────────────────────────────────────────────────────
const Bubble = ({ m }) => {
  if (m.role === "user") {
    return (
      <div className="fade-up" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <div style={{
          maxWidth: "78%", padding: "10px 14px",
          background: "var(--accent)", color: "#fff",
          borderRadius: 18, borderBottomRightRadius: 4,
          fontSize: 14, lineHeight: 1.45, fontWeight: 500, letterSpacing: -0.005,
        }}>{m.text}</div>
      </div>
    );
  }
  if (m.role === "error") {
    return (
      <div className="fade-up" style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 4 }}>
        <CoachAvatar small />
        <div style={{
          maxWidth: "78%", padding: "10px 14px",
          background: "rgba(255,69,58,0.12)", color: "var(--danger)",
          borderRadius: 18, borderBottomLeftRadius: 4,
          border: "1px solid rgba(255,69,58,0.2)",
          fontSize: 13.5, lineHeight: 1.45,
        }}>{m.text}</div>
      </div>
    );
  }
  return (
    <div className="fade-up" style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 4 }}>
      <CoachAvatar small />
      <div style={{
        maxWidth: "78%", padding: "10px 14px",
        background: "var(--card)", color: "var(--text)",
        borderRadius: 18, borderBottomLeftRadius: 4,
        border: "1px solid var(--border)",
        fontSize: 14, lineHeight: 1.5, letterSpacing: -0.003,
        whiteSpace: "pre-wrap",
      }}>{m.text}</div>
    </div>
  );
};

// ── Coach screen ───────────────────────────────────────────────────────────
const Coach = ({ device, activities = [], checkIn, hydration, weekNum, bodyWeight }) => {
  const isDesktop = device === "desktop";
  const t = useT();

  const sess = window.getTodaySession ? window.getTodaySession() : null;
  const greeting = sess
    ? `Ciao Lorenzo! Oggi tocca ${sess.label}. Sono pronto — chiedimi su scheda, dieta o recupero.`
    : "Ciao Lorenzo! Oggi è un giorno di riposo. Parliamo di recupero, nutrizione o programmazione?";

  const [messages, setMessages] = React.useState([{ role: "assistant", text: greeting }]);
  const [input, setInput]       = React.useState("");
  const [busy, setBusy]         = React.useState(false);
  const scrollRef               = React.useRef(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user", text: q }];
    setMessages(next);
    setInput("");
    setBusy(true);

    try {
      const history = next
        .filter(m => m.role === "user" || m.role === "assistant")
        .slice(-10)
        .map(m => ({ role: m.role, content: m.text }));

      const reply = await window.groqAPI.complete({
        messages: history,
        systemPrompt: _buildSystemPrompt({ activities, checkIn, hydration, weekNum, bodyWeight }),
        model: "llama-3.3-70b-versatile",
        maxTokens: 512,
      });

      setMessages(ms => [...ms, { role: "assistant", text: reply }]);
    } catch (err) {
      const errText = err.message || "Errore sconosciuto";
      const isNoKey = errText.toLowerCase().includes("api key") || errText.toLowerCase().includes("configurata");
      setMessages(ms => [...ms, {
        role: "error",
        text: isNoKey
          ? "⚙️ API key Groq non configurata. Vai in Impostazioni → Coach per inserirla. È gratuita su console.groq.com"
          : `⚠️ ${errText}`,
      }]);
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Header */}
      <div style={{
        padding: isDesktop ? "22px 40px 16px" : "14px 16px 10px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-2)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <CoachAvatar />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: isDesktop ? 18 : 16, fontWeight: 600, letterSpacing: -0.015 }}>
              {t("AI Coach")}
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {busy
                ? <><TypingDots /> {t("Sta scrivendo…")}</>
                : t("Groq · llama-3.3-70b-versatile")}
            </div>
          </div>
          {weekNum && (
            <span className="pill" style={{ fontSize: 11, background: "rgba(10,132,255,0.18)", color: "var(--accent)" }}>
              W{weekNum}
            </span>
          )}
          {bodyWeight && (
            <span className="pill num" style={{ fontSize: 11, background: "rgba(48,209,88,0.15)", color: "var(--success)" }}>
              {bodyWeight}kg
            </span>
          )}
        </div>

        {/* Quick prompts */}
        <div className="hscroll" style={{ marginLeft: 0, marginRight: 0, paddingLeft: 0, paddingRight: 0, marginTop: 12 }}>
          {_QUICK_PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => send(p)}
              disabled={busy}
              style={{
                display: "inline-flex", alignItems: "center",
                padding: "6px 12px", border: "1px solid var(--border)",
                background: "var(--card-2)", borderRadius: 999,
                fontSize: 12.5, fontWeight: 500,
                cursor: busy ? "default" : "pointer",
                whiteSpace: "nowrap", marginRight: 6,
                color: busy ? "var(--text-3)" : "var(--text)",
                opacity: busy ? 0.5 : 1,
                transition: "all 0.14s",
              }}
            >{t(p)}</button>
          ))}
        </div>
      </div>

      {/* Messages list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: "auto", padding: isDesktop ? "20px 40px" : "14px 16px",
          display: "flex", flexDirection: "column", gap: 2,
          scrollbarWidth: "none",
        }}
      >
        {messages.map((m, i) => <Bubble key={i} m={m} />)}
        {busy && (
          <div className="fade-up" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <CoachAvatar small />
            <div style={{
              padding: "10px 14px",
              background: "var(--card)", borderRadius: 18, borderBottomLeftRadius: 4,
              border: "1px solid var(--border)",
            }}>
              <TypingDots />
            </div>
          </div>
        )}
      </div>

      {/* Input bar — NO <form> tag */}
      <div style={{
        padding: isDesktop ? "12px 40px 24px" : "10px 16px 20px",
        display: "flex", gap: 8, alignItems: "center",
        borderTop: "1px solid var(--border)",
        background: "rgba(20,20,22,0.72)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        flexShrink: 0,
      }}>
        <div style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8,
          background: "var(--card)", borderRadius: 999, padding: "4px 6px 4px 18px",
          border: "1px solid var(--border)",
        }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("Chiedi al coach…")}
            disabled={busy}
            style={{
              flex: 1, background: "transparent", border: 0, outline: "none",
              color: "var(--text)", fontSize: 14, padding: "10px 0", fontFamily: "inherit",
            }}
          />
          <button
            disabled={busy || !input.trim()}
            onClick={() => send()}
            style={{
              width: 34, height: 34, borderRadius: 999,
              background: (input.trim() && !busy) ? "var(--accent)" : "var(--card-2)",
              color: "#fff", border: 0, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: (input.trim() && !busy) ? "pointer" : "default",
              transition: "background 0.16s",
            }}
          >
            <Icon name="send" size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
};

window.Coach = Coach;
