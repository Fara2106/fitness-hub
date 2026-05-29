// impostazioni.jsx — Full settings screen wired to window.storage

// ── Helper sub-components ──────────────────────────────────────────────────
const ISection = ({ title, subtitle, children }) => (
  <div>
    <div style={{ padding: "0 4px 8px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.6, textTransform: "uppercase" }}>{title}</div>
      {subtitle && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{subtitle}</div>}
    </div>
    <div className="ios-list">{children}</div>
  </div>
);

const IRow = ({ icon, iconBg, title, sub, trailing, children, onClick }) => (
  <div className="row" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
    <div className="icon-wrap" style={{ background: iconBg || "var(--card-3)", color: "#fff" }}>
      <Icon name={icon} size={15} strokeWidth={2} />
    </div>
    <div className="row-main">
      <div className="row-title">{title}</div>
      {sub && <div className="row-sub">{sub}</div>}
    </div>
    <div className="row-trailing">{children || trailing}</div>
  </div>
);

const IField = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6, paddingLeft: 2 }}>{label}</div>
    {children}
  </div>
);

// ── ApiKeyRow — shows/hides key, has Test button ───────────────────────────
const ApiKeyRow = ({ icon, iconBg, title, sub, storageKey, testFn, placeholder }) => {
  const t = useT();
  const [val, setVal]       = React.useState(() => window.storage ? window.storage.get(storageKey, "") : "");
  const [show, setShow]     = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [testing, setTesting]  = React.useState(false);
  const [testResult, setTestResult] = React.useState(null);

  const save = (v) => {
    setVal(v);
    const trimmed = v.trim();
    if (window.storage) window.storage.set(storageKey, trimmed);
    // Sync groqApiKey al cloud (con retry così non si perde su errore di rete)
    if (storageKey === "groqApiKey" && trimmed) {
      (window._saveSettingRetry
        ? window._saveSettingRetry("groqApiKey", trimmed)
        : (window.sheetsAPI && window.sheetsAPI.saveSettings({ key: "groqApiKey", value: trimmed }).catch(() => {})));
    }
  };

  const test = async () => {
    if (!testFn || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testFn();
      setTestResult({ ok: true, msg: r.reply ? `✓ OK — "${r.reply}"` : `✓ Connesso (${r.rows} righe)` });
    } catch (e) {
      setTestResult({ ok: false, msg: "✗ " + (e.message || "Errore") });
    } finally {
      setTesting(false);
    }
  };

  const masked = val ? val.slice(0, 6) + "••••••••" + val.slice(-4) : "";

  return (
    <div>
      <div className="row" onClick={() => setExpanded(e => !e)} style={{ cursor: "pointer" }}>
        <div className="icon-wrap" style={{ background: iconBg, color: "#fff" }}>
          <Icon name={icon} size={15} strokeWidth={2} />
        </div>
        <div className="row-main">
          <div className="row-title">{title}</div>
          {sub && <div className="row-sub">{sub}</div>}
        </div>
        <div className="row-trailing" style={{ gap: 6 }}>
          {val ? (
            <span className="pill" style={{ fontSize: 10, background: "rgba(48,209,88,0.18)", color: "var(--success)" }}>
              {t("Configurato")}
            </span>
          ) : (
            <span className="pill" style={{ fontSize: 10, background: "rgba(255,69,58,0.14)", color: "var(--danger)" }}>
              {t("Mancante")}
            </span>
          )}
          <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "flex" }}>
            <Icon name="chevron" size={13} color="var(--text-3)" />
          </span>
        </div>
      </div>

      {expanded && (
        <div className="fade-up" style={{ padding: "12px 16px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type={show ? "text" : "password"}
              value={val}
              onChange={(e) => save(e.target.value)}
              placeholder={placeholder || "Inserisci…"}
              className="input input-mono"
              style={{ flex: 1, fontSize: 13, padding: "10px 12px" }}
            />
            <button className="btn ghost" style={{ padding: "8px 10px", flexShrink: 0 }} onClick={() => setShow(s => !s)}>
              <Icon name={show ? "lock" : "lock"} size={14} />
              <span style={{ fontSize: 12, marginLeft: 4 }}>{show ? t("Nascondi") : t("Mostra")}</span>
            </button>
          </div>
          {val && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                className="btn"
                disabled={testing}
                onClick={test}
                style={{ padding: "8px 14px", fontSize: 13 }}
              >
                {testing ? <span className="spinner" style={{ width: 14, height: 14 }} /> : t("Testa connessione")}
              </button>
              {testResult && (
                <div style={{ fontSize: 12.5, fontWeight: 500, color: testResult.ok ? "var(--success)" : "var(--danger)" }}>
                  {testResult.msg}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── File importer ──────────────────────────────────────────────────────────
const FileImporter = ({ label, icon, storageKey, accept = ".txt" }) => {
  const t = useT();
  const [loaded, setLoaded]   = React.useState(() => !!(window.storage && window.storage.get(storageKey, null)));
  const [fileName, setFileName] = React.useState(() => window.storage ? window.storage.get(storageKey + "_name", "") : "");
  const inputRef = React.useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      if (window.storage) {
        window.storage.set(storageKey, text);
        window.storage.set(storageKey + "_name", file.name);
      }
      setLoaded(true);
      setFileName(file.name);
      // Sync al cloud (scheda/dieta disponibili su tutti i device) con retry
      if (window._saveSettingRetry) {
        window._saveSettingRetry(storageKey, text);
      } else if (window.sheetsAPI) {
        window.sheetsAPI.saveSettings({ key: storageKey, value: text }).catch(() => {});
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  return (
    <div className="row">
      <div className="icon-wrap" style={{ background: "#FF9F0A", color: "#fff" }}>
        <Icon name={icon} size={15} strokeWidth={2} />
      </div>
      <div className="row-main">
        <div className="row-title">{label}</div>
        <div className="row-sub">{loaded ? (fileName || t("Caricato")) : t("Nessun file importato")}</div>
      </div>
      <div className="row-trailing">
        {loaded && <span className="pill" style={{ fontSize: 10, background: "rgba(48,209,88,0.18)", color: "var(--success)", marginRight: 6 }}>✓</span>}
        <button
          className="btn"
          style={{ padding: "6px 12px", fontSize: 12 }}
          onClick={() => inputRef.current?.click()}
        >
          {loaded ? t("Aggiorna") : t("Importa")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          onChange={handleFile}
          onClick={(e) => { e.target.value = ""; }}
        />
      </div>
    </div>
  );
};

// ── Week stepper ───────────────────────────────────────────────────────────
const WeekStepper = ({ value, onChange }) => {
  const t = useT();
  return (
    <div className="row">
      <div className="icon-wrap" style={{ background: "#5e5ce6", color: "#fff" }}>
        <Icon name="calendar" size={15} strokeWidth={2} />
      </div>
      <div className="row-main">
        <div className="row-title">{t("Settimana mesociclo")}</div>
        <div className="row-sub">{t("Settimana")} {value} {t("di")} 8</div>
      </div>
      <div className="row-trailing" style={{ gap: 6 }}>
        <button
          className="btn ghost"
          style={{ padding: "4px 10px", fontSize: 15 }}
          onClick={() => onChange(Math.max(1, value - 1))}
        >−</button>
        <span className="num" style={{ fontSize: 17, fontWeight: 700, minWidth: 22, textAlign: "center" }}>{value}</span>
        <button
          className="btn ghost"
          style={{ padding: "4px 10px", fontSize: 15 }}
          onClick={() => onChange(Math.min(8, value + 1))}
        >+</button>
      </div>
    </div>
  );
};

// ── Reset confirmation modal ───────────────────────────────────────────────
const ResetModal = ({ onConfirm, onCancel }) => {
  const t = useT();
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="pop-in" style={{
        background: "var(--card)", borderRadius: 18, border: "1px solid var(--border)",
        padding: 28, maxWidth: 380, width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 14 }}>⚠️</div>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{t("Reset completo")}</h2>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 22 }}>
          {t("Tutti i dati verranno eliminati: check-in, storico pesi, attività, impostazioni e file importati. Questa operazione non è reversibile.")}
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" style={{ flex: 1 }} onClick={onCancel}>{t("Annulla")}</button>
          <button className="btn danger" style={{ flex: 1 }} onClick={onConfirm}>{t("Resetta tutto")}</button>
        </div>
      </div>
    </div>
  );
};

// ── Profile editor modal ───────────────────────────────────────────────────
const ProfileEditor = ({ profile, onSave, onClose, isDesktop }) => {
  const t = useT();
  const [p, setP] = React.useState(profile);
  const set = (k, v) => setP(prev => ({ ...prev, [k]: v }));

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const PROGRAMS = ["Powerbuilding", "Hypertrophy", "Strength", "Cut", "Lean bulk"];

  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: isDesktop ? "center" : "flex-end", justifyContent: "center",
      animation: "fadeUp 0.18s ease",
    }}>
      <div onClick={(e) => e.stopPropagation()} className="pop-in" style={{
        width: isDesktop ? 480 : "100%",
        background: "var(--card)", borderRadius: isDesktop ? 18 : "22px 22px 0 0",
        border: "1px solid var(--border)", padding: 22,
        display: "flex", flexDirection: "column", gap: 18, overflow: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        {!isDesktop && (
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--card-3)", margin: "-8px auto 0" }} />
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.02 }}>{t("Modifica profilo")}</h2>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 999, background: "var(--card-2)", border: 0, color: "var(--text-2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} strokeWidth={2.4} />
          </button>
        </div>
        <div style={{ alignSelf: "center", width: 80, height: 80, borderRadius: 999, background: "linear-gradient(135deg, #FF9F0A 0%, #FF453A 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--display)", fontWeight: 700, fontSize: 34, color: "#1a0a04" }}>
          {p.name.slice(0, 1).toUpperCase() || "?"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <IField label={t("Nome")}>
            <input className="input" value={p.name} onChange={(e) => set("name", e.target.value)} autoFocus style={{ background: "var(--card-2)" }} />
          </IField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <IField label={t("Altezza (cm)")}>
              <input className="input input-mono" value={p.height} onChange={(e) => set("height", e.target.value.replace(/\D/g, ""))} style={{ background: "var(--card-2)" }} />
            </IField>
            <IField label={t("Età")}>
              <input className="input input-mono" value={p.age} onChange={(e) => set("age", e.target.value.replace(/\D/g, ""))} style={{ background: "var(--card-2)" }} />
            </IField>
          </div>
          <IField label={t("Programma")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PROGRAMS.map(pr => {
                const on = p.program === pr;
                return (
                  <button key={pr} onClick={() => set("program", pr)} style={{
                    padding: "8px 14px", border: 0,
                    background: on ? "var(--accent)" : "var(--card-2)",
                    color: on ? "#fff" : "var(--text)",
                    borderRadius: 999, fontSize: 12.5, fontWeight: on ? 600 : 500,
                    cursor: "pointer", transition: "all 0.16s",
                  }}>{t(pr)}</button>
                );
              })}
            </div>
          </IField>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>{t("Annulla")}</button>
          <button className="btn primary" style={{ flex: 2 }} onClick={() => onSave(p)} disabled={!p.name.trim()}>{t("Salva")}</button>
        </div>
      </div>
    </div>
  );
};

// ── Main Impostazioni screen ───────────────────────────────────────────────
const Impostazioni = ({ device, onNav, theme, setTheme, weekNum, setWeekNum, bodyWeight, setBodyWeight, onResetAll }) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const { lang, setLang } = useLang();

  const [weightInput, setWeightInput] = React.useState(() => String(bodyWeight || 77.5));
  const [profile, setProfile]         = React.useState(() => window.storage ? window.storage.get("profile", { name: "Lorenzo", height: "178", age: "28", program: "Powerbuilding" }) : { name: "Lorenzo", height: "178", age: "28", program: "Powerbuilding" });
  const [editing, setEditing]         = React.useState(false);
  const [showReset, setShowReset]     = React.useState(false);

  // Sync theme selector display
  const themeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Auto";

  const handleTheme = (label) => {
    const val = label === "Dark" ? "dark" : label === "Light" ? "light" : "system";
    setTheme(val);
  };

  const handleWeightSave = () => {
    const n = parseFloat(weightInput);
    if (!isNaN(n) && n > 0) {
      setBodyWeight(n);
      // Also log to weightLog
      if (window.storage) {
        const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0,10);
        const log = window.storage.get("weightLog", []);
        const idx = log.findIndex(e => e.date === today);
        if (idx >= 0) { log[idx].weight = n; } else { log.push({ date: today, weight: n }); }
        window.storage.set("weightLog", log);
      }
      // Also save to Sheets (fire and forget)
      if (window.sheetsAPI) {
        const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0,10);
        window.sheetsAPI.savePesoCorporeo({ date: today, weight: n }).catch(() => {});
      }
    }
  };

  const handleProfileSave = (p) => {
    setProfile(p);
    setEditing(false);
    if (window.storage) window.storage.set("profile", p);
  };

  const handleReset = () => {
    setShowReset(false);
    if (onResetAll) onResetAll();
  };

  return (
    <div className="fade-up" style={{ padding: isDesktop ? "32px 40px" : "10px 16px 24px", display: "flex", flexDirection: "column", gap: isDesktop ? 22 : 18, maxWidth: 760, margin: isDesktop ? "0 auto" : 0 }}>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Configurazione")}</div>
        <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight: 600 }}>{t("Impostazioni")}</h1>
      </div>

      {/* Profile card */}
      <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 999,
          background: "linear-gradient(135deg, #FF9F0A 0%, #FF453A 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--display)", fontWeight: 700, fontSize: 22, color: "#1a0a04",
        }}>{profile.name.slice(0, 1).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{profile.name}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            <span className="num">{profile.height}</span> cm · <span className="num">{profile.age}</span> {t("anni")} · {t(profile.program)}
          </div>
        </div>
        <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 12, color: "var(--accent)" }} onClick={() => setEditing(true)}>
          {t("Modifica")}
        </button>
      </div>

      {editing && (
        <ProfileEditor
          isDesktop={isDesktop}
          profile={profile}
          onSave={handleProfileSave}
          onClose={() => setEditing(false)}
        />
      )}

      {/* — Progressi — (su mobile lo Storico non è nella tab bar: unico accesso) */}
      {onNav && (
        <ISection title={t("Progressi")}>
          <IRow
            icon="trend-up"
            iconBg="#30D158"
            title={t("Storico")}
            sub={t("Peso, cardio e check-in")}
            onClick={() => onNav("storico")}
            trailing={<Icon name="chevron" size={13} color="var(--text-3)" />}
          />
        </ISection>
      )}

      {/* — Aspetto — */}
      <ISection title={t("Aspetto")}>
        <IRow icon="sun" iconBg="#FF9F0A" title={t("Tema")}>
          <div className="segmented" style={{ width: 200 }}>
            {["Dark", "Light", "Auto"].map(th => (
              <button key={th} className={themeLabel === th ? "on" : ""} onClick={() => handleTheme(th)}>{th}</button>
            ))}
          </div>
        </IRow>
        <IRow icon="globe" iconBg="#0A84FF" title={t("Lingua")}>
          <div className="segmented" style={{ width: 130 }}>
            <button className={lang === "it" ? "on" : ""} onClick={() => setLang("it")}>IT</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </div>
        </IRow>
      </ISection>

      {/* — Dati personali — */}
      <ISection title={t("Dati personali")}>
        <div className="row">
          <div className="icon-wrap" style={{ background: "#30D158", color: "#fff" }}>
            <Icon name="scale" size={15} strokeWidth={2} />
          </div>
          <div className="row-main">
            <div className="row-title">{t("Peso corporeo")}</div>
            <div className="row-sub">{t("Aggiorna peso odierno")}</div>
          </div>
          <div className="row-trailing" style={{ gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--card-2)", borderRadius: 8, padding: "5px 8px", border: "1px solid var(--border)" }}>
              <input
                type="text"
                inputMode="decimal"
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                onBlur={handleWeightSave}
                onKeyDown={(e) => { if (e.key === "Enter") { e.target.blur(); handleWeightSave(); } }}
                className="input-mono"
                style={{ width: 52, background: "transparent", border: 0, outline: "none", color: "var(--text)", fontSize: 14, fontWeight: 600, textAlign: "right" }}
              />
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>kg</span>
            </div>
            <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={handleWeightSave}>
              {t("Log")}
            </button>
          </div>
        </div>
        <WeekStepper value={weekNum || 1} onChange={setWeekNum} />
      </ISection>

      {/* — Connessioni — */}
      <ISection title={t("Connessioni")} subtitle={t("API key e sorgenti dati")}>
        <ApiKeyRow
          icon="spark"
          iconBg="#BF5AF2"
          title={t("API key Groq")}
          sub={t("Coach AI · llama-3.3-70b-versatile")}
          storageKey="groqApiKey"
          placeholder="gsk_…"
          testFn={() => window.groqAPI.testConnection()}
        />
        <ApiKeyRow
          icon="doc"
          iconBg="#0A84FF"
          title="Google Apps Script URL"
          sub={t("Sheets: pesi, sessioni, movimenti")}
          storageKey="sheetsUrl"
          placeholder="https://script.google.com/macros/s/…/exec"
          testFn={() => window.sheetsAPI.testConnection()}
        />
      </ISection>

      {/* — Importa file — */}
      <ISection title={t("File di testo")} subtitle={t("Importa scheda.txt e dieta.txt")}>
        <FileImporter
          label="scheda.txt"
          icon="dumbbell"
          storageKey="schedaData"
          accept=".txt"
        />
        <FileImporter
          label="dieta.txt"
          icon="fork"
          storageKey="dietaData"
          accept=".txt"
        />
        <IRow icon="info" iconBg="#8E8E93" title={t("Cibi esclusi")} sub="Pasta di ceci · lenticchie · piselli · bevanda di mandorla">
          <span className="pill" style={{ fontSize: 10, background: "rgba(255,69,58,0.14)", color: "var(--danger)" }}>🚫 Sempre</span>
        </IRow>
      </ISection>

      {/* — Sync & Dati — */}
      <ISection title={t("Sincronizzazione & Dati")}>
        {(() => {
          const [syncing, setSyncing] = React.useState(false);
          const [syncResult, setSyncResult] = React.useState(null);
          const handleSync = async () => {
            setSyncing(true);
            setSyncResult(null);
            try {
              await window._cloudPushAll();
              setSyncResult({ ok: true });
            } catch (e) {
              setSyncResult({ ok: false, msg: e.message });
            } finally {
              setSyncing(false);
              setTimeout(() => setSyncResult(null), 4000);
            }
          };
          return (
            <IRow
              icon="refresh"
              iconBg="#0A84FF"
              title={t("Sincronizza ora")}
              sub={t("Pusha tutti i dati locali al cloud")}
              onClick={!syncing ? handleSync : undefined}
            >
              {syncing ? (
                <span className="spinner" style={{ width: 18, height: 18 }} />
              ) : syncResult ? (
                <span className="pill" style={{
                  fontSize: 10,
                  background: syncResult.ok ? "rgba(48,209,88,0.18)" : "rgba(255,69,58,0.14)",
                  color: syncResult.ok ? "var(--success)" : "var(--danger)",
                }}>
                  {syncResult.ok ? "✓ Sincronizzato" : "✗ Errore"}
                </span>
              ) : (
                <Icon name="chevron" size={13} color="var(--accent)" />
              )}
            </IRow>
          );
        })()}
        <IRow icon="lock" iconBg="#636366" title={t("Dati locali")} sub={t("Tutti i dati sono sul dispositivo")} trailing={
          <span className="pill" style={{ fontSize: 10 }}>🔒 {t("Solo locale")}</span>
        } />
        <IRow
          icon="refresh"
          iconBg="#FF453A"
          title={t("Reset completo")}
          sub={t("Elimina tutti i dati e ricomincia")}
          onClick={() => setShowReset(true)}
          trailing={<Icon name="chevron" size={13} color="var(--danger)" />}
        />
      </ISection>

      <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 11.5, padding: "8px 0 24px" }}>
        Lorenzo Fitness Hub · v2.5.0 · build 2026.05
      </div>

      {showReset && (
        <ResetModal onConfirm={handleReset} onCancel={() => setShowReset(false)} />
      )}
    </div>
  );
};

window.Impostazioni = Impostazioni;
