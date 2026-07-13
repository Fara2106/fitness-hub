// scheda.jsx — Workout tracker: sets, RPE, timer, vibration, Sheets sync

// ── Fallback schedule (used when scheda.txt not loaded) ──────────────────
const _DEFAULT_SCHEDULE = {
  "Upper A": [
    { name:"Panca piana con bilanciere", muscles:["petto","tricipiti","spalle"], sets:[{peso:80,rip:9,rpe:7},{peso:82.5,rip:9,rpe:8},{peso:82.5,rip:8,rpe:9},{peso:82.5,rip:8,rpe:9}], rest:90, ripRange:"8-10", history:[], alternatives:["Push-up zavorrati","Push-up con piedi rialzati"] },
    { name:"Panca inclinata con manubri (30°)", muscles:["petto","spalle"], sets:[{peso:30,rip:11,rpe:7},{peso:30,rip:11,rpe:8},{peso:30,rip:10,rpe:9},{peso:30,rip:10,rpe:9}], rest:90, ripRange:"10-12", history:[], alternatives:["Push-up con piedi su sedia"] },
    { name:"Croci ai cavi bassi (chest fly)", muscles:["petto"], sets:[{peso:15,rip:13,rpe:7},{peso:15,rip:13,rpe:8},{peso:15,rip:12,rpe:9}], rest:75, ripRange:"12-15", history:[], alternatives:["Croci con elastico"] },
    { name:"Dips alle parallele", muscles:["petto","tricipiti"], sets:[{peso:0,rip:10,rpe:7},{peso:0,rip:9,rpe:8},{peso:0,rip:8,rpe:9}], rest:90, ripRange:"8-12", history:[], alternatives:["Dips su sedia"] },
    { name:"Lat machine presa larga (pull-down)", muscles:["schiena","bicipiti"], sets:[{peso:55,rip:11,rpe:7},{peso:60,rip:10,rpe:8},{peso:60,rip:10,rpe:9},{peso:60,rip:9,rpe:9}], rest:90, ripRange:"10-12", history:[], alternatives:["Trazioni","Inverted row su tavolo"] },
    { name:"Rematore con manubrio su panca (1 braccio)", muscles:["schiena","bicipiti"], sets:[{peso:32,rip:11,rpe:7},{peso:34,rip:10,rpe:8},{peso:34,rip:10,rpe:9}], rest:75, ripRange:"10-12", history:[], alternatives:["Row con zaino zavorrato","Elastico"] },
    { name:"Alzate laterali con manubri", muscles:["spalle"], sets:[{peso:10,rip:13,rpe:7},{peso:10,rip:12,rpe:8},{peso:10,rip:12,rpe:9}], rest:75, ripRange:"12-15", history:[], alternatives:["Alzate con bottiglie d'acqua"] },
    { name:"Curl con bilanciere EZ", muscles:["bicipiti"], sets:[{peso:25,rip:11,rpe:7},{peso:27.5,rip:10,rpe:8},{peso:27.5,rip:10,rpe:9}], rest:75, ripRange:"10-12", history:[], alternatives:["Curl con bottiglie"] },
    { name:"Curl con manubri alternati (martello)", muscles:["bicipiti"], sets:[{peso:14,rip:11,rpe:7},{peso:14,rip:10,rpe:8},{peso:14,rip:10,rpe:9}], rest:75, ripRange:"10-12", history:[], alternatives:["Curl neutrale con bottiglie"] },
  ],
  "Lower": [
    { name:"Squat con bilanciere (back squat)", muscles:["quadricipiti","glutei"], sets:[{peso:100,rip:9,rpe:7},{peso:105,rip:8,rpe:8},{peso:105,rip:8,rpe:9},{peso:105,rip:8,rpe:9}], rest:120, ripRange:"8-10", history:[], alternatives:["Squat con zaino zavorrato","Bulgarian split squat"] },
    { name:"Leg press 45°", muscles:["quadricipiti","glutei"], sets:[{peso:120,rip:13,rpe:7},{peso:130,rip:12,rpe:8},{peso:130,rip:12,rpe:9}], rest:90, ripRange:"12-15", history:[], alternatives:["Squat sumo","Wall sit"] },
    { name:"Romanian Deadlift (RDL) con bilanciere", muscles:["femorali","glutei"], sets:[{peso:90,rip:11,rpe:7},{peso:95,rip:10,rpe:8},{peso:95,rip:10,rpe:9},{peso:95,rip:10,rpe:9}], rest:90, ripRange:"10-12", history:[], alternatives:["Stacco a una gamba corpo libero"] },
    { name:"Affondi con manubri (camminata)", muscles:["quadricipiti","glutei"], sets:[{peso:20,rip:10,rpe:7},{peso:22,rip:10,rpe:8},{peso:22,rip:10,rpe:9}], rest:90, ripRange:"10/gamba", history:[], alternatives:["Affondi statici","Reverse lunge"] },
    { name:"Leg curl sdraiato (macchina)", muscles:["femorali"], sets:[{peso:50,rip:13,rpe:7},{peso:55,rip:12,rpe:8},{peso:55,rip:12,rpe:9}], rest:75, ripRange:"12-15", history:[], alternatives:["Nordic curl","Leg curl con elastico"] },
    { name:"Calf raise in piedi (macchina o scalino)", muscles:["polpacci"], sets:[{peso:80,rip:17,rpe:7},{peso:80,rip:17,rpe:8},{peso:80,rip:16,rpe:9},{peso:80,rip:16,rpe:9}], rest:60, ripRange:"15-20", history:[], alternatives:["Calf raise su scalino"] },
    { name:"Crunch inverso a terra", muscles:["addome"], sets:[{peso:0,rip:17,rpe:7},{peso:0,rip:17,rpe:8},{peso:0,rip:17,rpe:9}], rest:60, ripRange:"15-20", history:[], alternatives:["Leg raise sdraiato"] },
    { name:"Plank isometrico", muscles:["addome"], sets:[{peso:0,rip:45,rpe:7},{peso:0,rip:50,rpe:8},{peso:0,rip:50,rpe:9}], rest:60, ripRange:"45-60 sec", history:[], alternatives:[] },
    { name:"Back extension (macchina o panca lombare)", muscles:["schiena"], sets:[{peso:20,rip:13,rpe:7},{peso:25,rip:12,rpe:8},{peso:25,rip:12,rpe:9}], rest:60, ripRange:"12-15", history:[], alternatives:[] },
  ],
  "Upper B": [
    { name:"Military press (bilanciere)", muscles:["spalle","tricipiti"], sets:[{peso:50,rip:8,rpe:7},{peso:52.5,rip:7,rpe:8},{peso:52.5,rip:6,rpe:9}], rest:120, ripRange:"6-10", history:[], alternatives:["Lento manubri","Push press"] },
    { name:"Trazioni o Lat machine presa stretta", muscles:["schiena","bicipiti"], sets:[{peso:-20,rip:10,rpe:7},{peso:-15,rip:8,rpe:8},{peso:-10,rip:7,rpe:9}], rest:120, ripRange:"8-12", history:[], alternatives:["Lat machine presa stretta","Pulley alto"] },
    { name:"Rematore con bilanciere (pendlay row)", muscles:["schiena"], sets:[{peso:70,rip:8,rpe:7},{peso:72.5,rip:8,rpe:8},{peso:72.5,rip:7,rpe:9}], rest:90, ripRange:"6-10", history:[], alternatives:["Rematore T-bar","Chest-supported row"] },
    { name:"Panca stretta (tricipiti)", muscles:["tricipiti","petto"], sets:[{peso:60,rip:10,rpe:7},{peso:62.5,rip:9,rpe:8},{peso:62.5,rip:8,rpe:9}], rest:90, ripRange:"8-12", history:[], alternatives:["Push-up presa stretta","Dips verticali"] },
    { name:"Face pull (cavo alto)", muscles:["spalle","trapezi"], sets:[{peso:25,rip:15,rpe:7},{peso:27.5,rip:13,rpe:8},{peso:27.5,rip:13,rpe:9}], rest:75, ripRange:"12-15", history:[], alternatives:["Alzate posteriori manubri"] },
    { name:"Alzate laterali con manubri", muscles:["spalle"], sets:[{peso:10,rip:13,rpe:7},{peso:10,rip:13,rpe:8},{peso:10,rip:12,rpe:9}], rest:75, ripRange:"12-15", history:[], alternatives:["Alzate laterali cavo","Alzate con bottiglie"] },
    { name:"Skull crusher (EZ barra)", muscles:["tricipiti"], sets:[{peso:30,rip:11,rpe:7},{peso:32.5,rip:10,rpe:8},{peso:32.5,rip:10,rpe:9}], rest:75, ripRange:"10-12", history:[], alternatives:["Push-down cavo"] },
    { name:"Curl con manubri alternati", muscles:["bicipiti"], sets:[{peso:14,rip:11,rpe:7},{peso:14,rip:10,rpe:8},{peso:14,rip:10,rpe:9}], rest:75, ripRange:"10-12", history:[], alternatives:["Curl EZ","Curl cavo"] },
    { name:"Shrug con manubri o bilanciere", muscles:["trapezi"], sets:[{peso:30,rip:13,rpe:7},{peso:32.5,rip:12,rpe:8},{peso:32.5,rip:12,rpe:9}], rest:75, ripRange:"12-15", history:[], alternatives:[] },
    { name:"Crunch inverso a terra", muscles:["addome"], sets:[{peso:0,rip:17,rpe:7},{peso:0,rip:17,rpe:8},{peso:0,rip:16,rpe:9}], rest:60, ripRange:"15-20", history:[], alternatives:["Leg raise sdraiato"] },
    { name:"Plank isometrico", muscles:["addome"], sets:[{peso:0,rip:45,rpe:7},{peso:0,rip:50,rpe:8},{peso:0,rip:50,rpe:9}], rest:60, ripRange:"45-60 sec", history:[], alternatives:[] },
  ],
};

