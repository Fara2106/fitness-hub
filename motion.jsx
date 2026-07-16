// motion.jsx — sistema motion centralizzato (GSAP core via CDN → window.gsap).
// REGOLA: ogni API è un no-op sicuro se gsap è assente, se l'utente ha
// prefers-reduced-motion, o se l'elemento è null. Mai lanciare, mai lasciare
// la UI in uno stato visivo intermedio.

const Motion = (() => {
  const reduced = () => {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) { return false; }
  };
  const g = () => (typeof window.gsap !== "undefined" && window.gsap ? window.gsap : null);

  return {
    enabled() { return !!g() && !reduced(); },

    // Ingresso schermata: stagger dei [data-reveal] dentro il container di
    // scroll; se nessuno è marcato, i figli diretti del primo figlio (il
    // wrapper della schermata). Max 12 elementi: il resto è sotto il fold.
    screenEnter(container) {
      const gsap = g();
      if (!gsap || reduced() || !container) return;
      let items = Array.prototype.slice.call(container.querySelectorAll("[data-reveal]"));
      if (!items.length && container.firstElementChild) {
        items = Array.prototype.slice.call(container.firstElementChild.children);
      }
      items = items.slice(0, 12);
      if (!items.length) return;
      gsap.fromTo(items,
        { y: 12, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, ease: "power3.out", stagger: 0.04,
          overwrite: "auto", clearProps: "transform,opacity" });
    },

    // Micro-pop elastico (spunte, toggle, badge).
    pop(el) {
      const gsap = g();
      if (!gsap || reduced() || !el) return;
      gsap.fromTo(el, { scale: 0.6 },
        { scale: 1, duration: 0.45, ease: "back.out(2.5)", overwrite: "auto", clearProps: "transform" });
    },

    // Tween numerico su textContent (peso, contatori). Senza gsap/motion
    // scrive direttamente il valore finale: il dato è SEMPRE corretto.
    countTo(el, from, to, opts) {
      if (!el) return;
      opts = opts || {};
      const dec = opts.decimals != null ? opts.decimals : 0;
      const fmt = opts.format || ((v) => Number(v).toFixed(dec));
      const gsap = g();
      if (!gsap || reduced()) { el.textContent = fmt(to); return; }
      const state = { v: from };
      gsap.to(state, {
        v: to, duration: opts.duration || 0.6, ease: "power2.out", overwrite: "auto",
        onUpdate: () => { el.textContent = fmt(state.v); },
      });
    },
  };
})();

window.Motion = Motion;
