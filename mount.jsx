// mount.jsx — bootstrap React: rileva il device iniziale e monta AppFrame.
// Ultimo file del bundle (app.compiled.js): tutti i globali sono già definiti.
// Il device qui è solo il valore iniziale: AppFrame lo ricalcola dal viewport
// a ogni resize/rotazione (vedi _computeDevice in app.jsx).
const _isMobile = window.innerWidth < 768
  || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

ReactDOM.createRoot(document.getElementById("root")).render(
  <div style={{ width: "100%", height: "100%" }}>
    <AppFrame device={_isMobile ? "mobile" : "desktop"} />
  </div>
);
