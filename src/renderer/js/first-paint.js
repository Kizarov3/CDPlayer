// The first frame in the saved theme's material: main passes --cdp-light (preload: cdp.startsLight) when the saved theme
// is WHITE, and this runs before the page is first painted, so a light player doesn't flash dark while app.js loads the
// settings. WHITE's colours as theme.js has them; app.js's showTheme takes over from its first call. A dark theme: nothing.
if (window.cdp && window.cdp.startsLight) {
  const root = document.documentElement;
  root.classList.add('light');
  const white = { bg: '251, 251, 252', card: '255, 255, 255', accent: '224, 68, 46', accent2: '112, 116, 123', text: '42, 44, 48', muted: '112, 116, 123' };
  for (const k in white) root.style.setProperty(`--${k}`, white[k]);
}