// Build schedule from parser output or fallback
function _buildSchedule() {
  if (!window.parseScheda || !window.storage) return _DEFAULT_SCHEDULE;
  const text = window.storage.get("schedaData", null);
  if (!text) return _DEFAULT_SCHEDULE;
  try {
    const parsed = window.parseScheda(text);
    if (!parsed) return _DEFAULT_SCHEDULE;
    const out = {};
    ["Upper A", "Lower", "Upper B"].forEach(key => {
      const block = parsed[key];
      if (!block || !block.exercises || !block.exercises.length) {
        out[key] = _DEFAULT_SCHEDULE[key];
        return;
      }
      out[key] = block.exercises.map(ex => {
        const altArr = block.altMap
          ? block.altMap[ex.name.toLowerCase()] || []
          : [];
        return {
          ...ex,
          alternatives: altArr.length ? altArr : (ex.alternatives || []),
          history: ex.history || [],
        };
      });
    });
    return out;
  } catch (_) {
    return _DEFAULT_SCHEDULE;
  }
}

// ── Persistenza progressi di giornata (per giorno + sessione) ─────────────
// Senza, uscire dalla tab Scheda a metà allenamento perdeva serie completate,
// pesi digitati e sostituzioni (lo stato viveva solo nel componente montato).
// NB: le chiavi restano indicizzate per posizione → il reset tra tab (bleed)
// è gestito caricando SEMPRE il blocco salvato della tab di destinazione.
function _progKey() {
  return `schedaProg_${window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10)}`;
}
function _loadProg(tab) {
  const all = window.storage ? window.storage.get(_progKey(), {}) : {};
  return (all && all[tab]) || { completion: {}, substitutions: {}, pesos: {} };
}
function _saveProg(tab, patch) {
  if (!window.storage) return;
  const key = _progKey();
  const all = window.storage.get(key, {}) || {};
  all[tab] = Object.assign({}, all[tab], patch);
  window.storage.set(key, all);
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
      <div className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 24 }}>{t("Recupero")}</div>
      <div style={{ position: "relative", width: 220, height: 220 }}>
        <div className="timer-pulse" style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: done
            ? "radial-gradient(circle, rgba(48,209,88,0.4), transparent 70%)"
            : "radial-gradient(circle, rgba(10,132,255,0.4), transparent 70%)",
        }} />
        <svg viewBox="0 0 200 200" width="220" height="220" style={{ position: "relative", transform: "rotate(-90deg)" }}>
          <circle cx="100" cy="100" r={R} stroke="rgba(255,255,255,0.06)" strokeWidth="6" fill="none" />
          <circle cx="100" cy="100" r={R} stroke={done ? "var(--success)" : "var(--accent)"} strokeWidth="6" fill="none"
            strokeDasharray={C} strokeDashoffset={dashOffset} strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s linear" }} />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <div className="num" style={{ fontSize: 56, fontWeight: 600, letterSpacing: -0.04 }}>
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
          </div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600 }}>
            {t("min · sec")}
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
      <div className="muted" style={{ fontSize: 11.5, marginTop: 16 }}>{t("Tocca ovunque per chiudere")}</div>
    </div>
  );
};

