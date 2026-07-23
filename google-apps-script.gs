/**
 * Lorenzo Fitness Hub — Google Apps Script
 *
 * Deploy: Extensions → Apps Script → Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * FOGLI NECESSARI nel Google Sheet:
 *   - "PesoCorporeo"    colonne: Data | Peso
 *   - "SerieAllenamento" colonne: Data | Esercizio | SetN | Peso | Rip | RPE | Sessione | Settimana
 *   - "Sessioni"        colonne: Data | Tipo | Settimana | SerieCompletate | SerieTotal | Note | DurataMin
 *   - "Movimenti"       colonne: Data | Tipo | Minuti | Km | Note
 *   - "CheckIn"         colonne: Data | Sonno | Energia | Fastidi
 */

// ── CORS headers ──────────────────────────────────────────────────────────
// NB: setHeader() non esiste su TextOutput; il proxy Netlify gestisce i CORS
function _cors(output) {
  return output.setMimeType(ContentService.MimeType.JSON);
}

function _json(data) {
  return _cors(ContentService.createTextOutput(JSON.stringify(data)));
}

function _err(msg) {
  return _json({ success: false, error: msg });
}

// ── OPTIONS preflight ─────────────────────────────────────────────────────
function doOptions(e) {
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.JSON);
}

// ── Autorizzazione ────────────────────────────────────────────────────────
// Token condiviso col Cloudflare Worker (che lo inietta da un segreto NON nel
// repo). Impostalo in: Progetto → Impostazioni progetto → Proprietà script →
// APP_TOKEN = <stringa lunga casuale>. Finché la proprietà NON è impostata, il
// comportamento resta quello legacy (aperto) → si può deployare il codice prima
// e attivare l'enforcement dopo, senza finestra di rottura.
function _tokenOk(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty("APP_TOKEN");
  if (!expected) return true;               // non configurato → legacy
  return provided === expected;
}

// ── GET dispatcher ────────────────────────────────────────────────────────
function doGet(e) {
  const p = e.parameter || {};
  if (!_tokenOk(p._token)) return _err("Non autorizzato");
  try {
    switch (p.action) {
      case "getPesoCorporeo":  return _getPesoCorporeo();
      case "getPesi":          return _getPesi();
      case "getUltimiPesi":    return _getUltimiPesi();
      case "getCheckIn":       return _getCheckIn(p.date);
      case "getSettings":      return _getSettings();
      case "getAll":           return _getAll();
      default:
        return _json({ success: true, message: "Lorenzo Fitness Hub API v2", endpoints: ["getPesoCorporeo","getPesi","getUltimiPesi","getCheckIn","getSettings","getAll","savePeso","savePesoCorporeo","saveSessione","saveMovimento","saveCheckIn","saveSettings"] });
    }
  } catch (err) {
    return _err(err.message || "Errore GET");
  }
}

// ── POST dispatcher ───────────────────────────────────────────────────────
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (_) {
    return _err("JSON non valido");
  }
  if (!_tokenOk(body._token)) return _err("Non autorizzato");
  try {
    switch (body.action) {
      case "savePeso":          return _savePeso(body);
      case "savePesoCorporeo":  return _savePesoCorporeo(body);
      case "saveSessione":      return _saveSessione(body);
      case "saveMovimento":     return _saveMovimento(body);
      case "saveCheckIn":       return _saveCheckIn(body);
      case "saveSettings":      return _saveSettings(body);
      default:
        return _err("Azione sconosciuta: " + body.action);
    }
  } catch (err) {
    return _err(err.message || "Errore POST");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function _getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    // Add header row based on sheet name
    const headers = {
      PesoCorporeo:      ["Data", "Peso"],
      SerieAllenamento:  ["Data", "Esercizio", "SetN", "Peso", "Rip", "RPE", "Sessione", "Settimana"],
      Sessioni:          ["Data", "Tipo", "Settimana", "SerieCompletate", "SerieTotal", "Note", "OraInizio"],
      Movimenti:         ["Data", "Tipo", "Minuti", "Km", "Note"],
      CheckIn:           ["Data", "Sonno", "Energia", "Fastidi"],
      Settings:          ["Key", "Value"],
    };
    if (headers[name]) {
      sh.getRange(1, 1, 1, headers[name].length).setValues([headers[name]]);
      sh.getRange(1, 1, 1, headers[name].length).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function _today() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

// ── GET: peso corporeo (last 90 days) ─────────────────────────────────────
function _getPesoCorporeoRows() {
  const sh = _getSheet("PesoCorporeo");
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];

  return data.slice(1)
    .filter(r => r[0] && r[1])
    .map(r => ({
      date:   r[0] instanceof Date
        ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), "yyyy-MM-dd")
        : String(r[0]),
      weight: Number(r[1]) || 0,
    }))
    .filter(r => r.weight > 0)
    .slice(-90);
}

function _getPesoCorporeo() {
  return _json(_getPesoCorporeoRows());
}

// ── GET: getAll — peso + settings in UNA chiamata ─────────────────────────
// La sync dell'app faceva 2 GET ogni 45s (getPesoCorporeo + getSettings):
// questa le fonde → metà latenza e metà quota Apps Script. Il client fa
// feature-detect: se il backend è vecchio (questa azione manca) ricade sulle
// due chiamate separate.
function _getAll() {
  return _json({
    success: true,
    pesoCorporeo: _getPesoCorporeoRows(),
    settings: _getSettingsObj(),
  });
}

