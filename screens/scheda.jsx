// scheda.jsx — Workout tracker: sets, timer, vibration, Sheets sync

// Lista ordinata dei giorni: sempre da getSchedule() (che ha il fallback
// testuale embedded in defaults.jsx quando storage è vuoto).
function _buildSchedule() {
  const sched = window.getSchedule ? window.getSchedule() : { days: [] };
  const days = (sched && sched.days) || [];
  return days.map(d => ({
    ...d,
    exercises: (d.exercises || []).map(ex => ({ ...ex, history: ex.history || [] })),
  }));
}

// Chiave giorno per la persistenza dei progressi (schedaProg_<date>).
function _todayK() {
  return window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
}

// ── Timer overlay ──────────────────────────────────────────────────────────
const TimerOverlay = ({ seconds, onClose }) => {
  const t = useT();
  // Conto alla rovescia basato su timestamp (non su decrementi): se iOS
  // sospende il tab / blocchi lo schermo, al ritorno il timer è comunque giusto.
  const endRef = React.useRef(Date.now() + seconds * 1000);
  const [remaining, setRemaining] = React.useState(seconds);
  const beeped = React.useRef(false);

  React.useEffect(() => {
    const tick = () => {
      const r = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0 && !beeped.current) {
        beeped.current = true;
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        if (window.playBeep) {
          window.playBeep(880, 0.18);
          setTimeout(() => window.playBeep(880, 0.18), 220);
          setTimeout(() => window.playBeep(1100, 0.28), 440);
        }
      }
    };
    const tid = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(tid); document.removeEventListener("visibilitychange", tick); };
  }, []);

  // Wake Lock: tiene lo schermo acceso durante il recupero (iOS ≥16.4);
  // senza, lo schermo si spegne e il beep di fine recupero non parte.
  React.useEffect(() => {
    let lock = null;
    let released = false;
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request("screen")
        .then(l => { if (released) l.release().catch(() => {}); else lock = l; })
        .catch(() => {});
    }
    return () => { released = true; if (lock) lock.release().catch(() => {}); };
  }, []);

  const adjust = (d) => {
    endRef.current = Math.max(Date.now(), endRef.current + d * 1000);
    if (d > 0) beeped.current = false;
    setRemaining(Math.max(0, Math.round((endRef.current - Date.now()) / 1000)));
  };

  const total = seconds;
  const R = 86;
  const C = 2 * Math.PI * R;
  const dashOffset = C - C * Math.min(1, Math.max(0, remaining) / total);
  const done = remaining === 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(10,10,10,0.88)",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        zIndex: 9999,
        animation: "fadeUp 0.18s ease",
      }}
      onClick={onClose}
    >
      <div className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 24, color: "#8e8e9a" }}>{t("Recupero")}</div>
      <div style={{ position: "relative", width: 220, height: 220 }}>
        <div className="timer-pulse" style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: done
            ? "radial-gradient(circle, rgba(48,209,88,0.4), transparent 70%)"
            : "radial-gradient(circle, rgba(10,132,255,0.4), transparent 70%)",
        }} />
        <svg viewBox="0 0 200 200" width="220" height="220" style={{ position: "relative", transform: "rotate(-90deg)" }}>
          <defs>
            <linearGradient id="timerGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#0A84FF" />
              <stop offset="1" stopColor="#5E5CE6" />
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r={R} stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
          <circle cx="100" cy="100" r={R} stroke={done ? "var(--success)" : "url(#timerGrad)"} strokeWidth="8" fill="none"
            strokeDasharray={C} strokeDashoffset={dashOffset} strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s linear" }} />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <div className="num" style={{ fontSize: 56, fontWeight: 600, letterSpacing: -0.04, color: "#f2f2f7" }}>
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
          </div>
          <div className="muted tnum" style={{ fontSize: 12, fontWeight: 500, color: "#8e8e9a" }}>
            {t("di")} {Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
        <button className="btn" onClick={(e) => { e.stopPropagation(); adjust(-15); }}>−15s</button>
        <button className="btn" onClick={(e) => { e.stopPropagation(); adjust(15); }}>+15s</button>
        <button className="btn primary" onClick={(e) => { e.stopPropagation(); onClose(); }}>
          {done ? t("Riprendi") : t("Salta")}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 16, color: "#8e8e9a" }}>{t("Tocca ovunque per chiudere")}</div>
    </div>
  );
};

