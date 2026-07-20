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

function _buildSystemPrompt({ activities, checkIn, bodyWeight, lang }) {
  const sess = window.getTodaySession ? window.getTodaySession() : null;
  const sessLabel = sess ? `${sess.label} (${sess.muscles.join(", ")})` : "Riposo";
  const _days = window.getSchedule ? (window.getSchedule().days || []) : [];
  const _dayCount = _days.length || 3;
  const _dayNames = _days.map(d => d.name).filter(Boolean).join(", ");

  // Ora del giorno e contesto temporale
  const now = new Date();
  const h = now.getHours();
  const timeOfDay = h < 6 ? "notte" : h < 12 ? "mattina" : h < 15 ? "pranzo" : h < 18 ? "pomeriggio" : h < 21 ? "sera" : "sera tardi";
  const timeStr = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  // File caricati dall'utente
  const st = window.storage;
  const schedaData = (st ? st.get("schedaData", null) : null) || window.SCHEDA_TXT_FALLBACK || null;
  const dietaData  = (st ? st.get("dietaData",  null) : null) || window.DIETA_TXT_FALLBACK  || null;

  // Check-in e note sessione di oggi
  const today = window.todayKey ? window.todayKey() : now.toISOString().slice(0, 10);
  const sessionNotes = st ? st.get(`notes_${today}`, "") : "";

  // ── Prompt base ────────────────────────────────────────────────────────────
  // Lingua di risposta del coach: segue la lingua dell'app
  const replyLang = lang === "en" ? "inglese" : "italiano";
  let prompt = `Sei il personal coach di Lorenzo Faraoni: preciso, motivante, esperto di powerbuilding (periodizzazione, progressione) e nutrizione (bulk lento, timing proteine, manipolazione carbo). Rispondi in ${replyLang}, conciso (2-5 frasi), tono diretto da coach che lo conosce bene da anni.

Lorenzo: ${bodyWeight || 77.5}kg, 178cm.
Oggi: ${dateStr} — ${sessLabel}.
Ora: ${timeStr} (${timeOfDay}).
Piano (${_dayCount} giorni, selezione manuale): ${_dayNames || "n/d"}. Cardio: camminata + ellittica nei giorni di riposo.
ESCLUDERE SEMPRE dalla dieta: pasta di ceci, lenticchie, piselli, bevanda di mandorla.`;

  // ── Check-in ───────────────────────────────────────────────────────────────
  if (checkIn) {
    const lvl = (v) => ["","pessimo","basso","medio","buono","ottimo"][Math.max(1, Math.min(5, v || 3))];
    prompt += `\n\nCheck-in oggi: sonno ${lvl(checkIn.sleep)} (${checkIn.sleep}/5), energia ${lvl(checkIn.energy)} (${checkIn.energy}/5)${checkIn.ailments ? `, fastidi: "${checkIn.ailments}"` : ""}.`;
    if (checkIn.sleep <= 2 || checkIn.energy <= 2) {
      prompt += ` ⚠️ Recupero scarso — suggerisci di ridurre l'intensità o tagliare l'ultima serie se rilevante.`;
    }
  }

  // ── Cardio recente ─────────────────────────────────────────────────────────
  if (activities && activities.length > 0) {
    const recent = activities.slice(0, 5).map(a =>
      `• ${a.when}: ${_ACT_LABEL[a.type] || a.type} ${a.min}min${a.km ? " " + a.km + "km" : ""}${a.note ? " (" + a.note + ")" : ""}`
    ).join("\n");
    prompt += `\n\nCardio recente:\n${recent}`;
  }

  // ── Note scheda oggi ───────────────────────────────────────────────────────
  if (sessionNotes) {
    prompt += `\n\nNote scheda di oggi: "${sessionNotes}"`;
  }

  // ── Performance reale: record personali + volume (dati loggati localmente) ──
  // Rende il coach data-driven: sa cosa Lorenzo ha davvero sollevato, non solo
  // il testo della scheda.
  const prMap = st ? st.get("prMap", {}) : {};
  const prKeys = Object.keys(prMap || {});
  if (prKeys.length) {
    const prList = prKeys.slice(0, 15).map(k => `${k} ${prMap[k].peso}kg`).join(", ");
    prompt += `\n\nRecord personali (massimale caricato per esercizio): ${prList}.`;
  }
  if (window.WorkoutProgress && st) {
    const dates = window.WorkoutProgress.lastNDates(today, 7);
    const hist = dates.map(d => ({ date: d, muscleSets: st.get(`muscleSets_${d}`, null) })).filter(h => h.muscleSets);
    const vol = window.WorkoutProgress.aggregateVolume(hist);
    if (vol.total > 0) {
      const parts = vol.order.map(g => `${g} ${vol.byGroup[g]}`).join(", ");
      prompt += `\nVolume ultimi 7 giorni (serie per gruppo): ${parts} (totale ${vol.total} serie).`;
    }
  }

  // ── Scheda allenamento (file caricato) ─────────────────────────────────────
  if (schedaData) {
    const txt = schedaData.length > 3000 ? schedaData.slice(0, 3000) + "\n[…troncato]" : schedaData;
    prompt += `\n\n=== SCHEDA ALLENAMENTO (file caricato) ===\n${txt}`;
  } else {
    // Fallback se il file non è stato caricato
    prompt += `\n\nScheda: nessun file caricato. Chiedi a Lorenzo di importare la sua scheda .txt dalle Impostazioni.`;
  }

  // ── Piano alimentare (file caricato) ──────────────────────────────────────
  if (dietaData) {
    const txt = dietaData.length > 3000 ? dietaData.slice(0, 3000) + "\n[…troncato]" : dietaData;
    prompt += `\n\n=== PIANO ALIMENTARE (file caricato — usa questi dati come riferimento primario) ===\n${txt}`;
  } else {
    // Fallback se il file non è stato caricato
    prompt += `\n\nDieta: bulk lento. Proteine: ~180g/die.`;
    prompt += `\nIntegratori: MGK pre-WO, Omnia intra/post, Barretta 4Plus 45g (snack ore 17/21/22).`;
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
          background: "var(--brand-grad)", color: "#fff",
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
const Coach = ({ device, onNav, activities = [], checkIn, bodyWeight }) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const { lang } = useLang();

  const sess = window.getTodaySession ? window.getTodaySession() : null;
  const greeting = sess
    ? `${t("Ciao Lorenzo! Oggi tocca")} ${sess.label}. ${t("Sono pronto — chiedimi su scheda, dieta o recupero.")}`
    : t("Ciao Lorenzo! Oggi è un giorno di riposo. Parliamo di recupero, nutrizione o programmazione?");

  // Chat persistita per giornata: navigare in un'altra tab non la cancella più
  const chatKey = `coachChat_${window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10)}`;
  const [messages, setMessages] = React.useState(() => {
    const saved = window.storage ? window.storage.get(chatKey, null) : null;
    return Array.isArray(saved) && saved.length ? saved : [{ role: "assistant", text: greeting }];
  });
  const [input, setInput]       = React.useState("");
  const [busy, setBusy]         = React.useState(false);
  const scrollRef               = React.useRef(null);

  React.useEffect(() => {
    if (window.storage && messages.length > 1) window.storage.set(chatKey, messages.slice(-40));
  }, [messages]);

  const resetChat = () => {
    if (window.storage) window.storage.remove(chatKey);
    setMessages([{ role: "assistant", text: greeting }]);
  };

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
        systemPrompt: _buildSystemPrompt({ activities, checkIn, bodyWeight, lang }),
        model: "llama-3.3-70b-versatile",
        maxTokens: 512,
      });

      setMessages(ms => [...ms, { role: "assistant", text: reply }]);
    } catch (err) {
      const errText = err.message || t("Errore sconosciuto");
      const isNoKey = errText.toLowerCase().includes("api key") || errText.toLowerCase().includes("configurata");
      setMessages(ms => [...ms, {
        role: "error",
        text: isNoKey
          ? "⚙️ " + t("API key Groq non configurata. Vai in Impostazioni → Coach per inserirla. È gratuita su console.groq.com")
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

  // API key presente? (letta una volta al mount; il cambio tab rimonta Coach → si aggiorna)
  const hasKey = React.useMemo(
    () => !!(window.storage && (window.storage.get("groqApiKey", "") || "").trim()),
    []
  );

  // Chip di contesto reali (sessione · peso · check-in), derivate dai dati veri
  const ctxChips = [{ emoji: sess ? "🏋️" : "🛌", label: sess ? `${t("Oggi")} · ${sess.label}` : t("Riposo") }];
  if (bodyWeight) ctxChips.push({ emoji: "⚖️", label: `${bodyWeight} kg` });
  if (checkIn)    ctxChips.push({ emoji: "✅", label: t("Check-in ok") });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Header compatto: avatar · titolo · stato · Nuova chat */}
      <div style={{
        padding: isDesktop ? "20px 40px 12px" : "12px 16px 10px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-2)",
        flexShrink: 0, display: "flex", flexDirection: "column", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <CoachAvatar />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: isDesktop ? 19 : 17, fontWeight: 600, letterSpacing: -0.015 }}>
              {t("AI Coach")}
            </div>
            <div style={{ fontSize: 11.5, minHeight: 14, display: "flex", alignItems: "center", gap: 6, color: busy ? "var(--accent)" : "var(--text-2)" }}>
              {busy
                ? <><TypingDots /> {t("Sta scrivendo…")}</>
                : (hasKey ? t("Pronto ad aiutarti") : t("Non configurato"))}
            </div>
          </div>
          {messages.length > 1 && (
            <button
              onClick={resetChat}
              title={t("Nuova chat")}
              disabled={busy}
              style={{
                display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)",
                borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 600,
                cursor: busy ? "default" : "pointer",
              }}
            >
              <Icon name="plus" size={13} strokeWidth={2.2} />
              {t("Nuova chat")}
            </button>
          )}
        </div>

        {/* Chip di contesto */}
        <div className="hscroll" style={{ display: "flex", gap: 7 }}>
          {ctxChips.map((c, i) => (
            <span key={i} style={{
              flex: "none", display: "inline-flex", alignItems: "center", gap: 5,
              background: "var(--card-2)", border: "1px solid var(--border)", borderRadius: 999,
              padding: "6px 11px", fontSize: 11.5, fontWeight: 500, color: "var(--text-2)", whiteSpace: "nowrap",
            }}><span>{c.emoji}</span>{c.label}</span>
          ))}
        </div>
      </div>

      {hasKey ? (
        <>
          {/* Lista messaggi */}
          <div
            ref={scrollRef}
            style={{
              flex: 1, overflowY: "auto", padding: isDesktop ? "18px 40px" : "14px 16px",
              display: "flex", flexDirection: "column", gap: 2, scrollbarWidth: "none",
            }}
          >
            <div style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--text-3)", margin: "2px 0 8px" }}>{t("Oggi")}</div>
            {messages.map((m, i) => <Bubble key={i} m={m} />)}
            {busy && (
              <div className="fade-up" style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 4 }}>
                <CoachAvatar small />
                <div style={{
                  maxWidth: "78%", padding: "10px 14px",
                  background: "var(--card)", borderRadius: 18, borderBottomLeftRadius: 4,
                  border: "1px solid var(--border)",
                }}>
                  <UISkeleton h={11} w={180} style={{ marginBottom: 7 }} />
                  <UISkeleton h={11} w={120} />
                </div>
              </div>
            )}
          </div>

          {/* Suggerimenti + input — NO <form> tag */}
          <div style={{
            padding: isDesktop ? "10px 40px 24px" : "8px 16px 20px",
            display: "flex", flexDirection: "column", gap: 9,
            borderTop: "1px solid var(--glass-border)",
            backgroundColor: "var(--glass)",
            backgroundImage: "var(--glass-sheen)",
            backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-sat))",
            WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-sat))",
            boxShadow: "inset 0 1px 0 var(--glass-edge)",
            flexShrink: 0,
          }}>
            <div className="hscroll" style={{ display: "flex", gap: 7 }}>
              {_QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  disabled={busy}
                  style={{
                    flex: "none", background: "rgba(10,132,255,0.14)", border: "1px solid var(--border)",
                    borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 500,
                    color: "var(--accent)", whiteSpace: "nowrap",
                    cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1,
                  }}
                >{t(p)}</button>
              ))}
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
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
                  width: 38, height: 38, borderRadius: 999,
                  background: (input.trim() && !busy) ? "var(--brand-grad)" : "var(--card-2)",
                  color: "#fff", border: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: (input.trim() && !busy) ? "pointer" : "default",
                  transition: "background 0.16s",
                }}
              >
                <Icon name="send" size={16} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </>
      ) : (
        /* Empty state — nessuna API key: CTA diretta al profilo */
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 16, padding: "40px 34px", textAlign: "center",
        }}>
          <div style={{
            width: 66, height: 66, borderRadius: 20,
            background: "var(--card)", border: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "center", color: "var(--warning)",
          }}>
            <Icon name="key" size={28} strokeWidth={1.8} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{t("Coach non configurato")}</div>
          <div className="muted" style={{ fontSize: 13.5, maxWidth: 250, lineHeight: 1.5 }}>
            {t("Serve una API key per parlare con l'allenatore AI. Configurala nel profilo per iniziare.")}
          </div>
          <button
            onClick={() => onNav && onNav("impostazioni")}
            style={{
              border: "none", borderRadius: "var(--r)", background: "var(--brand-grad)", color: "#fff",
              fontSize: 16, fontWeight: 600, padding: "14px 22px", cursor: "pointer",
              boxShadow: "0 12px 28px -12px rgba(10,132,255,0.7)",
            }}
          >{t("Configura in Profilo")}</button>
        </div>
      )}
    </div>
  );
};

window.Coach = Coach;
