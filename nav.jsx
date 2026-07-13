// nav.jsx — Bottom tab bar (mobile) + Sidebar (desktop)

const NAV_ITEMS = [
  { id: "dashboard",    icon: "home",     label: "Home" },
  { id: "scheda",       icon: "dumbbell", label: "Scheda" },
  { id: "dieta",        icon: "fork",     label: "Dieta" },
  { id: "spesa",        icon: "cart",     label: "Spesa" },
  { id: "coach",        icon: "spark",    label: "Coach" },
  { id: "storico",      icon: "trend-up", label: "Storico" },
  { id: "impostazioni", icon: "gear",     label: "Setup" },
];

// — Mobile bottom tab bar —
const TabBar = ({ screen, onNav }) => {
  const t = useT();
  // Mobile: 6 voci nella tab bar. Lo Storico è raggiungibile da Impostazioni → Progressi
  // (su desktop è nella Sidebar).
  const mobileItems = NAV_ITEMS.filter(it => it.id !== "storico");
  return (
    <nav
      style={{
        flexShrink: 0,
        display: "flex",
        gap: 0,
        padding: "8px 4px 10px",
        paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
        background: "var(--nav-bg)", // theme-aware: si adatta a dark/light
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: "1px solid var(--border)",
        position: "relative",
        zIndex: 5,
      }}
    >
      {mobileItems.map((it) => {
        const on = screen === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onNav(it.id)}
            style={{
              flex: 1,
              border: 0,
              background: "transparent",
              color: on ? "var(--accent)" : "var(--text-2)",
              padding: "6px 0 4px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              cursor: "pointer",
              transition: "color 0.16s",
            }}
          >
            <Icon name={it.icon} size={22} strokeWidth={on ? 2 : 1.6} />
            <span style={{ fontSize: 9.5, fontWeight: on ? 600 : 500, letterSpacing: -0.005 }}>{t(it.label)}</span>
          </button>
        );
      })}
    </nav>
  );
};

// — Desktop left sidebar —
const Sidebar = ({ screen, onNav }) => {
  const t = useT();
  const weekNum = window.storage ? window.storage.get("weekNum", 3) : 3;
  const todaySess = window.getTodaySession ? window.getTodaySession() : null;

  const labels = {
    dashboard:    t("Dashboard"),
    scheda:       t("Allenamento"),
    dieta:        t("Dieta"),
    spesa:        t("Lista spesa"),
    coach:        t("AI Coach"),
    storico:      t("Storico"),
    impostazioni: t("Impostazioni"),
  };

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        height: "100%",
        background: "var(--bg-2)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "22px 14px",
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 22px" }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: "var(--brand-grad)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--display)", fontWeight: 700, fontSize: 16, letterSpacing: -0.04,
        }}>LF</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.01 }}>Lorenzo</div>
          <div style={{ fontSize: 11, color: "var(--text-2)" }}>{t("Fitness Hub")}</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV_ITEMS.map(it => {
          const on = screen === it.id;
          return (
            <button
              key={it.id}
              onClick={() => onNav(it.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%",
                background: on ? "rgba(10,132,255,0.14)" : "transparent",
                color: on ? "var(--accent)" : "var(--text-2)",
                border: 0,
                padding: "10px 12px",
                borderRadius: 10,
                fontSize: 13.5,
                fontWeight: on ? 600 : 500,
                cursor: "pointer",
                letterSpacing: -0.005,
                textAlign: "left",
                transition: "background 0.14s, color 0.14s",
              }}
            >
              <Icon name={it.icon} size={18} strokeWidth={on ? 2 : 1.6} />
              {labels[it.id]}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: "auto", padding: "12px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px",
          background: "var(--card)",
          borderRadius: 12,
          border: "1px solid var(--border)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: "var(--brand-grad)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 13, color: "#fff", letterSpacing: "-0.03em",
          }}>LF</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Lorenzo</div>
            <div style={{ fontSize: 11, color: "var(--text-2)" }}>
              {t("Settimana")} {weekNum} · {todaySess ? todaySess.label : t("Riposo")}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

// — Sync badge — piccolo indicatore dello stato cloud-sync (legge window._syncState,
//   aggiornato da _cloudSync in app.jsx via evento "lfh-sync") —
const SyncBadge = ({ compact }) => {
  const t = useT();
  const [s, setS] = React.useState(() => window._syncState || { status: "idle", last: null });
  React.useEffect(() => {
    const on = () => setS(Object.assign({}, window._syncState || { status: "idle", last: null }));
    window.addEventListener("lfh-sync", on);
    return () => window.removeEventListener("lfh-sync", on);
  }, []);

  const status = s.status || "idle";
  if (status === "idle") return null;

  const time = s.last
    ? new Date(s.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const CFG = {
    syncing: { color: "var(--text-2)",  bg: "rgba(120,120,128,0.14)", icon: "cloud",     label: t("Sincronizzazione…") },
    ok:      { color: "var(--success)", bg: "rgba(48,209,88,0.12)",   icon: "cloud",     label: time ? `${t("Sync")} ${time}` : t("Sincronizzato") },
    error:   { color: "var(--warning)",  bg: "rgba(255,159,10,0.14)",  icon: "cloud-off", label: t("Sync non riuscito") },
    offline: { color: "var(--text-3)",  bg: "rgba(120,120,128,0.14)", icon: "cloud-off", label: t("Offline") },
  };
  const cfg = CFG[status] || CFG.ok;

  return (
    <span className="pill" title={cfg.label} style={{ fontSize: 10.5, padding: "3px 8px", gap: 5, background: cfg.bg, color: cfg.color }}>
      {status === "syncing"
        ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
        : <Icon name={cfg.icon} size={11} strokeWidth={2} />}
      {!compact && cfg.label}
    </span>
  );
};

window.TabBar  = TabBar;
window.Sidebar = Sidebar;
window.SyncBadge = SyncBadge;
window.NAV_ITEMS = NAV_ITEMS;
