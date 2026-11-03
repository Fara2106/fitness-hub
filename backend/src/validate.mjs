// Validazione del corpo di /v1/sync: tutto o niente, messaggi in italiano con l'indice della modifica.
import { COLLECTIONS } from "./store.mjs";

export const MAX_CHANGES = 500;
export const MAX_DATA_BYTES = 65536;
export const MAX_ID_LEN = 128;
export const PULL_LIMIT = 500;
const MAX_DEVICE_ID_LEN = 128;

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (error) => ({ ok: false, error });
const encoder = new TextEncoder();

export function validateSyncBody(body) {
  if (!isPlainObject(body)) return fail("il corpo della richiesta deve essere un oggetto JSON");
  const { deviceId, cursor, changes } = body;
  if (typeof deviceId !== "string" || !deviceId || deviceId.length > MAX_DEVICE_ID_LEN) {
    return fail(`deviceId deve essere una stringa non vuota di al massimo ${MAX_DEVICE_ID_LEN} caratteri`);
  }
  if (!Number.isSafeInteger(cursor) || cursor < 0) return fail("cursor deve essere un intero maggiore o uguale a 0");
  if (!Array.isArray(changes)) return fail("changes deve essere un array");
  if (changes.length > MAX_CHANGES) return fail(`troppe modifiche: al massimo ${MAX_CHANGES} per richiesta`);

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const at = `changes[${i}]`;
    if (!isPlainObject(c)) return fail(`${at}: la modifica deve essere un oggetto`);
    if (typeof c.collection !== "string" || !COLLECTIONS.has(c.collection)) {
      return fail(`${at}: collezione sconosciuta '${String(c.collection)}'`);
    }
    if (typeof c.id !== "string" || !c.id || c.id.length > MAX_ID_LEN) {
      return fail(`${at}: id deve essere una stringa non vuota di al massimo ${MAX_ID_LEN} caratteri`);
    }
    if (typeof c.updatedAt !== "number" || !Number.isFinite(c.updatedAt) || c.updatedAt <= 0) {
      return fail(`${at}: updatedAt deve essere un numero maggiore di 0`);
    }
    if (c.deleted !== undefined && typeof c.deleted !== "boolean") return fail(`${at}: deleted deve essere vero o falso`);
    const deleted = c.deleted === true;
    if (deleted ? c.data != null && !isPlainObject(c.data) : !isPlainObject(c.data)) {
      return fail(`${at}: data deve essere un oggetto${deleted ? " oppure null" : ""}`);
    }
    if (c.data != null && encoder.encode(JSON.stringify(c.data)).length > MAX_DATA_BYTES) {
      return fail(`${at}: data troppo grande (massimo ${MAX_DATA_BYTES} byte)`);
    }
  }
  return { ok: true, value: { deviceId, cursor, changes } };
}
