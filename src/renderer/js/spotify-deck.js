// Spotify discs: the Web Playback SDK's one player for the app (SpotifySession), and a stand-in <audio> element per
// track (SpotifyTrackElement) that AudioEngine drives as a deck — so the transport, the disc, the seek bar, lyrics
// and karaoke don't need to know the sound comes from Spotify. The SDK plays through Widevine, outside Web Audio:
// no EQ, mono, crossfade or visualizer for it.

let sdk = null;
/** Loads Spotify's player script once, on first use (never at startup — the player must work offline). */
export function loadSpotifySdk(doc = document, win = window) {
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    if (win.Spotify && win.Spotify.Player) { resolve(win.Spotify.Player); return; }
    win.onSpotifyWebPlaybackSDKReady = () => resolve(win.Spotify.Player);
    const script = doc.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => { sdk = null; script.remove(); reject(new Error('sdk')); };
    doc.head.append(script);
  });
  return sdk;
}
