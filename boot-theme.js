/* boot-theme.js — anti-flash tema, eseguito PRIMA del mount React (script
   bloccante in <head>). File esterno (non inline) così la CSP può fare a meno
   di 'unsafe-inline' in script-src.
   Il tema salvato dall'utente (storage IndexedDB) viene riapplicato da
   _applyTheme appena l'app è pronta; default = "system" (segue macOS/iOS). */
(function () {
  try {
    var light = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    if (light) document.documentElement.classList.add("theme-light");
    /* tono TabBar (non --bg): iOS usa theme-color per la striscia della home-indicator,
       che la pagina NON può dipingere → così si fonde con la barra. Aggiorna TUTTI i meta
       theme-color (i due media-scoped) per i browser che onorano il JS. */
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", light ? "#f7f7fa" : "#0b0b0f");
  } catch (_) {}
})();
