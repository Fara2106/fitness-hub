// push.jsx — window.pushAPI: gestione permessi + subscription Web Push
(function () {
  const VAPID_PUBLIC = "";                 // ← Lorenzo: incolla la VAPID PUBLIC key (base64url)
  const _PUSH_BASE   = "";                 // ← Lorenzo: incolla l'URL del push-worker (senza slash finale)

  function urlB64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function _reg() {
    if (!("serviceWorker" in navigator)) return null;
    return navigator.serviceWorker.ready;
  }

  const pushAPI = {
    isConfigured() { return !!VAPID_PUBLIC && !!_PUSH_BASE; },
    isSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; },
    isInstalled() {
      return window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    },
    permission() { return ("Notification" in window) ? Notification.permission : "denied"; },

    getLocalSub() { return window.storage ? window.storage.get("notifSub", null) : null; },

    // Richiede permesso + subscribe + POST /save. Ritorna { ok, error? }.
    async enable(config) {
      if (!this.isSupported()) return { ok: false, error: "unsupported" };
      if (!this.isInstalled()) return { ok: false, error: "not-installed" };
      if (!this.isConfigured()) return { ok: false, error: "not-configured" };
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return { ok: false, error: "denied" };
        const reg = await _reg();
        if (!reg) return { ok: false, error: "no-sw" };
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
          });
        }
        const subJson = sub.toJSON();
        if (window.storage) { window.storage.set("notifSub", subJson); window.storage.set("notifEnabled", true); }
        const res = await this._post("/save", { subscription: subJson, config });
        return res.ok ? { ok: true } : { ok: false, error: "save-failed" };
      } catch (e) { return { ok: false, error: "subscribe-failed" }; }
    },

    async disable() {
      try {
        const reg = await _reg();
        let endpoint = null;
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) { endpoint = sub.endpoint; try { await sub.unsubscribe(); } catch (_) {} }
        }
        if (window.storage) { window.storage.set("notifEnabled", false); window.storage.remove("notifSub"); }
        if (endpoint) await this._post("/unsubscribe", { endpoint });
        return { ok: true };
      } catch (e) {
        if (window.storage) { window.storage.set("notifEnabled", false); window.storage.remove("notifSub"); }
        return { ok: true };
      }
    },

    // Aggiorna solo la config (se già abilitato) — reinvia subscription + config.
    async syncConfig(config) {
      if (!window.storage || !window.storage.get("notifEnabled", false)) return { ok: false, error: "disabled" };
      const sub = window.storage.get("notifSub", null);
      if (!sub) return { ok: false, error: "no-sub" };
      return this._post("/save", { subscription: sub, config });
    },

    async _post(path, body) {
      if (!_PUSH_BASE) return { ok: false, error: "not-configured" };
      try {
        const r = await fetch(_PUSH_BASE + path, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return await r.json();
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  };

  window.pushAPI = pushAPI;
})();