// ── Set row ────────────────────────────────────────────────────────────────
const SetRow = ({ s, idx, completed, onToggle, peso, onPesoChange, isPR }) => {
  const t = useT();
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "26px 1.4fr 0.8fr 36px",
      gap: 10, alignItems: "center",
      padding: "8px 4px",
      borderTop: "1px solid var(--border)",
      transition: "background 0.16s",
      background: completed ? "rgba(48,209,88,0.04)" : "transparent",
    }}>
      <div className="num muted" style={{ fontSize: 13, textAlign: "center", fontWeight: 600 }}>{idx + 1}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
        <input
          type="text"
          value={peso}
          onChange={(e) => onPesoChange(e.target.value)}
          placeholder={t("kg o elastico")}
          className="input"
          style={{
            padding: "6px 8px", fontSize: 14, fontWeight: 600, textAlign: "left", borderRadius: 7, width: "100%",
            borderColor: isPR ? "#FF9F0A" : "var(--border)",
            boxShadow: isPR ? "0 0 0 1px #FF9F0A" : "none",
            color: isPR ? "#FF9F0A" : "var(--text)",
          }}
        />
        {isPR && (
          <span className="pop-in" style={{
            position: "absolute", top: -6, right: 22,
            fontSize: 9, fontWeight: 700, color: "#FF9F0A",
            background: "rgba(255,159,10,0.15)", padding: "1px 5px", borderRadius: 4,
            letterSpacing: 0.5, pointerEvents: "none",
          }}>⚡ PR</span>
        )}
      </div>
      <div className="num" style={{ fontSize: 14, fontWeight: 600, textAlign: "center" }}>{s.rip}</div>
      <button
        onClick={(ev) => {
          if (!completed && window.Motion) window.Motion.pop(ev.currentTarget);
          onToggle();
        }}
        className={`check ${completed ? "on" : ""}`}
        style={{ width: 26, height: 26, justifySelf: "center" }}
      >
        <Icon name="check" size={13} color="#062810" />
      </button>
    </div>
  );
};

// ── History popover ────────────────────────────────────────────────────────
const HistoryPopover = ({ history, onClose }) => {
  const t = useT();
  if (!history || !history.length) return (
    <div className="fade-up" style={{ padding: 12, marginBottom: 10, background: "var(--card-2)", borderRadius: 12, border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="muted" style={{ fontSize: 12 }}>{t("Nessuno storico disponibile")}</div>
        <button onClick={onClose} style={{ background: "transparent", border: 0, color: "var(--text-2)", cursor: "pointer", padding: 0, display: "flex" }}><Icon name="x" size={13} /></button>
      </div>
    </div>
  );
  return (
    <div className="fade-up" style={{ padding: 10, marginBottom: 10, background: "var(--card-2)", borderRadius: 12, border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Storico · ultime 3")}</div>
        <button onClick={onClose} style={{ background: "transparent", border: 0, color: "var(--text-2)", cursor: "pointer", padding: 0, display: "flex" }}><Icon name="x" size={13} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr", gap: 8, alignItems: "center", fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", fontWeight: 600, letterSpacing: 0.4, padding: "0 2px 6px", borderBottom: "1px solid var(--border)" }}>
        <div>{t("Quando")}</div>
        <div style={{ textAlign: "right" }}>{t("Peso")}</div>
        <div style={{ textAlign: "center" }}>{t("Rip")}</div>
      </div>
      {history.slice(0, 3).map((h, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr", gap: 8, alignItems: "center", padding: "7px 2px", borderTop: i > 0 ? "1px solid var(--border)" : 0 }}>
          <div style={{ fontSize: 12, color: i === 0 ? "var(--text)" : "var(--text-2)", fontWeight: i === 0 ? 600 : 500 }}>{h.when || h.date}</div>
          <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: "right" }}>{h.peso} <span style={{ color: "var(--text-3)", fontSize: 10, fontWeight: 500 }}>kg</span></div>
          <div className="num" style={{ fontSize: 12, textAlign: "center", color: "var(--text-2)" }}>{h.rip}</div>
        </div>
      ))}
    </div>
  );
};

