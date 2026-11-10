'use strict';
// A brand-new install (no settings.txt yet) opens in the theme matching the system's light/dark; after that the
// saved theme rules and the system is never consulted again. null = keep whatever was read.
function initialTheme({ hasSettings, systemDark }) {
  if (hasSettings) return null;
  return systemDark ? 'RED' : 'WHITE';
}

module.exports = { initialTheme };
