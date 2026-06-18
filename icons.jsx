// icons.jsx — Lorenzo Fitness Hub icon set (SF-inspired, hairline)
const Icon = ({ name, size = 20, color = "currentColor", strokeWidth = 1.6, style }) => {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style,
  };
  switch (name) {
    case "home":
      return <svg {...common}><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>;
    case "dumbbell":
      return <svg {...common}><path d="M3 9v6M6 7v10M9 9.5h6M15 7v10M18 9v6" /></svg>;
    case "fork":
      return <svg {...common}><path d="M8 3v8a2 2 0 0 0 2 2v8M6 3v6M10 3v6M16 3c-1.5 0-3 1.7-3 5s1.5 5 3 5v8" /></svg>;
    case "cart":
      return <svg {...common}><path d="M3 5h2l2.4 10.4a1.5 1.5 0 0 0 1.5 1.1H18a1.5 1.5 0 0 0 1.5-1.2L21 8H6" /><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></svg>;
    case "spark":
      return <svg {...common}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case "gear":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "refresh":
      return <svg {...common}><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M3 21v-5h5M21 3v5h-5" /></svg>;
    case "chevron":
      return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case "chevron-down":
      return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    case "check":
      return <svg {...common} strokeWidth="2.5"><path d="M5 12.5 10 17 19 7.5" /></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "minus":
      return <svg {...common}><path d="M5 12h14" /></svg>;
    case "upload":
      return <svg {...common}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>;
    case "lock":
      return <svg {...common}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 1 1 8 0v3" /></svg>;
    case "eye":
      return <svg {...common}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "eye-off":
      return <svg {...common}><path d="M10.6 6.1A9 9 0 0 1 12 6c6.5 0 10 6 10 6a13 13 0 0 1-2.2 2.7M6.6 6.6A13 13 0 0 0 2 12s3.5 7 10 7a9 9 0 0 0 3.5-.7M3 3l18 18" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;
    case "bolt":
      return <svg {...common} fill="currentColor" stroke="none"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>;
    case "scale":
      return <svg {...common}><path d="M4 6h16l-2 14H6L4 6Z" /><path d="M8 6V4a4 4 0 0 1 8 0v2" /></svg>;
    case "flame":
      return <svg {...common}><path d="M12 21c-3.9 0-7-2.7-7-6.4 0-2 .9-3.5 2-4.6 1.2-1.2 1.7-2 1.7-3.3V4c2 .5 3.3 2 3.8 3.7.7 2.2 2.5 1.6 3.7 3.6.9 1.4 1.8 3.4 1.8 5 0 3-2.6 4.7-6 4.7Z" /></svg>;
    case "leaf":
      return <svg {...common}><path d="M4 20c0-8 6-14 17-14-1 11-7 17-14 17 0-3 2-5 5-7" /></svg>;
    case "pill":
      return <svg {...common}><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-30 12 12)" /><path d="m8.5 6.5 6 6" transform="rotate(-30 12 12)" /></svg>;
    case "send":
      return <svg {...common}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" /></svg>;
    case "robot":
      return <svg {...common}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 4h6" /><circle cx="9" cy="13" r="1" fill="currentColor" /><circle cx="15" cy="13" r="1" fill="currentColor" /><path d="M9 17h6" /></svg>;
    case "online":
      return <svg viewBox="0 0 24 24" width={size} height={size}><circle cx="12" cy="12" r="5" fill="#30D158" /></svg>;
    case "x":
      return <svg {...common}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case "wave":
      return <svg viewBox="0 0 24 24" width={size} height={size} fill="none"><path d="M5 12c2-3 4-3 6 0s4 3 6 0M5 17c2-3 4-3 6 0s4 3 6 0M5 7c2-3 4-3 6 0s4 3 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>;
    case "key":
      return <svg {...common}><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 7l3 3" /></svg>;
    case "moon":
      return <svg {...common}><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" /></svg>;
    case "sun":
      return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
    case "globe":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18-3-3.5-3-14.5 0-18Z" /></svg>;
    case "user":
      return <svg {...common}><circle cx="12" cy="9" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>;
    case "info":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" /></svg>;
    case "trend-up":
      return <svg {...common}><path d="M3 17 9 11l4 4 8-9M14 6h7v7" /></svg>;
    case "doc":
      return <svg {...common}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M9 14h6M9 17h4" /></svg>;
    default:
      return null;
  }
};

window.Icon = Icon;
