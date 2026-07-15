// onboarding.jsx — 3-step onboarding: Apps Script URL → Groq API key → Peso corporeo
// Salta automaticamente i passi già configurati in storage

const STEPS = [
  {
    label:       "Sorgente",
    title:       "Collega Google Sheets",
    sub:         "Incolla l'URL del tuo Google Apps Script (doGet/doPost). Configuri il foglio in Impostazioni.",
    icon:        "doc",
    iconColor:   "#0A84FF",
    field:       "sheets",
    placeholder: "https://script.google.com/macros/s/…/exec",
    mono:        false,
    storageKey:  "sheetsUrl",
  },
  {
    label:       "Coach",
    title:       "API key Groq",
    sub:         "Per attivare l'AI Coach. Ottienila su console.groq.com — gratuita.",
    icon:        "key",
    iconColor:   "#BF5AF2",
    field:       "api",
    placeholder: "gsk_…",
    mono:        true,
    storageKey:  "groqApiKey",
  },
  {
    label:       "Profilo",
    title:       "Il tuo peso attuale",
    sub:         "Inizia a tracciare il trend da oggi.",
    icon:        "scale",
    iconColor:   "#30D158",
    field:       "weight",
    placeholder: "100",
    mono:        true,
    suffix:      "kg",
    inputWidth:  180,
    storageKey:  "bodyWeight",
  },
];

// Controlla se un passo è già configurato in storage
function _stepAlreadyDone(s) {
  if (!window.storage) return false;
  const val = window.storage.get(s.storageKey, "");
  if (s.storageKey === "bodyWeight") {
    return !!val && parseFloat(val) > 0;
  }
  return !!(val && String(val).trim().length > 0);
}