// ── Substitute popover ─────────────────────────────────────────────────────
const SubstitutePopover = ({ alternatives, current, original, onPick, onClose }) => {
  const t = useT();
  const allAlts = alternatives || [];
  return (
    <div className="fade-up" style={{ padding: 10, marginBottom: 10, background: "var(--card-2)", borderRadius: 12, border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Sostituisci con")}</div>
        <button onClick={onClose} style={{ background: "transparent", border: 0, color: "var(--text-2)", cursor: "pointer", padding: 0, display: "flex" }}><Icon name="x" size={13} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {current && (
          <button onClick={() => onPick(null)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: 0, background: "transparent", borderRadius: 8, fontSize: 13, color: "var(--text-2)", cursor: "pointer", textAlign: "left" }}>
            <Icon name="refresh" size={12} /> {t("Ripristina originale")}
          </button>
        )}
        {allAlts.length === 0 && <div className="muted" style={{ fontSize: 13, padding: "6px 10px" }}>{t("Nessuna alternativa disponibile")}</div>}
        {allAlts.map(alt => {
          const on = current === alt;
          return (
            <button key={alt} onClick={() => onPick(alt)} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 10px", border: 0,
              background: on ? "rgba(10,132,255,0.18)" : "transparent",
              borderRadius: 8, fontSize: 13,
              color: on ? "var(--accent)" : "var(--text)",
              fontWeight: on ? 600 : 500,
              cursor: "pointer", textAlign: "left", transition: "background 0.14s",
            }}>
              <span>{t(alt)}</span>
              {on && <Icon name="check" size={12} color="var(--accent)" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Confetti burst ─────────────────────────────────────────────────────────
const Confetti = () => {
  const colors = ["#0A84FF", "#5E5CE6", "#5AC8FA", "#30D158"];
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 50 }}>
      {Array.from({ length: 32 }).map((_, i) => (
        <span key={i} className="confetti" style={{
          background: colors[i % colors.length],
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 0.3}s`,
          animationDuration: `${1.4 + Math.random() * 0.6}s`,
          ["--cx"]: `${(Math.random() - 0.5) * 360}px`,
          borderRadius: Math.random() > 0.5 ? "50%" : "2px",
        }} />
      ))}
    </div>
  );
};

// ── Exercise card ──────────────────────────────────────────────────────────
const ExerciseCard = ({
  ex, completed, onToggleSet, onRest,
  occupied, onOccupied, isDesktop,
  substituted, onSubstitute,
  sheetsWeights, savedPesos, onPesosChange,
}) => {
  const t = useT();
  const [pesos, setPesos] = React.useState(() => {
    // 1) pesi già digitati oggi (ripristino sessione) → 2) Sheets → 3) default scheda
    if (savedPesos && savedPesos.length === ex.sets.length) return savedPesos.slice();
    return ex.sets.map((s, i) => {
      const key = ex.name.toLowerCase();
      if (sheetsWeights && sheetsWeights[key] && sheetsWeights[key][i] != null) {
        return String(sheetsWeights[key][i]);
      }
      return String(s.peso || "");
    });
  });
  const [showHistory, setShowHistory] = React.useState(false);
  const [showSubs, setShowSubs]       = React.useState(false);

  // Update pesos when sheetsWeights arrives
  React.useEffect(() => {
    // i pesi digitati/ripristinati di oggi vincono sui dati Sheets
    if (savedPesos && savedPesos.length === ex.sets.length) return;
    const key = ex.name.toLowerCase();
    if (sheetsWeights && sheetsWeights[key]) {
      const updated = ex.sets.map((s, i) => {
        const w = sheetsWeights[key][i];
        return w != null ? String(w) : String(s.peso || "");
      });
      setPesos(updated);
      if (onPesosChange) onPesosChange(updated);
    }
  }, [sheetsWeights]);

  // Notifica il parent quando i pesos cambiano (per il salvataggio su Sheets)
  const handlePesoChange = (i, v) => {
    setPesos(p => {
      const n = [...p]; n[i] = v;
      if (onPesosChange) onPesosChange(n);
      return n;
    });
  };

  const bestEver = React.useMemo(() => {
    if (!ex.history || !ex.history.length) return 0;
    return Math.max(...ex.history.map(h => Number(h.peso) || 0));
  }, [ex.history]);

  // Bordo-sinistro colorato per stato (come nel mockup): fatto / in corso / da fare
  const doneCount = completed.filter(Boolean).length;
  const edge = doneCount > 0 && doneCount === ex.sets.length
    ? "var(--success)"
    : doneCount > 0 ? "var(--accent)" : "var(--border)";

  return (
    <div className="card lift" style={{
      padding: isDesktop ? 22 : 16,
      opacity: occupied ? 0.55 : 1,
      transition: "opacity 0.2s",
      position: "relative",
      borderLeft: `3px solid ${edge}`,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={() => setShowHistory(s => !s)}
            style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 6, marginBottom: 6, color: "var(--text)" }}
          >
            <h3 style={{ fontSize: isDesktop ? 17 : 15.5, fontWeight: 600, letterSpacing: -0.015, lineHeight: 1.25 }}>
              {substituted ? t(substituted) : t(ex.name)}
            </h3>
            <Icon name="clock" size={12} color="var(--text-3)" />
          </button>
          {substituted && (
            <div className="muted" style={{ fontSize: 10.5, marginBottom: 4, textDecoration: "line-through" }}>{t(ex.name)}</div>
          )}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {ex.muscles.map(m => (
              <span key={m} className="pill" style={{ fontSize: 11, padding: "3px 8px" }}>{t(m)}</span>
            ))}
            {ex.ripRange && (
              <span className="pill" style={{ fontSize: 10.5, padding: "3px 8px", color: "var(--text-3)" }}>{ex.ripRange} rip</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            className="btn ghost"
            title={t("Sostituisci")}
            style={{ padding: "6px 8px", background: showSubs ? "rgba(10,132,255,0.18)" : "var(--card-2)", color: showSubs ? "var(--accent)" : "var(--text-2)" }}
            onClick={() => setShowSubs(s => !s)}
          >
            <Icon name="refresh" size={13} />
          </button>
          <button
            className="btn ghost"
            title={occupied ? t("Macchina libera — clicca per sbloccare") : t("Macchina occupata — clicca per segnalare")}
            style={{
              padding: "6px 8px",
              background: occupied ? "rgba(255,159,10,0.22)" : "var(--card-2)",
              color: occupied ? "#FF9F0A" : "var(--text-2)",
              boxShadow: occupied ? "inset 0 0 0 1.5px #FF9F0A" : "none",
              fontSize: 12, fontWeight: 600,
            }}
            onClick={onOccupied}
          >
            {occupied ? "🔴 Occ." : "🟢"}
          </button>
        </div>
      </div>

      {showHistory && (
        <HistoryPopover history={ex.history} onClose={() => setShowHistory(false)} />
      )}
      {showSubs && (
        <SubstitutePopover
          alternatives={ex.alternatives}
          current={substituted}
          original={ex.name}
          onPick={(name) => { onSubstitute(name); setShowSubs(false); }}
          onClose={() => setShowSubs(false)}
        />
      )}

      {/* Column headers */}
      <div style={{
        display: "grid", gridTemplateColumns: "26px 1.4fr 0.8fr 36px",
        gap: 10, alignItems: "center",
        padding: "8px 4px 4px",
        fontSize: 10, letterSpacing: 0.6, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase",
      }}>
        <div style={{ textAlign: "center" }}>{t("Set")}</div>
        <div style={{ textAlign: "right", paddingRight: 18 }}>{t("Peso")}</div>
        <div style={{ textAlign: "center" }}>{t("Rip")}</div>
        <div />
      </div>

      {ex.sets.map((s, i) => {
        const cur = parseFloat(pesos[i]);
        const isPR = !!cur && bestEver > 0 && cur > bestEver;
        return (
          <SetRow
            key={i}
            s={s}
            idx={i}
            completed={completed[i]}
            onToggle={() => onToggleSet(i)}
            peso={pesos[i]}
            onPesoChange={(v) => handlePesoChange(i, v)}
            isPR={isPR}
          />
        );
      })}

      {/* Rest + progress footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <button
          className="btn tnum"
          style={{ padding: "7px 14px", fontSize: 13, background: "rgba(10,132,255,0.14)", borderColor: "transparent", color: "var(--accent)" }}
          onClick={() => onRest(ex.rest)}
        >
          <Icon name="clock" size={13} /> {ex.rest}s
        </button>
        <span className="muted tnum" style={{ fontSize: 12 }}>
          <span className="num" style={{ color: "var(--text)", fontWeight: 600 }}>{completed.filter(Boolean).length}</span>
          {" "}/{ex.sets.length}{" "}{t("serie")}
        </span>
      </div>

      {/* Occupied banner */}
      {occupied && (
        <div style={{
          marginTop: 10, padding: "8px 12px", borderRadius: 10,
          background: "rgba(255,159,10,0.12)", border: "1px solid rgba(255,159,10,0.3)",
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 13, fontWeight: 500, color: "#FF9F0A",
        }}>
          <span>🔴</span>
          <span>{t("Macchina occupata — attendi o sostituisci con ↻")}</span>
        </div>
      )}
    </div>
  );
};

// ── Workout Player (vista a schermo intero, un esercizio alla volta) ────────
const WorkoutPlayer = ({
  dayKey, dayName, exercises, cursor, setCursor,
  completion, substitutions, pesosRef, sheetsWeights, prMap,
  autoRest, setAutoRest, onPatch, onClose, onFinish,
}) => {
  const t = useT();
  const [showSubs, setShowSubs] = React.useState(false);
  const [restSecs, setRestSecs] = React.useState(null);

  const ex = exercises[cursor];
  if (!ex || !ex.sets || !ex.sets.length) return null;
  const id = window.exId(dayKey, cursor);
  const done = completion[id] || new Array(ex.sets.length).fill(false);
  // Serie corrente = prima non completata (o l'ultima se tutte fatte).
  const rawIdx = done.findIndex(x => !x);
  const curSet = rawIdx === -1 ? Math.max(0, ex.sets.length - 1) : rawIdx;
  const allSetsDone = done.length > 0 && done.every(Boolean);

  // Peso della serie corrente: pesi digitati oggi → Sheets → default scheda.
  const savedP = pesosRef.current[id];
  const pesoVal = (savedP && savedP[curSet] != null)
    ? savedP[curSet]
    : (() => {
        const k = ex ? ex.name.toLowerCase() : "";
        if (sheetsWeights && sheetsWeights[k] && sheetsWeights[k][curSet] != null) return String(sheetsWeights[k][curSet]);
        return String(ex && ex.sets[curSet] ? ex.sets[curSet].peso || "" : "");
      })();

  const setPeso = (v) => {
    const arr = (pesosRef.current[id] || ex.sets.map(s => String(s.peso || ""))).slice();
    arr[curSet] = v;
    pesosRef.current[id] = arr;
    onPatch({ pesos: { [id]: arr } });
  };

  const advance = () => {
    if (cursor < exercises.length - 1) setCursor(cursor + 1);
    else onFinish(); // ultimo esercizio → schermata chiusura
  };

  const serieFatta = () => {
    if (navigator.vibrate) navigator.vibrate([100]);
    const arr = [...done];
    arr[curSet] = true;
    onPatch({ completion: { [id]: arr } });
    const nowAllDone = arr.every(Boolean);
    if (autoRest && !nowAllDone) setRestSecs(ex.rest || 90);
    else if (nowAllDone) setTimeout(advance, 250);
  };

  const label = substitutions[id] ? t(substitutions[id]) : t(ex.name);
  const next = exercises[cursor + 1];

  // ── Progressione + PR (coach silenzioso) ──────────────────────────────────
  const exName = substitutions[id] || ex.name;
  const WP = window.WorkoutProgress;
  // Ultimo peso reale della serie: pesi Sheets (getUltimiPesi) → history esercizio.
  const lastRaw = (() => {
    const k = (exName || "").toLowerCase(), ko = (ex.name || "").toLowerCase();
    const row = sheetsWeights && (sheetsWeights[k] || sheetsWeights[ko]);
    if (row && row[curSet] != null) return String(row[curSet]);
    if (ex.history && ex.history.length) return String(ex.history[0].peso);
    return null;
  })();
  const sug     = WP ? WP.suggestNext(lastRaw) : null;
  const prBest  = WP ? WP.bestFor(prMap || {}, exName) : null;
  const curNum  = WP ? WP.parseWeight(pesoVal) : null;
  const isPR    = prBest != null && curNum != null && curNum > prBest;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9990,
      background: "var(--bg)", display: "flex", flexDirection: "column",
      padding: "max(env(safe-area-inset-top), 20px) 20px calc(env(safe-area-inset-bottom) + 20px)",
    }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <button className="btn ghost" style={{ padding: "8px 10px" }} title={t("Esci dal player")} onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
        <div className="muted tnum" style={{ fontSize: 12, fontWeight: 600 }}>{dayName} · {cursor + 1}/{exercises.length}</div>
        <button className="btn ghost" style={{ padding: "8px 10px", background: showSubs ? "rgba(10,132,255,0.18)" : "var(--card-2)" }} onClick={() => setShowSubs(s => !s)}>
          <Icon name="refresh" size={16} />
        </button>
      </div>

      {showSubs && (
        <SubstitutePopover
          alternatives={ex.alternatives}
          current={substitutions[id]}
          original={ex.name}
          onPick={(name) => { onPatch({ substitutions: { [id]: name } }); setShowSubs(false); }}
          onClose={() => setShowSubs(false)}
        />
      )}

      {/* Centro: esercizio corrente */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: 10 }}>
        <div className="muted tnum" style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>
          {t("Serie {n} di {m}").replace("{n}", curSet + 1).replace("{m}", ex.sets.length)}
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.02, maxWidth: 340 }}>{label}</h2>
        {substitutions[id] && <div className="muted" style={{ fontSize: 12, textDecoration: "line-through", marginTop: -4 }}>{t(ex.name)}</div>}

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
          <input
            type="text" value={pesoVal} onChange={(e) => setPeso(e.target.value)}
            placeholder={t("kg o elastico")} className="input num"
            style={{ width: 150, textAlign: "center", fontSize: 40, fontWeight: 700, padding: "8px 10px", borderRadius: 14 }}
          />
          <span className="num" style={{ fontSize: 22, fontWeight: 600, color: "var(--text-2)" }}>× {ex.sets[curSet].rip}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, marginTop: 4 }}>
          <div className="muted tnum" style={{ fontSize: 12.5 }}>
            {lastRaw != null ? `${t("L'ultima volta")}: ${lastRaw} kg` : t("Nessuno storico")}
            {prBest != null ? ` · ${t("record")} ${prBest} kg` : ""}
          </div>
          {isPR ? (
            <span className="tnum" style={{
              fontSize: 12.5, fontWeight: 700, color: "var(--success)",
              background: "rgba(48,209,88,0.15)", borderRadius: 999, padding: "5px 12px",
            }}>🏆 {t("Nuovo record!")}</span>
          ) : sug ? (
            <button
              onClick={() => setPeso(String(sug.next))}
              className="pressable tnum"
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 12.5, fontWeight: 600, color: "var(--accent)",
                background: "rgba(10,132,255,0.14)", border: "1px solid var(--border)",
                borderRadius: 999, padding: "6px 12px", cursor: "pointer",
              }}
              title={t("Progressione: tocca per applicare")}
            >↑ {t("prova")} {sug.next} kg</button>
          ) : null}
        </div>

        {/* Puntini serie */}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {done.map((d, i) => (
            <span key={i} style={{
              width: 9, height: 9, borderRadius: "50%",
              background: d ? "var(--success)" : (i === curSet ? "var(--accent)" : "var(--track)"),
            }} />
          ))}
        </div>
      </div>

      {/* Peek prossimo */}
      {next && (
        <div className="muted" style={{ fontSize: 12.5, textAlign: "center", marginBottom: 10 }}>
          {t("Dopo")}: {substitutions[window.exId(dayKey, cursor + 1)] ? t(substitutions[window.exId(dayKey, cursor + 1)]) : t(next.name)}
        </div>
      )}

      {/* Azioni */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button className="btn primary" style={{ width: "100%", padding: 16, fontSize: 16, fontWeight: 600 }} onClick={(ev) => {
          if (window.Motion) window.Motion.pop(ev.currentTarget);
          serieFatta();
        }}>
          <Icon name="check" size={17} color="#fff" /> {allSetsDone ? t("Dopo") : t("Serie fatta")}
        </button>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12.5, color: "var(--text-2)" }}>
          <input type="checkbox" checked={autoRest} onChange={(e) => setAutoRest(e.target.checked)} />
          {t("Auto-recupero")} ({ex.rest || 90}s)
        </label>
      </div>

      {restSecs != null && (
        <TimerOverlay seconds={restSecs} onClose={() => setRestSecs(null)} />
      )}
    </div>
  );
};

// ── Main Scheda screen ─────────────────────────────────────────────────────
const Scheda = ({ device, scheda, setScheda, checkIn }) => {
  const isDesktop = device === "desktop";
  const t = useT();

  const [days]  = React.useState(() => _buildSchedule());
  const current = days.find(d => d.key === scheda) || days[0] || { key: "", num: 0, name: "", focus: [], exercises: [] };

  // Blocco progressi di giornata (piatto, keyed-by-id, valido per TUTTI i giorni).
  const [prog, setProg] = React.useState(() => window.readSchedaProg(window.storage, _todayK()));
  const completion    = prog.completion;      // { "Day#pos": [bool,…] }
  const substitutions = prog.substitutions;   // { "Day#pos": "nome alt" }
  const [timer, setTimer]   = React.useState(null);
  const [occupied, setOccupied] = React.useState({}); // effimero, keyed-by-id
  const [showConfetti, setShowConfetti] = React.useState(false);
  const [notes, setNotes]   = React.useState(() => window.storage ? window.storage.get(`notes_${_todayK()}`, "") : "");
  const [sheetsWeights, setSheetsWeights] = React.useState(null);
  // Record personali (PR) per esercizio: { nome: { peso, date } } — persistiti,
  // aggiornati alla chiusura sessione; il Player li usa per il badge "record".
  const [prMap, setPrMap] = React.useState(() => window.storage ? window.storage.get("prMap", {}) : {});
  const [newPRs, setNewPRs] = React.useState([]); // PR appena battuti → celebrazione
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState("");
  const prevDoneRef = React.useRef(null); // null = da inizializzare al primo render
  // Ref pesi condiviso per il salvataggio Sheets, keyed-by-id.
  const pesosRef = React.useRef(null);
  if (pesosRef.current === null) pesosRef.current = Object.assign({}, prog.pesos);

  const [mode, setMode] = React.useState("list");   // "list" | "player"
  const [cursor, setCursor] = React.useState(0);      // indice esercizio nel player
  const [autoRest, setAutoRest] = React.useState(true);

  // Ingresso al player da Home (CTA "Inizia allenamento" imposta _schedaIntent).
  React.useEffect(() => {
    if (window._schedaIntent === "player") {
      window._schedaIntent = null;
      setCursor(0);
      setMode("player");
    }
  }, []);

  // Persiste una patch nel blocco piatto e aggiorna lo stato locale.
  const patchProg = (patch) => {
    window.writeSchedaProg(window.storage, _todayK(), patch);
    setProg(p => ({
      completion:    Object.assign({}, p.completion,    patch.completion),
      substitutions: Object.assign({}, p.substitutions, patch.substitutions),
      pesos:         Object.assign({}, p.pesos,          patch.pesos),
    }));
  };

  // Cambia SOLO il giorno mostrato. Lo stato è keyed-by-id e vive per tutti i
  // giorni insieme → niente swap, niente bleed.
  const switchTo = (k) => {
    setScheda(k);
    if (window.storage) window.storage.set("schedaSelectedDay", k);
    const exs = (days.find(d => d.key === k) || {}).exercises || [];
    const tot = exs.reduce((n, ex) => n + ex.sets.length, 0);
    const done = exs.reduce((n, ex, i) => n + ((completion[window.exId(k, i)] || []).filter(Boolean).length), 0);
    setOccupied({});
    prevDoneRef.current = tot > 0 && done === tot; // no confetti rientrando in sessione completa
  };

  // Load last weights from Sheets on mount
  React.useEffect(() => {
    if (!window.sheetsAPI) return;
    window.sheetsAPI.getUltimiPesi().then(data => {
      if (!data || typeof data !== "object") return;
      // data: { "nome esercizio": [peso_set1, peso_set2, ...] }
      setSheetsWeights(data);
    }).catch(() => {});
  }, []);

  // On mount: apri il giorno persistito (o il primo). Persiste la scelta.
  React.useEffect(() => {
    const saved = window.storage ? window.storage.get("schedaSelectedDay", null) : null;
    const target = (days.find(d => d.key === saved) || days[0]);
    if (target && target.key !== scheda) switchTo(target.key);
    else if (target && window.storage) window.storage.set("schedaSelectedDay", target.key);
  }, []);

  const exercises = current.exercises || [];
  const totalSets = exercises.reduce((n, ex) => n + ex.sets.length, 0);
  const completedSets = exercises.reduce(
    (n, ex, i) => n + ((completion[window.exId(scheda, i)] || []).filter(Boolean).length), 0
  );
  const pct = totalSets ? (completedSets / totalSets) * 100 : 0;
  const allDone = completedSets > 0 && completedSets === totalSets;
  // Primo render: se la sessione ripristinata è già completa, niente confetti
  if (prevDoneRef.current === null) prevDoneRef.current = allDone;

  // Vibrate + confetti when session complete
  React.useEffect(() => {
    if (allDone && !prevDoneRef.current) {
      prevDoneRef.current = true;
      if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      setShowConfetti(true);
      const tid = setTimeout(() => setShowConfetti(false), 2200);
      return () => clearTimeout(tid);
    }
    if (!allDone) prevDoneRef.current = false;
  }, [allDone]);

  const toggleSet = (exIdx, setIdx) => {
    if (navigator.vibrate) navigator.vibrate([100]);
    const id = window.exId(scheda, exIdx);
    const arr = [...(completion[id] || new Array(exercises[exIdx].sets.length).fill(false))];
    const wasCompleted = arr[setIdx];
    arr[setIdx] = !arr[setIdx];
    patchProg({ completion: { [id]: arr } });
    // Auto-start rest timer when marking a set as DONE (not when unchecking)
    if (!wasCompleted) {
      const restSecs = exercises[exIdx]?.rest || 90;
      setTimeout(() => setTimer(restSecs), 50); // slight delay so state settles
    }
  };

  const handleSaveSession = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
      // Persist notes
      if (window.storage) window.storage.set(`notes_${today}`, notes);

      // Chiudere la sessione marca il giorno palestra e registra le serie per
      // gruppo muscolare (la card "Settimana" in Dashboard usa dati reali)
      if (window.storage) {
        window.storage.set(`gym_${today}`, true);
        const GROUP = {
          petto: "Petto", schiena: "Schiena", spalle: "Spalle", trapezi: "Spalle",
          quadricipiti: "Gambe", femorali: "Gambe", glutei: "Gambe", polpacci: "Gambe",
          bicipiti: "Braccia", tricipiti: "Braccia", addome: "Core",
        };
        const daily = {};
        exercises.forEach((ex, exIdx) => {
          const done = (completion[window.exId(scheda, exIdx)] || []).filter(Boolean).length;
          if (!done) return;
          const g = GROUP[(ex.muscles && ex.muscles[0]) || ""] || "Altro";
          daily[g] = (daily[g] || 0) + done;
        });
        window.storage.set(`muscleSets_${today}`, daily);

        // Record personali: raccogli le serie completate (peso digitato) e
        // aggiorna il PR per esercizio. I nuovi record → celebrazione in UI.
        if (window.WorkoutProgress) {
          const doneSets = [];
          exercises.forEach((ex, exIdx) => {
            const id = window.exId(scheda, exIdx);
            const exComp = completion[id] || [];
            const exName = substitutions[id] || ex.name;
            const exPesos = pesosRef.current[id] || ex.sets.map(s => String(s.peso));
            ex.sets.forEach((s, setIdx) => {
              if (!exComp[setIdx]) return;
              const raw = exPesos[setIdx];
              doneSets.push({ esercizio: exName, peso: (raw != null && String(raw).trim() !== "") ? raw : s.peso, date: today });
            });
          });
          const res = window.WorkoutProgress.applySession(prMap, doneSets);
          if (res.newPRs.length) {
            window.storage.set("prMap", res.prMap);
            setPrMap(res.prMap);
            setNewPRs(res.newPRs);
            if (navigator.vibrate) navigator.vibrate([40, 60, 40, 60, 80]);
            setTimeout(() => setNewPRs([]), 5000);
          }
        }
      }

      if (window.sheetsAPI) {
        // 1. Salva riepilogo sessione
        await window.sheetsAPI.saveSessione({
          date: today,
          type: scheda,
          setsCompleted: completedSets,
          totalSets,
          notes,
        });

        // 2. Salva ogni serie completata su SerieAllenamento
        const savePromises = [];
        exercises.forEach((ex, exIdx) => {
          const id = window.exId(scheda, exIdx);
          const exCompletion = completion[id] || [];
          const exName = substitutions[id] || ex.name;
          const exPesos = pesosRef.current[id] || ex.sets.map(s => String(s.peso));
          ex.sets.forEach((s, setIdx) => {
            if (!exCompletion[setIdx]) return; // salta serie non completate
            // Testo libero: peso può essere un numero (kg) o una parola (es. elastico
            // "rosso"/"medio"). Salviamo il valore digitato COM'È; fallback al default
            // solo se il campo è vuoto (prima un parseFloat lo convertiva e perdeva la parola).
            const raw = exPesos[setIdx];
            const peso = (raw != null && String(raw).trim() !== "") ? raw : s.peso;
            savePromises.push(
              window.sheetsAPI.savePeso({
                date: today,
                esercizio: exName,
                setN: setIdx + 1,
                peso,
                rip: s.rip,
                sessione: current.name || scheda,
              })
            );
          });
        });
        // Fire-and-forget le serie (non bloccare UI se fallisce una)
        await Promise.allSettled(savePromises);
      }
      setSaveMsg("✓ " + t("Sessione salvata"));
    } catch (err) {
      setSaveMsg("⚠️ " + (err.message || t("Errore salvataggio")));
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  return (
    <div style={{ padding: isDesktop ? "32px 40px" : "10px 16px 24px", display: "flex", flexDirection: "column", gap: isDesktop ? 18 : 14, position: "relative" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Allenamento")}</div>
          <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight: 600 }}>{t("Scheda")}</h1>
        </div>
      </div>

      {/* Check-in warning */}
      {checkIn && (checkIn.sleep <= 2 || checkIn.energy <= 2) && (
        <div className="fade-up" style={{
          padding: "10px 14px", borderRadius: 12,
          background: "rgba(255,159,10,0.12)",
          border: "1px solid rgba(255,159,10,0.25)",
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 13,
        }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span>
            {checkIn.sleep <= 2 ? t("Sonno scarso — riduci l'intensità oggi") : t("Energia bassa — ascolta il corpo oggi")}
          </span>
        </div>
      )}

      {/* Segmented giorni — G# + nome, full-width, robusto fino a 5 giorni dinamici */}
      <div style={{
        display: "flex", gap: 4, background: "var(--card-2)", border: "1px solid var(--border)",
        borderRadius: 12, padding: 4, overflowX: "auto",
      }}>
        {days.map(d => {
          const on = d.key === scheda;
          return (
            <button
              key={d.key}
              onClick={() => switchTo(d.key)}
              style={{
                flex: 1, minWidth: 54, border: "none", cursor: "pointer", borderRadius: 9,
                padding: "9px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                background: on ? "var(--card)" : "transparent",
                color: on ? "var(--text)" : "var(--text-2)",
                boxShadow: on ? "0 1px 4px rgba(0,0,0,.25)" : "none",
                transition: "background .16s, color .16s",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{"G" + d.num}</span>
              <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.7, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
            </button>
          );
        })}
      </div>

      {/* CTA player */}
      <button
        className="btn primary"
        style={{ width: "100%", padding: 13, fontSize: 15, fontWeight: 600 }}
        onClick={() => { setCursor(0); setMode("player"); }}
      >
        <Icon name="check" size={16} color="#fff" /> {t("Inizia allenamento")}
      </button>

      {/* Intestazione giorno: Giorno N · Nome + focus */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, padding: "0 2px" }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{t("Giorno")} {current.num} · {current.name}</span>
        {(current.focus || []).map(f => <UIChip key={f}>{f}</UIChip>)}
      </div>

      {/* Progress bar */}
      <div className="card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            <span className="num" style={{ fontWeight: 600, fontSize: 16 }}>{completedSets}</span>
            <span className="muted tnum">/{totalSets} {t("serie completate")}</span>
          </div>
          <div className="num" style={{ fontSize: 12, fontWeight: 600, color: allDone ? "var(--success)" : "var(--accent)" }}>
            {Math.round(pct)}%
          </div>
        </div>
        <div className="bar"><i style={{ width: `${pct}%`, background: allDone ? "var(--success)" : "var(--accent)" }} /></div>
      </div>

      {/* Exercise grid */}
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: isDesktop ? 18 : 12 }}>
        {exercises.map((ex, i) => {
          const id = window.exId(scheda, i);
          return (
            <ExerciseCard
              key={id}
              ex={ex}
              isDesktop={isDesktop}
              completed={completion[id] || new Array(ex.sets.length).fill(false)}
              onToggleSet={(j) => toggleSet(i, j)}
              onRest={(s) => setTimer(s)}
              occupied={occupied[id]}
              onOccupied={() => setOccupied(o => ({ ...o, [id]: !o[id] }))}
              substituted={substitutions[id]}
              onSubstitute={(name) => patchProg({ substitutions: { [id]: name } })}
              sheetsWeights={sheetsWeights}
              savedPesos={pesosRef.current[id]}
              onPesosChange={(pesos) => {
                pesosRef.current[id] = pesos;
                patchProg({ pesos: { [id]: pesos } });
              }}
            />
          );
        })}
      </div>

      {/* Session notes */}
      <div className="card lift" style={{ padding: isDesktop ? 18 : 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Icon name="doc" size={14} color="var(--text-2)" />
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("Note di oggi")}</div>
          {notes.length > 0 && (
            <span className="num muted" style={{ fontSize: 11, marginLeft: "auto" }}>{notes.length}</span>
          )}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("Sensazioni, fastidi, dettagli da ricordare… il coach AI le leggerà.")}
          rows={3}
          style={{
            width: "100%", background: "var(--card-2)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 11,
            padding: "10px 12px", fontSize: 13.5, lineHeight: 1.45,
            fontFamily: "inherit", outline: "none", resize: "vertical", minHeight: 60,
          }}
        />
      </div>

      {/* Close session button */}
      <button
        className={`btn ${allDone ? "success" : "primary"}`}
        disabled={saving || completedSets === 0}
        onClick={handleSaveSession}
        style={{
          width: "100%", padding: "14px", fontSize: 15, fontWeight: 600,
          opacity: completedSets > 0 ? 1 : 0.45,
          position: "relative",
        }}
      >
        {saving ? <span className="spinner" style={{ width: 18, height: 18 }} /> : (
          <>
            <Icon name="check" size={16} color={allDone ? "#062810" : "#fff"} />
            {allDone ? t("Sessione completa — Salva su Sheets") : `${t("Chiudi sessione")} (${completedSets}/${totalSets})`}
          </>
        )}
      </button>
      {saveMsg && (
        <div className="fade-up" style={{
          textAlign: "center", fontSize: 13, fontWeight: 500,
          color: saveMsg.startsWith("✓") ? "var(--success)" : "#FF9F0A",
          padding: "4px 0",
        }}>{saveMsg}</div>
      )}

      {timer != null && (
        <TimerOverlay seconds={timer} onClose={() => setTimer(null)} />
      )}
      {showConfetti && <Confetti />}

      {mode === "player" && (
        <WorkoutPlayer
          dayKey={scheda}
          dayName={current.name}
          exercises={exercises}
          cursor={cursor}
          setCursor={setCursor}
          completion={completion}
          substitutions={substitutions}
          pesosRef={pesosRef}
          sheetsWeights={sheetsWeights}
          prMap={prMap}
          autoRest={autoRest}
          setAutoRest={setAutoRest}
          onPatch={patchProg}
          onClose={() => setMode("list")}
          onFinish={() => setMode("list")}
        />
      )}

      {/* Celebrazione record personali (PR) */}
      {newPRs.length > 0 && (
        <div className="pop-in" style={{
          position: "fixed", left: 16, right: 16, bottom: "calc(env(safe-area-inset-bottom) + 90px)",
          zIndex: 9995, background: "var(--card)", border: "1px solid rgba(48,209,88,0.4)",
          borderRadius: 16, padding: "14px 16px", boxShadow: "0 16px 40px -12px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{ fontSize: 26 }}>🏆</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--success)" }}>
              {newPRs.length === 1 ? t("Nuovo record!") : `${newPRs.length} ${t("nuovi record!")}`}
            </div>
            <div className="muted tnum" style={{ fontSize: 12, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {newPRs.slice(0, 3).map(p => `${t(p.esercizio)} ${p.peso}kg`).join(" · ")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


window.Scheda = Scheda;
