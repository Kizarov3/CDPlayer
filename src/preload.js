'use strict';
// The renderer's only door to the system: a small, explicit API (no Node access in the page itself).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (callback) => ipcRenderer.on(channel, (_e, ...args) => callback(...args));

contextBridge.exposeInMainWorld('cdp', {
  loadState: invoke('state:load'),
  saveSettings: invoke('state:saveSettings'),
  saveQueue: invoke('state:saveQueue'),
  saveQueueSync: (q) => ipcRenderer.sendSync('state:saveQueueSync', q),
  saveHistory: invoke('state:saveHistory'),
  saveEqPresets: invoke('state:saveEqPresets'),
  markOnboarded: invoke('state:markOnboarded'),
  writeLastVersion: invoke('state:writeLastVersion'),

  exists: invoke('fs:exists'),
  details: invoke('meta:details'),
  findCover: invoke('online:cover'),
  findCoverUrl: invoke('online:coverUrl'),
  findLyrics: invoke('online:lyrics'),
  classifySpotifyLink: invoke('spotify:classify'),
  resolveSpotifyLink: invoke('spotify:resolve'),
  spotifySignIn: invoke('spotify:signIn'),

  collectAudio: invoke('library:collect'),
  scanLibrary: invoke('library:scan'),
  openTracksDialog: invoke('dialog:openTracks'),
  savePlaylistDialog: invoke('dialog:savePlaylist'),
  loadPlaylistDialog: invoke('dialog:loadPlaylist'),
  importLibraryDialog: invoke('dialog:importLibrary'),

  setMiniMode: invoke('win:setMiniMode'),
  toggleFullscreen: invoke('win:toggleFullscreen'),
  isFullscreen: invoke('win:isFullscreen'),
  openGitHub: invoke('shell:openGitHub'),
  checkForUpdate: invoke('updates:check'),
  openReleasesPage: invoke('updates:openReleases'),
  setDiscordTrack: (track) => ipcRenderer.send('discord:track', track),

  pathForFile: (file) => webUtils.getPathForFile(file),
  mediaUrl: (p) => `cdp://app/media?p=${encodeURIComponent(p)}`,

  onOpenFiles: on('open-files'),
  onFullscreenChanged: on('fullscreen-changed'),
  onAppClosing: on('app-closing'),

  // Mini player <-> main window
  sendMiniState: (state) => ipcRenderer.send('mini:state', state),
  onMiniState: on('mini-state'),
  sendMiniCommand: (command) => ipcRenderer.send('mini:command', command),
  onMiniCommand: on('mini-command'),
});
