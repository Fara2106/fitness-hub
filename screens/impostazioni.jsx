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
  <div className={onClick ? "row pressable" : "row"} onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
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
    // NB: la chiave Groq NON viene più sincronizzata al cloud (sicurezza): resta
    // solo sul device. Va reinserita a mano su ogni device (per te 1-2 volte).
  };

  const test = async () => {
    if (!testFn || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testFn();
      setTestResult({ ok: true, msg: r.reply ? `✓ OK — "${r.reply}"` : `✓ ${t("Connesso")} (${r.rows} ${t("righe")})` });
    } catch (e) {
      setTestResult({ ok: false, msg: "✗ " + (e.message || t("Errore")) });
    } finally {
      setTesting(false);
    }
  };

  const masked = val ? val.slice(0, 6) + "••••••••" + val.slice(-4) : "";

  return (
    <div>
      <div className="row pressable" onClick={() => setExpanded(e => !e)} style={{ cursor: "pointer" }}>
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
              // Testo mascherato invece di type="password": il campo password
              // attivava portachiavi/autofill iOS (che poteva riempirlo da solo).
              type="text"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              value={val}
              onChange={(e) => save(e.target.value)}
              placeholder={placeholder || t("Inserisci…")}
              className="input input-mono"
              style={{ flex: 1, fontSize: 13, padding: "10px 12px", WebkitTextSecurity: show ? "none" : "disc" }}
            />
            <button className="btn ghost" style={{ padding: "8px 10px", flexShrink: 0 }} onClick={() => setShow(s => !s)}>
              <Icon name={show ? "eye-off" : "eye"} size={14} />
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
// ── Validatori import .txt ─────────────────────────────────────────────────
// Parsano il file PRIMA di salvare: un file sbagliato non deve mai
// sovrascrivere i dati buoni in storage né essere pushato al cloud.
function _validateSchedaText(text, t) {
  try {
    if (!window.parseScheda) return { ok: true, detail: "" };
    const p = window.parseScheda(text);
    const days = (p && p.days) || [];
    if (!days.length) return { ok: false };
    const nEx = days.reduce((n, d) => n + ((d.exercises && d.exercises.length) || 0), 0);
    return { ok: true, detail: `${days.length} ${t("giorni")} · ${nEx} ${t("esercizi")}` };
  } catch (_) { return { ok: false }; }
}
function _validateDietaText(text, t) {
  try {
    if (!window.parseDieta) return { ok: true, detail: "" };
    const p = window.parseDieta(text);
    const secs = p ? Object.keys(p).filter(k =>
      p[k] && Array.isArray(p[k].meals) && p[k].meals.length > 0) : [];
    if (!secs.length) return { ok: false };
    const nMeals = secs.reduce((n, k) => n + p[k].meals.length, 0);
    return { ok: true, detail: `${secs.length} ${t("sezioni")} · ${nMeals} ${t("pasti")}` };
  } catch (_) { return { ok: false }; }
}

function _fmtImportDate(iso) {
  try {
    // "YYYY-MM-DD" (validFrom di un piano) → solo data, in ora locale.
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) {
      return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
    }
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch (_) { return ""; }
}

// ── Logica pura (testata in test/run.mjs, esposta come window.ImpostazioniLogic) ─
// Import .txt → piano strutturato (TEMPORANEO: finché il piano non si edita in-app).
// Il testo diventa un nuovo piano attivo (workoutPlan / dietPlan) con id
// workout|diet-YYYYMMDD-HHMM (con suffisso -2, -3… se l'id esiste già: due import nello
// stesso minuto non devono mai sovrascriversi), nome dal file e validFrom = oggi; il
// piano attivo precedente passa ad "archived" con validTo = oggi. SyncV2.putRecords
// aggiorna subito plan_workout / plan_diet (Scheda e Dieta lo usano) e mette in coda il push.
const _PLAN_IMPORT = {
  scheda: { collection: "workoutPlan", prefix: "workout", fromText: "workoutPlanFromText", legacy: "toLegacyScheda", local: "plan_workout", active: "workout" },
  dieta:  { collection: "dietPlan",    prefix: "diet",    fromText: "dietPlanFromText",    legacy: "toLegacyDieta",  local: "plan_diet",    active: "diet" },
};
function _importPlanChanges(kind, text, fileName, now) {
  const cfg = _PLAN_IMPORT[kind], PC = window.PlanConv;
  const d = now || new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const today = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const baseId = `${cfg.prefix}-${today.replace(/-/g, "")}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  // Piano attivo da archiviare: la copia locale; se manca (device mai collegato o cache vuota)
  // quello attivo tra i record noti, così non resta un secondo piano "active" sul server.
  let prev = window.storage ? window.storage.get(cfg.local, null) : null;
  if (!(prev && prev.id && prev.data)) {
    try { prev = PC.activePlan(window.SyncV2 ? window.SyncV2.listRecords(cfg.collection) : [], cfg.collection); } catch (_) { prev = null; }
  }
  const taken = new Set();
  if (prev && prev.id) taken.add(prev.id);
  try { (window.SyncV2 ? window.SyncV2.listRecords(cfg.collection) : []).forEach((r) => taken.add(r.id)); } catch (_) {}
  let id = baseId;
  for (let n = 2; taken.has(id); n++) id = `${baseId}-${n}`;
  const name = String(fileName || "").replace(/\.txt$/i, "") || kind;
  const plan = PC[cfg.fromText](text, { id, name, validFrom: today });
  // La lista della spesa vive nel piano dieta ma non nel .txt: il nuovo piano la eredita dal
  // precedente (copia, stessi id delle voci → le spunte restano valide) invece di perderla.
  if (cfg.collection === "dietPlan" && prev && prev.data && Array.isArray(prev.data.shopping) && plan.data.shopping === undefined) {
    plan.data.shopping = JSON.parse(JSON.stringify(prev.data.shopping));
  }
  // Stesso contenuto del piano attivo → niente nuovo piano.
  if (prev && prev.data && JSON.stringify(PC[cfg.legacy](prev.data)) === JSON.stringify(PC[cfg.legacy](plan.data))) {
    return { identical: true, changes: [] };
  }
  const changes = [{ collection: cfg.collection, id: plan.id, data: plan.data }];
  if (prev && prev.id && prev.id !== plan.id && prev.data) {
    changes.push({ collection: cfg.collection, id: prev.id, data: Object.assign({}, prev.data, { status: "archived", validTo: today }) });
  }
  return { identical: false, changes };
}

// Chiavi SOLO del device: mai nel backup (né in export né in ripristino). Token e
// chiave Groq sono segreti; il resto è stato del motore di sync (cursore, coda, cache record e piani).
// plan_workout/plan_diet sono una cache dei record dei piani (si ricalcola dai record): mai nel backup.
const _DEVICE_LOCAL_KEYS = ["syncToken", "v2deviceId", "v2cursor", "v2epoch", "v2outbox", "groqApiKey", "errorLog", "plan_workout", "plan_diet"];
function _isDeviceLocalKey(k) {
  return _DEVICE_LOCAL_KEYS.indexOf(k) !== -1 || k.startsWith("v2grp:") || k.startsWith("r:");
}
function _backupData(st) {
  const data = {};
  st.keys().filter((k) => !_isDeviceLocalKey(k)).sort().forEach((k) => { data[k] = st.get(k, null); });
  return data;
}
// Scrive le chiavi del file ignorando quelle del device (anche se presenti in un backup vecchio).
// In SILENZIO (Ruling 14): il motore di sync non deve leggerle come modifiche (tombstonerebbe tutto ciò
// che è nato dopo il backup, su ogni device). Dopo il ripristino l'UI chiama SyncV2.rebaseline().
function _restoreBackupData(st, data) {
  const keys = Object.keys(data || {}).filter((k) => !_isDeviceLocalKey(k));
  keys.forEach((k) => st.set(k, data[k], { silent: true }));
  return keys.length;
}

window.ImpostazioniLogic = {
  importPlanChanges: _importPlanChanges, isDeviceLocalKey: _isDeviceLocalKey, tokenFromInput: _tokenFromInput,
  backupData: _backupData, restoreBackupData: _restoreBackupData,
  validateSchedaText: _validateSchedaText, validateDietaText: _validateDietaText,
};

// NB: nessun filtro `accept` di default. iOS (picker "File") rende NON
// selezionabili i .txt quando accept=".txt"/"text/plain" (filtra per UTI):
// il popup si apre ma il file resta grigio. Senza accept il file è sempre
// selezionabile; la sicurezza è garantita da `validate` (valida il contenuto
// dopo la lettura, un file sbagliato non tocca i dati esistenti).
const FileImporter = ({ label, icon, kind, accept = "", validate }) => {
  const t = useT();
  const cfg = _PLAN_IMPORT[kind];
  const [status, setStatus] = React.useState(null); // {type:'ok'|'err'|'warn', msg}
  const inputRef = React.useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setStatus({ type: "err", msg: t("Errore di lettura del file") });
    reader.onload = (ev) => {
      // Normalizza: BOM (file da Windows/Blocco note) e a-capo CR/CRLF → LF.
      const text = String(ev.target.result || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
      // Validazione: se il formato non torna, NON toccare i dati esistenti
      const v = validate ? validate(text, t) : { ok: true, detail: "" };
      if (!v.ok || !window.PlanConv || !window.SyncV2) {
        setStatus({ type: "err", msg: t("Formato non valido — dati attuali conservati") });
        return;
      }
      let res;
      try { res = _importPlanChanges(kind, text, file.name); }
      catch (_) { setStatus({ type: "err", msg: t("Formato non valido — dati attuali conservati") }); return; }
      if (res.identical) {
        setStatus({ type: "ok", msg: t("File identico a quello attuale") });
        setTimeout(() => setStatus(null), 4000);
        return;
      }
      try { window.SyncV2.putRecords(res.changes); }
      catch (_) { setStatus({ type: "err", msg: t("Errore salvataggio") }); return; }
      const okMsg = `${t("Importato")}${v.detail ? " · " + v.detail : ""}`;
      if (!window.SyncV2.hasToken()) {
        setStatus({ type: "warn", msg: `${okMsg} · ${t("salvato sul device (non collegato)")}` });
        setTimeout(() => setStatus(null), 6000);
        return;
      }
      setStatus({ type: "ok", msg: `${okMsg} · ${t("sync cloud…")}` });
      window.SyncV2.syncNow().then(r => {
        setStatus(r && r.ok
          ? { type: "ok",   msg: `${okMsg} · ${t("sincronizzato")}` }
          : { type: "warn", msg: `${okMsg} · ${t("salvato sul device, sync cloud appena torna la rete")}` });
        setTimeout(() => setStatus(null), 6000);
      });
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
        <div className="row-sub" style={status ? { color: status.type === "err" ? "var(--danger)" : status.type === "warn" ? "var(--warning)" : "var(--success)" } : undefined}>
          {status ? status.msg : t("Crea un nuovo piano attivo e archivia quello precedente")}
        </div>
      </div>
      <div className="row-trailing">
        <button
          className="btn"
          style={{ padding: "6px 12px", fontSize: 12 }}
          onClick={() => inputRef.current?.click()}
        >
          {t("Importa")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept || undefined}
          style={{ display: "none" }}
          onChange={handleFile}
          onClick={(e) => { e.target.value = ""; }}
        />
      </div>
    </div>
  );
};

// ── Piani in sola lettura: attivo + archiviati (da SyncV2, aggiornati dal pull) ───
const PlanKindRows = ({ kind, label, icon }) => {
  const t = useT();
  const cfg = _PLAN_IMPORT[kind];
  const read = () => {
    const act = window.SyncV2 ? window.SyncV2.activePlans()[cfg.active] : null;
    let arch = [];
    try {
      arch = (window.SyncV2 ? window.SyncV2.listRecords(cfg.collection) : [])
        .filter(r => !r.deleted && r.data && r.data.status === "archived")
        .sort((x, y) => String(y.data.validFrom || "").localeCompare(String(x.data.validFrom || "")) || String(y.id).localeCompare(String(x.id)));
    } catch (_) {}
    return { act, arch };
  };
  const [st, setSt] = React.useState(read);
  const [open, setOpen] = React.useState(false);
  useSyncedData([cfg.local], () => setSt(read()));
  const act = st.act && st.act.data;
  const count = act
    ? (kind === "scheda"
        ? `${(act.days || []).length} ${t("giorni")}`
        : `${(act.variants || []).length} ${t("sezioni")}`)
    : "";
  const period = (d) => `${d.validFrom ? _fmtImportDate(d.validFrom) : "?"} – ${d.validTo ? _fmtImportDate(d.validTo) : "?"}`;
  return (
    <React.Fragment>
      <IRow
        icon={icon}
        iconBg="#30D158"
        title={`${label}${act && act.name ? ": " + act.name : ""}`}
        sub={act
          ? `${act.validFrom ? t("dal") + " " + _fmtImportDate(act.validFrom) : ""}${count ? " · " + count : ""}`
          : t("Nessun piano: si usa il testo predefinito dell'app")}
      />
      {st.arch.length > 0 && (
        <IRow
          icon="clock"
          iconBg="#8E8E93"
          title={`${t("Piani archiviati")} (${st.arch.length})`}
          onClick={() => setOpen(o => !o)}
          trailing={<span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "flex" }}><Icon name="chevron" size={13} color="var(--text-3)" /></span>}
        />
      )}
      {open && st.arch.map(r => (
        <div className="row" key={r.id}>
          <div className="row-main" style={{ paddingLeft: 40 }}>
            <div className="row-title" style={{ fontSize: 14 }}>{r.data.name || r.id}</div>
            <div className="row-sub">{period(r.data)}</div>
          </div>
        </div>
      ))}
    </React.Fragment>
  );
};

// ── Esporta piani (.txt) ────────────────────────────────────────────────────
// Esporta il piano ATTIVO (record sincronizzato, non il testo vecchio del device) in testo
// leggibile e completo (PlanConv.planToText con full:true: niente taglio a 3000 caratteri),
// via share sheet (iOS: "Salva su File") o download. Senza piani: il testo embedded dell'app.
const PlanExportRow = ({ label, icon, kind, fallbackKey, fileName }) => {
  const t = useT();
  const cfg = _PLAN_IMPORT[kind];
  const [status, setStatus] = React.useState(null); // {type:'ok'|'err', msg}

  const planText = () => {
    const act = window.SyncV2 ? window.SyncV2.activePlans()[cfg.active] : null;
    if (act && act.data && window.PlanConv) {
      return kind === "scheda"
        ? window.PlanConv.planToText(act.data, null, { full: true })
        : window.PlanConv.planToText(null, act.data, { full: true });
    }
    return window[fallbackKey] || "";
  };

  const doExport = async () => {
    try {
      const text = planText();
      if (!text) { setStatus({ type: "err", msg: t("Nessun testo da esportare") }); return; }
      const file = new File([text], fileName, { type: "text/plain" });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: fileName });
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        const a = document.createElement("a");
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      setStatus({ type: "ok", msg: "✓ " + t("Esportato") });
      setTimeout(() => setStatus(null), 2500);
    } catch (e) {
      if (e && e.name === "AbortError") return; // share annullata dall'utente
      setStatus({ type: "err", msg: `${t("Export fallito")}: ${e.message || e}` });
    }
  };

  return (
    <IRow
      icon={icon}
      iconBg="#5AC8FA"
      title={label}
      sub={status ? status.msg : t("Il piano attivo in testo leggibile")}
      onClick={doExport}
      trailing={<Icon name="chevron" size={13} color="var(--accent)" />}
    />
  );
};

// ── Sync now row (componente dedicato: gli hook NON possono stare in una
//    IIFE dentro al render — ordine fragile e contrario alle Rules of Hooks) ─
const SyncNowRow = () => {
  const t = useT();
  const [syncing, setSyncing] = React.useState(false);
  const [syncResult, setSyncResult] = React.useState(null);

  // Sync completo con il backend (invio coda + ricezione); senza token → "non collegato".
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = window.SyncV2 ? await window.SyncV2.syncNow() : { ok: false, error: "assente" };
      setSyncResult({ ok: !!(r && r.ok), unlinked: !!(r && r.error === "unlinked") });
    } catch (e) {
      setSyncResult({ ok: false });
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
      sub={t("Invia e ricevi le modifiche")}
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
          {syncResult.ok ? "✓ " + t("Sincronizzato") : "✗ " + (syncResult.unlinked ? t("Non collegato") : t("Errore"))}
        </span>
      ) : (
        <Icon name="chevron" size={13} color="var(--accent)" />
      )}
    </IRow>
  );
};

// ── Collega questo device: token di sync (mai mostrato per intero) ───────────
// Il token sta solo in window.storage (syncToken), mai nel backup né sincronizzato.
// Accetta il token da solo o l'intero link ".../#sync=<token>" incollato.
const _TOKEN_RE = /^[0-9a-fA-F]{64}$/;
// Token in minuscolo (com'è generato, openssl rand -hex): un link o un incolla in maiuscolo è lo stesso token.
function _tokenFromInput(raw) {
  const v = String(raw || "").trim();
  const i = v.indexOf("#sync=");
  const cand = i >= 0 ? v.slice(i + 6) : v;
  return _TOKEN_RE.test(cand) ? cand.toLowerCase() : null;
}
const SyncLinkRow = () => {
  const t = useT();
  const read = () => {
    const tok = window.storage ? window.storage.get("syncToken", null) : null;
    return typeof tok === "string" && tok ? tok.slice(-4) : null;
  };
  const [tail, setTail] = React.useState(read);
  const [val, setVal] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [res, setRes] = React.useState(null); // {type:'ok'|'warn'|'err', msg}
  React.useEffect(() => {
    const on = () => setTail(read());
    window.addEventListener("lfh-sync", on);
    return () => window.removeEventListener("lfh-sync", on);
  }, []);

  const connect = async () => {
    if (busy) return;
    const token = _tokenFromInput(val);
    if (!token) { setRes({ type: "err", msg: t("Token non valido: servono 64 caratteri esadecimali") }); return; }
    if (!window.SyncV2) { setRes({ type: "err", msg: t("Errore") }); return; }
    const cur = window.storage ? window.storage.get("syncToken", null) : null;
    if (cur && String(cur).toLowerCase() !== token && !window.confirm(t("Questo device è già collegato con un altro token. Sostituirlo?"))) return;
    setBusy(true); setRes(null);
    try {
      const r = await window.SyncV2.setToken(token);
      setTail(read());
      if (r && r.ok) { setVal(""); setRes({ type: "ok", msg: t("Collegato e sincronizzato") }); }
      else if (r && r.error === "unauthorized") setRes({ type: "err", msg: t("Token rifiutato dal server") });
      else { setVal(""); setRes({ type: "warn", msg: t("Token salvato, ma il server non è raggiungibile: riprova più tardi") }); }
    } catch (_) {
      setTail(read());
      setRes({ type: "err", msg: t("Errore") });
    } finally { setBusy(false); }
  };
  const unlink = async () => {
    if (busy || !window.SyncV2) return;
    try { await window.SyncV2.setToken(""); } catch (_) {}
    setTail(read()); setRes(null);
  };

  const color = res ? (res.type === "err" ? "var(--danger)" : res.type === "warn" ? "var(--warning)" : "var(--success)") : "var(--text-3)";
  return (
    <div>
      <IRow
        icon="key"
        iconBg="#5E5CE6"
        title={t("Collega questo device")}
        sub={tail ? `${t("Collegato")} · …${tail}` : t("Non collegato")}
      >
        {tail && <button className="btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={unlink}>{t("Scollega")}</button>}
      </IRow>
      <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="text"
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={t("Incolla il token o il link")}
            aria-label={t("Token di sincronizzazione")}
            className="input input-mono"
            style={{ flex: 1, minWidth: 0, fontSize: 13, padding: "10px 12px", WebkitTextSecurity: "disc" }}
          />
          <button className="btn" style={{ padding: "8px 14px", fontSize: 13 }} onClick={connect} disabled={busy || !val.trim()}>
            {busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : t("Collega")}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color, lineHeight: 1.4 }}>
          {res ? res.msg : t("Il link con #sync=<token> funziona nel browser. Nell'app installata sulla Home incolla qui il token (il browser ha uno storage separato).")}
        </div>
      </div>
    </div>
  );
};

// ── Sync status row — legge window._syncState (aggiornato da SyncV2) ────────
const SyncStatusRow = () => {
  const t = useT();
  const [s, setS] = React.useState(() => window._syncState || { status: "idle", last: null });
  React.useEffect(() => {
    const on = () => setS(Object.assign({}, window._syncState || { status: "idle", last: null }));
    window.addEventListener("lfh-sync", on);
    return () => window.removeEventListener("lfh-sync", on);
  }, []);

  const time = s.last
    ? new Date(s.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  let pending = 0;
  try { pending = window.SyncV2 ? window.SyncV2.status().pending : 0; } catch (_) {}
  const base = time ? `${t("Ultimo sync")}: ${time} · ${t("Cloud: Cloudflare")}` : s.status === "unlinked" ? t("Device non collegato: dati solo in locale") : t("In attesa del primo sync");

  return (
    <IRow
      icon="cloud"
      iconBg="#30D158"
      title={t("Stato sincronizzazione")}
      sub={pending > 0 ? `${base} · ${pending} ${t("modifiche in coda")}` : base}
    >
      {window.SyncBadge ? <SyncBadge /> : null}
    </IRow>
  );
};

// ── Backup: esporta/ripristina TUTTO lo storage locale in un .json ─────────
// Protezione contro l'eviction di IndexedDB su iOS: i dati per-giorno
// (schedaProg_/gym_/coachChat_…) vivono SOLO sul device finché la sessione non
// è chiusa e sincronizzata. Il file NON include i dati del device: token di sync,
// stato del motore (cursore, coda, cache record), chiave Groq e log errori.
const BackupRows = () => {
  const t = useT();
  const [status, setStatus] = React.useState(null); // {type:'ok'|'err', msg}
  const inputRef = React.useRef(null);

  const doExport = async () => {
    try {
      const st = window.storage;
      if (!st || !st.keys) throw new Error("storage non pronto");
      const data = _backupData(st);
      const json = JSON.stringify({ _lfhBackup: 1, exportedAt: new Date().toISOString(), data });
      const name = "fitness-hub-backup-" + (window.todayKey ? window.todayKey() : "export") + ".json";
      const file = new File([json], name, { type: "application/json" });
      // iOS standalone: share sheet ("Salva su File"); altrove: download diretto
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: name });
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      setStatus({ type: "ok", msg: `${t("Backup esportato")} · ${Object.keys(data).length} ${t("chiavi")}` });
    } catch (e) {
      if (e && e.name === "AbortError") return; // share annullata dall'utente
      setStatus({ type: "err", msg: `${t("Export fallito")}: ${e.message || e}` });
    }
  };

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onerror = () => setStatus({ type: "err", msg: t("Errore di lettura del file") });
    reader.onload = (ev) => {
      let p = null;
      try { p = JSON.parse(ev.target.result); } catch (_) {}
      // Validazione: file sbagliato → i dati esistenti restano intatti
      if (!p || p._lfhBackup !== 1 || !p.data || typeof p.data !== "object") {
        setStatus({ type: "err", msg: t("File non valido — dati attuali conservati") });
        return;
      }
      if (!window.confirm(t("Ripristinare il backup? I dati locali verranno sovrascritti, ma i dati già sincronizzati non vengono riportati indietro."))) return;
      const n = _restoreBackupData(window.storage, p.data);
      // La cache dei piani non è nel backup: ricalcolata dai record, così la Scheda non resta su un piano vecchio.
      try { if (window.SyncV2 && window.SyncV2.refreshPlans) window.SyncV2.refreshPlans(); } catch (_) {}
      // Rebaseline (Ruling 14): primo sync → il server tiene i dati più nuovi, parte solo ciò che non ha.
      let sync = null;
      try { if (window.SyncV2 && window.SyncV2.rebaseline) sync = window.SyncV2.rebaseline(); } catch (_) {}
      setStatus({ type: "ok", msg: `${t("Backup ripristinato")} · ${n} ${t("chiavi")}` });
      // Ricarica dopo il sync (al massimo 5 s): anche se si ricarica prima, il primo sync riparte all'avvio.
      const wait = new Promise((res) => setTimeout(res, 5000));
      Promise.race([Promise.resolve(sync).catch(() => {}), wait])
        .then(() => setTimeout(() => window.location.reload(), 600));
    };
    reader.readAsText(f, "UTF-8");
  };

  return (
    <React.Fragment>
      <IRow
        icon="cloud"
        iconBg="#30D158"
        title={t("Esporta backup (.json)")}
        sub={status && status.type === "ok" ? status.msg : t("Tutto lo storage locale, tranne token e chiave Groq")}
        onClick={doExport}
        trailing={<Icon name="chevron" size={13} color="var(--accent)" />}
      />
      <div className="row">
        <div className="icon-wrap" style={{ background: "#FF9F0A", color: "#fff" }}>
          <Icon name="upload" size={15} strokeWidth={2} />
        </div>
        <div className="row-main">
          <div className="row-title">{t("Ripristina backup")}</div>
          <div className="row-sub" style={status && status.type === "err" ? { color: "var(--danger)" } : undefined}>
            {status && status.type === "err" ? status.msg : t("Sovrascrive i dati locali col file")}
          </div>
        </div>
        <div className="row-trailing">
          <button className="btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => inputRef.current?.click()}>
            {t("Importa")}
          </button>
          <input
            ref={inputRef}
            type="file"
            style={{ display: "none" }}
            onChange={handleFile}
            onClick={(e) => { e.target.value = ""; }}
          />
        </div>
      </div>
    </React.Fragment>
  );
};

// ── Diagnostica: log errori JS del device (raccolto in index.html) ─────────
// Gli errori solo-iOS (SW, safe-area, …) erano invisibili: ora restano leggibili
// e copiabili dal device. Sorgente: storage "errorLog" (ring degli ultimi 50).
const DiagnosticaRow = () => {
  const t = useT();
  const read = () => (window.storage && window.storage.get("errorLog", [])) || [];
  const [errors, setErrors] = React.useState(read);
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const on = () => setErrors(read());
    window.addEventListener("lfh-err", on);
    return () => window.removeEventListener("lfh-err", on);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(errors, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };
  const clear = () => {
    if (window.storage) window.storage.set("errorLog", []);
    setErrors([]);
  };

  const fmtT = (iso) => {
    try { return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (_) { return ""; }
  };

  return (
    <div>
      <IRow
        icon="info"
        iconBg={errors.length ? "#FF453A" : "#8E8E93"}
        title={t("Log errori")}
        sub={errors.length
          ? `${errors.length} ${errors.length === 1 ? t("errore registrato") : t("errori registrati")}`
          : t("Nessun errore registrato 🎉")}
        onClick={() => setExpanded(x => !x)}
        trailing={
          <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "flex" }}>
            <Icon name="chevron" size={13} color="var(--text-3)" />
          </span>
        }
      />
      {expanded && (
        <div className="fade-up" style={{ padding: "10px 16px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
          {errors.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
              {errors.slice(-10).reverse().map((e, i) => (
                <div key={i} style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                  <span className="num" style={{ color: "var(--text-3)" }}>{fmtT(e.t)}</span>
                  <span style={{ color: "var(--danger)", marginLeft: 6 }}>{e.type}</span>
                  <div style={{ color: "var(--text-2)", wordBreak: "break-word" }}>{e.msg}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" style={{ padding: "7px 12px", fontSize: 12 }} onClick={copy} disabled={!errors.length}>
              {copied ? "✓ " + t("Copiato") : t("Copia tutto")}
            </button>
            <button className="btn ghost" style={{ padding: "7px 12px", fontSize: 12 }} onClick={clear} disabled={!errors.length}>
              {t("Svuota")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Reset confirmation — bottom sheet ──────────────────────────────────────
const ResetModal = ({ onConfirm, onCancel }) => {
  const t = useT();
  return (
    <div
      onClick={onCancel}
      className="lfh-overlay"
      style={{
        zIndex: 300,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-end",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="pop-in" style={{
        width: "100%", background: "var(--bg-2)",
        borderTopLeftRadius: "var(--r-xl)", borderTopRightRadius: "var(--r-xl)",
        borderTop: "1px solid var(--border)", padding: "10px 22px 30px",
        display: "flex", flexDirection: "column", gap: 16,
        boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: "var(--border-2)", alignSelf: "center", marginBottom: 4 }} />
        <div style={{ width: 52, height: 52, borderRadius: 999, background: "rgba(255,69,58,0.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, alignSelf: "center" }}>⚠️</div>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>{t("Reset completo")}?</h2>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            {t("Tutti i dati verranno eliminati: check-in, storico pesi, attività, impostazioni e file importati. Questa operazione non è reversibile.")}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 4 }}>
          <button className="btn danger" style={{ padding: 15, fontSize: 16 }} onClick={onConfirm}>{t("Resetta tutto")}</button>
          <button className="btn" style={{ padding: 15, fontSize: 16 }} onClick={onCancel}>{t("Annulla")}</button>
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
    // Overlay fisso in un portal: con position:absolute sulla pagina lunga di
    // Impostazioni il pannello finiva in fondo alla pagina, fuori schermo.
    <UIPortal>
    <div onClick={onClose} className="lfh-overlay" style={{
      zIndex: 200,
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
    </UIPortal>
  );
};

// ── Main Impostazioni screen ───────────────────────────────────────────────
const Impostazioni = ({ device, onNav, theme, setTheme, bodyWeight, setBodyWeight, onResetAll }) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const { lang, setLang } = useLang();

  const [profile, setProfile]         = React.useState(() => window.storage ? window.storage.get("profile", { name: "Lorenzo", height: "178", age: "28", program: "Powerbuilding" }) : { name: "Lorenzo", height: "178", age: "28", program: "Powerbuilding" });
  const [editing, setEditing]         = React.useState(false);
  const [showReset, setShowReset]     = React.useState(false);

  // Sync theme selector display
  const themeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Auto";

  const handleTheme = (label) => {
    const val = label === "Dark" ? "dark" : label === "Light" ? "light" : "system";
    setTheme(val);
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
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Profilo")}</div>
        <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight: 600 }}>{t("Impostazioni")}</h1>
      </div>

      {/* Profile hero — gradiente di marca */}
      <div style={{
        position: "relative", borderRadius: "var(--r-lg)", padding: 20, overflow: "hidden",
        background: "var(--brand-grad)", boxShadow: "0 16px 34px -16px rgba(10,132,255,0.6)",
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{
          width: 54, height: 54, borderRadius: 999, flexShrink: 0,
          background: "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 20, color: "#fff",
        }}>{profile.name.slice(0, 1).toUpperCase() || "?"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>{profile.name}</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>
            <span className="num">{profile.height}</span> cm · <span className="num">{profile.age}</span> {t("anni")} · {t(profile.program)}
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          style={{
            flexShrink: 0, background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.35)",
            color: "#fff", borderRadius: 999, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          }}
        >{t("Modifica")}</button>
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
          <IRow
            icon="pill"
            iconBg="#FF453A"
            title={t("Promemoria")}
            onClick={() => onNav("promemoria")}
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

      {/* — Connessioni — */}
      <ISection title={t("Connessioni")} subtitle={t("API key e sorgenti dati")}>
        <ApiKeyRow
          icon="spark"
          iconBg="#BF5AF2"
          title={t("API key Groq")}
          sub={t("Coach AI · Groq gpt-oss-120b")}
          storageKey="groqApiKey"
          placeholder="gsk_…"
          testFn={() => window.groqAPI.testConnection()}
        />
      </ISection>

      {/* — Sincronizzazione — */}
      <ISection title={t("Sincronizzazione")}>
        <SyncStatusRow />
        <SyncLinkRow />
        <SyncNowRow />
      </ISection>

      {/* — Piani (sola lettura; l'import .txt è temporaneo) — */}
      <ISection title={t("Piani")} subtitle={t("Sola lettura · l'import .txt è temporaneo")}>
        <PlanKindRows kind="scheda" label={t("Scheda attiva")} icon="dumbbell" />
        <PlanKindRows kind="dieta" label={t("Dieta attiva")} icon="fork" />
        <FileImporter
          label={t("Importa scheda .txt (temporaneo)")}
          icon="dumbbell"
          kind="scheda"
          validate={_validateSchedaText}
        />
        <FileImporter
          label={t("Importa dieta .txt (temporaneo)")}
          icon="fork"
          kind="dieta"
          validate={_validateDietaText}
        />
        <PlanExportRow
          label={t("Esporta scheda (.txt)")}
          icon="send"
          kind="scheda"
          fallbackKey="SCHEDA_TXT_FALLBACK"
          fileName="scheda.txt"
        />
        <PlanExportRow
          label={t("Esporta dieta (.txt)")}
          icon="send"
          kind="dieta"
          fallbackKey="DIETA_TXT_FALLBACK"
          fileName="dieta.txt"
        />
        <IRow icon="info" iconBg="#8E8E93" title={t("Cibi esclusi")} sub="Pasta di ceci · lenticchie · piselli · bevanda di mandorla">
          <span className="pill" style={{ fontSize: 10, background: "rgba(255,69,58,0.14)", color: "var(--danger)" }}>🚫 {t("Sempre")}</span>
        </IRow>
      </ISection>

      {/* — Backup locale (protezione da eviction IndexedDB su iOS) — */}
      <ISection title={t("Backup")} subtitle={t("I dati per-giorno vivono solo su questo device")}>
        <BackupRows />
      </ISection>

      {/* — Diagnostica — */}
      <ISection title={t("Diagnostica")}>
        <DiagnosticaRow />
      </ISection>

      {/* — Reset: azione distruttiva, isolata e in evidenza — */}
      <button
        onClick={() => setShowReset(true)}
        style={{
          background: "none", border: "1px solid rgba(255,69,58,0.35)", color: "var(--danger)",
          borderRadius: "var(--r)", padding: 14, fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 4,
        }}
      >{t("Reset completo")}</button>

      <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 11.5, padding: "8px 0 24px" }}>
        Lorenzo Fitness Hub · v2.8.0 · build 2026.07
      </div>

      {showReset && (
        <UIPortal><ResetModal onConfirm={handleReset} onCancel={() => setShowReset(false)} /></UIPortal>
      )}
    </div>
  );
};

window.Impostazioni = Impostazioni;
