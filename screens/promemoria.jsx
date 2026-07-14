// screens/promemoria.jsx — impostazioni notifiche push
// PromemoriaEditor e PromemoriaOverrides: stub temporanei, sostituiti nei Task 8 e 9.
const PromemoriaEditor = () => null;
const PromemoriaOverrides = () => null;

const Promemoria = ({ device, onNav }) => {
  const isDesktop = device === "desktop";
  const t = useT();

  const [config, setConfig] = React.useState(() => {
    const saved = window.storage ? window.storage.get("notifConfig", null) : null;
    return saved || (window.buildDefaultNotifConfig ? window.buildDefaultNotifConfig() : { weekly:{}, daytypes:{}, overrides:{} });
  });
  const [enabled, setEnabled] = React.useState(() => window.storage ? window.storage.get("notifEnabled", false) : false);
  const [status, setStatus] = React.useState("");   // messaggio diagnostico
  const [selDay, setSelDay] = React.useState("ore17");

  const persist = (next) => {
    setConfig(next);
    if (window.storage) window.storage.set("notifConfig", next);
    if (window.pushAPI) window.pushAPI.syncConfig(next);
  };

  const onToggleMaster = async () => {
    if (!window.pushAPI) return;
    if (enabled) {
      await window.pushAPI.disable();
      setEnabled(false); setStatus("");
      return;
    }
    const res = await window.pushAPI.enable(config);
    if (res.ok) { setEnabled(true); setStatus(t("Notifiche attive")); }
    else {
      const map = {
        "unsupported": t("Notifiche non supportate su questo dispositivo"),
        "not-installed": t("Le notifiche richiedono l'app installata sulla Home"),
        "not-configured": t("Configurazione push mancante"),
        "denied": t("Permesso negato — riattiva da Impostazioni iOS"),
      };
      setStatus(map[res.error] || ("Errore: " + res.error));
    }
  };

  const regen = () => { if (window.buildDefaultNotifConfig) persist(window.buildDefaultNotifConfig()); };

  return (
    <div className="fade-up" style={{ padding: isDesktop ? "32px 40px" : "10px 16px 24px", display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ fontSize:11, fontWeight:600, color:"var(--text-3)", letterSpacing:0.5, textTransform:"uppercase" }}>{t("Impostazioni")}</div>
        <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight:600 }}>{t("Promemoria")}</h1>
      </div>

      {/* Master toggle */}
      <div className="card" style={{ padding:16, display:"flex", alignItems:"center", gap:12 }}>
        <Icon name="pill" size={20} color="var(--accent)" />
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>{t("Attiva notifiche")}</div>
          {status && <div className="muted" style={{ fontSize:12, marginTop:2 }}>{status}</div>}
        </div>
        <div className={`ios-toggle blue ${enabled ? "on" : ""}`} onClick={onToggleMaster} />
      </div>

      {/* placeholder: editor per giorno (Task 8) e sposta allenamento (Task 9) montati qui */}
      <PromemoriaEditor config={config} persist={persist} selDay={selDay} setSelDay={setSelDay} t={t} />
      <PromemoriaOverrides config={config} persist={persist} t={t} />

      <button onClick={regen} style={{ border:"1px solid var(--border)", background:"var(--card)", color:"var(--text)", borderRadius:14, padding:13, fontSize:14, fontWeight:600, cursor:"pointer" }}>
        {t("Rigenera orari dal piano")}
      </button>
    </div>
  );
};
window.Promemoria = Promemoria;