// ── GET: all pesi per esercizio (last 3 sessions each) ────────────────────
function _getPesi() {
  const sh = _getSheet("SerieAllenamento");
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return _json({});

  // Group by exercise name → most recent 3 sets
  const map = {};
  data.slice(1).forEach(r => {
    const [date, esercizio, setN, peso, rip, rpe, sessione, settimana] = r;
    if (!esercizio) return;
    const key = String(esercizio).toLowerCase().trim();
    if (!map[key]) map[key] = [];
    map[key].push({
      date: date instanceof Date ? Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd") : String(date),
      setN: Number(setN),
      peso: Number(peso),
      rip:  Number(rip),
      rpe:  Number(rpe),
      sessione: String(sessione || ""),
      settimana: Number(settimana),
    });
  });

  // Keep last 12 entries per exercise
  Object.keys(map).forEach(k => {
    map[k] = map[k].slice(-12);
  });

  return _json(map);
}

// ── GET: ultimi pesi (for pre-filling sets) ───────────────────────────────
function _getUltimiPesi() {
  const sh = _getSheet("SerieAllenamento");
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return _json({});

  // For each exercise: last known peso per setN
  const map = {};
  data.slice(1).forEach(r => {
    const [date, esercizio, setN, peso] = r;
    if (!esercizio || !peso) return;
    const key = String(esercizio).toLowerCase().trim();
    if (!map[key]) map[key] = [];
    const idx = Number(setN) - 1;
    if (idx >= 0) map[key][idx] = Number(peso);
  });

  return _json(map);
}

// ── GET: check-in data ─────────────────────────────────────────────────────
function _getCheckIn(dateStr) {
  const sh = _getSheet("CheckIn");
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return _json([]);

  let rows = data.slice(1).map(r => ({
    date:    r[0] instanceof Date ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(r[0]),
    sleep:   Number(r[1]),
    energy:  Number(r[2]),
    ailments: String(r[3] || ""),
  }));

  if (dateStr) {
    rows = rows.filter(r => r.date === dateStr);
  } else {
    rows = rows.slice(-30);
  }

  return _json(rows);
}

// ── POST: save serie allenamento ───────────────────────────────────────────
function _savePeso(body) {
  // body: { date, esercizio, setN, peso, rip, rpe, sessione, weekNum }
  const sh = _getSheet("SerieAllenamento");
  const date = body.date || _today();
  sh.appendRow([
    date,
    body.esercizio || "",
    body.setN || 1,
    Number(body.peso) || 0,
    Number(body.rip) || 0,
    Number(body.rpe) || 0,
    body.sessione || "",
    Number(body.weekNum) || 0,
  ]);
  return _json({ success: true, date });
}

// ── POST: save peso corporeo ───────────────────────────────────────────────
function _savePesoCorporeo(body) {
  // body: { date, weight }
  const sh = _getSheet("PesoCorporeo");
  const date = body.date || _today();

  // Update existing row if same date exists
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][0] instanceof Date
      ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd")
      : String(data[i][0]);
    if (rowDate === date) {
      sh.getRange(i + 1, 2).setValue(Number(body.weight));
      return _json({ success: true, action: "updated", date });
    }
  }
  // Append new row
  sh.appendRow([date, Number(body.weight)]);
  return _json({ success: true, action: "inserted", date });
}

// ── POST: save sessione ────────────────────────────────────────────────────
function _saveSessione(body) {
  // body: { date, type, weekNum, setsCompleted, totalSets, notes }
  const sh = _getSheet("Sessioni");
  const date = body.date || _today();
  const now  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm");
  sh.appendRow([
    date,
    body.type || "",
    Number(body.weekNum) || 0,
    Number(body.setsCompleted) || 0,
    Number(body.totalSets) || 0,
    body.notes || "",
    now,
  ]);
  return _json({ success: true, date });
}

// ── POST: save movimento (cardio) ─────────────────────────────────────────
function _saveMovimento(body) {
  // body: { date, type, min, km, note }
  const sh = _getSheet("Movimenti");
  const date = body.date || _today();
  sh.appendRow([
    date,
    body.type || "camminata",
    Number(body.min) || 0,
    Number(body.km) || 0,
    body.note || "",
  ]);
  return _json({ success: true, date });
}

// ── POST: save check-in ────────────────────────────────────────────────────
function _saveCheckIn(body) {
  // body: { date, sleep, energy, ailments }
  const sh = _getSheet("CheckIn");
  const date = body.date || _today();

  // Update if exists
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][0] instanceof Date
      ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd")
      : String(data[i][0]);
    if (rowDate === date) {
      sh.getRange(i + 1, 2, 1, 3).setValues([[
        Number(body.sleep) || 0,
        Number(body.energy) || 0,
        body.ailments || "",
      ]]);
      return _json({ success: true, action: "updated", date });
    }
  }
  sh.appendRow([date, Number(body.sleep) || 0, Number(body.energy) || 0, body.ailments || ""]);
  return _json({ success: true, action: "inserted", date });
}

// ── GET: settings (cross-device sync) ─────────────────────────────────────
function _getSettingsObj() {
  const sh = _getSheet("Settings");
  const data = sh.getDataRange().getValues();
  const result = {};
  data.slice(1).forEach(function(r) {
    if (r[0]) result[String(r[0])] = String(r[1] || "");
  });
  return result;
}

function _getSettings() {
  return _json(_getSettingsObj());
}

// ── POST: save setting ─────────────────────────────────────────────────────
function _saveSettings(body) {
  // body: { key, value }
  const key   = String(body.key   || "");
  const value = String(body.value || "");
  if (!key) return _err("key mancante");

  const sh   = _getSheet("Settings");
  const data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return _json({ success: true, action: "updated", key: key });
    }
  }
  sh.appendRow([key, value]);
  return _json({ success: true, action: "inserted", key: key });
}