// ── Set row ────────────────────────────────────────────────────────────────
const SetRow = ({ s, idx, completed, onToggle, peso, onPesoChange, isPR, rpeAdjust = 0 }) => {
  const effRpe = Math.min(10, Math.max(1, s.rpe + rpeAdjust));
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "26px 1.4fr 0.8fr 0.8fr 36px",
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
          inputMode="decimal"
          value={peso}
          onChange={(e) => onPesoChange(e.target.value)}
          className="input input-mono"
          style={{
            padding: "6px 8px", fontSize: 14, fontWeight: 600, textAlign: "right", borderRadius: 7,
            borderColor: isPR ? "#FF9F0A" : "var(--border)",
            boxShadow: isPR ? "0 0 0 1px #FF9F0A" : "none",
            color: isPR ? "#FF9F0A" : "var(--text)",
          }}
        />
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>kg</span>
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
      <div style={{ textAlign: "center" }}>
        <span className="pill" style={{
          fontSize: 11, padding: "3px 8px", fontWeight: 600,
          background: effRpe >= 9 ? "rgba(255,69,58,0.15)" : effRpe >= 8 ? "rgba(255,159,10,0.15)" : "rgba(48,209,88,0.15)",
          color: effRpe >= 9 ? "#FF453A" : effRpe >= 8 ? "#FF9F0A" : "#30D158",
        }}>
          {effRpe}{rpeAdjust !== 0 && <span style={{ opacity: 0.6, marginLeft: 2, fontSize: 9 }}>({rpeAdjust > 0 ? "+" : ""}{rpeAdjust})</span>}
        </span>
      </div>
      <button
        onClick={onToggle}
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
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr 0.7fr", gap: 8, alignItems: "center", fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", fontWeight: 600, letterSpacing: 0.4, padding: "0 2px 6px", borderBottom: "1px solid var(--border)" }}>
        <div>{t("Quando")}</div>
        <div style={{ textAlign: "right" }}>{t("Peso")}</div>
        <div style={{ textAlign: "center" }}>{t("Rip")}</div>
        <div style={{ textAlign: "center" }}>RPE</div>
      </div>
      {history.slice(0, 3).map((h, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr 0.7fr", gap: 8, alignItems: "center", padding: "7px 2px", borderTop: i > 0 ? "1px solid var(--border)" : 0 }}>
          <div style={{ fontSize: 12, color: i === 0 ? "var(--text)" : "var(--text-2)", fontWeight: i === 0 ? 600 : 500 }}>{h.when || h.date}</div>
          <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: "right" }}>{h.peso} <span style={{ color: "var(--text-3)", fontSize: 10, fontWeight: 500 }}>kg</span></div>
          <div className="num" style={{ fontSize: 12, textAlign: "center", color: "var(--text-2)" }}>{h.rip}</div>
          <div className="num" style={{ fontSize: 12, textAlign: "center", color: "var(--text-2)" }}>{h.rpe}</div>
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
  const colors = ["#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2", "#5AC8FA", "#FF453A"];
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
  rpeAdjust, substituted, onSubstitute,
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

  return (
    <div className="card lift" style={{
      padding: isDesktop ? 22 : 16,
      opacity: occupied ? 0.55 : 1,
      transition: "opacity 0.2s",
      position: "relative",
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
        display: "grid", gridTemplateColumns: "26px 1.4fr 0.8fr 0.8fr 36px",
        gap: 10, alignItems: "center",
        padding: "8px 4px 4px",
        fontSize: 10, letterSpacing: 0.6, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase",
      }}>
        <div style={{ textAlign: "center" }}>{t("Set")}</div>
        <div style={{ textAlign: "right", paddingRight: 18 }}>{t("Peso")}</div>
        <div style={{ textAlign: "center" }}>{t("Rip")}</div>
        <div style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
          RPE
          <span title={t("Rate of Perceived Exertion: quanto hai lavorato duramente su scala 1-10. 7 = moderato · 8 = faticoso · 9 = quasi al limite · 10 = massimale")} style={{ cursor: "help", fontSize: 9, background: "var(--card-3)", color: "var(--text-3)", borderRadius: 999, width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>?</span>
        </div>
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
            rpeAdjust={rpeAdjust}
          />
        );
      })}

      {/* Rest + progress footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <button
          className="btn"
          style={{ padding: "7px 14px", fontSize: 13, background: "rgba(10,132,255,0.14)", borderColor: "transparent", color: "var(--accent)" }}
          onClick={() => onRest(ex.rest)}
        >
          <Icon name="clock" size={13} /> {ex.rest}s
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
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

// ── Main Scheda screen ─────────────────────────────────────────────────────
const Scheda = ({ device, scheda, setScheda, checkIn, weekNum }) => {
  const isDesktop = device === "desktop";
  const t = useT();

  const [SCHEDULE]    = React.useState(() => _buildSchedule());
  const [completion, setCompletion]   = React.useState(() => _loadProg(scheda).completion || {});
  const [timer, setTimer]             = React.useState(null);
  const [occupied, setOccupied]       = React.useState({});
  const [showConfetti, setShowConfetti] = React.useState(false);
  const [rpeAdjust, setRpeAdjust]     = React.useState(0);
  const [substitutions, setSubstitutions] = React.useState(() => _loadProg(scheda).substitutions || {});
  const [notes, setNotes]             = React.useState(() => window.storage ? window.storage.get(`notes_${window.todayKey ? window.todayKey() : ""}`, "") : "");
  const [sheetsWeights, setSheetsWeights] = React.useState(null);
  const [saving, setSaving]           = React.useState(false);
  const [saveMsg, setSaveMsg]         = React.useState("");
  const prevDoneRef                   = React.useRef(null); // null = da inizializzare al primo render
  // Ref condiviso: ogni ExerciseCard scrive i propri pesos qui per il salvataggio su Sheets
  const pesosRef = React.useRef(null);
  if (pesosRef.current === null) pesosRef.current = Object.assign({}, _loadProg(scheda).pesos);

  // Cambia tab caricando i progressi salvati di QUELLA tab: tutti gli stati
  // per-posizione (completion/substitutions/occupied/pesos) vanno sostituiti
  // insieme per evitare il bleed tra giorni diversi.
  const switchTo = (k) => {
    const saved = _loadProg(k);
    const exs = SCHEDULE[k] || [];
    const tot  = exs.reduce((n, ex) => n + ex.sets.length, 0);
    const done = exs.reduce((n, ex, i) => n + ((saved.completion || {})[i] || []).filter(Boolean).length, 0);
    setScheda(k);
    setCompletion(saved.completion || {});
    setSubstitutions(saved.substitutions || {});
    setOccupied({});
    pesosRef.current = Object.assign({}, saved.pesos);
    prevDoneRef.current = tot > 0 && done === tot; // niente confetti ri-entrando in una sessione già completa
  };

  // Persisti i progressi a ogni modifica (le note hanno già la loro chiave)
  React.useEffect(() => {
    _saveProg(scheda, { completion, substitutions });
  }, [completion, substitutions, scheda]);

  // Load last weights from Sheets on mount
  React.useEffect(() => {
    if (!window.sheetsAPI) return;
    window.sheetsAPI.getUltimiPesi().then(data => {
      if (!data || typeof data !== "object") return;
      // data: { "nome esercizio": [peso_set1, peso_set2, ...] }
      setSheetsWeights(data);
    }).catch(() => {});
  }, []);

  // Auto-detect today's session on mount
  React.useEffect(() => {
    const sess = window.getTodaySession ? window.getTodaySession() : null;
    if (sess && (!scheda || scheda === "Upper A") && sess.id !== scheda) {
      switchTo(sess.id); // carica anche i progressi salvati della sessione giusta
    }
  }, []);

  const exercises = SCHEDULE[scheda] || [];
  const totalSets = exercises.reduce((n, ex) => n + ex.sets.length, 0);
  const completedSets = exercises.reduce(
    (n, ex, i) => n + (completion[i] || []).filter(Boolean).length, 0
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
    let wasCompleted = false;
    setCompletion(c => {
      const arr = [...(c[exIdx] || new Array(exercises[exIdx].sets.length).fill(false))];
      wasCompleted = arr[setIdx];
      arr[setIdx] = !arr[setIdx];
      return { ...c, [exIdx]: arr };
    });
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
          const done = (completion[exIdx] || []).filter(Boolean).length;
          if (!done) return;
          const g = GROUP[(ex.muscles && ex.muscles[0]) || ""] || "Altro";
          daily[g] = (daily[g] || 0) + done;
        });
        window.storage.set(`muscleSets_${today}`, daily);
      }

      if (window.sheetsAPI) {
        // 1. Salva riepilogo sessione
        await window.sheetsAPI.saveSessione({
          date: today,
          type: scheda,
          weekNum: weekNum || 1,
          setsCompleted: completedSets,
          totalSets,
          notes,
        });

        // 2. Salva ogni serie completata su SerieAllenamento
        const savePromises = [];
        exercises.forEach((ex, exIdx) => {
          const exCompletion = completion[exIdx] || [];
          const exName = substitutions[exIdx] || ex.name;
          const exPesos = pesosRef.current[exIdx] || ex.sets.map(s => String(s.peso));
          ex.sets.forEach((s, setIdx) => {
            if (!exCompletion[setIdx]) return; // salta serie non completate
            const peso = parseFloat(exPesos[setIdx]) || s.peso;
            savePromises.push(
              window.sheetsAPI.savePeso({
                date: today,
                esercizio: exName,
                setN: setIdx + 1,
                peso,
                rip: s.rip,
                rpe: Math.min(10, Math.max(1, s.rpe + rpeAdjust)),
                sessione: scheda,
                weekNum: weekNum || 1,
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
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Allenamento")} · W{weekNum || "?"}</div>
          <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight: 600 }}>{t("Scheda")}</h1>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="btn"
            onClick={() => setRpeAdjust(a => a === 0 ? -1 : 0)}
            style={{
              padding: "8px 12px", fontSize: 12.5,
              background: rpeAdjust !== 0 ? "rgba(255,159,10,0.18)" : "var(--card-2)",
              color: rpeAdjust !== 0 ? "#FF9F0A" : "var(--text)",
            }}
          >
            {rpeAdjust === 0 ? t("− RPE") : `RPE −1 ✓`}
          </button>
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
            {checkIn.sleep <= 2 ? t("Sonno scarso — valuta RPE −1 su tutti gli esercizi") : t("Energia bassa — ascolta il corpo oggi")}
          </span>
        </div>
      )}

      {/* Tab pills */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="tab-pills">
          {Object.keys(SCHEDULE).map(k => (
            <button
              key={k}
              className={k === scheda ? "on" : ""}
              onClick={() => switchTo(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div className="card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            <span className="num" style={{ fontWeight: 600, fontSize: 16 }}>{completedSets}</span>
            <span className="muted">/{totalSets} {t("serie completate")}</span>
          </div>
          <div className="num" style={{ fontSize: 12, fontWeight: 600, color: allDone ? "var(--success)" : "var(--accent)" }}>
            {Math.round(pct)}%
          </div>
        </div>
        <div className="bar"><i style={{ width: `${pct}%`, background: allDone ? "var(--success)" : "var(--accent)" }} /></div>
      </div>

      {/* Exercise grid */}
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: isDesktop ? 18 : 12 }}>
        {exercises.map((ex, i) => (
          <ExerciseCard
            key={ex.name + i}
            ex={ex}
            isDesktop={isDesktop}
            completed={completion[i] || new Array(ex.sets.length).fill(false)}
            onToggleSet={(j) => toggleSet(i, j)}
            onRest={(s) => setTimer(s)}
            occupied={occupied[i]}
            onOccupied={() => setOccupied(o => ({ ...o, [i]: !o[i] }))}
            rpeAdjust={rpeAdjust}
            substituted={substitutions[i]}
            onSubstitute={(name) => setSubstitutions(s => ({ ...s, [i]: name }))}
            sheetsWeights={sheetsWeights}
            savedPesos={pesosRef.current[i]}
            onPesosChange={(pesos) => {
              pesosRef.current[i] = pesos;
              _saveProg(scheda, { pesos: Object.assign({}, pesosRef.current) });
            }}
          />
        ))}
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
    </div>
  );
};


window.Scheda = Scheda;
