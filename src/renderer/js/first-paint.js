// The first frame in the saved theme's material: when the saved theme is light (WHITE, or one of your own with a light
// background), main passes its colours as --cdp-light=r,g,b;r,g,b;… (bg card accent accent2 text muted; preload:
// cdp.startsLight), and this runs before the page is first painted, so a light player doesn't flash dark while app.js
// loads the settings. app.js's showTheme takes over from its first call. A dark theme: nothing.
if (window.cdp && typeof window.cdp.startsLight === 'string') {
  const keys = ['bg', 'card', 'accent', 'accent2', 'text', 'muted'];
  const parts = window.cdp.startsLight.split(';').map((p) => p.split(',').map(Number));
  if (parts.length === keys.length && parts.every((c) => c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))) {
    const root = document.documentElement;
    root.classList.add('light');
    keys.forEach((k, i) => root.style.setProperty(`--${k}`, parts[i].join(', ')));
  }
}