const Onboarding = ({ device, onDone }) => {
  const isDesktop = device === "desktop";
  const t = useT();

  // Filtra solo i passi non ancora configurati
  const activeSteps = React.useMemo(
    () => STEPS.filter(s => !_stepAlreadyDone(s)),
    []
  );

  // Se tutto è già configurato, salta subito l'onboarding
  React.useEffect(() => {
    if (activeSteps.length === 0) {
      if (window.storage) window.storage.set("onboardingDone", true);
      onDone();
    }
  }, []);

  const [step, setStep] = React.useState(0);

  // Pre-popola i valori da storage (mostra quello già salvato nel campo)
  const [values, setValues] = React.useState(() => {
    const init = { sheets: "", api: "", weight: "" };
    STEPS.forEach(s => {
      if (window.storage) {
        const val = window.storage.get(s.storageKey, "");
        if (val) init[s.field] = String(val);
      }
    });
    return init;
  });

  const [saving, setSaving] = React.useState(false);

  // Niente da mostrare se tutto configurato
  if (activeSteps.length === 0) return null;

  const current = activeSteps[step];
  const isLast  = step === activeSteps.length - 1;
  const canNext = values[current.field].trim().length > 0;

  const handleDone = () => {
    setSaving(true);
    STEPS.forEach(s => {
      const val = values[s.field].trim();
      if (val && window.storage) {
        if (s.storageKey === "bodyWeight") {
          const num = parseFloat(val);
          if (!isNaN(num)) {
            window.storage.set("bodyWeight", num);
            const log = window.storage.get("weightLog", []);
            const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
            if (!log.find(e => e.date === today)) {
              log.push({ date: today, weight: num });
              window.storage.set("weightLog", log);
            }
          }
        } else {
          window.storage.set(s.storageKey, val);
        }
      }
    });
    if (window.storage) window.storage.set("onboardingDone", true);
    setTimeout(() => { setSaving(false); onDone(); }, 300);
  };

  const handleNext = () => {
    if (isLast) handleDone();
    else setStep(step + 1);
  };

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      padding: isDesktop ? "48px 64px" : "16px 20px 28px",
      background: "var(--bg)", position: "relative", overflow: "hidden",
    }}>
      {/* ambient bg gradient */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(60% 50% at 50% 0%, ${current.iconColor}1f 0%, transparent 70%)`,
        transition: "background 0.6s",
      }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "var(--brand-grad)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--display)", fontWeight: 700, fontSize: 13, color: "#fff",
          }}>LF</div>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.005 }}>{t("Fitness Hub")}</div>
        </div>
        {/* "Salta" deve settare onboardingDone come gli altri due percorsi (auto-skip
            e completamento), altrimenti il wizard riappare a ogni avvio */}
        <button onClick={() => { if (window.storage) window.storage.set("onboardingDone", true); onDone(); }} style={{
          background: "transparent", border: 0, color: "var(--text-2)",
          fontSize: 13, fontWeight: 500, cursor: "pointer",
        }}>{t("Salta")}</button>
      </div>

      {/* progress bars — solo per i passi attivi */}
      <div style={{ display: "flex", gap: 6, marginTop: isDesktop ? 28 : 22, position: "relative", zIndex: 1 }}>
        {activeSteps.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= step ? "var(--accent)" : "var(--track)",
            transition: "background 0.3s",
          }} />
        ))}
      </div>

      <div style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        maxWidth: 480, margin: "0 auto", width: "100%", position: "relative", zIndex: 1,
        gap: isDesktop ? 24 : 18,
      }}>

        <div className="fade-up" key={step} style={{ textAlign: "center" }}>
          <div style={{
            width: 72, height: 72, borderRadius: 22,
            background: `${current.iconColor}22`,
            border: `1px solid ${current.iconColor}44`,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 22px",
          }}>
            <Icon name={current.icon} size={32} color={current.iconColor} strokeWidth={1.6} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: current.iconColor, marginBottom: 8 }}>
            {t("Step")} {step + 1} {t("di")} {activeSteps.length} · {t(current.label)}
          </div>
          <h1 style={{ fontSize: isDesktop ? 34 : 26, fontWeight: 600, letterSpacing: -0.025, marginBottom: 10 }}>{t(current.title)}</h1>
          <p className="muted" style={{ fontSize: isDesktop ? 16 : 14, lineHeight: 1.5 }}>{t(current.sub)}</p>
        </div>

        <div className="fade-up" key={`f${step}`} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <input
            autoFocus
            className={"input " + (current.mono ? "input-mono" : "")}
            type={current.field === "api" ? "password" : "text"}
            placeholder={current.placeholder}
            value={values[current.field]}
            onChange={(e) => setValues(v => ({ ...v, [current.field]: e.target.value }))}
            style={{
              maxWidth: current.inputWidth || 420,
              fontSize: isDesktop ? 17 : 15.5,
              padding: "14px 18px",
              textAlign: current.suffix ? "center" : "left",
              fontWeight: current.mono ? 600 : 500,
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && canNext) handleNext(); }}
          />
          {current.suffix && (
            <span className="muted" style={{ fontSize: 18, fontWeight: 500 }}>{current.suffix}</span>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8 }}>
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)} style={{ minWidth: 120 }}>
              {t("Indietro")}
            </button>
          )}
          <button
            className="btn primary"
            disabled={!canNext || saving}
            onClick={handleNext}
            style={{ minWidth: 180, opacity: canNext && !saving ? 1 : 0.4, cursor: canNext ? "pointer" : "default" }}
          >
            {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : (
              <>
                {isLast ? t("Iniziamo") : t("Continua")}
                <Icon name="chevron" size={15} strokeWidth={2.4} />
              </>
            )}
          </button>
        </div>
      </div>

      <div className="muted" style={{ textAlign: "center", fontSize: 11.5, padding: "12px 0 0", position: "relative", zIndex: 1 }}>
        🔒 {t("Le credenziali sono cifrate e salvate solo sul tuo dispositivo.")}
      </div>
    </div>
  );
};

window.Onboarding = Onboarding;
