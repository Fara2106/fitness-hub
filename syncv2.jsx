// syncv2.jsx — motore di sync offline-first della PWA sul backend v2 (Worker fitness-hub-api + D1).
//
//   window.SyncV2 = {
//     API,                                   URL del Worker
//     init({ storage, fetch, now?, setTimeout?, clearTimeout?, today? })   da chiamare dopo storage.onReady
//     setToken(token) → Promise<{ ok, error? }>   salva il token e prova un sync (401 → token non salvato)
//     hasToken() → boolean
//     linkTokenFromHash(hash) → token|null · consumeLinkHash(loc?, hist?, confirmReplace?) → Promise|null · refreshPlans() → chiavi   (#sync=<64 hex> all'avvio)
//     syncNow()  → Promise<{ ok, pushed, pulled, error? }>   error: "unlinked"|"offline"|"unauthorized"|…
//     rebaseline() → Promise   dopo un ripristino del backup (scritto in silenzio): il prossimo sync è un primo sync
//     putRecords(changes)                    scrittura diretta di record ({collection,id,data,deleted?}), per i piani
//     getRecord(collection, id) → Record|null      cache + modifiche in coda (tombstone inclusi)
//     listRecords(collection)   → Record[]         idem, tutta la collezione
//     activePlans() → { workout, diet }            copie locali plan_workout / plan_diet ({id,data}|null)
//     status() → { status, last, pending, linked }
//   }
//   Stato pubblicato in window._syncState ({ status: idle|syncing|ok|error|offline|unlinked, last }) + evento
//   "lfh-sync"; dopo ogni applicazione di record in arrivo, evento "lfh-data" con detail { keys } (chiavi
//   locali riscritte).
//
// Storage solo del device (mai sincronizzato, mai nel backup): syncToken, v2deviceId, v2cursor, v2epoch,
// v2outbox ({ "<collection>/<id>": Change }, coalescente), v2grp:<gruppo> (["<collection>/<id>"] prodotti
// l'ultima volta dal gruppo), r:<collection>:<id> (cache dei record del server).
//
// Push: storage.onChange non silenzioso → RecordMap.groupsForKey → buildGroup → diff con cache+coda →
// change in v2outbox (updatedAt = max(now, precedente + 1)); tombstone solo per id che il gruppo aveva
// prodotto (v2grp), ora assenti, dentro la `window` del gruppo e non protetti (RecordMap.isProtected). Risultato "noTouch" (records [] e
// minId "￿") = non toccare nulla. Invio debounced 1,5 s, a lotti ≤ 500 change e ≤ 1,5 MB.
// Pull: record in cache; per i record di ALTRI device keysForRecord → rebuildKeys (vista cache + coda:
// le modifiche in coda vincono) → storage.set/remove silenziosi, solo chiavi con data ≥ oggi−90; piani →
// plan_workout / plan_diet. conflicts e echo adottati; reset:true → il pull riparte da 0, coda tenuta.
// Primo sync (cursore 0 e nessun v2grp): pull completo SENZA toccare le chiavi, poi in coda solo i record
// locali che il server non ha (+ i record cambiati dall'utente mentre il sync era in corso), poi
// ricostruzione delle chiavi: un device con dati vecchi non sovrascrive mai dati più nuovi del server.
// Epoch cambiato (DB ripristinato, Ruling 9) = primo sync: via cache r:*, v2grp e cursore, coda tenuta.
// rebaseline() (ripristino di un backup, Ruling 14) = primo sync: via v2grp e cursore (cache r:* tenuta), poi
// sync → il server vince sugli id che ha, si pusha solo ciò che non ha (mai tombstone per dati più nuovi).
// Un giro di sync in volo durante il rebaseline non salva cursore né chiavi (generazione `gen`).
(function () {
  const API = "https://fitness-hub-api.lorefara97.workers.dev";
  const DEBOUNCE_MS = 1500;
  const MAX_BATCH = 500;
  const MAX_BATCH_BYTES = 1.5 * 1024 * 1024;
  const ENVELOPE_BYTES = 1024;               // deviceId, cursor e parentesi del corpo
  const MAX_DATA_BYTES = 65536;              // stessi limiti di backend/src/validate.mjs
  const MAX_ID_LEN = 128;
  const MAX_ROUNDS = 200;
  const HORIZON_DAYS = 90;                   // sweep _cleanupOldDailyKeys
  const NONE = "￿";                     // RecordMap: window.minId "non toccare niente"
  const COLLECTIONS = new Set([
    "workoutPlan", "dietPlan", "dayState", "setLog", "workoutSession", "mealCheck", "supplementCheck",
    "bodyWeight", "bodyMeasure", "shoppingCheck", "shoppingExtra", "exerciseNote", "personalRecord",
    "coachMessage", "settings",
  ]);
  const PLAN_KEY = { workoutPlan: "plan_workout", dietPlan: "plan_diet" };
  const K = { token: "syncToken", device: "v2deviceId", cursor: "v2cursor", epoch: "v2epoch", outbox: "v2outbox" };
  const GRP = "v2grp:", REC = "r:";
  const LOCAL_ONLY = /^(r:|v2|syncToken$|plan_workout$|plan_diet$)/;
  const DATED_KEY = /_(\d{4}-\d{2}-\d{2})$/;
  const DATED_GROUP = /:(\d{4}-\d{2}-\d{2})$/;
  const SILENT = { silent: true };
  const MISSING = {};

  let S = null, F = null, clock = () => Date.now(), setT = null, clearT = null, todayFn = null, unsub = null;
  let cache = new Map();          // collection → Map(id → Record)
  let outbox = {};                // "<collection>/<id>" → Change (coalescente, ordine d'inserimento)
  let deviceId = null;
  const dirty = new Set();        // gruppi da ricalcolare (flush in microtask)
  const touched = new Set();      // chiavi modificate durante il primo sync (vedi enqueueTouchedEdits)
  let firstDone = false, firstRunning = false, flushScheduled = false, timer = null;
  let state = { status: "idle", last: null };
  let chain = Promise.resolve(), queued = null;
  let gen = 0;                    // cresce a ogni rebaseline: un exchange in volo di prima si ferma

  // ── helper ────────────────────────────────────────────────────────────────
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const keyOf = (c, id) => `${c}/${id}`;
  const splitKey = (k) => { const i = k.indexOf("/"); return [k.slice(0, i), k.slice(i + 1)]; };
  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const addDays = (date, n) => { const [y, m, d] = date.split("-").map(Number); return localDate(new Date(y, m - 1, d + n, 12).getTime()); };
  const today = () => (todayFn ? todayFn() : localDate(clock()));
  const RM = () => window.RecordMap;
  const ctx = () => ({ workout: S.get("plan_workout", null), diet: S.get("plan_diet", null), today: today() });

  // JSON con chiavi ordinate: confronto di dati indipendente dall'ordine delle proprietà.
  function canon(x) {
    return JSON.stringify(x, (k, v) => (isObj(v) ? Object.keys(v).sort().reduce((o, kk) => { o[kk] = v[kk]; return o; }, {}) : v));
  }
  function utf8Len(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  function logErr(msg) {
    try { if (typeof window._logError === "function") window._logError(new Error(`[SyncV2] ${msg}`)); else console.warn(`[SyncV2] ${msg}`); } catch (_) {}
  }
  function emit(name, detail) {
    try {
      if (typeof window.dispatchEvent !== "function") return;
      const ev = typeof CustomEvent === "function" ? new CustomEvent(name, { detail }) : new Event(name);
      window.dispatchEvent(ev);
    } catch (_) {}
  }
  function setStatus(status, error) {
    state = { status, last: status === "ok" ? clock() : state.last };
    if (error) state.error = error;
    window._syncState = Object.assign({}, state);
    emit("lfh-sync", Object.assign({}, state));
  }
  const hasToken = () => !!(S && S.get(K.token, null));

  // ── cache dei record (r:<collection>:<id>) ────────────────────────────────
  function cacheGet(c, id) { const m = cache.get(c); return (m && m.get(id)) || null; }
  function cachePut(r) {
    const rec = {
      collection: r.collection, id: r.id, data: r.deleted ? null : r.data,
      updatedAt: Number(r.updatedAt) || 0, deleted: !!r.deleted, deviceId: r.deviceId || null, seq: Number(r.seq) || 0,
    };
    if (!cache.has(rec.collection)) cache.set(rec.collection, new Map());
    cache.get(rec.collection).set(rec.id, rec);
    S.set(`${REC}${rec.collection}:${rec.id}`, rec, SILENT);
  }
  // Epoch cambiato (DB ripristinato): la cache non vale più → via cache, indice gruppi e cursore;
  // il prossimo giro è un primo sync (pull completo, poi push dei record che il server non ha).
  function resetToFirstSync(epoch) {
    cache = new Map();
    S.keys().forEach((k) => { if (k.startsWith(REC) || k.startsWith(GRP)) S.remove(k, SILENT); });
    S.set(K.cursor, 0, SILENT);
    if (epoch != null) S.set(K.epoch, epoch, SILENT);
    firstDone = false;
  }
  function buildIndex() {
    cache = new Map();
    S.keys().forEach((k) => {
      if (!k.startsWith(REC)) return;
      const r = S.get(k, null);
      if (!isObj(r) || typeof r.collection !== "string" || typeof r.id !== "string") return;
      if (!cache.has(r.collection)) cache.set(r.collection, new Map());
      cache.get(r.collection).set(r.id, r);
    });
  }

  // Vista "effettiva" = cache del server + modifiche in coda (le modifiche in coda vincono).
  function pendingRecord(ch) {
    const base = cacheGet(ch.collection, ch.id);
    return { collection: ch.collection, id: ch.id, data: ch.deleted ? null : ch.data, updatedAt: ch.updatedAt, deleted: !!ch.deleted, deviceId, seq: base ? base.seq : 0 };
  }
  function effective(c, id) {
    const p = outbox[keyOf(c, id)];
    return p ? pendingRecord(p) : cacheGet(c, id);
  }
  function listEffective(c) {
    const m = new Map(cache.get(c) || []);
    Object.keys(outbox).forEach((k) => { const ch = outbox[k]; if (ch.collection === c) m.set(ch.id, pendingRecord(ch)); });
    return [...m.values()];
  }

  // ── coda (v2outbox) ───────────────────────────────────────────────────────
  function validateChange(ch) {
    if (!COLLECTIONS.has(ch.collection)) return `collezione sconosciuta '${ch.collection}'`;
    if (typeof ch.id !== "string" || !ch.id || ch.id.length > MAX_ID_LEN) return `id non valido '${String(ch.id).slice(0, 40)}'`;
    if (!Number.isSafeInteger(ch.updatedAt) || ch.updatedAt <= 0) return "updatedAt non valido";
    if (!ch.deleted && !isObj(ch.data)) return `data non valida (${ch.collection}/${ch.id})`;
    if (ch.data != null && utf8Len(JSON.stringify(ch.data)) > MAX_DATA_BYTES) return `data oltre 64 KB (${ch.collection}/${ch.id})`;
    return null;
  }
  // updatedAt = max(now, versione nota + 1): sempre crescente anche con l'orologio indietro.
  function nextUpdatedAt(c, id) {
    const a = cacheGet(c, id), p = outbox[keyOf(c, id)];
    const base = Math.max(a ? a.updatedAt || 0 : 0, p ? p.updatedAt || 0 : 0);
    return Math.max(Math.floor(clock()), base + 1);
  }
  function enqueue(c, id, data, deleted) {
    const ch = { collection: c, id: String(id), data: deleted ? null : data, updatedAt: nextUpdatedAt(c, String(id)), deleted: !!deleted };
    const err = validateChange(ch);
    if (err) { logErr(`modifica scartata: ${err}`); return null; }
    outbox[keyOf(c, ch.id)] = ch;
    return ch;
  }
  function persistOutbox() { S.set(K.outbox, Object.assign({}, outbox), SILENT); }
  function loadOutbox() {
    outbox = {};
    const raw = S.get(K.outbox, null);
    if (!isObj(raw)) return;
    let dropped = false;
    Object.keys(raw).forEach((k) => {
      const ch = raw[k];
      const err = isObj(ch) ? validateChange(ch) : "voce non valida";
      if (err) { logErr(`coda: voce ${k} scartata al caricamento: ${err}`); dropped = true; return; }
      outbox[keyOf(ch.collection, ch.id)] = ch;
    });
    if (dropped) persistOutbox();
  }
  function takeBatch() {
    const out = [];
    let bytes = ENVELOPE_BYTES;
    for (const k of Object.keys(outbox)) {
      const ch = outbox[k], n = utf8Len(JSON.stringify(ch)) + 1;
      if (out.length >= MAX_BATCH || (out.length && bytes + n > MAX_BATCH_BYTES)) break;
      out.push(ch);
      bytes += n;
    }
    return out;
  }

  // ── gruppi (RecordMap) ────────────────────────────────────────────────────
  function groupsOfKey(key, c) {
    if (LOCAL_ONLY.test(key)) return [];
    try { return RM().groupsForKey(key, S.get(key, null), c) || []; } catch (e) { logErr(`groupsForKey ${key}: ${e.message}`); return []; }
  }
  function build(groupId, c) {
    try { return RM().buildGroup(groupId, (k, def) => S.get(k, def), c); } catch (e) { logErr(`buildGroup ${groupId}: ${e.message}`); return null; }
  }
  const noTouch = (res) => !res || (res.records.length === 0 && !!res.window && res.window.minId === NONE);
  function localGroups(c) {
    const out = new Set();
    S.keys().forEach((k) => groupsOfKey(k, c).forEach((g) => out.add(g)));
    return out;
  }
  // Ruling 12: id dichiarati protetti dal gruppo (RecordMap.isProtected) → mai tombstone, e fuori
  // dall'indice v2grp (così nemmeno un giro successivo li considera "prodotti l'ultima volta").
  const isProt = (res, col, id) => { try { return !!RM().isProtected && RM().isProtected(res, col, id); } catch (_) { return false; } };
  const indexIds = (res) => res.records.filter((r) => !isProt(res, r.collection, r.id)).map((r) => keyOf(r.collection, r.id));
  function setGroupIndex(groupId, ids) {
    const prev = S.get(GRP + groupId, null);
    if (!Array.isArray(prev) || prev.join("\n") !== ids.join("\n")) S.set(GRP + groupId, ids, SILENT);
  }

  // Ricalcola un gruppo e mette in coda solo ciò che differisce dalla vista effettiva; tombstone solo per
  // id prodotti l'ultima volta dal gruppo, ora assenti e dentro la sua `window`. Ritorna i change creati.
  function processGroup(groupId, c) {
    const res = build(groupId, c);
    if (noTouch(res)) return 0;
    const win = res.window || null;
    const prevRaw = S.get(GRP + groupId, null);
    const prev = Array.isArray(prevRaw) ? prevRaw : [];
    let n = 0;
    for (const r of res.records) {
      const eff = effective(r.collection, r.id);
      if (eff && !eff.deleted && canon(eff.data) === canon(r.data)) continue;
      if (enqueue(r.collection, r.id, r.data, false)) n++;
    }
    const now = indexIds(res);
    const nowSet = new Set(res.records.map((r) => keyOf(r.collection, r.id)));
    for (const k of prev) {
      if (nowSet.has(k)) continue;
      const [col, id] = splitKey(k);
      if (win && col === win.collection && id < win.minId) continue; // uscito dalla finestra locale
      if (isProt(res, col, id)) continue;                              // storico protetto (Ruling 12)
      const eff = effective(col, id);
      if (!eff || eff.deleted) continue;
      if (enqueue(col, id, null, true)) n++;
    }
    setGroupIndex(groupId, now);
    return n;
  }

  function flushDirty() {
    if (!firstDone || !dirty.size) return;
    const groups = [...dirty];
    dirty.clear();
    const c = ctx();
    let n = 0;
    groups.forEach((g) => { n += processGroup(g, c); });
    if (n) persistOutbox();
  }

  function schedulePush() {
    if (!hasToken() || !setT) return;
    if (timer !== null && clearT) clearT(timer);
    timer = setT(() => { timer = null; syncNow(); }, DEBOUNCE_MS);
  }

  function onLocalChange(key, value, info) {
    if ((info && info.silent) || LOCAL_ONLY.test(key)) return;
    const groups = groupsOfKey(key, ctx());
    if (!groups.length) return;
    if (!firstDone) {
      // Prima del primo sync non si confronta con una cache incompleta: lo fa il primo sync.
      if (firstRunning) { touched.add(key); groups.forEach((g) => dirty.add(g)); }
      schedulePush();
      return;
    }
    groups.forEach((g) => dirty.add(g));
    if (!flushScheduled) {
      flushScheduled = true;
      Promise.resolve().then(() => { flushScheduled = false; flushDirty(); });
    }
    schedulePush();
  }

  // ── applicazione dei record in arrivo ─────────────────────────────────────
  function refreshPlans() {
    const changed = [];
    Object.keys(PLAN_KEY).forEach((c) => {
      const recs = listEffective(c);
      if (!recs.length) return;
      const ap = window.PlanConv ? window.PlanConv.activePlan(recs, c) : null;
      const key = PLAN_KEY[c], cur = S.get(key, MISSING);
      if (ap) {
        if (cur === MISSING || canon(cur) !== canon(ap)) { S.set(key, ap, SILENT); changed.push(key); }
      } else if (cur !== MISSING) { S.remove(key, SILENT); changed.push(key); }
    });
    return changed;
  }

  // Riscrive in silenzio le chiavi locali dalla vista effettiva; solo date ≥ oggi−90, mai le chiavi in `skip`.
  function applyKeys(keys, c, skip) {
    const cut = addDays(c.today, -HORIZON_DAYS);
    const list = [...new Set(keys)].filter((k) => {
      const m = DATED_KEY.exec(k);
      return !(m && m[1] < cut) && !(skip && skip.has(k));
    });
    if (!list.length) return [];
    let out;
    try { out = RM().rebuildKeys(list, effective, listEffective, c); } catch (e) { logErr(`rebuildKeys: ${e.message}`); return []; }
    const changed = [];
    Object.keys(out).forEach((k) => {
      const v = out[k], cur = S.get(k, MISSING);
      if (v === undefined) {
        if (cur !== MISSING) { S.remove(k, SILENT); changed.push(k); }
      } else if (cur === MISSING || canon(cur) !== canon(v)) { S.set(k, v, SILENT); changed.push(k); }
    });
    return changed;
  }

  // Dopo una ricostruzione v2grp segue lo stato locale (una cancellazione futura tombstona anche ciò che
  // è arrivato da un altro device). Niente coda: le modifiche locali in sospeso sono già in v2outbox.
  function refreshGroupIndex(keys, c) {
    const groups = new Set();
    keys.forEach((k) => groupsOfKey(k, c).forEach((g) => groups.add(g)));
    groups.forEach((g) => { const res = build(g, c); if (!noTouch(res)) setGroupIndex(g, indexIds(res)); });
  }

  // Record adottati (pull/conflicts) → piani + chiavi locali. I record scritti da questo device non
  // ricostruiscono le chiavi: le chiavi locali sono già la loro sorgente (niente round-trip lossy).
  function applyAdopted(records, skip) {
    flushDirty(); // modifiche locali appena fatte → in coda prima di ricostruire (vincono)
    let plans = false;
    const keys = [];
    records.forEach((r) => {
      if (RM().DIRECT.has(r.collection)) { plans = true; return; }
      if (r.deviceId === deviceId) return;
      try { keys.push(...RM().keysForRecord(r, null)); } catch (_) {}
    });
    const changed = plans ? refreshPlans() : [];
    const c = ctx();
    const rebuilt = applyKeys(keys, c, skip);
    refreshGroupIndex(rebuilt, c);
    changed.push(...rebuilt);
    if (changed.length) emit("lfh-data", { keys: changed });
    return changed;
  }

  // ── rete ──────────────────────────────────────────────────────────────────
  const validRecord = (r) => isObj(r) && COLLECTIONS.has(r.collection) && typeof r.id === "string";

  // Push della coda + pull dal cursore, finché c'è coda o `more`. cur = { cursor, epoch } (aggiornato).
  // persist: salva cursore/epoch a ogni giro; rebuild: applica i record adottati a ogni giro.
  async function exchange(token, cur, { persist, rebuild }) {
    const g = gen;
    let pushed = 0, pulled = 0;
    const adopted = [];
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (rebuild) flushDirty();
      const batch = takeBatch();
      let res;
      try {
        res = await F(`${API}/v1/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ deviceId, cursor: cur.cursor, changes: batch }),
        });
      } catch (_) {
        return { ok: false, error: "offline", pushed, pulled, adopted };
      }
      if (res.status === 401) return { ok: false, error: "unauthorized", pushed, pulled, adopted };
      let j = null;
      try { j = await res.json(); } catch (_) {}
      if (res.status === 400 && batch.length && j && typeof j.error === "string") {
        // Una modifica rifiutata dalla validazione bloccherebbe la coda per sempre: si scarta e si riprova.
        const m = /^changes\[(\d+)\]/.exec(j.error), bad = m ? batch[Number(m[1])] : null;
        if (bad) {
          const k = keyOf(bad.collection, bad.id);
          if (outbox[k] === bad) delete outbox[k];
          persistOutbox();
          logErr(`modifica rifiutata dal server e scartata: ${j.error}`);
          continue;
        }
      }
      if (!res.ok || !isObj(j) || !Array.isArray(j.changes)) {
        return { ok: false, error: res.ok ? "risposta non valida" : `http ${res.status}`, pushed, pulled, adopted };
      }

      // Esito del push: stale → versione del server (conflicts); applicata → la nostra versione in cache.
      const conflicts = new Map();
      (Array.isArray(j.conflicts) ? j.conflicts : []).forEach((r) => { if (validRecord(r)) conflicts.set(keyOf(r.collection, r.id), r); });
      const roundAdopted = [];
      batch.forEach((s) => {
        const k = keyOf(s.collection, s.id), srv = conflicts.get(k);
        if (srv) { cachePut(srv); roundAdopted.push(srv); }
        else {
          const prev = cacheGet(s.collection, s.id);
          cachePut({ collection: s.collection, id: s.id, data: s.data, updatedAt: s.updatedAt, deleted: s.deleted, deviceId, seq: prev ? prev.seq : 0 });
          pushed++;
        }
        if (outbox[k] === s) delete outbox[k]; // cambiata nel frattempo → resta in coda (updatedAt più alto)
      });
      if (batch.length) persistOutbox();
      // rebaseline nel frattempo: niente cursore, cache o chiavi da questo giro (riparte da un primo sync).
      if (g !== gen) return { ok: false, error: "rebaseline", pushed, pulled, adopted };

      // epoch cambiato (DB azzerato o ripristinato, Ruling 9) → come un primo sync: fuori dal primo sync
      // si esce e runSync riparte da zero; dentro il primo sync si svuota la cache e si ripulla da 0.
      // reset:true con lo stesso epoch → il server ha già ripreso il pull da 0: si prosegue.
      const epochChanged = j.epoch != null && cur.epoch != null && j.epoch !== cur.epoch;
      if (j.epoch != null) cur.epoch = j.epoch;
      if (epochChanged && persist) return { ok: false, epochChanged: true, epoch: j.epoch, pushed, pulled, adopted };
      const restart = epochChanged;
      if (restart) { resetToFirstSync(j.epoch); cur.cursor = 0; adopted.length = 0; roundAdopted.length = 0; }
      else {
        j.changes.forEach((r) => { if (!validRecord(r)) return; cachePut(r); roundAdopted.push(r); pulled++; });
        if (Number.isSafeInteger(j.cursor) && j.cursor >= 0) cur.cursor = j.cursor;
      }
      if (persist) {
        S.set(K.cursor, cur.cursor, SILENT);
        if (cur.epoch != null) S.set(K.epoch, cur.epoch, SILENT);
      }
      if (rebuild && roundAdopted.length) applyAdopted(roundAdopted, null);
      else adopted.push(...roundAdopted);
      if (!restart && j.more !== true && !Object.keys(outbox).length) return { ok: true, pushed, pulled, adopted };
    }
    return { ok: false, error: "troppi giri di sync", pushed, pulled, adopted };
  }

  // Copia dei valori locali sincronizzabili (clonati: le schermate possono riusare gli oggetti).
  function snapshotLocal() {
    const snap = new Map();
    S.keys().forEach((k) => {
      if (LOCAL_ONLY.test(k)) return;
      const v = S.get(k, null);
      try { snap.set(k, v === undefined ? v : JSON.parse(JSON.stringify(v))); } catch (_) { snap.set(k, v); }
    });
    return snap;
  }

  // Modifiche fatte DURANTE il primo sync (chiavi in `touched`): per i loro gruppi si mettono in coda solo
  // i record che differiscono fra la foto iniziale e lo stato attuale (le modifiche vere dell'utente),
  // mai il resto della chiave, che può essere vecchio rispetto al server.
  function enqueueTouchedEdits(snap, c) {
    const groups = new Set();
    touched.forEach((k) => groupsOfKey(k, c).forEach((g) => groups.add(g)));
    const before = (k, def) => (snap.has(k) ? snap.get(k) : def);
    groups.forEach((g) => {
      const after = build(g, c);
      if (noTouch(after)) return;
      let prev = null;
      try { prev = RM().buildGroup(g, before, c); } catch (_) {}
      const old = new Map((prev && !noTouch(prev) ? prev.records : []).map((r) => [keyOf(r.collection, r.id), canon(r.data)]));
      const now = new Set();
      after.records.forEach((r) => {
        const k = keyOf(r.collection, r.id);
        now.add(k);
        if (old.get(k) !== canon(r.data)) enqueue(r.collection, r.id, r.data, false);
      });
      const win = after.window || null;
      old.forEach((_, k) => {
        if (now.has(k)) return;
        const [col, id] = splitKey(k);
        if (win && col === win.collection && id < win.minId) return;
        if (isProt(after, col, id)) return;                              // Ruling 12
        const eff = effective(col, id);
        if (eff && !eff.deleted) enqueue(col, id, null, true);
      });
    });
  }

  // Primo sync: pull completo senza toccare le chiavi → in coda i record locali che il server non ha
  // (+ le modifiche fatte durante il sync) → chiavi ricostruite dalla vista effettiva (cache + coda) →
  // indice gruppi → cursore salvato (solo alla fine: se cade a metà, il prossimo tentativo riparte da 0).
  async function firstSync(token) {
    firstRunning = true;
    touched.clear();
    dirty.clear();
    const snap = snapshotLocal();
    try {
      const cur = { cursor: 0, epoch: S.get(K.epoch, null) };
      const r1 = await exchange(token, cur, { persist: false, rebuild: false });
      if (!r1.ok) return r1;
      const changed = refreshPlans();
      let c = ctx();
      localGroups(c).forEach((g) => {
        const res = build(g, c);
        if (noTouch(res)) return;
        res.records.forEach((r) => {
          if (!cacheGet(r.collection, r.id) && !outbox[keyOf(r.collection, r.id)]) enqueue(r.collection, r.id, r.data, false);
        });
      });
      enqueueTouchedEdits(snap, c);
      persistOutbox();
      const keys = []; // le chiavi toccate con dati sul server sono già fra quelle dei record adottati
      r1.adopted.forEach((r) => { if (!RM().DIRECT.has(r.collection)) { try { keys.push(...RM().keysForRecord(r, null)); } catch (_) {} } });
      changed.push(...applyKeys(keys, c, null));
      c = ctx();
      localGroups(c).forEach((g) => { const res = build(g, c); if (!noTouch(res)) setGroupIndex(g, indexIds(res)); });
      S.set(K.cursor, cur.cursor, SILENT);
      if (cur.epoch != null) S.set(K.epoch, cur.epoch, SILENT);
      firstDone = true;
      firstRunning = false;
      dirty.clear(); // le modifiche durante il sync sono già state valutate (enqueueTouchedEdits)
      if (changed.length) emit("lfh-data", { keys: changed });
      if (!Object.keys(outbox).length) return r1;
      const r2 = await exchange(token, cur, { persist: true, rebuild: true });
      return { ok: r2.ok, error: r2.error, pushed: r1.pushed + r2.pushed, pulled: r1.pulled + r2.pulled };
    } finally {
      firstRunning = false;
      touched.clear();
    }
  }

  function pruneGroupIndex() {
    const cut = addDays(today(), -HORIZON_DAYS);
    S.keys().forEach((k) => {
      if (!k.startsWith(GRP)) return;
      const m = DATED_GROUP.exec(k);
      if (m && m[1] < cut) S.remove(k, SILENT);
    });
  }

  async function runSync() {
    if (!S) return { ok: false, pushed: 0, pulled: 0, error: "non inizializzato" };
    const token = S.get(K.token, null);
    if (!token) { setStatus("unlinked"); return { ok: false, pushed: 0, pulled: 0, error: "unlinked" }; }
    if (!F) { setStatus("error", "fetch assente"); return { ok: false, pushed: 0, pulled: 0, error: "fetch assente" }; }
    setStatus("syncing");
    let r;
    try {
      if (!firstDone) r = await firstSync(token);
      else {
        flushDirty();
        const cur = { cursor: Number(S.get(K.cursor, 0)) || 0, epoch: S.get(K.epoch, null) };
        r = await exchange(token, cur, { persist: true, rebuild: true });
        if (r.epochChanged) {
          const p = r;
          resetToFirstSync(r.epoch);
          r = await firstSync(token);
          r = Object.assign({}, r, { pushed: (r.pushed || 0) + p.pushed, pulled: (r.pulled || 0) + p.pulled });
        }
      }
    } catch (e) {
      logErr(`sync: ${e && e.message ? e.message : e}`);
      r = { ok: false, pushed: 0, pulled: 0, error: String((e && e.message) || e) };
    }
    if (r.ok) { pruneGroupIndex(); setStatus("ok"); }
    else if (r.error === "rebaseline") { /* segue il primo sync già in fila */ }
    else setStatus(r.error === "offline" ? "offline" : "error", r.error);
    const out = { ok: r.ok, pushed: r.pushed, pulled: r.pulled };
    if (!r.ok) out.error = r.error;
    return out;
  }

  // Un sync alla volta; chiamate durante un sync in corso → un solo giro in più, condiviso.
  function syncNow() {
    if (queued) return queued;
    const p = chain.then(() => { queued = null; return runSync(); });
    queued = p;
    chain = p.catch(() => {});
    return p;
  }

  // Dopo un ripristino del backup (chiavi scritte in silenzio, Ruling 14): via indice gruppi e cursore,
  // il prossimo sync è un primo sync. Subito e in modo persistente (anche se la pagina si ricarica prima
  // del sync): le modifiche locali di qui in poi non si confrontano più con l'indice vecchio.
  function rebaseline() {
    if (!S) return Promise.resolve({ ok: false, pushed: 0, pulled: 0, error: "non inizializzato" });
    gen++;
    S.keys().forEach((k) => { if (k.startsWith(GRP)) S.remove(k, SILENT); });
    S.set(K.cursor, 0, SILENT);
    firstDone = false;
    dirty.clear();
    touched.clear();
    if (!hasToken()) return Promise.resolve({ ok: true, pushed: 0, pulled: 0, local: true });
    return syncNow();
  }

  // ── API pubblica ──────────────────────────────────────────────────────────
  async function setToken(token) {
    if (!S) return { ok: false, error: "non inizializzato" };
    const t = String(token == null ? "" : token).trim();
    const prev = S.get(K.token, null);
    if (!t) {
      S.remove(K.token, SILENT);
      if (timer !== null && clearT) { clearT(timer); timer = null; }
      setStatus("unlinked");
      return { ok: true };
    }
    S.set(K.token, t, SILENT);
    const r = await syncNow();
    if (!r.ok && r.error === "unauthorized") {
      if (prev && prev !== t) S.set(K.token, prev, SILENT); else S.remove(K.token, SILENT);
      return { ok: false, error: "unauthorized" };
    }
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  // Scrittura diretta di record (import dei piani): in coda, chiavi locali e piani aggiornati subito.
  function putRecords(changes) {
    if (!S) return [];
    const out = [], keys = [];
    let plans = false;
    (Array.isArray(changes) ? changes : []).forEach((c) => {
      if (!isObj(c)) return;
      const ch = enqueue(c.collection, c.id, c.data, c.deleted === true);
      if (!ch) return;
      out.push(ch);
      if (RM().DIRECT.has(ch.collection)) plans = true;
      else { try { keys.push(...RM().keysForRecord(pendingRecord(ch), null)); } catch (_) {} }
    });
    if (!out.length) return out;
    persistOutbox();
    const changed = plans ? refreshPlans() : [];
    const c = ctx();
    const rebuilt = applyKeys(keys, c, null);
    if (firstDone) refreshGroupIndex(rebuilt, c);
    changed.push(...rebuilt);
    if (changed.length) emit("lfh-data", { keys: changed });
    schedulePush();
    return out;
  }

  // Link di collegamento: https://…/fitness-hub/#sync=<64 hex>. Funzione pura: il token o null
  // (qualsiasi altro hash, o lunghezza/caratteri sbagliati, è ignorato).
  function linkTokenFromHash(hash) {
    const m = /^#sync=([0-9a-fA-F]{64})$/.exec(String(hash == null ? "" : hash));
    return m ? m[1].toLowerCase() : null; // minuscolo: lo stesso token scritto in maiuscolo non è "diverso"
  }
  // All'avvio (dopo init): se l'hash è un link valido, ripulisce l'URL (replaceState) e collega il
  // device. Ritorna la Promise di setToken, o null se non c'era niente da fare. Il token non si logga.
  // confirmReplace (opzionale): chiamata se è già salvato un token DIVERSO; false → resta il vecchio
  // (l'hash viene comunque ripulito) e la Promise risolve { ok:false, error:"declined" }.
  function consumeLinkHash(loc, hist, confirmReplace) {
    const l = loc || (typeof location !== "undefined" ? location : null);
    const h = hist || (typeof history !== "undefined" ? history : null);
    const token = linkTokenFromHash(l && l.hash);
    if (!token) return null;
    try { if (h && typeof h.replaceState === "function") h.replaceState(null, "", (l.pathname || "") + (l.search || "")); } catch (_) {}
    const cur = S ? S.get(K.token, null) : null;
    if (cur && String(cur).toLowerCase() !== token && typeof confirmReplace === "function") {
      let yes = false;
      try { yes = !!confirmReplace(); } catch (_) {}
      if (!yes) return Promise.resolve({ ok: false, error: "declined" });
    }
    return setToken(token);
  }

  // Ricalcola plan_workout / plan_diet dai record in cache (dopo un ripristino del backup). Ritorna le chiavi cambiate.
  function refreshPlansNow() {
    if (!S) return [];
    const changed = refreshPlans();
    if (changed.length) emit("lfh-data", { keys: changed });
    return changed;
  }

  function getRecord(collection, id) { return S ? effective(collection, String(id)) : null; }
  function listRecords(collection) { return S ? listEffective(collection) : []; }
  function activePlans() { return { workout: S ? S.get("plan_workout", null) : null, diet: S ? S.get("plan_diet", null) : null }; }
  function status() { return Object.assign({}, state, { pending: Object.keys(outbox).length, linked: hasToken() }); }

  function init(opts) {
    const o = opts || {};
    if (unsub) { try { unsub(); } catch (_) {} unsub = null; }
    if (timer !== null && clearT) clearT(timer);
    S = o.storage || window.storage;
    F = o.fetch || (typeof fetch === "function" ? (url, init2) => fetch(url, init2) : null);
    clock = typeof o.now === "function" ? o.now : () => Date.now();
    setT = o.setTimeout || (typeof setTimeout === "function" ? (fn, ms) => setTimeout(fn, ms) : null);
    clearT = o.clearTimeout || (typeof clearTimeout === "function" ? (id) => clearTimeout(id) : null);
    todayFn = typeof o.today === "function" ? o.today : null;
    timer = null; flushScheduled = false; firstRunning = false;
    dirty.clear(); touched.clear();
    chain = Promise.resolve(); queued = null;
    buildIndex();
    loadOutbox();
    deviceId = S.get(K.device, null);
    if (typeof deviceId !== "string" || !deviceId || deviceId.length > MAX_ID_LEN) {
      deviceId = typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function"
        ? `pwa-${crypto.randomUUID()}`
        : `pwa-${clock().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      S.set(K.device, deviceId, SILENT);
    }
    firstDone = (Number(S.get(K.cursor, 0)) || 0) > 0 || S.keys().some((k) => k.startsWith(GRP));
    if (typeof S.onChange === "function") unsub = S.onChange(onLocalChange);
    setStatus(hasToken() ? "idle" : "unlinked");
    return SyncV2;
  }

  const SyncV2 = { API, init, setToken, hasToken, linkTokenFromHash, consumeLinkHash, refreshPlans: refreshPlansNow, syncNow, rebaseline, putRecords, getRecord, listRecords, activePlans, status };
  window.SyncV2 = SyncV2;
})();
