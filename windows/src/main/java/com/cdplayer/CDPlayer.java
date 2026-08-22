package com.cdplayer;

import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.BorderLayout;
import java.awt.image.BufferedImage;
import java.awt.Color;
import java.awt.Component;
import java.awt.Cursor;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.GradientPaint;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.RenderingHints;
import java.awt.datatransfer.DataFlavor;
import java.awt.dnd.DropTarget;
import java.awt.dnd.DropTargetAdapter;
import java.awt.dnd.DropTargetDropEvent;
import java.awt.event.ActionEvent;
import java.awt.geom.AffineTransform;
import java.awt.geom.Ellipse2D;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Map;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.DataLine;
import javax.sound.sampled.LineUnavailableException;
import javax.sound.sampled.SourceDataLine;
import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JSlider;
import javax.swing.JTextField;
import javax.swing.JScrollPane;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.UIManager;
import javax.swing.plaf.basic.BasicSliderUI;
import javax.swing.plaf.basic.BasicScrollBarUI;
import javax.swing.filechooser.FileNameExtensionFilter;

/** A standalone, dependency-free Java desktop music player. */
public final class CDPlayer extends JFrame {
  private static final Theme[] THEMES = {
    new Theme("RED", new Color(17, 17, 19), new Color(31, 31, 34), new Color(196, 20, 28), new Color(180, 186, 194), new Color(232, 233, 236), new Color(138, 142, 148)),
    new Theme("BLUE", new Color(6, 10, 22), new Color(13, 19, 36), new Color(46, 116, 255), new Color(150, 210, 255), new Color(232, 240, 250), new Color(120, 134, 160)),
    new Theme("SUNSET", new Color(24, 15, 18), new Color(38, 24, 28), new Color(255, 106, 61), new Color(255, 71, 133), new Color(250, 238, 230), new Color(176, 148, 142)),
    new Theme("FOREST", new Color(11, 17, 14), new Color(20, 30, 24), new Color(52, 199, 123), new Color(178, 214, 58), new Color(230, 240, 228), new Color(128, 148, 130)),
    new Theme("GALAXY", new Color(7, 7, 18), new Color(14, 14, 30), new Color(150, 120, 255), new Color(90, 200, 255), new Color(238, 236, 250), new Color(140, 140, 172)),
    new Theme("OCEAN", new Color(4, 14, 20), new Color(9, 24, 33), new Color(40, 190, 210), new Color(60, 130, 220), new Color(226, 246, 250), new Color(110, 152, 166)),
    new Theme("MATRIX", new Color(4, 8, 5), new Color(9, 15, 10), new Color(64, 230, 120), new Color(140, 255, 170), new Color(214, 250, 224), new Color(96, 140, 108)),
    new Theme("AUTUMN", new Color(20, 12, 8), new Color(34, 21, 14), new Color(224, 122, 40), new Color(200, 60, 46), new Color(250, 236, 220), new Color(168, 132, 108)),
    new Theme("SNOW", new Color(14, 16, 20), new Color(23, 26, 30), new Color(214, 44, 54), new Color(46, 168, 96), new Color(248, 248, 250), new Color(152, 154, 160)),
    // Placeholder colors — always replaced by deriveAutoTheme() before ever being displayed (see switchToTheme,
    // applyThemeInstant, and DiscView's onCoverChanged callback). AUTO has no particle effect of its own
    // (ThemeOverlay.Mode.forTheme/VisualizerBars.Mode.forTheme both fall back to NONE/BARS for an unrecognized
    // name), which reads as intentional here — the album art is the visual, not an overlay competing with it.
    new Theme("AUTO", new Color(10, 10, 12), new Color(18, 18, 21), new Color(150, 150, 160), new Color(190, 190, 200), new Color(232, 232, 236), new Color(140, 140, 148)),
  };
  private static Color BG = THEMES[0].bg;
  private static Color CARD = THEMES[0].card;
  private static Color ACCENT = THEMES[0].accent;
  private static Color ACCENT2 = THEMES[0].accent2;
  private static Color TEXT = THEMES[0].text;
  private static Color MUTED = THEMES[0].muted;
  // Read by every hover/pulse/transition timer below (HoverFade, PillButton, TransportButton, ModeIconButton,
  // the Settings dialog open/close animation, the now-playing fade-in, and the theme color transition) — when
  // off, each of those jumps straight to its end state instead of animating toward it.
  private static boolean animationsEnabled = true;
  private int currentThemeIndex = 0;
  private Timer themeAnim;
  private Timer nowPlayingFadeTimer;
  private final DiscView disc = new DiscView();
  private JPanel headerPanel; // the status pill + History/Settings row — hidden in CD view, unlike the triangle divider below it
  private JPanel playerPanelWrap; // track info, transport controls, queue — hidden in CD view
  private JPanel bodyPanel; // the GridBagLayout row holding discColumn + playerPanelWrap — see applyCdViewState() for why this needs to be reachable
  private JPanel discColumn; // wraps disc for vertical centering in the main view — needs to be reachable so setMiniModeEnabled() can move disc back into it on exit
  private GridBagConstraints playerPanelWrapConstraints; // saved so playerPanelWrap can be re-added at its original cell when leaving CD view — see applyCdViewState()
  private JLabel hintLabel; // the keyboard-shortcuts line at the bottom — hidden in CD view
  private final JButton cdViewButton = textButton("CD VIEW");
  private boolean cdViewEnabled = false;
  private final JLabel cdViewTrackLabel = new JLabel(); // mirrors track's text (see setTrackTitle) — shown centered at the bottom of the window, only in CD view
  private final JLabel cdViewArtistLabel = new JLabel(); // mirrors artistLabel's text (see setTrackTitle) — sits under cdViewTrackLabel in the same bottom info block
  private JPanel cdViewInfoPanel; // wraps cdViewTrackLabel + cdViewArtistLabel, swapped in for hintLabel at the bottom of the window while in CD view — see applyCdViewState()
  private SnapshotFadeOverlay cdViewTransitionOverlay;
  private Timer cdViewTransitionTimer;
  private final JLabel status = label("●  READY TO PLAY", 11, ACCENT);
  private final JLabel track = new JLabel("Pick a track to get started.");
  private final JLabel artistLabel = new JLabel(); // author's name under the song title in normal view — hidden when the track has no artist tag
  private final JLabel source = label("YOUR MUSIC LIBRARY", 11, MUTED);
  private final JLabel elapsed = label("0:00", 10, MUTED);
  private final JLabel length = label("0:00", 10, MUTED);
  private final JSlider progress = new JSlider(0, 1000, 0);
  private final TransportButton play = new TransportButton(Glyph.PLAY, 68, true);
  private final ModeIconButton shuffleButton = new ModeIconButton(Glyph.SHUFFLE, "Shuffle");
  private final ModeIconButton repeatButton = new ModeIconButton(Glyph.REPEAT, "Repeat");
  private final JButton clearQueueButton = textButton("CLEAR QUEUE");
  private final JButton themeButton = textButton(THEMES[0].name);
  private final JButton lyricsButton = textButton("LYRICS");
  private String currentLyrics; // the loaded track's embedded lyrics, or null — drives lyricsButton's visibility
  private final JButton eqButton = textButton("EQ");
  private double[] eqGains = new double[Equalizer.BANDS]; // all 0 = flat; applied to the live player and persisted across launches
  private final java.util.List<EqPreset> customEqPresets = new ArrayList<EqPreset>();
  private final JButton historyButton = textButton("HISTORY");
  private static final int HISTORY_LIMIT = 50;
  private final java.util.List<File> playHistory = new ArrayList<File>(); // most-recently-played first
  private static final int SEARCH_RESULTS_LIMIT = 100;
  private final java.util.List<File> searchIndex = new ArrayList<File>(); // every audio file found under the last-used folder, filename-filtered live as the user types
  private int searchScanGeneration = 0; // bumped on every rescan so a slow background scan can't clobber results with stale data from a folder that's since changed
  private boolean searchScanning = false;
  private JTextField searchField; // live query box; a field so the background scan's completion callback can re-filter against whatever's currently typed
  private JPanel searchResultsList; // rebuilt in place on every keystroke, without rebuilding the whole card
  private JLabel searchStatusLabel;
  private String lastImportedSpotifyUrl; // guards against re-triggering an import repeatedly while the field still shows the same pasted link (every keystroke fires the DocumentListener, not just the paste itself)
  private final JLabel nowPlayingLabel = new JLabel("NOW PLAYING");
  private final JLabel queueInfo = label("QUEUE EMPTY", 10, MUTED);
  private final JLabel queueNext = label("DROP SONGS OR A FOLDER TO BUILD A QUEUE", 9, MUTED);
  private final JLabel crossfadeTitle = new JLabel("CROSSFADE");
  private final JSlider crossfadeSlider = new JSlider(0, 15, 0);
  private final JLabel crossfadeValueLabel = new JLabel("OFF");
  private final JLabel sleepTimerTitle = new JLabel("SLEEP TIMER");
  private final JSlider sleepTimerSlider = new JSlider(0, 120, 0);
  private final JLabel sleepTimerValueLabel = new JLabel("OFF");
  // Small header readout, only non-empty while a sleep timer is armed — not persisted across restarts (a
  // countdown resuming after the app was actually closed doesn't mean anything), and independent of play/pause:
  // real sleep timers count down wall-clock time regardless, and just no-op firing if already paused.
  private final JLabel sleepTimerIndicator = label("", 10, MUTED);
  private final Timer sleepTimer = new Timer(1000, null);
  private int sleepSecondsRemaining;
  private final JLabel volumeTitle = new JLabel("VOLUME");
  private final JSlider volumeSlider = new JSlider(0, 100, 100);
  private final JLabel volumeValueLabel = new JLabel("100%");
  private final VisualizerBars visualizer = new VisualizerBars();
  private final ThemeOverlay themeOverlay = new ThemeOverlay();
  private final List<File> queue = new ArrayList<File>();
  private int queueIndex = -1;
  // Bounded LRU, not a plain HashMap — SongDetails carries a full-resolution embedded-cover BufferedImage (easily
  // several MB apiece), and an unbounded cache here meant memory grew for as long as the session kept touching new
  // files (History, Search, shuffle/repeat over a large library all do), with nothing ever evicted. Eldest-first
  // eviction (access-order=true) once the cap is exceeded keeps a generous working set without an unbounded tail.
  private static final int METADATA_CACHE_LIMIT = 200;
  private final Map<File, SongDetails> metadataCache = new LinkedHashMap<File, SongDetails>(16, 0.75f, true) {
    protected boolean removeEldestEntry(Map.Entry<File, SongDetails> eldest) { return size() > METADATA_CACHE_LIMIT; }
  };
  private final Map<File, Long> durationCache = new LinkedHashMap<File, Long>(16, 0.75f, true) {
    protected boolean removeEldestEntry(Map.Entry<File, Long> eldest) { return size() > METADATA_CACHE_LIMIT; }
  };
  // Panel that lists all queued songs; displayed under queue headers.
  private final JPanel queueList = new JPanel();
  private final List<QueueRowUI> queueRows = new ArrayList<QueueRowUI>();
  private int hoveredQueueIndex = -1;
  // Drag-to-reorder state for the queue list — see updateQueueUI(). draggingIndex tracks the row's current
  // position live (not the stale index captured when its row was built), since a swap rebuilds every row.
  private int draggingIndex = -1;
  private int dragLastScreenY;
  private int dragAccumulatedY;
  private boolean dragMoved;
  private boolean shuffle;
  private enum RepeatMode { OFF, ONE, ALL }
  private RepeatMode repeatMode = RepeatMode.OFF;
  private StreamPlayer player;
  private File loadedFile;
  private File temporaryAudio;
  private boolean adjusting;
  private boolean crossfadeStarted;
  private boolean crossfading;
  private float volume = 1f;
  private boolean monoAudio;
  // Beat detection state for the visualizer — a classic "energy vs. its own rolling average" onset detector: no
  // FFT/frequency analysis, just broadband RMS energy (levels[] from computeLevels() is already that) compared
  // against its recent history. Transients (drum/bass hits) spike broadband energy anyway, so this reads as
  // genuinely beat-synced for most music without needing real spectral analysis.
  private final double[] beatEnergyHistory = new double[106]; // ~1.7s of history at the 16ms tick rate
  private int beatEnergyHistoryIndex;
  private double beatPulse; // 0..1, spikes to 1 on a detected beat and decays each tick; visualizer levels are boosted by this
  // 0.15 per tick, rescaled from the original 70ms tick to this clock's current 16ms one (0.15 * 16/70) so the
  // snap-and-fade pulse still fades over the same ~0.5s of real time instead of 4.4x faster.
  private static final double BEAT_DECAY_PER_TICK = 0.15 * 16.0 / 70.0;
  private byte[] rawAudio;
  private AudioFormat audioFormat;
  private WaveformSliderUI waveformSliderUI;
  // Windows' own DWM compositor presents every window's frame buffer vsync-locked to the display's actual refresh
  // rate regardless of how fast an individual app repaints — a plain windowed Swing app can't tear the way a
  // legacy fullscreen-exclusive GDI app could, so there's no separate "enable vsync" call to make here. What
  // genuinely matters is not guessing a fixed interval that's wrong for whatever monitor this actually runs on:
  // painting slower than the display's refresh leaves real frames on the table (DWM just re-presents the same
  // stale frame at its own tick), and painting much faster than it wastes CPU on frames DWM will discard unseen.
  // Querying the real refresh rate and pacing continuous animations (disc spin, theme particles, disc eject) to
  // match it lands each repaint just before DWM's own next composite, which is the practical meaning of "vsync"
  // for a desktop app that doesn't own the swap chain itself. REFRESH_RATE_UNKNOWN does happen in some
  // environments (RDP/virtualized displays in particular), so this falls back to a plain 60Hz assumption there.
  private static final int DISPLAY_REFRESH_MS = computeDisplayRefreshMs();
  private static int computeDisplayRefreshMs() {
    try {
      int hz = java.awt.GraphicsEnvironment.getLocalGraphicsEnvironment().getDefaultScreenDevice().getDisplayMode().getRefreshRate();
      if (hz == java.awt.DisplayMode.REFRESH_RATE_UNKNOWN || hz <= 0) return 16;
      return Math.max(1, Math.round(1000f / hz));
    } catch (Exception unavailable) { return 16; }
  }
  // DISPLAY_REFRESH_MS matches the display exactly (down to ~7ms on this machine's 144Hz panel), which is right
  // for brief, one-shot UI transitions but wrong for animations that run continuously for as long as a track is
  // playing (disc spin, theme particles, disc eject): measured directly, running the disc's own repaint at 144Hz
  // instead of 60Hz raised its CPU cost from ~14% to ~35% of one core — linear with the tick rate, not a bug, but
  // real cost that competes for scheduling with StreamPlayer's real-time audio pump thread (see StreamPlayer.pump)
  // for the entire time a song is playing. A spinning disc doesn't read as meaningfully smoother past 60fps the
  // way responding-to-input content would, so there's no visual reason to pay that cost. Clamping to 16ms keeps
  // the "adapt to a slower display" half of DISPLAY_REFRESH_MS's reasoning (a 30Hz display still gets matched
  // exactly) while dropping the "chase a 144Hz+ display" half that was actively costing audio smoothness for no
  // visible benefit.
  private static final int ANIMATION_TICK_MS = Math.max(16, DISPLAY_REFRESH_MS);
  // 16ms (~60fps), not the original 70ms (~14fps): this timer drives the seek slider, elapsed-time label, and
  // visualizer during ordinary playback — i.e. the bulk of actual time spent using the app — so 70ms visibly
  // made the seek bar creep in discrete jumps and the visualizer/beat pulse look stepped rather than fluid.
  // computeLevels() only samples a small ~90ms audio window each tick (a few thousand cheap RMS multiplies), so
  // the extra calls at 4x the old rate cost microseconds, not milliseconds — nowhere near the 16ms budget.
  private final Timer clock = new Timer(16, this::tick);
  private static final Pattern ITUNES_COVER = Pattern.compile("\\\"artworkUrl100\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern DEEZER_COVER = Pattern.compile("\\\"cover_xl\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern SPOTIFY_ACCESS_TOKEN = Pattern.compile("\\\"access_token\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern SPOTIFY_REFRESH_TOKEN = Pattern.compile("\\\"refresh_token\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern SPOTIFY_EXPIRES_IN = Pattern.compile("\\\"expires_in\\\"\\s*:\\s*(\\d+)");
  private static final Pattern SPOTIFY_TRACK_URL = Pattern.compile("open\\.spotify\\.com/track/([a-zA-Z0-9]+)|spotify:track:([a-zA-Z0-9]+)");
  private static final Pattern SPOTIFY_PLAYLIST_URL = Pattern.compile("open\\.spotify\\.com/playlist/([a-zA-Z0-9]+)|spotify:playlist:([a-zA-Z0-9]+)");
  // 127.0.0.1, not localhost — matches the loopback-IP exception Spotify's own app-registration form requires
  // for a plain (non-HTTPS) redirect URI; must exactly match whatever's registered in the user's Spotify app.
  private static final String SPOTIFY_REDIRECT_URI = "http://127.0.0.1:8080/callback";
  // (?:[^"\\]|\\.)* rather than [^"]* : lyrics text routinely contains escaped quotes and, far more importantly,
  // escaped newlines (\n) throughout — a naive "everything up to the next quote" match would stop at the first
  // escaped quote inside the lyrics themselves instead of the string's real closing quote.
  private static final Pattern LRCLIB_SYNCED_KEY = Pattern.compile("\\\"syncedLyrics\\\"\\s*:\\s*\\\"");
  private static final Pattern LRCLIB_PLAIN_KEY = Pattern.compile("\\\"plainLyrics\\\"\\s*:\\s*\\\"");
  // %LOCALAPPDATA%\CDPlayer is the idiomatic Windows location for a per-user app data folder (what Explorer,
  // backup tools, and antivirus scanners expect) — the cross-platform build's plain ~/.cdplayer dotfile
  // convention is a Unix habit that works on Windows but isn't native to it. LOCALAPPDATA is unset only in
  // exotic launch contexts (e.g. certain service accounts), so user.home stays as a defensive fallback.
  private static final File APP_DATA_DIR = new File(
    System.getenv("LOCALAPPDATA") != null ? System.getenv("LOCALAPPDATA") : System.getProperty("user.home"),
    "CDPlayer");
  private static final File QUEUE_STATE_FILE = new File(APP_DATA_DIR, "queue.txt");
  private static final File ONBOARDING_FLAG_FILE = new File(APP_DATA_DIR, "onboarded");
  // Bumped by hand alongside CHANGELOG below whenever a build ships — also what's passed to jpackage's
  // --app-version at build time, so the two stay in sync.
  private static final String APP_VERSION = "1.11.0";
  private static final File LAST_VERSION_FILE = new File(APP_DATA_DIR, "lastversion.txt");
  private static final File LAST_PATH_FILE = new File(APP_DATA_DIR, "lastpath.txt");
  private static final File SETTINGS_FILE = new File(APP_DATA_DIR, "settings.txt");
  private static final File EQ_PRESETS_FILE = new File(APP_DATA_DIR, "eq-presets.txt");
  private static final File HISTORY_FILE = new File(APP_DATA_DIR, "history.txt");
  // Two lines: Client ID, then Client Secret, from a free app registered at developer.spotify.com/dashboard —
  // deliberately a local, gitignored-by-convention file rather than anything in source, since a Client Secret is
  // meant to stay private per Spotify's own API terms. Missing/empty file just means the Spotify cover fallback
  // never activates (see searchSpotifyCover) — iTunes and Deezer still work exactly as before either way.
  private static final File SPOTIFY_CREDENTIALS_FILE = new File(APP_DATA_DIR, "spotify.txt");
  /** A named set of 10 band gains (dB). Built-in presets are fixed; user-saved ones (see customEqPresets) use the same type and live alongside them in the picker. */
  private static final class EqPreset {
    final String name; final double[] gains;
    EqPreset(String name, double... gains) { this.name = name; this.gains = gains; }
  }
  // Classic graphic-EQ preset shapes across the 10 ISO bands (31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz).
  private static final EqPreset[] BUILTIN_EQ_PRESETS = {
    new EqPreset("Flat", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    new EqPreset("Bass Boost", 6, 5, 4, 2, 0, 0, 0, 0, 0, 0),
    new EqPreset("Treble Boost", 0, 0, 0, 0, 0, 0, 2, 4, 5, 6),
    new EqPreset("Vocal", -2, -1, 0, 2, 4, 4, 3, 1, 0, -1),
    new EqPreset("Rock", 4, 3, 2, 0, -1, 0, 1, 2, 3, 4),
    new EqPreset("Pop", -1, 0, 2, 3, 3, 2, 0, -1, -1, -1),
    new EqPreset("Classical", 3, 2, 0, 0, 0, 0, 0, 2, 3, 4),
    new EqPreset("Electronic", 5, 4, 1, 0, -2, 0, 1, 2, 4, 5),
  };
  private final JButton settingsButton = textButton("SETTINGS");
  private final JButton monoButton = textButton("OFF");
  private final JButton waveformButton = textButton("ON");
  private boolean waveformEnabled = true;
  private final JButton animationsButton = textButton("ON");
  private final JButton miniModeButton = textButton("OFF");
  private boolean miniModeEnabled = false;
  private JPanel miniPanel; // built lazily on first use — see setMiniModeEnabled()
  private final JLabel miniTrackLabel = new JLabel(); // mirrors track's text (see setTrackTitle) — the compact mini-player window's own title line
  private final JLabel miniArtistLabel = new JLabel(); // the artist's own line underneath — split from miniTrackLabel so a long title and a long artist each get their own fitText budget instead of fighting for room on one combined "Artist – Title" line
  private final JSlider miniProgress = new JSlider(0, 1000, 0); // mirrors progress's value (see syncMiniProgress) rather than being re-parented — progress lives inside playerPanel(), built once, and Mini Mode needs its own always-available small widgets instead of tearing a live component out of that tree on every toggle
  private final JLabel miniElapsed = label("0:00", 9, MUTED);
  private final JLabel miniLength = label("0:00", 9, MUTED);
  // Built lazily inside buildMiniPanel() — null until Mini Mode is entered for the first time, same as miniPanel
  // itself — but unlike the labels/slider above, setPlaying() (called constantly, well before Mini Mode is ever
  // entered) needs to touch miniPlayButton specifically, hence the null-guard there rather than eager construction.
  private TransportButton miniPlayButton;
  // The raw (non-HTML, non-ellipsized) name/artist last passed to setTrackTitle() — kept so buildMiniPanel() can
  // re-run fitText on the mini labels against the CURRENT track right after constructing them (see
  // setMiniModeEnabled()'s call site), rather than the hardcoded placeholder font buildMiniPanel() sets initially
  // silently winning over whatever fitText had already computed for a track loaded before Mini Mode was ever
  // first entered.
  private String currentTrackName = "Pick a track to get started.", currentTrackArtist;
  private java.awt.Rectangle preMiniBounds; // window bounds to restore on exit — same pattern as preFullscreenBounds below
  private CenteredOverlay settingsOverlay;
  private CenteredOverlay lyricsOverlay;
  private CenteredOverlay eqOverlay;
  private CenteredOverlay historyOverlay;
  private CenteredOverlay searchOverlay;
  private ThemeMenuOverlay themeMenuOverlay;
  private JPanel contentStack; // the OverlayLayout stack: themeMenuOverlay / settingsOverlay / lyricsOverlay / historyOverlay / searchOverlay (topmost, added lazily) > foreground > themeOverlay > background
  private java.awt.Rectangle preFullscreenBounds;
  private boolean fullscreen;

  public static void main(String[] args) {
    // The theme dropdown (showThemeMenu) uses a JPopupMenu; Swing normally decides per-popup whether to use a
    // lightweight (in-window) or heavyweight (separate native window) implementation. Forcing lightweight avoids
    // the same class of bug that motivated moving Settings off JDialog: a heavyweight popup is a real top-level
    // window, and those don't reliably layer above this app's own always-on-top fullscreen window.
    javax.swing.JPopupMenu.setDefaultLightWeightPopupEnabled(true);
    SwingUtilities.invokeLater(() -> {
      // This build only ever runs on Windows, so the native Windows L&F is set directly instead of going through
      // getSystemLookAndFeelClassName()'s per-OS reflection lookup — same result, one less runtime detection step.
      try { UIManager.setLookAndFeel("com.sun.java.swing.plaf.windows.WindowsLookAndFeel"); }
      catch (Exception ignored) { }
      CDPlayer player = new CDPlayer();
      player.setVisible(true);
      // Captured before showOnboardingIfNeeded() runs, since that call itself creates ONBOARDING_FLAG_FILE the
      // moment a fresh-install user dismisses the welcome dialog — checking it afterward would see it as
      // "existing" even on a brand new install. showChangelogIfNeeded() needs the true before-state to tell a
      // real returning user apart from someone who just installed for the first time.
      boolean existingInstall = ONBOARDING_FLAG_FILE.isFile();
      player.showOnboardingIfNeeded();
      player.showChangelogIfNeeded(existingInstall);
    });
  }

  public CDPlayer() {
    super("CDPlayer");
    try (InputStream in =
            CDPlayer.class.getResourceAsStream("/com/cdplayer/icon.png")) {

        if (in != null) {
            BufferedImage icon = ImageIO.read(in);

            if (icon != null) {
                setIconImage(icon);
            }
        }

    } catch (IOException ignored) {
    }
    setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
    // The vertical stack of labels/sliders/buttons/queue-card genuinely needs ~720px of content height at its
    // component minimums (measured directly via Swing's own getMinimumSize()) — the previous 560 floor was
    // already smaller than that, so under any layout pressure something in the column had to overflow/clip
    // rather than shrink further. Both figures below give real headroom above that requirement.
    setMinimumSize(new Dimension(760, 785));
    setSize(1120, 820);
    setLocationByPlatform(true);
    setContentPane(createContent());
    // The glass pane, not a regular sibling layer — see createContent()'s doc comment for why: it's the one
    // mechanism Swing actually composites independently, so themeOverlay's continuous particle-animation
    // repaints don't cascade into repainting the rest of the window. ThemeOverlay itself clips the disc's
    // current bounds out of its own painting so particles still don't visually cover it.
    getRootPane().setGlassPane(themeOverlay);
    themeOverlay.setDiscReference(disc);
    themeOverlay.setVisible(false);
    // Easter egg: at the peak of the disc's eject animation (see DiscView), swap to the next track — like
    // physically switching the CD while it's held up out of the case. nextTrack() already no-ops gracefully
    // (returns false) with an empty queue or at the end of it, so no extra guard is needed here.
    disc.setOnEjectPeak(this::nextTrack);
    disc.setOnCoverChanged(this::onCoverChanged);
    disc.setOnMiniClick(this::toggle);
    setDropTarget(new DropTarget(this, new DropTargetAdapter() {
      @SuppressWarnings("unchecked") public void drop(DropTargetDropEvent event) {
        // DropTarget is registered on the frame itself, not on any particular component — unlike a mouse click
        // (which the modal overlays' full-window backdrop already blocks via ordinary Swing z-order hit-
        // testing), a file drop bypasses that entirely and would still reach here and queue/play a track even
        // with Settings or another panel open on top of it. Rejecting it here is the drag-and-drop equivalent
        // of the click-blocking backdrop those overlays already have.
        if (anyOverlayOpen()) { event.rejectDrop(); return; }
        try {
          event.acceptDrop(event.getDropAction());
          List<File> files = (List<File>) event.getTransferable().getTransferData(DataFlavor.javaFileListFlavor);
          if (!files.isEmpty()) addToQueue(files);
        } catch (Exception ignored) { status.setText("●  COULDN'T LOAD THAT FILE"); }
      }
    }));
    bindKeys();
    // Wired once here rather than inside buildSettingsPanel(), which is rebuilt fresh every time the Settings
    // dialog opens — attaching it there would stack a duplicate listener on each open.
    themeButton.addActionListener(e -> showThemeMenu());
    lyricsButton.addActionListener(e -> showLyrics());
    eqButton.addActionListener(e -> showEq());
    sleepTimer.addActionListener(e -> {
      sleepSecondsRemaining--;
      if (sleepSecondsRemaining <= 0) {
        sleepTimer.stop();
        sleepSecondsRemaining = 0;
        if (player != null && player.isRunning()) toggle(); // pause; a no-op if already paused when this fires
        sleepTimerSlider.setValue(0); // resets the Settings row back to OFF too, if it happens to be open
      }
      updateSleepTimerIndicator();
    });
    Runtime.getRuntime().addShutdownHook(new Thread(this::saveQueueState, "cdplayer-save-queue"));
    Runtime.getRuntime().addShutdownHook(new Thread(this::saveSettingsState, "cdplayer-save-settings"));
    loadCustomEqPresets();
    loadHistory();
    restoreSettingsState();
    restoreQueueState();
  }

  /**
   * True while any of the modal-ish overlays (Settings/Lyrics/EQ/History/Search, or the theme picker menu) is
   * open — every player-control key binding below (LEFT/RIGHT/SPACE/K/J/L/F/C) checks this first and no-ops if
   * it's true. These overlays already block mouse clicks to the player behind them (see CenteredOverlay's full-
   * window backdrop), but that never touched keyboard shortcuts: WHEN_IN_FOCUSED_WINDOW bindings fire purely
   * because the window has focus, with no awareness of what's currently drawn on top of it — so pressing Space
   * (or J/L, F, C, the arrows...) while Settings was open would still play/pause, skip tracks, or toggle
   * fullscreen/CD view underneath it. ESCAPE is deliberately NOT gated by this — it's what closes these overlays
   * in the first place, via its own priority chain below.
   */
  private boolean anyOverlayOpen() {
    return (themeMenuOverlay != null && themeMenuOverlay.isVisible())
        || (lyricsOverlay != null && lyricsOverlay.isVisible())
        || (eqOverlay != null && eqOverlay.isVisible())
        || (historyOverlay != null && historyOverlay.isVisible())
        || (searchOverlay != null && searchOverlay.isVisible())
        || (settingsOverlay != null && settingsOverlay.isVisible());
  }
  private void bindKeys() {
    javax.swing.JRootPane root = getRootPane();
    javax.swing.InputMap inputMap = root.getInputMap(javax.swing.JComponent.WHEN_IN_FOCUSED_WINDOW);
    javax.swing.ActionMap actionMap = root.getActionMap();
    bindKey(inputMap, actionMap, "LEFT", "skipBack15", e -> { if (!anyOverlayOpen()) seek(-15); });
    bindKey(inputMap, actionMap, "RIGHT", "skipForward15", e -> { if (!anyOverlayOpen()) seek(15); });
    bindKey(inputMap, actionMap, "SPACE", "togglePlaySpace", e -> { if (!anyOverlayOpen()) toggle(); });
    bindKey(inputMap, actionMap, "K", "togglePlayK", e -> { if (!anyOverlayOpen()) toggle(); });
    bindKey(inputMap, actionMap, "J", "previousTrackJ", e -> { if (!anyOverlayOpen()) previousTrack(); });
    bindKey(inputMap, actionMap, "L", "nextTrackL", e -> { if (!anyOverlayOpen()) nextTrack(); });
    bindKey(inputMap, actionMap, "F", "toggleFullscreen", e -> { if (!anyOverlayOpen()) toggleFullscreen(); });
    bindKey(inputMap, actionMap, "C", "toggleCdView", e -> { if (!anyOverlayOpen()) toggleCdView(); });
    // Not gated on anyOverlayOpen() the way C/F are: Mini Mode's own window has no Settings/History/etc. buttons
    // to open an overlay from in the first place (see buildMiniPanel), so that guard would only ever matter for
    // toggling Mini Mode ON from the full window while some overlay happens to be open — harmless either way,
    // but keeping it ungated means M reliably exits Mini Mode from inside it too, with nothing else to check.
    bindKey(inputMap, actionMap, "M", "toggleMiniMode", e -> setMiniModeEnabled(!miniModeEnabled));
    // Closest-thing-open takes priority: the theme menu, then Settings, then CD view, then fullscreen. Both
    // overlays are plain in-window components (not separate JDialog/JPopupMenu windows — see
    // showSettingsDialog/showThemeMenu), so this single WHEN_IN_FOCUSED_WINDOW binding on the main frame handles
    // all of these; there's no separate window with its own key bindings to manage.
    bindKey(inputMap, actionMap, "ESCAPE", "escapeAction", e -> {
      if (themeMenuOverlay != null && themeMenuOverlay.isVisible()) hideThemeMenu();
      else if (lyricsOverlay != null && lyricsOverlay.isVisible()) closeLyrics();
      else if (eqOverlay != null && eqOverlay.isVisible()) closeEq();
      else if (historyOverlay != null && historyOverlay.isVisible()) closeHistory();
      else if (searchOverlay != null && searchOverlay.isVisible()) closeSearch();
      else if (settingsOverlay != null && settingsOverlay.isVisible()) closeSettingsDialog();
      else if (miniModeEnabled) setMiniModeEnabled(false);
      else if (cdViewEnabled) toggleCdView();
      else if (fullscreen) toggleFullscreen();
    });
  }
  /**
   * CD view: a distraction-free "now playing" look — hides the header row (status pill, History/Settings), the
   * whole track/transport/queue column, and the keyboard-shortcuts hint line, leaving only the disc (enlarged,
   * see DiscView.setEnlarged) and the triangle divider below where the header row was. The song name and author
   * swap in for the hint line at the bottom of the window instead (see cdViewInfoPanel), not tucked under the
   * disc, so they stay put and legible regardless of the disc's own size. Independent of true fullscreen (F) —
   * either can be on, off, or both at once.
   *
   * The transition itself is a snapshot crossfade (see SnapshotFadeOverlay), not an animation of each component's
   * own visibility/size: with the header, the whole track/transport/queue column, and the disc's size all
   * changing in the same instant, animating each of those individually (fading several unrelated Swing
   * containers in place, resizing a GridBagLayout cell smoothly) would mean either reworking each of those
   * components to support a live opacity/size tween or fighting the layout manager mid-animation. A single
   * frozen "before" snapshot fading away to reveal the already-applied "after" state underneath gets a smooth
   * transition without any of that, the same trick FadeableCard already uses for the overlays.
   */
  // Cap on the "before" snapshot's internal render resolution for the CD-view crossfade: painting, then
  // repeatedly alpha-blending across the transition's animation steps, a full-resolution captured image (the
  // whole window's content, not a handful of simple shapes) costs roughly proportional to its pixel count, which
  // at a large/fullscreen window dwarfs a windowed one. Below the cap this is a no-op: scale ends up 1.0 and the
  // snapshot is captured at native resolution, exactly as before.
  private static final int CD_VIEW_SNAPSHOT_CAP = 1600;
  // Above this destination size, even the cheapest per-pixel blit (SnapshotFadeOverlay's NEAREST-interpolated
  // drawImage — see its own doc comment) can't stay inside the transition's ~8ms/step budget: measured directly
  // at 13ms/step by 3840x2160, climbing to 32ms/step by 6016x3384 — a "crossfade" that's actually stuttering
  // through 1-2 dropped, stalled frames looks worse than no animation at all. 3200 sits with headroom below the
  // 3840 measurement (6.06ms/step at 2560x1440, still comfortably inside budget) and above it, falling back to
  // the same instant switch animationsEnabled=false already uses keeps CD view itself always responsive,
  // trading only the crossfade's visual polish specifically where it wouldn't have read as smooth anyway.
  private static final int CD_VIEW_ANIMATE_MAX = 3200;
  private void toggleCdView() {
    if (miniModeEnabled) setMiniModeEnabled(false); // mutually exclusive — an enlarged disc makes no sense inside the tiny Mini Mode window
    cdViewEnabled = !cdViewEnabled;
    int w = Math.max(1, contentStack.getWidth()), h = Math.max(1, contentStack.getHeight());
    if (!animationsEnabled || Math.max(w, h) > CD_VIEW_ANIMATE_MAX) { applyCdViewState(); return; }

    if (cdViewTransitionTimer != null && cdViewTransitionTimer.isRunning()) cdViewTransitionTimer.stop();
    if (cdViewTransitionOverlay != null) { contentStack.remove(cdViewTransitionOverlay); cdViewTransitionOverlay.releaseSnapshot(); cdViewTransitionOverlay = null; } // clean up an interrupted previous transition, if "C" was pressed again mid-fade

    double snapshotScale = Math.min(1.0, CD_VIEW_SNAPSHOT_CAP / (double) Math.max(w, h));
    int bw = Math.max(1, (int) Math.round(w * snapshotScale)), bh = Math.max(1, (int) Math.round(h * snapshotScale));
    BufferedImage before = new BufferedImage(bw, bh, BufferedImage.TYPE_INT_ARGB);
    Graphics2D bg = before.createGraphics();
    bg.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    bg.scale(snapshotScale, snapshotScale); // contentStack.paint() below still draws at its normal logical coordinates; this maps that down onto the (possibly capped, smaller) buffer
    contentStack.paint(bg);
    bg.dispose();

    applyCdViewState(); // instantly applied, underneath the frozen "before" snapshot about to cover it

    SnapshotFadeOverlay overlay = new SnapshotFadeOverlay(before);
    overlay.setPreferredSize(new Dimension(w, h)); overlay.setMaximumSize(new Dimension(w, h));
    cdViewTransitionOverlay = overlay;
    contentStack.add(overlay, 0);
    contentStack.validate();

    final int steps = 6;
    final int[] step = { 0 };
    cdViewTransitionTimer = new Timer(8, null);
    cdViewTransitionTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      overlay.setAlpha(1f - t);
      if (t >= 1f) {
        ((Timer) e.getSource()).stop();
        contentStack.remove(overlay);
        overlay.releaseSnapshot();
        if (cdViewTransitionOverlay == overlay) cdViewTransitionOverlay = null;
        contentStack.repaint();
      }
    });
    cdViewTransitionTimer.start();
  }
  /**
   * playerPanelWrap.setVisible(false) alone isn't enough to free up its column's width for the enlarged disc:
   * GridBagLayout counts an invisible component's preferred size toward its column's width demand regardless of
   * visibility (confirmed directly — a minimal GridBagLayout with one hidden 600px-preferred column still
   * squeezed a 760px-preferred sibling down to its 260px floor). So playerPanelWrap is removed from bodyPanel
   * entirely while in CD view, and re-added at its original cell (playerPanelWrapConstraints) on the way back.
   * contentStack.validate() (immediate, not a deferred revalidate) is used for the same reason every overlay
   * open/close in this file uses it: several components change visibility/size/membership at once, and the
   * layout needs to re-center the disc in the newly-freed space right away, not on whatever the next natural
   * repaint cycle happens to be.
   */
  private void applyCdViewState() {
    headerPanel.setVisible(!cdViewEnabled);
    hintLabel.setVisible(!cdViewEnabled);
    cdViewInfoPanel.setVisible(cdViewEnabled);
    disc.setEnlarged(cdViewEnabled);
    cdViewButton.setText(cdViewEnabled ? "EXIT CD VIEW" : "CD VIEW");
    if (cdViewEnabled) {
      if (playerPanelWrap.getParent() == bodyPanel) bodyPanel.remove(playerPanelWrap);
    } else if (playerPanelWrap.getParent() != bodyPanel) {
      bodyPanel.add(playerPanelWrap, playerPanelWrapConstraints);
    }
    playerPanelWrap.setVisible(!cdViewEnabled);
    bodyPanel.invalidate();
    contentStack.validate();
  }
  // Height grew from the original 168 to fit the added artist line + transport button row (see buildMiniPanel())
  // without feeling cramped.
  private static final int MINI_WINDOW_WIDTH = 400, MINI_WINDOW_HEIGHT = 210;
  /**
   * Mini Mode: shrinks the whole window down to a small, glanceable, always-on-top widget — disc, title/artist,
   * and a seek bar, nothing else — toggled from the Settings row (see buildSettingsPanel) rather than an
   * animated in-window state change like CD view, since it needs the actual JFrame itself to become small, not
   * just what's shown inside a fixed-size one. Swaps the whole content pane rather than hiding/showing pieces of
   * the existing one (setContentPane() works fine on an already-visible frame — no dispose()/recreate needed,
   * unlike toggleFullscreen()'s undecorated-peer dance): contentStack and everything inside it (including any
   * currently-open Settings/Lyrics/etc. overlay) stays fully intact in memory while detached, and reappears
   * exactly as it was left the moment Mini Mode turns back off.
   */
  // The main window's own floor, set once in the constructor — setSize() to Mini Mode's much smaller target
  // is silently clamped back up to this by the native peer otherwise (confirmed directly: requested 400x168,
  // got 760x785 — exactly this floor), so it has to come down too while Mini Mode is active and go back
  // afterward. Mini Mode's own minimum is the window size itself: it's a fixed-size widget, never user-resized.
  private static final Dimension MAIN_MINIMUM_SIZE = new Dimension(760, 785);
  private void setMiniModeEnabled(boolean enabled) {
    if (enabled == miniModeEnabled) return;
    if (enabled) {
      if (cdViewEnabled) toggleCdView(); // mutually exclusive — see toggleCdView()'s own guard
      if (fullscreen) toggleFullscreen(); // mutually exclusive — see toggleFullscreen()'s own guard
      // The re-fit call right after building is what keeps a long title/artist correctly sized the very first
      // time Mini Mode is entered — see currentTrackName/currentTrackArtist's own doc comment for why
      // buildMiniPanel()'s own hardcoded initial font isn't enough on its own.
      if (miniPanel == null) { miniPanel = buildMiniPanel(); setTrackTitle(currentTrackName, currentTrackArtist); }
      preMiniBounds = getBounds();
      miniModeEnabled = true;
      miniModeButton.setText("ON");
      disc.setMini(true);
      miniPanel.add(disc, BorderLayout.WEST); // moves disc here — a component can only have one parent, so this auto-detaches it from discColumn; see the exit branch below for the move back
      setContentPane(miniPanel);
      setMinimumSize(new Dimension(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT));
      setResizable(false);
      setAlwaysOnTop(true);
      setSize(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT);
      syncMiniProgress();
    } else {
      miniModeEnabled = false;
      miniModeButton.setText("OFF");
      disc.setMini(false);
      discColumn.add(disc, 1); // back between discColumn's two centering glue components (index 0 and what's now 1) — see the enter branch above for where it went
      setContentPane(contentStack);
      setResizable(true);
      setAlwaysOnTop(false);
      setMinimumSize(MAIN_MINIMUM_SIZE);
      if (preMiniBounds != null) setBounds(preMiniBounds);
    }
    // validate() (immediate, synchronous), not revalidate() (deferred) — same reasoning as every other
    // overlay/view-mode change in this file: disc was just re-parented (into or out of miniPanel) right above,
    // and a deferred revalidate left it reporting its stale pre-swap size (confirmed directly: still 480 wide,
    // Normal Mode's own preferred size, well after the swap and an explicit repaint).
    getRootPane().validate();
    getRootPane().repaint();
    getRootPane().requestFocusInWindow(); // keyboard shortcuts live on the root pane's WHEN_IN_FOCUSED_WINDOW map — same reasoning as toggleFullscreen()'s own call
  }
  /** Built once, lazily, the first time Mini Mode is actually entered — mirrors showSettingsDialog()'s lazy-overlay pattern. Structure only — disc itself is moved in and out by setMiniModeEnabled() on every toggle, not added here, since it needs to move back to discColumn on exit rather than staying put. */
  private JPanel buildMiniPanel() {
    JPanel panel = new JPanel(new BorderLayout(12, 0));
    panel.setBackground(BG); panel.setOpaque(true);
    panel.setBorder(BorderFactory.createEmptyBorder(16, 16, 16, 16));

    // GridBagLayout, not BoxLayout Y_AXIS: BoxLayout's minor-axis (width) sizing measurably failed to stretch
    // these rows to the column's actual available width once a row's own preferred width (driven by a long
    // fitText-ellipsized HTML label) exceeded what an early/first layout pass had — confirmed directly (a long
    // title's row settling at ~150px wide inside a 264px-wide column, no amount of extra validate() passes fixing
    // it). Each GridBagConstraints row below is pinned to weightx=1/fill=HORIZONTAL explicitly instead of relying
    // on BoxLayout's alignment-based minor-axis stretching, which sidesteps that failure mode entirely.
    JPanel right = new JPanel(new GridBagLayout()); right.setOpaque(false);
    GridBagConstraints rightGc = new GridBagConstraints();
    rightGc.gridx = 0; rightGc.fill = GridBagConstraints.HORIZONTAL; rightGc.weightx = 1.0; rightGc.anchor = GridBagConstraints.WEST;
    int rightRow = 0;

    JPanel titleRow = new JPanel(new BorderLayout()); titleRow.setOpaque(false);
    miniTrackLabel.setFont(new Font("SansSerif", Font.BOLD, 13)); miniTrackLabel.setForeground(TEXT);
    // Locked to match setTrackTitle()'s own fitText width budget for this label — without an explicit size,
    // BorderLayout.CENTER instead hands it whatever's left over in titleRow at layout time, which doesn't
    // necessarily match that budget, and an HTML JLabel wraps to a second line (rather than the single-line
    // ellipsis fitText/ellipsize() computed for) whenever its real rendered width comes in narrower than assumed.
    miniTrackLabel.setPreferredSize(new Dimension(220, 16)); miniTrackLabel.setMinimumSize(new Dimension(0, 16));
    titleRow.add(miniTrackLabel, BorderLayout.CENTER);
    JButton exitButton = new JButton("×"); exitButton.setFont(new Font("SansSerif", Font.BOLD, 16)); exitButton.setForeground(MUTED);
    exitButton.setFocusPainted(false); exitButton.setBorderPainted(false); exitButton.setContentAreaFilled(false); exitButton.setOpaque(false);
    exitButton.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); exitButton.setMargin(new Insets(0, 8, 0, 0)); exitButton.setToolTipText("Exit Mini Mode");
    exitButton.setFocusable(false);
    attachColorHover(exitButton, MUTED, TEXT);
    exitButton.addActionListener(e -> setMiniModeEnabled(false));
    titleRow.add(exitButton, BorderLayout.EAST);
    rightGc.gridy = rightRow++; rightGc.insets = new Insets(0, 0, 2, 0); right.add(titleRow, rightGc);

    miniArtistLabel.setFont(new Font("SansSerif", Font.PLAIN, 10)); miniArtistLabel.setForeground(MUTED);
    miniArtistLabel.setPreferredSize(new Dimension(220, 13)); miniArtistLabel.setMinimumSize(new Dimension(0, 13));
    rightGc.gridy = rightRow++; rightGc.insets = new Insets(0, 0, 0, 0); right.add(miniArtistLabel, rightGc);

    // Flexible gap: weighty=1 on this row alone (every other row keeps its natural height) so it absorbs
    // whatever vertical space the window has beyond the other rows' combined natural height, same centering
    // effect the old BoxLayout glue was after.
    GridBagConstraints glueGc = (GridBagConstraints) rightGc.clone();
    glueGc.gridy = rightRow++; glueGc.weighty = 1.0; glueGc.fill = GridBagConstraints.VERTICAL;
    right.add(javax.swing.Box.createGlue(), glueGc);

    // Prev/play-pause/next — mirrors the main transport row's buttons (see playerPanel()), just smaller and
    // built as separate instances rather than reusing play/back/forward directly, since a Swing component can
    // only ever have one parent (same reasoning as disc's own re-parenting between discColumn and miniPanel).
    // FlowLayout.CENTER inside a row stretched to the column's full width (fill=HORIZONTAL, above) centers the
    // button cluster horizontally without needing a separate alignment mechanism.
    JPanel transportRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 14, 0));
    transportRow.setOpaque(false);
    JButton miniPrevButton = roundButton(Glyph.PREVIOUS_TRACK, 26, false);
    miniPrevButton.setToolTipText("Previous track");
    miniPrevButton.addActionListener(e -> previousTrack());
    miniPlayButton = new TransportButton(player != null && player.isRunning() ? Glyph.PAUSE : Glyph.PLAY, 34, true);
    miniPlayButton.setToolTipText("Play/Pause");
    miniPlayButton.addActionListener(e -> toggle());
    JButton miniNextButton = roundButton(Glyph.NEXT_TRACK, 26, false);
    miniNextButton.setToolTipText("Next track");
    miniNextButton.addActionListener(e -> nextTrack());
    transportRow.add(miniPrevButton); transportRow.add(miniPlayButton); transportRow.add(miniNextButton);
    rightGc.gridy = rightRow++; rightGc.insets = new Insets(0, 0, 8, 0); right.add(transportRow, rightGc);

    miniProgress.setOpaque(false); miniProgress.setUI(new AccentSliderUI(miniProgress)); miniProgress.setFocusable(false);
    miniProgress.setPreferredSize(new Dimension(220, 14)); miniProgress.setMaximumSize(new Dimension(Integer.MAX_VALUE, 14));
    // Same drag-to-seek pattern as progress's own listener (see playerPanel()) — a separate widget/listener
    // rather than re-parenting progress itself, per buildMiniPanel()'s doc comment; keeps progress (the main
    // view's slider) and player state as the source of truth, mirrored back onto miniElapsed too so both stay
    // in sync however the seek was actually made.
    miniProgress.addChangeListener(e -> {
      if (player != null && miniProgress.getValueIsAdjusting()) adjusting = true;
      else if (player != null && adjusting) {
        long target = (long) (player.getMicrosecondLength() * miniProgress.getValue() / 1000.0);
        player.setMicrosecondPosition(target);
        adjusting = false;
        progress.setValue(miniProgress.getValue());
        elapsed.setText(format(target));
        miniElapsed.setText(elapsed.getText());
        if (lyricsOverlay != null && lyricsOverlay.isVisible()) updateLyricsSync();
      }
    });
    JPanel progressRow = new JPanel(new BorderLayout(8, 0)); progressRow.setOpaque(false);
    progressRow.add(miniElapsed, BorderLayout.WEST);
    progressRow.add(miniProgress, BorderLayout.CENTER);
    progressRow.add(miniLength, BorderLayout.EAST);
    rightGc.gridy = rightRow++; rightGc.insets = new Insets(0, 0, 0, 0); right.add(progressRow, rightGc);

    panel.add(right, BorderLayout.CENTER);
    return panel;
  }
  /**
   * Borderless-maximized fullscreen, not exclusive GraphicsDevice fullscreen. Windows' own DWM compositor already
   * does the "cover the whole display, hide the taskbar" job efficiently for a plain borderless window sized to
   * the screen — measured directly (see the [perf] logging added while chasing a "feels slow in fullscreen"
   * report): true exclusive fullscreen hands the whole display over to the app and bypasses DWM entirely, and
   * that costs far more per frame than the exact same content painted in a plain window. Individual
   * paintComponent costs stayed a few ms even at a 2560x1440 fullscreen size, yet a 150ms-budgeted animation was
   * still taking 250-300ms wall-clock, time that never showed up inside any paintComponent timing — consistent
   * with the swap/flip step itself, which exclusive mode owns directly instead of handing to DWM. So this always
   * takes the plain-window path. setAlwaysOnTop keeps the taskbar (itself kept topmost by the shell) from ending
   * up above this window despite bounds matching it exactly.
   * Swing requires a Frame to not be displayable to change setUndecorated(), so this disposes and recreates the
   * native peer — the Java component tree (and all its listeners) survives that untouched, only the OS window
   * itself is torn down and rebuilt.
   */
  private void toggleFullscreen() {
    if (!fullscreen && miniModeEnabled) setMiniModeEnabled(false); // mutually exclusive — see toggleCdView()'s note
    java.awt.GraphicsDevice device = getGraphicsConfiguration().getDevice();
    if (!fullscreen) {
      preFullscreenBounds = getBounds();
      dispose();
      setUndecorated(true);
      setAlwaysOnTop(true);
      setBounds(device.getDefaultConfiguration().getBounds());
      setVisible(true);
      fullscreen = true;
    } else {
      setAlwaysOnTop(false);
      dispose();
      setUndecorated(false);
      if (preFullscreenBounds != null) setBounds(preFullscreenBounds);
      setVisible(true);
      fullscreen = false;
    }
    getRootPane().requestFocusInWindow(); // keyboard shortcuts live on the root pane's WHEN_IN_FOCUSED_WINDOW map
    // themeOverlay (the glass pane) tracks the root pane's bounds automatically, but its particles' x/y positions
    // were seeded (see ThemeOverlay.seed()) against whatever size was current back when the theme was switched on
    // — usually the small windowed size, long before this. They do drift into any newly-exposed area on their own
    // eventually (advance() reseeds a particle's x/y using the CURRENT width/height every time it wraps around),
    // but that's a per-particle, one-at-a-time process spread over several fall cycles, so right after entering
    // fullscreen the snow/etc. visibly stayed confined to the old window's rectangle instead of covering the
    // screen. invokeLater, not immediate: setFullScreenWindow()'s bounds change isn't guaranteed to have already
    // propagated through to getWidth()/getHeight() by the time this line runs.
    SwingUtilities.invokeLater(() -> { getRootPane().revalidate(); themeOverlay.reseedForCurrentSize(); getRootPane().repaint(); });
  }

  private static void bindKey(javax.swing.InputMap inputMap, javax.swing.ActionMap actionMap, String key, String name, java.util.function.Consumer<ActionEvent> action) {
    inputMap.put(javax.swing.KeyStroke.getKeyStroke(key), name);
    actionMap.put(name, new javax.swing.AbstractAction() {
      public void actionPerformed(ActionEvent e) {
        // WHEN_IN_FOCUSED_WINDOW bindings fire no matter which component has focus, and a plain JTextField
        // doesn't shadow/consume simple letter keys — typing inserts characters through a separate mechanism
        // from the keystroke-to-action bindings used here, so without this guard, typing "j"/"k"/"l" or a space
        // while naming an EQ preset would also skip tracks, toggle play/pause, etc.
        Component focused = java.awt.KeyboardFocusManager.getCurrentKeyboardFocusManager().getFocusOwner();
        if (focused instanceof javax.swing.text.JTextComponent) return;
        action.accept(e);
      }
    });
  }

  /** Shows a one-time welcome dialog on the very first launch, gated by a marker file — never shown again once dismissed, on this machine. */
  private void showOnboardingIfNeeded() {
    if (ONBOARDING_FLAG_FILE.isFile()) return;
    javax.swing.JDialog dialog = new javax.swing.JDialog(this, true);
    dialog.setUndecorated(true);
    dialog.setContentPane(buildOnboardingCard(dialog));
    dialog.getRootPane().setBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 40), 1));
    dialog.pack();
    dialog.setLocationRelativeTo(this);
    javax.swing.JRootPane root = dialog.getRootPane();
    root.getInputMap(javax.swing.JComponent.WHEN_IN_FOCUSED_WINDOW).put(javax.swing.KeyStroke.getKeyStroke("ESCAPE"), "closeOnboarding");
    root.getActionMap().put("closeOnboarding", new javax.swing.AbstractAction() { public void actionPerformed(ActionEvent e) { dialog.dispose(); } });
    dialog.addWindowListener(new java.awt.event.WindowAdapter() { public void windowClosed(java.awt.event.WindowEvent e) { markOnboarded(); } });
    dialog.setVisible(true); // blocks (modal) until the dialog is dismissed via the button or Escape
  }
  private static void markOnboarded() {
    try {
      File parent = ONBOARDING_FLAG_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      ONBOARDING_FLAG_FILE.createNewFile();
    } catch (Exception ignored) { /* best-effort; worst case the welcome dialog just shows again next launch */ }
  }
  private JPanel buildOnboardingCard(javax.swing.JDialog dialog) {
    JPanel card = new JPanel();
    card.setLayout(new javax.swing.BoxLayout(card, javax.swing.BoxLayout.Y_AXIS));
    card.setBackground(CARD);
    card.setOpaque(true);
    card.setBorder(BorderFactory.createEmptyBorder(30, 34, 26, 34));

    JLabel title = label("WELCOME TO CDPLAYER", 18, ACCENT);
    title.setAlignmentX(Component.LEFT_ALIGNMENT);
    card.add(title);
    card.add(javax.swing.Box.createVerticalStrut(6));
    JLabel subtitle = label("A few things worth knowing before you dive in", 11, MUTED);
    subtitle.setAlignmentX(Component.LEFT_ALIGNMENT);
    card.add(subtitle);
    card.add(javax.swing.Box.createVerticalStrut(20));

    String[] tips = {
      "Drag & drop audio files or a whole folder onto the window to build your queue",
      "SPACE / K play or pause &middot; J / L previous / next &middot; &larr; / &rarr; skip 15 seconds &middot; F fullscreen",
      "Click THEME to explore nine animated themes, each with its own audio visualizer",
      "FFmpeg is required for MP3, FLAC, and M4A playback, and for reading cover art / tags",
      "Your queue is saved automatically and restored the next time you open the app",
    };
    for (String tip : tips) {
      JPanel row = new JPanel(new BorderLayout(10, 0));
      row.setOpaque(false);
      row.setAlignmentX(Component.LEFT_ALIGNMENT);
      row.setMaximumSize(new Dimension(Integer.MAX_VALUE, Integer.MAX_VALUE));
      JLabel dot = new JLabel("●"); dot.setForeground(ACCENT2); dot.setFont(new Font("SansSerif", Font.PLAIN, 9)); dot.setVerticalAlignment(SwingConstants.TOP); dot.setBorder(BorderFactory.createEmptyBorder(4, 0, 0, 0));
      JLabel text = new JLabel("<html><body style='width:340px'>" + tip + "</body></html>");
      text.setForeground(TEXT); text.setFont(new Font("SansSerif", Font.PLAIN, 12));
      row.add(dot, BorderLayout.WEST); row.add(text, BorderLayout.CENTER);
      card.add(row);
      card.add(javax.swing.Box.createVerticalStrut(10));
    }
    card.add(javax.swing.Box.createVerticalStrut(8));

    JButton gotIt = textButton("GOT IT");
    gotIt.addActionListener(e -> dialog.dispose());
    JPanel buttonRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0));
    buttonRow.setOpaque(false);
    buttonRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    buttonRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 40));
    buttonRow.add(gotIt);
    card.add(buttonRow);
    return card;
  }

  /** One release's worth of changelog bullets, keyed by version so showChangelogIfNeeded() can look up exactly the entry matching APP_VERSION regardless of array order. */
  private static final class ChangelogEntry {
    final String version; final String[] changes;
    ChangelogEntry(String version, String... changes) { this.version = version; this.changes = changes; }
  }
  // Newest first. Add one entry here whenever APP_VERSION bumps — showChangelogDialog() only ever displays the
  // entry matching the CURRENT version, not the whole history, so older entries are kept only as a record (and
  // in case a future "full changelog" view wants them), not because they're ever shown together.
  private static final ChangelogEntry[] CHANGELOG = {
    new ChangelogEntry("1.11.0",
      "<b>Mini Mode</b>: press M (or flip the switch in Settings) to shrink the window down to a small always-on-top widget — the disc, track title/artist, a seek bar, and play/pause/skip controls — so you can keep the music going while you work in other apps",
      "Cover art now fills the entire disc face in every view, not just a small circle in the middle",
      "Fixed severe lag when an animated theme (Snow, Ocean, Autumn, Galaxy, Matrix) was active in fullscreen",
      "Fixed switching themes momentarily stalling the whole window, especially with Settings open at the time",
      "Fixed long track titles and artist names getting cut off or overlapping each other in Mini Mode"
    ),
    new ChangelogEntry("1.10.0",
      "Tracks with no embedded lyrics now try an <b>online lookup</b> (lrclib.net) automatically, including synced karaoke-style lyrics when available",
      "<b>Spotify</b>: added as a third cover art source when iTunes/Deezer come up empty, and paste a Spotify track or playlist link into Search to queue any matching songs you already have locally (playlist links need a one-time Spotify sign-in)",
      "Fixed blurry, low-resolution disc and thumbnail artwork on Retina displays",
      "Fixed mouse clicks reaching background controls (Play, skip, etc.) through an open Settings/Lyrics/History/Search/EQ panel",
      "Fixed the left/right arrow seek shortcuts breaking after closing a panel"
    ),
    new ChangelogEntry("1.9.1",
      "Fixed keyboard shortcuts (Space, J/L, the arrows, F, C) still controlling playback, skipping tracks, or toggling fullscreen/CD view while Settings or another panel was open on top",
      "Fixed this What's New dialog not appearing on some upgrades"
    ),
    new ChangelogEntry("1.9.0",
      "<b>CD view</b> (press C, or the header button) hides everything but an enlarged, spinning disc for a distraction-free look, with a crossfade transition and the track's title and author centered underneath",
      "The artist's name now shows under the track title in the main view too, not just in the queue",
      "AUTO theme colors (and the disc's own gradient) are noticeably more accurate now for covers where the real color is a small detail on an otherwise gray or white image, like a logo on a black-and-white photo",
      "Fixed the queue not advancing to the next track when Repeat All was on and playback reached the end",
      "Various memory and layout fixes under the hood"
    ),
    new ChangelogEntry("1.8.0",
      "A <b>History</b> button and a recursive library <b>Search</b>, both new in the header",
      "The seek bar can now show the track's real waveform shape instead of a plain line (toggle in Settings)",
      "Playlist controls (Save / Load / Search) moved next to Load a Track for a cleaner layout",
      "Settings and other panels are now properly modal — clicks no longer leak through to the player behind them"
    ),
  };
  /**
   * Shows a "what's new" dialog the first time this version is launched, by comparing APP_VERSION against
   * whatever version was last recorded in LAST_VERSION_FILE. Says nothing on a genuinely fresh install — the
   * welcome dialog already covers that moment, and there's nothing to call "new" yet. But a returning user
   * updating from a build that predates this feature entirely (LAST_VERSION_FILE was never written by any
   * version they've run, since it didn't exist yet) still needs to see it — that's what existingInstall is for:
   * without it, that very first upgrade past this feature's introduction would be silently swallowed exactly
   * like a fresh install, which is the bug a Windows user actually hit (installed the new build over an old one,
   * no changelog appeared, because their machine had never had LAST_VERSION_FILE at all). The version is only
   * recorded once the dialog is actually dismissed (mirroring markOnboarded()'s timing), so a crash before that
   * leaves it showing again next launch instead of silently marking a changelog the user never actually saw.
   */
  private void showChangelogIfNeeded(boolean existingInstall) {
    String lastVersion = readLastVersion();
    if (APP_VERSION.equals(lastVersion)) return;
    if (lastVersion == null && !existingInstall) { writeLastVersion(APP_VERSION); return; } // truly fresh install — nothing to show as "new"
    ChangelogEntry entry = null;
    for (ChangelogEntry candidate : CHANGELOG) if (candidate.version.equals(APP_VERSION)) { entry = candidate; break; }
    if (entry == null) { writeLastVersion(APP_VERSION); return; } // no entry written for this version yet — don't show an empty dialog, just stop asking
    showChangelogDialog(entry);
  }
  private static String readLastVersion() {
    try {
      if (!LAST_VERSION_FILE.isFile()) return null;
      String content = new String(java.nio.file.Files.readAllBytes(LAST_VERSION_FILE.toPath()), StandardCharsets.UTF_8).trim();
      return content.isEmpty() ? null : content;
    } catch (Exception ignored) { return null; }
  }
  private static void writeLastVersion(String version) {
    try {
      File parent = LAST_VERSION_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      java.nio.file.Files.write(LAST_VERSION_FILE.toPath(), version.getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) { /* best-effort; worst case the changelog just shows again next launch */ }
  }
  private void showChangelogDialog(ChangelogEntry entry) {
    javax.swing.JDialog dialog = new javax.swing.JDialog(this, true);
    dialog.setUndecorated(true);
    dialog.setContentPane(buildChangelogCard(dialog, entry));
    dialog.getRootPane().setBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 40), 1));
    dialog.pack();
    dialog.setLocationRelativeTo(this);
    javax.swing.JRootPane root = dialog.getRootPane();
    root.getInputMap(javax.swing.JComponent.WHEN_IN_FOCUSED_WINDOW).put(javax.swing.KeyStroke.getKeyStroke("ESCAPE"), "closeChangelog");
    root.getActionMap().put("closeChangelog", new javax.swing.AbstractAction() { public void actionPerformed(ActionEvent e) { dialog.dispose(); } });
    dialog.addWindowListener(new java.awt.event.WindowAdapter() { public void windowClosed(java.awt.event.WindowEvent e) { writeLastVersion(APP_VERSION); } });
    dialog.setVisible(true); // blocks (modal) until the dialog is dismissed via the button or Escape
  }
  private JPanel buildChangelogCard(javax.swing.JDialog dialog, ChangelogEntry entry) {
    JPanel card = new JPanel();
    card.setLayout(new javax.swing.BoxLayout(card, javax.swing.BoxLayout.Y_AXIS));
    card.setBackground(CARD);
    card.setOpaque(true);
    card.setBorder(BorderFactory.createEmptyBorder(30, 34, 26, 34));

    JLabel title = label("WHAT'S NEW", 18, ACCENT);
    title.setAlignmentX(Component.LEFT_ALIGNMENT);
    card.add(title);
    card.add(javax.swing.Box.createVerticalStrut(6));
    JLabel subtitle = label("CDPlayer " + entry.version, 11, MUTED);
    subtitle.setAlignmentX(Component.LEFT_ALIGNMENT);
    card.add(subtitle);
    card.add(javax.swing.Box.createVerticalStrut(20));

    for (String change : entry.changes) {
      JPanel row = new JPanel(new BorderLayout(10, 0));
      row.setOpaque(false);
      row.setAlignmentX(Component.LEFT_ALIGNMENT);
      row.setMaximumSize(new Dimension(Integer.MAX_VALUE, Integer.MAX_VALUE));
      JLabel dot = new JLabel("●"); dot.setForeground(ACCENT2); dot.setFont(new Font("SansSerif", Font.PLAIN, 9)); dot.setVerticalAlignment(SwingConstants.TOP); dot.setBorder(BorderFactory.createEmptyBorder(4, 0, 0, 0));
      JLabel text = new JLabel("<html><body style='width:340px'>" + change + "</body></html>");
      text.setForeground(TEXT); text.setFont(new Font("SansSerif", Font.PLAIN, 12));
      row.add(dot, BorderLayout.WEST); row.add(text, BorderLayout.CENTER);
      card.add(row);
      card.add(javax.swing.Box.createVerticalStrut(10));
    }
    card.add(javax.swing.Box.createVerticalStrut(8));

    JButton gotIt = textButton("GOT IT");
    gotIt.addActionListener(e -> dialog.dispose());
    JPanel buttonRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0));
    buttonRow.setOpaque(false);
    buttonRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    buttonRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 40));
    buttonRow.add(gotIt);
    card.add(buttonRow);
    return card;
  }

  /**
   * Opens (or refocuses) Settings. This is a plain in-window overlay panel (added to contentStack, the topmost
   * layer), not a separate JDialog/Window — a separate top-level window doesn't reliably layer correctly above
   * either the OS's own native fullscreen (opens on a different Space entirely) or this app's own exclusive
   * GraphicsDevice fullscreen (didn't show up at all — exclusive fullscreen generally can't host a second
   * top-level window above it). Being a component within the same window sidesteps both failure modes: it's
   * always positioned and painted correctly relative to whatever the main window's current bounds actually are.
   * Rebuilds its content each time rather than caching the panel, so labels/colors stay current across theme changes.
   */
  /**
   * A single contentStack.validate() pass right after (re)populating one of the CenteredOverlay-based panels
   * (Settings/Lyrics/History/Search/EQ) can leave that overlay's own bounds at zero size (confirmed directly by
   * inspecting getBounds() right after the call: Rectangle[x=0,y=0,width=0,height=0] on an 1120x820 window).
   * OverlayLayout stretches the overlay to fill contentStack based on the overlay's own preferred/minimum size,
   * which is itself derived from its just-populated card's not-yet-laid-out content — a chicken-and-egg gap that
   * only resolves once that inner content's real size is actually known, which just calling contentStack's own
   * validate() again does NOT resolve (confirmed directly — two back-to-back contentStack.validate() calls both
   * still leave it at 0x0; a Swing container's validate() is a no-op once it considers itself already valid,
   * regardless of whether the size it settled on was actually right). Swing's own automatic revalidation (queued
   * via invokeLater whenever a component reports itself invalid) eventually catches up before the next repaint,
   * which is why the dialog still visibly renders at the correct size and dimming — but in the narrow window
   * before that happens, the overlay's real clickable bounds are still 0x0, so any click lands on whatever's
   * really underneath at that pixel instead: reported directly as the transport controls (Play, skip, etc.)
   * staying clickable behind a just-opened Settings dialog. Forcing an unconditional (isValid()-ignoring)
   * doLayout() pass over just the overlay's OWN subtree first was tried and does NOT work (confirmed directly:
   * still 0x0, or shrinks the overlay to the card's tiny natural size instead) — the overlay's OWN stretched size
   * comes from OverlayLayout on contentStack, which needs contentStack's whole child list settled, not just the
   * one overlay in isolation. Forcing the pass over the whole contentStack subtree does converge correctly.
   * (overlay parameter unused directly but kept so call sites stay self-documenting about which overlay this
   * pass is settling.)
   */
  private void settleOverlayBounds(CenteredOverlay overlay) {
    // Give the overlay its correct outer bounds directly, sidestepping OverlayLayout's own preferred/min-size
    // computation for it entirely (that computation is exactly what was producing 0x0 — see the class doc above).
    // getMaximumSize() already documents the intent as "always fill contentStack fully", so there's no need to
    // ask OverlayLayout to derive that; just set it.
    overlay.setBounds(0, 0, contentStack.getWidth(), contentStack.getHeight());
    // Lay out the overlay's OWN subtree (GridBagLayout centering the card) using those now-correct bounds —
    // confined to the overlay itself, not contentStack, so root/the background UI is never touched by this at
    // all. An earlier version called contentStack.validate() (with or without an extra forced doLayout() pass
    // first) instead: that does settle the overlay's own bounds correctly, but doLayout() forced unconditionally
    // over the WHOLE contentStack subtree also re-lays-out root's background UI using whatever intermediate
    // sizes existed mid-pass, silently shifting real background controls out of their painted positions — a real
    // click at a background control's visually-correct on-screen spot could land on empty space (or something
    // else) instead, confirmed directly with a genuine OS-level click via Robot (not just Swing's own hit-test
    // query, which didn't reveal the shift). Scoping the fix to just the overlay avoids that risk entirely.
    overlay.validate();
  }
  private void showSettingsDialog() {
    if (settingsOverlay == null) {
      settingsOverlay = new CenteredOverlay();
      settingsOverlay.setVisible(false);
      contentStack.add(settingsOverlay, 0); // index 0 = topmost in the OverlayLayout stack, above the disc/theme particles/background
      themeOverlay.setSettingsCardReference(settingsOverlay.card); // themeOverlay is the glass pane (always topmost) — without this, particles would drift over the open Settings card too
    }
    settingsOverlay.card.removeAll();
    settingsOverlay.card.add(buildSettingsPanel(), BorderLayout.CENTER);
    // validate() (immediate, synchronous), not revalidate() (deferred to the next natural repaint cycle) — and
    // done here, after the card's content is populated, not right after contentStack.add() above: the card's own
    // size comes from its content, so validating before that content exists would (and did) lock its bounds at
    // zero permanently, since this whole block only runs once per settingsOverlay lifetime. See
    // settleOverlayBounds()'s doc comment for why a plain validate() alone isn't enough.
    settleOverlayBounds(settingsOverlay);
    settingsOverlay.setVisible(true);
    animateSettingsIn();
  }
  // Interactive controls inside an overlay (the Crossfade/Sleep Timer sliders, in particular — JSlider is
  // focusable by default and binds its own LEFT/RIGHT arrow keys to nudge its value) can end up holding keyboard
  // focus when that overlay closes; Swing doesn't automatically hand focus back to anything just because the
  // component holding it became invisible. Left alone, that stranded-but-still-focused slider intercepts
  // LEFT/RIGHT via its own WHEN_FOCUSED binding before the seek shortcut's WHEN_IN_FOCUSED_WINDOW one ever sees
  // it — reported directly as "now the arrow keys don't work" after closing Settings. Explicitly returning focus
  // to the root pane on every overlay close (same fix already used after toggleFullscreen()'s peer recreation)
  // guarantees WHEN_IN_FOCUSED_WINDOW bindings are what handles the next keystroke, regardless of which control
  // was last interacted with inside the overlay.
  private void closeSettingsDialog() { hideThemeMenu(); if (settingsOverlay != null) animateSettingsOut(); getRootPane().requestFocusInWindow(); }
  private Timer settingsAnimTimer;
  /** Grows the settings card from 90% to 100% size (eased) with a fade-in, instead of it just popping into existence. Implemented as a component-level scale/alpha transform in FadeableCard.paint() rather than Window.setOpacity(), since this is no longer a separate Window. */
  private void animateSettingsIn() {
    if (settingsAnimTimer != null && settingsAnimTimer.isRunning()) settingsAnimTimer.stop();
    FadeableCard card = settingsOverlay.card;
    if (!animationsEnabled) { card.opacity = 1f; card.scale = 1f; card.repaint(); return; }
    card.beginTransformAnimation();
    card.opacity = 0f; card.scale = 0.9f;
    final int steps = 6;
    final int[] step = { 0 };
    settingsAnimTimer = new Timer(8, null);
    settingsAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      float eased = 1f - (float) Math.pow(1f - t, 3); // ease-out cubic
      card.opacity = eased;
      card.scale = 0.9f + 0.1f * eased;
      // card.repaint(), not settingsOverlay.repaint() — the overlay now spans the whole window (see CenteredOverlay,
      // for the dimmed backdrop that blocks clicks to what's underneath), so repainting the WHOLE overlay on every
      // 12ms tick meant recompositing the entire window ~80 times/second for an animation that only ever changes
      // the card's own opacity/scale. Scoped to the card, this is back to a small, cheap dirty region.
      card.repaint();
      if (t >= 1f) { ((Timer) e.getSource()).stop(); card.opacity = 1f; card.scale = 1f; card.endTransformAnimation(); }
    });
    settingsAnimTimer.start();
  }
  /** Reverse of {@link #animateSettingsIn}: shrinks and fades the card out, then actually hides the overlay. */
  private void animateSettingsOut() {
    if (!settingsOverlay.isVisible()) return;
    if (settingsAnimTimer != null && settingsAnimTimer.isRunning()) settingsAnimTimer.stop();
    FadeableCard card = settingsOverlay.card;
    if (!animationsEnabled) { settingsOverlay.setVisible(false); card.opacity = 1f; card.scale = 1f; return; }
    card.beginTransformAnimation();
    final int steps = 5;
    final int[] step = { 0 };
    settingsAnimTimer = new Timer(8, null);
    settingsAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      card.opacity = 1f - t;
      card.scale = 1f - 0.1f * t;
      card.repaint(); // see animateSettingsIn()'s note on why this is card.repaint(), not settingsOverlay.repaint()
      if (t >= 1f) {
        ((Timer) e.getSource()).stop();
        settingsOverlay.setVisible(false);
        card.opacity = 1f; card.scale = 1f; // reset so the next animateSettingsIn starts from a clean state
        card.endTransformAnimation();
      }
    });
    settingsAnimTimer.start();
  }
  private JPanel buildSettingsPanel() {
    JPanel card = new JPanel();
    card.setLayout(new javax.swing.BoxLayout(card, javax.swing.BoxLayout.Y_AXIS));
    card.setBackground(CARD);
    card.setOpaque(true);
    // The outer line border used to be set separately on the JDialog's own root pane; now that this card is a
    // plain in-window component, both borders live on the card itself via a compound border.
    card.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 40), 1), BorderFactory.createEmptyBorder(26, 30, 22, 30)));

    JLabel title = label("SETTINGS", 16, ACCENT);
    title.setAlignmentX(Component.LEFT_ALIGNMENT);
    card.add(title);
    card.add(javax.swing.Box.createVerticalStrut(20));

    // Theme picker — relocated here from the header; showThemeMenu() just opens the same popup as before,
    // now anchored to themeButton wherever it currently lives.
    JPanel themeRow = new JPanel(new BorderLayout()); themeRow.setOpaque(false); themeRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    themeRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));
    JLabel themeLabel = label("THEME", 10, MUTED);
    themeRow.add(themeLabel, BorderLayout.WEST);
    JPanel themeButtonWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); themeButtonWrap.setOpaque(false); themeButtonWrap.add(themeButton);
    themeRow.add(themeButtonWrap, BorderLayout.EAST);
    card.add(themeRow);
    card.add(javax.swing.Box.createVerticalStrut(22));

    // Equalizer — opens its own overlay on top of Settings, same as the theme picker above; both stay open together.
    JPanel eqRow = new JPanel(new BorderLayout()); eqRow.setOpaque(false); eqRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    eqRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));
    JLabel eqLabel = label("EQUALIZER", 10, MUTED);
    eqRow.add(eqLabel, BorderLayout.WEST);
    JPanel eqButtonWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); eqButtonWrap.setOpaque(false); eqButtonWrap.add(eqButton);
    eqRow.add(eqButtonWrap, BorderLayout.EAST);
    card.add(eqRow);
    card.add(javax.swing.Box.createVerticalStrut(22));

    // Crossfade slider — relocated here from the main screen, same fields/behavior as before.
    JPanel crossfadeRow = new JPanel(); crossfadeRow.setOpaque(false); crossfadeRow.setAlignmentX(Component.LEFT_ALIGNMENT); crossfadeRow.setLayout(new javax.swing.BoxLayout(crossfadeRow, javax.swing.BoxLayout.X_AXIS));
    crossfadeTitle.setFont(new Font("SansSerif", Font.BOLD, 10)); crossfadeTitle.setForeground(MUTED);
    crossfadeSlider.setOpaque(false); crossfadeSlider.setUI(new AccentSliderUI(crossfadeSlider)); crossfadeSlider.setFocusable(false);
    crossfadeSlider.setPreferredSize(new Dimension(150, 20)); crossfadeSlider.setMaximumSize(new Dimension(150, 20));
    crossfadeValueLabel.setFont(new Font("SansSerif", Font.BOLD, 10)); crossfadeValueLabel.setForeground(MUTED); crossfadeValueLabel.setPreferredSize(new Dimension(28, 16));
    for (javax.swing.event.ChangeListener l : crossfadeSlider.getChangeListeners()) crossfadeSlider.removeChangeListener(l); // rebuilt each open; avoid stacking duplicate listeners
    crossfadeSlider.addChangeListener(e -> { int v = crossfadeSlider.getValue(); crossfadeValueLabel.setText(v == 0 ? "OFF" : v + "S"); });
    crossfadeValueLabel.setText(crossfadeSlider.getValue() == 0 ? "OFF" : crossfadeSlider.getValue() + "S"); // sync immediately: the slider's value may already differ from "OFF" (e.g. restored from a previous session) before any change event fires
    crossfadeSlider.setToolTipText("Crossfade between tracks (0 = off, up to 15s)");
    crossfadeRow.add(crossfadeTitle); crossfadeRow.add(javax.swing.Box.createHorizontalStrut(10)); crossfadeRow.add(crossfadeSlider); crossfadeRow.add(javax.swing.Box.createHorizontalStrut(8)); crossfadeRow.add(crossfadeValueLabel); crossfadeRow.add(javax.swing.Box.createHorizontalGlue());
    card.add(crossfadeRow);
    card.add(javax.swing.Box.createVerticalStrut(22));

    // Sleep timer — arms a one-shot countdown from now (not a persistent preference like crossfade), so moving
    // the slider only actually (re)arms it once the drag settles, not on every intermediate tick while dragging.
    // The slider's own position is otherwise independent of the live countdown (see sleepTimerIndicator in the
    // header), so reopening Settings mid-countdown just shows whatever duration was last armed, unchanged.
    JPanel sleepRow = new JPanel(); sleepRow.setOpaque(false); sleepRow.setAlignmentX(Component.LEFT_ALIGNMENT); sleepRow.setLayout(new javax.swing.BoxLayout(sleepRow, javax.swing.BoxLayout.X_AXIS));
    sleepTimerTitle.setFont(new Font("SansSerif", Font.BOLD, 10)); sleepTimerTitle.setForeground(MUTED);
    sleepTimerSlider.setOpaque(false); sleepTimerSlider.setUI(new AccentSliderUI(sleepTimerSlider)); sleepTimerSlider.setFocusable(false);
    sleepTimerSlider.setPreferredSize(new Dimension(150, 20)); sleepTimerSlider.setMaximumSize(new Dimension(150, 20));
    sleepTimerValueLabel.setFont(new Font("SansSerif", Font.BOLD, 10)); sleepTimerValueLabel.setForeground(MUTED); sleepTimerValueLabel.setPreferredSize(new Dimension(34, 16));
    for (javax.swing.event.ChangeListener l : sleepTimerSlider.getChangeListeners()) sleepTimerSlider.removeChangeListener(l); // rebuilt each open; avoid stacking duplicate listeners
    sleepTimerSlider.addChangeListener(e -> {
      int v = sleepTimerSlider.getValue();
      sleepTimerValueLabel.setText(v == 0 ? "OFF" : v + "M");
      if (!sleepTimerSlider.getValueIsAdjusting()) armSleepTimer(v);
    });
    sleepTimerValueLabel.setText(sleepTimerSlider.getValue() == 0 ? "OFF" : sleepTimerSlider.getValue() + "M");
    sleepTimerSlider.setToolTipText("Pause playback after a set time (0 = off, up to 120 minutes)");
    sleepRow.add(sleepTimerTitle); sleepRow.add(javax.swing.Box.createHorizontalStrut(10)); sleepRow.add(sleepTimerSlider); sleepRow.add(javax.swing.Box.createHorizontalStrut(8)); sleepRow.add(sleepTimerValueLabel); sleepRow.add(javax.swing.Box.createHorizontalGlue());
    card.add(sleepRow);
    card.add(javax.swing.Box.createVerticalStrut(22));

    // Mono audio toggle — downmixes left/right to identical channels in software on the playback pump thread.
    JPanel monoRow = new JPanel(new BorderLayout()); monoRow.setOpaque(false); monoRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    monoRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));
    JLabel monoLabel = label("MONO AUDIO", 10, MUTED);
    for (java.awt.event.ActionListener l : monoButton.getActionListeners()) monoButton.removeActionListener(l); // rebuilt each open; avoid stacking duplicate listeners
    monoButton.addActionListener(e -> setMonoAudio(!monoAudio));
    monoRow.add(monoLabel, BorderLayout.WEST);
    JPanel monoButtonWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); monoButtonWrap.setOpaque(false); monoButtonWrap.add(monoButton);
    monoRow.add(monoButtonWrap, BorderLayout.EAST);
    card.add(monoRow);
    card.add(javax.swing.Box.createVerticalStrut(10));
    JLabel monoHint = new JLabel("<html><body style='width:280px'>Sums the left and right channels together — useful if you're listening through a single speaker or one earbud.</body></html>");
    monoHint.setForeground(MUTED); monoHint.setFont(new Font("SansSerif", Font.PLAIN, 10));
    monoHint.setAlignmentX(Component.LEFT_ALIGNMENT);
    card.add(monoHint);
    card.add(javax.swing.Box.createVerticalStrut(22));

    // Waveform toggle — the progress bar shows the current track's real amplitude shape instead of a plain line.
    JPanel waveformRow = new JPanel(new BorderLayout()); waveformRow.setOpaque(false); waveformRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    waveformRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));
    JLabel waveformLabel = label("WAVEFORM", 10, MUTED);
    for (java.awt.event.ActionListener l : waveformButton.getActionListeners()) waveformButton.removeActionListener(l); // rebuilt each open; avoid stacking duplicate listeners
    waveformButton.addActionListener(e -> setWaveformEnabled(!waveformEnabled));
    waveformRow.add(waveformLabel, BorderLayout.WEST);
    JPanel waveformButtonWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); waveformButtonWrap.setOpaque(false); waveformButtonWrap.add(waveformButton);
    waveformRow.add(waveformButtonWrap, BorderLayout.EAST);
    card.add(waveformRow);
    card.add(javax.swing.Box.createVerticalStrut(22));

    // Animations toggle — hover fades, pulses, on/off crossfades, dialog open/close, the now-playing fade-in, and
    // the theme color transition all check this and jump straight to their end state when off.
    JPanel animationsRow = new JPanel(new BorderLayout()); animationsRow.setOpaque(false); animationsRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    animationsRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));
    JLabel animationsLabel = label("ANIMATIONS", 10, MUTED);
    for (java.awt.event.ActionListener l : animationsButton.getActionListeners()) animationsButton.removeActionListener(l); // rebuilt each open; avoid stacking duplicate listeners
    animationsButton.addActionListener(e -> setAnimationsEnabled(!animationsEnabled));
    animationsRow.add(animationsLabel, BorderLayout.WEST);
    JPanel animationsButtonWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); animationsButtonWrap.setOpaque(false); animationsButtonWrap.add(animationsButton);
    animationsRow.add(animationsButtonWrap, BorderLayout.EAST);
    card.add(animationsRow);
    card.add(javax.swing.Box.createVerticalStrut(22));

    // Mini Mode toggle — shrinks the whole window to a small always-on-top widget (disc, title/artist, seek bar
    // only). Also reachable with M, or the × button inside the mini window itself (see buildMiniPanel).
    JPanel miniModeRow = new JPanel(new BorderLayout()); miniModeRow.setOpaque(false); miniModeRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    miniModeRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));
    JLabel miniModeLabel = label("MINI MODE", 10, MUTED);
    for (java.awt.event.ActionListener l : miniModeButton.getActionListeners()) miniModeButton.removeActionListener(l); // rebuilt each open; avoid stacking duplicate listeners
    miniModeButton.addActionListener(e -> setMiniModeEnabled(!miniModeEnabled));
    miniModeRow.add(miniModeLabel, BorderLayout.WEST);
    JPanel miniModeButtonWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); miniModeButtonWrap.setOpaque(false); miniModeButtonWrap.add(miniModeButton);
    miniModeRow.add(miniModeButtonWrap, BorderLayout.EAST);
    card.add(miniModeRow);
    card.add(javax.swing.Box.createVerticalStrut(10));
    JLabel miniModeHint = new JLabel("<html><body style='width:280px'>Shrinks the window to a small always-on-top widget — just the disc, track info, and a seek bar. Press M or click the disc to play/pause while in it.</body></html>");
    miniModeHint.setForeground(MUTED); miniModeHint.setFont(new Font("SansSerif", Font.PLAIN, 10));
    miniModeHint.setAlignmentX(Component.LEFT_ALIGNMENT);
    card.add(miniModeHint);
    card.add(javax.swing.Box.createVerticalStrut(22));

    JButton close = textButton("CLOSE");
    close.addActionListener(e -> closeSettingsDialog());
    JPanel buttonRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0));
    buttonRow.setOpaque(false); buttonRow.setAlignmentX(Component.LEFT_ALIGNMENT); buttonRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 40));
    buttonRow.add(close);
    card.add(buttonRow);
    card.add(javax.swing.Box.createVerticalStrut(18));
    JPanel githubRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 0, 0));
    githubRow.setOpaque(false); githubRow.setAlignmentX(Component.LEFT_ALIGNMENT); githubRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 24));
    githubRow.add(new GitHubLinkButton("Kizarov3"));
    card.add(githubRow);
    return card;
  }
  /** Applies the mono toggle to the live player (takes effect within ~20ms, on the pump thread's next chunk) and persists the choice for the next track load. */
  private void setMonoAudio(boolean value) {
    monoAudio = value;
    monoButton.setText(value ? "ON" : "OFF"); // the row's own "MONO AUDIO" label already gives context, so the button itself is just a plain on/off toggle
    if (player != null) player.setMono(value);
  }
  /** Purely a display toggle — the waveform keeps computing/caching in the background either way, this just controls whether the progress bar shows it (falling back to the plain line when off). */
  private void setWaveformEnabled(boolean value) {
    waveformEnabled = value;
    waveformButton.setText(value ? "ON" : "OFF");
    waveformSliderUI.setEnabled(value);
  }
  /** Applies new band gains to the live player (if any) and remembers them for the next track load / app restart. Takes effect within about one 20ms chunk, same as gain/mono. */
  private void setEqGains(double[] gains) {
    eqGains = gains;
    if (player != null) player.setEqGains(gains);
  }
  /** Flips the global animations flag before updating the button's own text, so turning animations on still gets an animated flourish on the button itself, and turning them off snaps the button (and everything else) instantly. */
  private void setAnimationsEnabled(boolean value) {
    animationsEnabled = value;
    animationsButton.setText(value ? "ON" : "OFF");
  }
  /** (Re)arms the sleep timer for `minutes` from now, or disarms it entirely at 0 — always restarts fresh from the full duration rather than adjusting an existing countdown, matching a real sleep timer's "set it and forget it" behavior. */
  private void armSleepTimer(int minutes) {
    if (sleepTimer.isRunning()) sleepTimer.stop();
    sleepSecondsRemaining = Math.max(0, minutes) * 60;
    if (sleepSecondsRemaining > 0) sleepTimer.start();
    updateSleepTimerIndicator();
  }
  private void updateSleepTimerIndicator() {
    if (sleepSecondsRemaining <= 0) { sleepTimerIndicator.setText(""); return; }
    int m = sleepSecondsRemaining / 60, s = sleepSecondsRemaining % 60;
    sleepTimerIndicator.setText("SLEEP " + m + ":" + (s < 10 ? "0" : "") + s);
  }

  /**
   * Opens the theme picker as a plain in-window overlay, anchored beneath themeButton — not a JPopupMenu. A
   * JPopupMenu still creates a real heavyweight Window even with setDefaultLightWeightPopupEnabled(true) (Swing's
   * PopupFactory decides that for itself), and a real top-level window doesn't reliably render above this app's
   * own exclusive-fullscreen GraphicsDevice, or above native OS fullscreen — the same failure mode Settings hit
   * before it moved off JDialog. Confirmed via Window.getWindows(): the popup's Popup$HeavyWeightWindow reported
   * itself fully visible/showing, matching Swing's own bookkeeping, while never actually appearing on screen.
   */
  private void showThemeMenu() {
    if (themeMenuOverlay == null) {
      themeMenuOverlay = new ThemeMenuOverlay();
      themeMenuOverlay.addMouseListener(new java.awt.event.MouseAdapter() {
        public void mousePressed(java.awt.event.MouseEvent e) { hideThemeMenu(); }
      });
      contentStack.add(themeMenuOverlay, 0); // index 0 = topmost, above settingsOverlay too (opened from a button inside it)
      themeOverlay.setThemeMenuReference(themeMenuOverlay.menu);
      contentStack.validate();
    }
    JPanel menu = themeMenuOverlay.menu;
    menu.removeAll();
    menu.setBackground(CARD);
    menu.setBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 30)));
    for (int i = 0; i < THEMES.length; i++) {
      Theme theme = THEMES[i]; int index = i;
      javax.swing.JMenuItem item = new javax.swing.JMenuItem(theme.name, new SwatchIcon(theme.accent, theme.accent2));
      item.setFont(new Font("SansSerif", Font.BOLD, 11));
      item.setForeground(index == currentThemeIndex ? ACCENT : TEXT);
      item.setBackground(CARD); item.setOpaque(true);
      item.setIconTextGap(10); item.setBorder(BorderFactory.createEmptyBorder(8, 12, 8, 16));
      item.addActionListener(e -> { switchToTheme(index); hideThemeMenu(); });
      menu.add(item);
    }
    // Anchored the same way menu.show(themeButton, 0, themeButton.getHeight() + 6) used to, then clamped so it
    // can't be positioned partly off the (possibly much smaller, possibly fullscreen-sized) overlay.
    Dimension pref = menu.getPreferredSize();
    java.awt.Point anchor = SwingUtilities.convertPoint(themeButton, 0, themeButton.getHeight() + 6, themeMenuOverlay);
    int mx = Math.max(4, Math.min(anchor.x, themeMenuOverlay.getWidth() - pref.width - 4));
    int my = Math.max(4, Math.min(anchor.y, themeMenuOverlay.getHeight() - pref.height - 4));
    menu.setBounds(mx, my, pref.width, pref.height);
    menu.validate(); // immediate, not deferred — see showSettingsDialog()'s note on why validate() over revalidate() here; needed every open, not just the first, since the items are rebuilt fresh each time
    themeMenuOverlay.setVisible(true);
  }
  private void hideThemeMenu() { if (themeMenuOverlay != null) themeMenuOverlay.setVisible(false); getRootPane().requestFocusInWindow(); } // see closeSettingsDialog()'s note on why every overlay close does this

  /** Applies a theme immediately, without switchToTheme()'s color-lerp animation — used only by restoreSettingsState() at startup, before the window is first shown, where an instant application is correct (no from-color transition makes sense yet, and an animated one risks a brief flash from the default theme to the restored one right as the app opens). */
  private void applyThemeInstant(int index) {
    currentThemeIndex = index;
    Theme to = THEMES[index];
    if ("AUTO".equals(to.name)) to = refreshAutoTheme(); // no track/cover has loaded yet this early, so this just seeds the placeholder-replacing fallback palette; onCoverChanged() refreshes it for real once a track actually loads
    themeButton.setText(to.name);
    themeOverlay.setMode(ThemeOverlay.Mode.forTheme(to.name));
    visualizer.setMode(VisualizerBars.Mode.forTheme(to.name));
    BG = to.bg; CARD = to.card; ACCENT = to.accent; ACCENT2 = to.accent2; TEXT = to.text; MUTED = to.muted;
    applyThemeColors();
  }
  private void switchToTheme(int index) {
    if (index == currentThemeIndex) return;
    Theme to = THEMES[index];
    currentThemeIndex = index;
    themeButton.setText(to.name); // the settings row's own "THEME" label already gives context
    themeOverlay.setMode(ThemeOverlay.Mode.forTheme(to.name));
    visualizer.setMode(VisualizerBars.Mode.forTheme(to.name));
    if ("AUTO".equals(to.name)) to = refreshAutoTheme(); // derive fresh from whatever cover art is showing right now, rather than the stale palette from the last time AUTO was picked
    animateThemeColors(new Color[] { to.bg, to.card, to.accent, to.accent2, to.text, to.muted });
  }
  /**
   * Animates (or instantly applies, if animations are off) BG/CARD/ACCENT/ACCENT2/TEXT/MUTED from their current
   * live values to toColors — the color-transition half of switchToTheme(), factored out so onCoverChanged() can
   * reuse it to fade into a freshly-derived AUTO palette without also re-running the theme-switch bookkeeping
   * (button text, particle/visualizer mode) that only makes sense when the theme selection itself changes.
   */
  private void animateThemeColors(Color[] toColors) {
    Color[] fromColors = { BG, CARD, ACCENT, ACCENT2, TEXT, MUTED };
    if (themeAnim != null && themeAnim.isRunning()) { themeAnim.stop(); disc.setColorAnimationInProgress(false); } // an interrupted-mid-transition timer never reaches its own t>=1 cleanup below, so clear the suppression flag here too
    if (!animationsEnabled) {
      BG = toColors[0]; CARD = toColors[1]; ACCENT = toColors[2]; ACCENT2 = toColors[3]; TEXT = toColors[4]; MUTED = toColors[5];
      applyThemeColors(); getContentPane().repaint(); refreshSettingsIfOpen(); updateQueueUI();
      return;
    }
    // Elapsed-time-based progress, not a fixed step count: this is the one theme animation that repaints the
    // WHOLE content pane every tick (every other overlay animation deliberately scopes to just its own card — see
    // animateSettingsIn()'s note — specifically to avoid this), and that repaint also drags in the particle
    // overlay glass pane sitting on top of it, which measured tens of times more expensive at a large/fullscreen
    // resolution than windowed (see ThemeOverlay's buildClip() note). A step-counted timer just runs slower,
    // wall-clock, when each callback's repaint takes longer than the tick interval — at fullscreen that stretched
    // a theme switch out into a visible multi-hundred-ms stall. Time-based progress instead bounds the total
    // transition to durationMillis regardless of how slow individual frames render: a struggling frame just skips
    // ahead in the interpolation rather than extending how long the whole thing takes.
    final long durationMillis = 150;
    final long startTime = System.currentTimeMillis();
    // refreshSettingsIfOpen() doesn't just repaint — it does settingsOverlay.card.removeAll() followed by
    // buildSettingsPanel(), reconstructing every button/slider/label in the dialog from scratch, plus a
    // synchronous validate(). Measured directly at ~20-26ms per call — far more than this timer's own 8ms tick
    // budget. Even calling it just twice (start + end) from inside this tick handler meant two of the ~18 ticks
    // still stalled the main fade by that much, since both run on the same EDT event as the tick that triggered
    // them. Scheduling it via invokeLater() instead queues it as a separate, later EDT event: the main window's
    // fade timer stays completely clear of that cost on every one of its own ticks, and the settings dialog (a
    // secondary overlay, not what's actually being watched fade) catches up to the final colors moments after the
    // main fade finishes instead of tracking it step by step.
    themeAnim = new Timer(8, e -> {
      float t = Math.min(1f, (System.currentTimeMillis() - startTime) / (float) durationMillis);
      BG = lerp(fromColors[0], toColors[0], t); CARD = lerp(fromColors[1], toColors[1], t); ACCENT = lerp(fromColors[2], toColors[2], t);
      ACCENT2 = lerp(fromColors[3], toColors[3], t); TEXT = lerp(fromColors[4], toColors[4], t); MUTED = lerp(fromColors[5], toColors[5], t);
      applyThemeColors();
      getContentPane().repaint();
      if (t >= 1f) {
        ((Timer) e.getSource()).stop(); disc.setColorAnimationInProgress(false); updateQueueUI();
        SwingUtilities.invokeLater(this::refreshSettingsIfOpen);
      }
    });
    disc.setColorAnimationInProgress(true);
    themeAnim.start();
  }
  /**
   * Recomputes the AUTO theme's palette from the disc's current cover art and replaces THEMES[autoIndex] with a
   * fresh Theme (Theme is immutable, so this swaps the array slot rather than mutating one in place) — callers
   * that need the derived colors right now (switchToTheme, applyThemeInstant) use the returned value directly;
   * onCoverChanged() below is what keeps it current as tracks change while AUTO is already the active theme.
   */
  private Theme refreshAutoTheme() {
    int autoIndex = -1;
    for (int i = 0; i < THEMES.length; i++) if ("AUTO".equals(THEMES[i].name)) { autoIndex = i; break; }
    if (autoIndex < 0) return THEMES[currentThemeIndex]; // AUTO isn't in THEMES; shouldn't happen, but fail safe rather than throw
    Theme derived = deriveAutoTheme(disc.getCover());
    THEMES[autoIndex] = derived;
    return derived;
  }
  /** Called whenever the disc's cover art changes (see DiscView.setOnCoverChanged) — including asynchronously, once an iTunes/Deezer lookup completes after playback has already started. Re-derives the AUTO theme's palette, but only while AUTO is actually the active theme — everywhere else this is a cheap no-op check. */
  private void onCoverChanged() {
    if (currentThemeIndex < 0 || currentThemeIndex >= THEMES.length || !"AUTO".equals(THEMES[currentThemeIndex].name)) return;
    Theme fresh = refreshAutoTheme();
    animateThemeColors(new Color[] { fresh.bg, fresh.card, fresh.accent, fresh.accent2, fresh.text, fresh.muted });
  }
  /** A representative color from quantizing a piece of art, and how much of the sampled image it covers. */
  private static final class Swatch {
    final int rgb; final int population;
    Swatch(int rgb, int population) { this.rgb = rgb; this.population = population; }
  }
  /**
   * Median-cut color quantization: repeatedly splits whichever color box currently holds the most pixels along
   * its widest-ranging RGB channel, at the population-weighted median, until maxSwatches boxes remain — each
   * then collapsed to its population-weighted average color. This groups pixels by genuine color similarity
   * (RGB proximity), which a hue-only histogram (this method's previous approach) can't: two colors sharing a
   * hue but differing sharply in saturation or brightness — a dark maroon and a bright pink, say — get kept
   * apart here, where pure hue-bucketing would lump them into the same bin regardless, and a real color
   * cluster straddling a fixed hue-bucket boundary doesn't get its weight arbitrarily split across two
   * neighbors the way it would there either. Modeled on the same idea as the Wu quantizer
   * material-color-utilities uses (see its dev_guide/extracting_colors.md) — median-cut instead of Wu's exact
   * variance-minimizing splits, since it's a well-established, considerably simpler algorithm to implement and
   * verify correctly in a single dependency-free file, while solving the same "genuinely representative
   * colors, not raw per-pixel tallying" problem.
   */
  private static List<Swatch> quantizeMedianCut(Map<Integer, Integer> colorCounts, int maxSwatches) {
    List<List<int[]>> boxes = new ArrayList<List<int[]>>(); // each box: a list of {r, g, b, count} entries
    List<int[]> initial = new ArrayList<int[]>();
    for (Map.Entry<Integer, Integer> e : colorCounts.entrySet()) {
      int rgb = e.getKey();
      initial.add(new int[] { (rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF, e.getValue() });
    }
    boxes.add(initial);
    while (boxes.size() < maxSwatches) {
      int splitIndex = -1, splitPopulation = -1;
      for (int i = 0; i < boxes.size(); i++) {
        if (boxes.get(i).size() < 2) continue; // can't split a box down to just one distinct color any further
        int pop = 0; for (int[] c : boxes.get(i)) pop += c[3];
        if (pop > splitPopulation) { splitPopulation = pop; splitIndex = i; }
      }
      if (splitIndex < 0) break; // every remaining box is already a single color — nothing left worth splitting
      List<int[]> box = boxes.get(splitIndex);
      final int ch = widestChannel(box); // 0=R, 1=G, 2=B — whichever has the widest range of values in this box
      box.sort((a, b) -> Integer.compare(a[ch], b[ch]));
      int totalPop = 0; for (int[] c : box) totalPop += c[3];
      int cumulative = 0, cut = box.size() - 1;
      for (int i = 0; i < box.size(); i++) { cumulative += box.get(i)[3]; if (cumulative >= totalPop / 2) { cut = i; break; } }
      // The population-weighted median can legitimately land on the very last sorted color — common for real
      // photos, where one shade can dominate a box's pixel count heavily enough that cumulative population
      // doesn't cross the halfway point until the last entry. That used to leave `right` empty and abort
      // quantization ENTIRELY right there (not just skip this one box), starving the scorer down to whatever
      // handful of swatches existed at that point — the actual bug behind a real cover producing an
      // unexpectedly poor/wrong AUTO color. Since box.size() >= 2 here (checked above), pulling the cut back by
      // one always leaves at least one color on each side, so this box can always be split successfully instead
      // of derailing every other box still waiting its turn.
      if (cut >= box.size() - 1) cut = box.size() - 2;
      List<int[]> right = new ArrayList<int[]>(box.subList(cut + 1, box.size()));
      boxes.set(splitIndex, new ArrayList<int[]>(box.subList(0, cut + 1)));
      boxes.add(right);
    }
    List<Swatch> result = new ArrayList<Swatch>();
    for (List<int[]> box : boxes) {
      long r = 0, g = 0, b = 0, pop = 0;
      for (int[] c : box) { r += (long) c[0] * c[3]; g += (long) c[1] * c[3]; b += (long) c[2] * c[3]; pop += c[3]; }
      if (pop == 0) continue;
      int avgRgb = ((int) (r / pop) << 16) | ((int) (g / pop) << 8) | (int) (b / pop);
      result.add(new Swatch(avgRgb, (int) pop));
    }
    return result;
  }
  private static int widestChannel(List<int[]> box) {
    int minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (int[] c : box) {
      minR = Math.min(minR, c[0]); maxR = Math.max(maxR, c[0]);
      minG = Math.min(minG, c[1]); maxG = Math.max(maxG, c[1]);
      minB = Math.min(minB, c[2]); maxB = Math.max(maxB, c[2]);
    }
    int rangeR = maxR - minR, rangeG = maxG - minG, rangeB = maxB - minB;
    if (rangeR >= rangeG && rangeR >= rangeB) return 0;
    return rangeG >= rangeB ? 1 : 2;
  }
  /**
   * Derives a full theme palette from a piece of album art, aiming for the same "vibrant accent, not the dull
   * dominant color" pick Spotify's own now-playing background famously makes (e.g. pulling the deep red from a
   * jacket instead of a photo's muddy greenish-brown backdrop, even though the backdrop covers far more of the
   * frame) rather than just tallying whichever color happens to cover the most pixels. Structured the same way
   * material-color-utilities documents doing this (see its dev_guide/extracting_colors.md): quantize the
   * sampled pixels down to a small set of genuinely representative colors first (quantizeMedianCut, above),
   * *then* score those candidates and explicitly disqualify low-chroma ones — instead of just tallying whichever
   * raw color happens to cover the most pixels, or (this method's previous approach) bucketing purely by hue
   * angle. Scores in HSB, not that project's actual HCT/CAM16 perceptual color space — full CAM16 conversion is
   * real color science (view-condition-adapted matrices, not just a formula), and HSB saturation is a
   * serviceable-enough stand-in for "how vivid does this look" for a single dependency-free file. The result is
   * built with the same recipe as the hand-picked themes above — near-black BG, a slightly lighter CARD, a
   * vivid ACCENT, a lighter/desaturated ACCENT2, near-white TEXT, mid-gray MUTED — just parameterized by the
   * extracted hue/saturation instead of fixed per theme. Falls back to a neutral blue when there's no cover
   * yet, or to a genuinely neutral gray/silver (not that same blue — see the monochrome branch below) when the
   * cover turns out to have no real color in it at all (true black-and-white art) — deriveAutoTheme always
   * returns a usable Theme, never null.
   */
  private static Theme deriveAutoTheme(BufferedImage cover) {
    float hue = 0.58f, sat = 0.55f;
    // Set only when the art has a second dominant color cluster clearly distinct from the first — lets the
    // accent -> accent2 gradient (used throughout: buttons, the disc, the visualizer) reflect two real colors
    // actually present in the cover, instead of always being accent nudged by an arbitrary fixed hue offset
    // regardless of what the art looks like.
    Float hue2 = null;
    // True once we know the cover is genuinely colorless (true black-and-white art, not just "no cover loaded
    // yet") — see the two "no qualifying pixels/swatches" branches below for why that needs different handling
    // than the placeholder hue/sat defaults above.
    boolean monochrome = false;
    if (cover != null) {
      int w = cover.getWidth(), h = cover.getHeight();
      // 48, not fewer: embedded/looked-up cover art is often a fairly small thumbnail, and a small colorful
      // detail (a logo, a jacket) sitting on an otherwise dull photo can fall entirely between grid points at a
      // coarser sampling and never get counted at all. Still cheap — 48x48 is at most ~2300 samples, done once
      // per track load/cover change, not per frame.
      int gridSize = 48;
      int stepX = Math.max(1, w / gridSize), stepY = Math.max(1, h / gridSize);
      Map<Integer, Integer> colorCounts = new HashMap<Integer, Integer>();
      float[] hsb = new float[3];
      int totalSamples = 0, qualifyingSamples = 0;
      for (int y = 0; y < h; y += stepY) {
        for (int x = 0; x < w; x += stepX) {
          totalSamples++;
          int rgb = cover.getRGB(x, y) & 0xFFFFFF;
          Color.RGBtoHSB((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF, hsb);
          // 0.20: disqualifies only genuinely low-chroma (gray/washed-out) pixels from the candidate pool, the
          // same way material-color-utilities' own scoring step "filters out non-pleasant colors" — a merely
          // abundant muddy/gray region (a dim photo backdrop, say) shouldn't be able to out-total a real accent
          // color. Kept lower than an earlier 0.30 cut: plenty of legitimate, human-recognizable dominant colors
          // (a natural forest/olive green background, for instance) sit around sat 0.2-0.35, and excluding that
          // whole band crippled the actual dominant color's counted population, letting an unrelated smaller but
          // more-saturated detail (a logo, a warm highlight) win by default — the scoring step below, not this
          // floor, is what should be doing the "prefer vivid" work. On its own, though, this per-pixel floor
          // isn't enough to catch a genuinely black-and-white photo: a handful of borderline off-white/sepia
          // pixels (scan noise, JPEG compression artifacts near edges) can still clear 0.20 even though the
          // photo as a whole has no real color in it — see the qualifyingSamples share check below.
          if (hsb[1] < 0.20f || hsb[2] < 0.12f || hsb[2] > 0.95f) continue;
          qualifyingSamples++;
          colorCounts.merge(rgb, 1, Integer::sum);
        }
      }
      // A real colored cover has color across a meaningful chunk of its sampled pixels, not just a stray few
      // percent of them — a black-and-white photo that happens to have a handful of warm-tinted pixels clear
      // the per-pixel floor above should still read as monochrome overall rather than let those few pixels pick
      // an accent color for the whole thing.
      if (!colorCounts.isEmpty() && qualifyingSamples >= totalSamples * 0.05) {
        List<Swatch> swatches = quantizeMedianCut(colorCounts, 16);
        // Score each quantized swatch by population * saturation^1.5 — enough of a boost that a smaller
        // genuinely-vivid swatch can still outscore a larger but comparatively duller one (a 20%-population
        // sat-0.85 accent still beats an 80%-population sat-0.35 muddy backdrop: 0.2*0.85^1.5=0.157 vs
        // 0.8*0.35^1.5=0.166 — close, tunable, but the point is population isn't steamrolled), while not being
        // so aggressive (as a straight square was) that an ordinary, moderately-saturated but legitimately
        // dominant color — a real album cover's actual background, say — loses to a small, incidentally
        // more-saturated detail like a logo or a warm highlight that a person wouldn't pick as "the" color.
        List<double[]> scored = new ArrayList<double[]>(); // each entry: {score, hue, sat, population}
        double totalPopulation = 0;
        for (Swatch sw : swatches) {
          float[] swHsb = new float[3];
          Color.RGBtoHSB((sw.rgb >> 16) & 0xFF, (sw.rgb >> 8) & 0xFF, sw.rgb & 0xFF, swHsb);
          totalPopulation += sw.population;
          if (swHsb[1] < 0.20f) continue; // a box's population-weighted average color can land back below the floor even though every pixel that fed it individually passed it
          double score = sw.population * Math.pow(swHsb[1], 1.5);
          scored.add(new double[] { score, swHsb[0], swHsb[1], sw.population });
        }
        if (!scored.isEmpty()) {
          scored.sort((a, b) -> Double.compare(b[0], a[0])); // highest score first
          double[] best = scored.get(0);
          hue = (float) best[1];
          // The winning swatch's own saturation — already a genuinely representative color (quantizeMedianCut's
          // population-weighted average of a cluster of similar pixels), not a raw per-pixel value, so unlike
          // the old hue-bin approach this doesn't need a second saturation-weighting pass to avoid getting
          // dragged down by weakly-tinted outliers. Floor kept at 0.6 for the same reason as before — an accent
          // is supposed to read as "that color", not a hint of it.
          sat = Math.max(0.6f, Math.min(0.95f, (float) best[2]));
          // The runner-up swatch, but only if it's both far enough from the winner's hue to read as a genuinely
          // different color (not just a slightly different shade of the same one) and common enough not to be a
          // handful of stray outlier pixels.
          for (int i = 1; i < scored.size(); i++) {
            double[] cand = scored.get(i);
            float diff = Math.abs((float) cand[1] - hue); if (diff > 0.5f) diff = 1f - diff; // circular distance
            if (diff < 0.12f) continue;
            if (cand[3] < totalPopulation * 0.08) continue;
            hue2 = (float) cand[1];
            break;
          }
        } else {
          monochrome = true;
          sat = 0.05f;
        }
      } else {
        // Cover exists but scanning found essentially no real color in it — either no pixel cleared the
        // saturation floor at all, or (qualifyingSamples check above) only a stray handful did, not enough to
        // call the cover "colored" as a whole. True black-and-white/grayscale art, not the "no cover loaded
        // yet" case the hue/sat defaults above are actually for. Left as those defaults, this rendered a
        // hardcoded blue-purple gradient on genuinely monochrome covers (a Linkin Park cover that's just black
        // silhouettes on white came out looking tinted blue/orange, with nothing in the art to justify it).
        // Near-zero saturation renders as light gray/silver regardless of hue, matching what's actually there
        // instead of inventing a color that isn't.
        monochrome = true;
        sat = 0.05f;
      }
    }
    Color accent = Color.getHSBColor(hue, sat, 0.72f);
    // A genuinely second dominant color from the art when one clearly exists, otherwise the same small fixed hue
    // nudge as before — still a tasteful two-tone gradient for largely monochrome covers. Skipped for a
    // genuinely monochrome cover (monochrome==true): the 0.25 floor below exists to keep accent2 from reading
    // as flat gray on a *colorful* cover with low-but-real saturation, which would defeat the whole point here.
    float accent2Hue = hue2 != null ? hue2 : (hue + 0.06f) % 1f;
    Color accent2 = Color.getHSBColor(accent2Hue, monochrome ? sat : Math.max(0.25f, sat * 0.55f), 0.85f);
    Color bg = Color.getHSBColor(hue, Math.min(0.55f, sat * 0.6f), 0.06f);
    Color card = Color.getHSBColor(hue, Math.min(0.5f, sat * 0.55f), 0.12f);
    Color text = Color.getHSBColor(hue, 0.04f, 0.93f);
    Color muted = Color.getHSBColor(hue, 0.10f, 0.58f);
    return new Theme("AUTO", bg, card, accent, accent2, text, muted);
  }
  /** Rebuilds the Settings card's content in place if it's currently open, so it tracks the live BG/CARD/ACCENT/etc. colors during a theme transition instead of sitting frozen on whatever they were when it was opened. */
  private void refreshSettingsIfOpen() {
    if (settingsOverlay == null || !settingsOverlay.isVisible()) return;
    settingsOverlay.card.removeAll();
    settingsOverlay.card.add(buildSettingsPanel(), BorderLayout.CENTER);
    contentStack.validate(); // immediate, not deferred — see showSettingsDialog()'s note on why validate() over revalidate() here
    settingsOverlay.card.repaint();
  }

  /** Opens the lyrics panel — same in-window-overlay approach as Settings (see showSettingsDialog), and for the same reason: a separate window doesn't reliably layer above this app's own or the OS's fullscreen. Uses its own CenteredOverlay/Timer rather than sharing Settings' — both can be triggered independently (the lyrics button lives on the main screen, not inside Settings), and stopping one's in-progress animation whenever the other opens would leave it visibly frozen mid-transition. */
  private void showLyrics() {
    if (currentLyrics == null) return;
    if (lyricsOverlay == null) {
      lyricsOverlay = new CenteredOverlay();
      lyricsOverlay.setVisible(false);
      contentStack.add(lyricsOverlay, 0);
      themeOverlay.setLyricsCardReference(lyricsOverlay.card);
    }
    lyricsOverlay.card.removeAll();
    lyricsOverlay.card.add(buildLyricsPanel(), BorderLayout.CENTER);
    settleOverlayBounds(lyricsOverlay); // see settleOverlayBounds()'s note on why a plain validate() alone isn't enough
    updateLyricsSync(); // now that validate() has given every line label real bounds, this can scroll to the right one immediately instead of waiting for the next tick
    lyricsOverlay.setVisible(true);
    animateLyricsIn();
  }
  private void closeLyrics() { if (lyricsOverlay != null) animateLyricsOut(); getRootPane().requestFocusInWindow(); } // see closeSettingsDialog()'s note on why every overlay close does this
  /** Rebuilds the lyrics card in place if it's open and a new track just loaded, so it tracks whatever's actually playing instead of showing a stale track's words — closes itself if the new track has none. */
  private void refreshLyricsIfOpen() {
    if (lyricsOverlay == null || !lyricsOverlay.isVisible()) return;
    if (currentLyrics == null) { closeLyrics(); return; }
    lyricsOverlay.card.removeAll();
    lyricsOverlay.card.add(buildLyricsPanel(), BorderLayout.CENTER);
    contentStack.validate();
    updateLyricsSync();
    lyricsOverlay.card.repaint();
  }
  private Timer lyricsAnimTimer;
  private void animateLyricsIn() {
    if (lyricsAnimTimer != null && lyricsAnimTimer.isRunning()) lyricsAnimTimer.stop();
    FadeableCard card = lyricsOverlay.card;
    if (!animationsEnabled) { card.opacity = 1f; card.scale = 1f; card.repaint(); return; }
    card.beginTransformAnimation();
    card.opacity = 0f; card.scale = 0.9f;
    final int steps = 6;
    final int[] step = { 0 };
    lyricsAnimTimer = new Timer(8, null);
    lyricsAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      float eased = 1f - (float) Math.pow(1f - t, 3);
      card.opacity = eased; card.scale = 0.9f + 0.1f * eased;
      // card.repaint(), not lyricsOverlay.repaint() — see animateSettingsIn()'s note: the overlay spans the whole
      // window now (the dimmed click-blocking backdrop), so repainting it on every tick recomposited the entire
      // window ~80 times/second for an animation that only changes the card.
      card.repaint();
      if (t >= 1f) { ((Timer) e.getSource()).stop(); card.opacity = 1f; card.scale = 1f; card.endTransformAnimation(); }
    });
    lyricsAnimTimer.start();
  }
  private void animateLyricsOut() {
    if (!lyricsOverlay.isVisible()) return;
    if (lyricsAnimTimer != null && lyricsAnimTimer.isRunning()) lyricsAnimTimer.stop();
    FadeableCard card = lyricsOverlay.card;
    if (!animationsEnabled) { lyricsOverlay.setVisible(false); card.opacity = 1f; card.scale = 1f; return; }
    card.beginTransformAnimation();
    final int steps = 5;
    final int[] step = { 0 };
    lyricsAnimTimer = new Timer(8, null);
    lyricsAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      card.opacity = 1f - t; card.scale = 1f - 0.1f * t;
      card.repaint(); // see animateSettingsIn()'s note on why this is card.repaint(), not lyricsOverlay.repaint()
      if (t >= 1f) {
        ((Timer) e.getSource()).stop();
        lyricsOverlay.setVisible(false);
        card.opacity = 1f; card.scale = 1f;
        card.endTransformAnimation();
      }
    });
    lyricsAnimTimer.start();
  }
  /** Opens the recently-played panel — same in-window-overlay approach as Settings/Lyrics/EQ, and its own CenteredOverlay/Timer for the same "must not stomp another overlay's in-progress animation" reason given on showLyrics(). */
  private void showHistory() {
    if (historyOverlay == null) {
      historyOverlay = new CenteredOverlay();
      historyOverlay.setVisible(false);
      contentStack.add(historyOverlay, 0);
      themeOverlay.setHistoryCardReference(historyOverlay.card);
    }
    historyOverlay.card.removeAll();
    historyOverlay.card.add(buildHistoryPanel(), BorderLayout.CENTER);
    settleOverlayBounds(historyOverlay); // see settleOverlayBounds()'s note on why a plain validate() alone isn't enough
    historyOverlay.setVisible(true);
    animateHistoryIn();
  }
  private void closeHistory() { if (historyOverlay != null) animateHistoryOut(); getRootPane().requestFocusInWindow(); } // see closeSettingsDialog()'s note on why every overlay close does this
  /** Rebuilds the history card in place if it's open and a track just finished loading, so a newly-recorded play shows up live instead of only after reopening. */
  private void refreshHistoryIfOpen() {
    if (historyOverlay == null || !historyOverlay.isVisible()) return;
    historyOverlay.card.removeAll();
    historyOverlay.card.add(buildHistoryPanel(), BorderLayout.CENTER);
    contentStack.validate();
    historyOverlay.card.repaint();
  }
  private Timer historyAnimTimer;
  private void animateHistoryIn() {
    if (historyAnimTimer != null && historyAnimTimer.isRunning()) historyAnimTimer.stop();
    FadeableCard card = historyOverlay.card;
    if (!animationsEnabled) { card.opacity = 1f; card.scale = 1f; card.repaint(); return; }
    card.beginTransformAnimation();
    card.opacity = 0f; card.scale = 0.9f;
    final int steps = 6;
    final int[] step = { 0 };
    historyAnimTimer = new Timer(8, null);
    historyAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      float eased = 1f - (float) Math.pow(1f - t, 3);
      card.opacity = eased; card.scale = 0.9f + 0.1f * eased;
      // card.repaint(), not historyOverlay.repaint() — see animateSettingsIn()'s note: the overlay spans the whole
      // window now (the dimmed click-blocking backdrop), so repainting it on every tick recomposited the entire
      // window ~80 times/second for an animation that only changes the card.
      card.repaint();
      if (t >= 1f) { ((Timer) e.getSource()).stop(); card.opacity = 1f; card.scale = 1f; card.endTransformAnimation(); }
    });
    historyAnimTimer.start();
  }
  private void animateHistoryOut() {
    if (!historyOverlay.isVisible()) return;
    if (historyAnimTimer != null && historyAnimTimer.isRunning()) historyAnimTimer.stop();
    FadeableCard card = historyOverlay.card;
    if (!animationsEnabled) { historyOverlay.setVisible(false); card.opacity = 1f; card.scale = 1f; return; }
    card.beginTransformAnimation();
    final int steps = 5;
    final int[] step = { 0 };
    historyAnimTimer = new Timer(8, null);
    historyAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      card.opacity = 1f - t; card.scale = 1f - 0.1f * t;
      card.repaint(); // see animateSettingsIn()'s note on why this is card.repaint(), not historyOverlay.repaint()
      if (t >= 1f) {
        ((Timer) e.getSource()).stop();
        historyOverlay.setVisible(false);
        card.opacity = 1f; card.scale = 1f;
        card.endTransformAnimation();
      }
    });
    historyAnimTimer.start();
  }
  /** Opens the library search panel — same in-window-overlay approach as Settings/Lyrics/History, and its own CenteredOverlay/Timer for the same "must not stomp another overlay's in-progress animation" reason given on showLyrics(). Kicks off a fresh recursive scan of the last-used music folder every time it opens, since the folder's contents (or the folder itself, via Load a Track) may have changed since the last time it was open. */
  private void showSearch() {
    if (searchOverlay == null) {
      searchOverlay = new CenteredOverlay();
      searchOverlay.setVisible(false);
      contentStack.add(searchOverlay, 0);
      themeOverlay.setSearchCardReference(searchOverlay.card);
    }
    startLibraryScan(); // before building the panel, so its initial render already reflects "scanning" state instead of a blank flash
    searchOverlay.card.removeAll();
    searchOverlay.card.add(buildSearchPanel(), BorderLayout.CENTER);
    settleOverlayBounds(searchOverlay); // see settleOverlayBounds()'s note on why a plain validate() alone isn't enough
    searchOverlay.setVisible(true);
    animateSearchIn();
  }
  private void closeSearch() { if (searchOverlay != null) animateSearchOut(); getRootPane().requestFocusInWindow(); } // see closeSettingsDialog()'s note on why every overlay close does this
  private Timer searchAnimTimer;
  private void animateSearchIn() {
    if (searchAnimTimer != null && searchAnimTimer.isRunning()) searchAnimTimer.stop();
    FadeableCard card = searchOverlay.card;
    if (!animationsEnabled) { card.opacity = 1f; card.scale = 1f; card.repaint(); return; }
    card.beginTransformAnimation();
    card.opacity = 0f; card.scale = 0.9f;
    final int steps = 6;
    final int[] step = { 0 };
    searchAnimTimer = new Timer(8, null);
    searchAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      float eased = 1f - (float) Math.pow(1f - t, 3);
      card.opacity = eased; card.scale = 0.9f + 0.1f * eased;
      // card.repaint(), not searchOverlay.repaint() — see animateSettingsIn()'s note: the overlay spans the whole
      // window now (the dimmed click-blocking backdrop), so repainting it on every tick recomposited the entire
      // window ~80 times/second for an animation that only changes the card.
      card.repaint();
      if (t >= 1f) { ((Timer) e.getSource()).stop(); card.opacity = 1f; card.scale = 1f; card.endTransformAnimation(); }
    });
    searchAnimTimer.start();
  }
  private void animateSearchOut() {
    if (!searchOverlay.isVisible()) return;
    if (searchAnimTimer != null && searchAnimTimer.isRunning()) searchAnimTimer.stop();
    FadeableCard card = searchOverlay.card;
    if (!animationsEnabled) { searchOverlay.setVisible(false); card.opacity = 1f; card.scale = 1f; return; }
    card.beginTransformAnimation();
    final int steps = 5;
    final int[] step = { 0 };
    searchAnimTimer = new Timer(8, null);
    searchAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      card.opacity = 1f - t; card.scale = 1f - 0.1f * t;
      card.repaint(); // see animateSettingsIn()'s note on why this is card.repaint(), not searchOverlay.repaint()
      if (t >= 1f) {
        ((Timer) e.getSource()).stop();
        searchOverlay.setVisible(false);
        card.opacity = 1f; card.scale = 1f;
        card.endTransformAnimation();
      }
    });
    searchAnimTimer.start();
  }
  /** Opens the EQ panel — same in-window-overlay approach as Settings/Lyrics, and its own CenteredOverlay/Timer for the same "must not stomp another overlay's in-progress animation" reason given on showLyrics(). */
  private void showEq() {
    if (eqOverlay == null) {
      eqOverlay = new CenteredOverlay();
      eqOverlay.setVisible(false);
      contentStack.add(eqOverlay, 0);
      themeOverlay.setEqCardReference(eqOverlay.card);
    }
    eqOverlay.card.removeAll();
    eqOverlay.card.add(buildEqPanel(), BorderLayout.CENTER);
    settleOverlayBounds(eqOverlay); // see settleOverlayBounds()'s note on why a plain validate() alone isn't enough
    eqOverlay.setVisible(true);
    animateEqIn();
  }
  private void closeEq() { if (eqOverlay != null) animateEqOut(); getRootPane().requestFocusInWindow(); } // see closeSettingsDialog()'s note on why every overlay close does this
  /** Rebuilds the EQ card in place if it's open — used right after saving a new custom preset, so the new preset button appears immediately without closing/reopening the panel. */
  private void refreshEqIfOpen() {
    if (eqOverlay == null || !eqOverlay.isVisible()) return;
    eqOverlay.card.removeAll();
    eqOverlay.card.add(buildEqPanel(), BorderLayout.CENTER);
    contentStack.validate();
    eqOverlay.card.repaint();
  }
  private Timer eqAnimTimer;
  private void animateEqIn() {
    if (eqAnimTimer != null && eqAnimTimer.isRunning()) eqAnimTimer.stop();
    FadeableCard card = eqOverlay.card;
    if (!animationsEnabled) { card.opacity = 1f; card.scale = 1f; card.repaint(); return; }
    card.beginTransformAnimation();
    card.opacity = 0f; card.scale = 0.9f;
    final int steps = 6;
    final int[] step = { 0 };
    eqAnimTimer = new Timer(8, null);
    eqAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      float eased = 1f - (float) Math.pow(1f - t, 3);
      card.opacity = eased; card.scale = 0.9f + 0.1f * eased;
      // card.repaint(), not eqOverlay.repaint() — see animateSettingsIn()'s note: the overlay spans the whole
      // window now (the dimmed click-blocking backdrop), so repainting it on every tick recomposited the entire
      // window ~80 times/second for an animation that only changes the card.
      card.repaint();
      if (t >= 1f) { ((Timer) e.getSource()).stop(); card.opacity = 1f; card.scale = 1f; card.endTransformAnimation(); }
    });
    eqAnimTimer.start();
  }
  private void animateEqOut() {
    if (!eqOverlay.isVisible()) return;
    if (eqAnimTimer != null && eqAnimTimer.isRunning()) eqAnimTimer.stop();
    FadeableCard card = eqOverlay.card;
    if (!animationsEnabled) { eqOverlay.setVisible(false); card.opacity = 1f; card.scale = 1f; return; }
    card.beginTransformAnimation();
    final int steps = 5;
    final int[] step = { 0 };
    eqAnimTimer = new Timer(8, null);
    eqAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      card.opacity = 1f - t; card.scale = 1f - 0.1f * t;
      card.repaint(); // see animateSettingsIn()'s note on why this is card.repaint(), not eqOverlay.repaint()
      if (t >= 1f) {
        ((Timer) e.getSource()).stop();
        eqOverlay.setVisible(false);
        card.opacity = 1f; card.scale = 1f;
        card.endTransformAnimation();
      }
    });
    eqAnimTimer.start();
  }
  private EqPreset[] allEqPresets() {
    EqPreset[] all = new EqPreset[BUILTIN_EQ_PRESETS.length + customEqPresets.size()];
    System.arraycopy(BUILTIN_EQ_PRESETS, 0, all, 0, BUILTIN_EQ_PRESETS.length);
    for (int i = 0; i < customEqPresets.size(); i++) all[BUILTIN_EQ_PRESETS.length + i] = customEqPresets.get(i);
    return all;
  }
  private static String formatDbLabel(double db) { long rounded = Math.round(db); return (rounded > 0 ? "+" : "") + rounded + "dB"; }
  private static String formatFrequencyLabel(int freqHz) { return freqHz >= 1000 ? (freqHz / 1000) + "K" : String.valueOf(freqHz); }
  /**
   * Ten horizontal band rows (label + slider + dB value) rather than the traditional vertical-fader graphic-EQ
   * look — AccentSliderUI (the app's one custom slider look, used everywhere else) is hardcoded horizontal, and
   * this reuses it as-is instead of teaching it a second, vertical rendering/scrubbing mode for just this panel.
   * Presets are plain inline buttons and "save as preset" is an inline name field, not a JComboBox/JOptionPane —
   * both create real popup/dialog windows, the same class of thing that doesn't reliably render above this app's
   * fullscreen (see showThemeMenu's doc comment) and had to be fixed twice already for Settings and the theme
   * picker; nothing new here should risk reintroducing that.
   */
  private JPanel buildEqPanel() {
    JPanel card = new JPanel();
    card.setLayout(new javax.swing.BoxLayout(card, javax.swing.BoxLayout.Y_AXIS));
    card.setBackground(CARD); card.setOpaque(true);
    card.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 40), 1), BorderFactory.createEmptyBorder(26, 30, 22, 30)));
    JLabel title = label("EQUALIZER", 16, ACCENT);
    title.setAlignmentX(Component.LEFT_ALIGNMENT);
    card.add(title);
    card.add(javax.swing.Box.createVerticalStrut(18));

    JSlider[] bandSliders = new JSlider[Equalizer.BANDS];
    for (int i = 0; i < Equalizer.BANDS; i++) {
      final int bandIndex = i;
      JPanel row = new JPanel(); row.setOpaque(false); row.setAlignmentX(Component.LEFT_ALIGNMENT); row.setLayout(new javax.swing.BoxLayout(row, javax.swing.BoxLayout.X_AXIS));
      JLabel freqLabel = new JLabel(formatFrequencyLabel(Equalizer.FREQUENCIES[i]));
      freqLabel.setFont(new Font("SansSerif", Font.BOLD, 10)); freqLabel.setForeground(MUTED); freqLabel.setPreferredSize(new Dimension(30, 16));
      JSlider slider = new JSlider(-12, 12, (int) Math.round(eqGains[i]));
      slider.setOpaque(false); slider.setUI(new AccentSliderUI(slider)); slider.setFocusable(false);
      slider.setPreferredSize(new Dimension(240, 20)); slider.setMaximumSize(new Dimension(240, 20));
      JLabel valueLabel = new JLabel(formatDbLabel(eqGains[i]));
      valueLabel.setFont(new Font("SansSerif", Font.BOLD, 10)); valueLabel.setForeground(MUTED); valueLabel.setPreferredSize(new Dimension(36, 16));
      slider.addChangeListener(e -> {
        double[] newGains = eqGains.clone();
        newGains[bandIndex] = slider.getValue();
        valueLabel.setText(formatDbLabel(newGains[bandIndex]));
        setEqGains(newGains);
      });
      bandSliders[i] = slider;
      row.add(freqLabel); row.add(javax.swing.Box.createHorizontalStrut(10)); row.add(slider); row.add(javax.swing.Box.createHorizontalStrut(8)); row.add(valueLabel);
      card.add(row);
      card.add(javax.swing.Box.createVerticalStrut(5));
    }
    card.add(javax.swing.Box.createVerticalStrut(10));

    JLabel presetsLabel = label("PRESETS", 10, MUTED);
    presetsLabel.setAlignmentX(Component.LEFT_ALIGNMENT);
    card.add(presetsLabel);
    card.add(javax.swing.Box.createVerticalStrut(8));
    ScrollableFlowPanel presetsWrap = new ScrollableFlowPanel(new java.awt.FlowLayout(java.awt.FlowLayout.LEFT, 6, 4));
    presetsWrap.setOpaque(false);
    EqPreset[] allPresets = allEqPresets();
    for (int p = 0; p < allPresets.length; p++) {
      EqPreset preset = allPresets[p];
      boolean isCustom = p >= BUILTIN_EQ_PRESETS.length; // built-ins aren't deletable, so only custom ones get the × button
      JButton presetButton = textButton(preset.name);
      // Each slider's own ChangeListener above updates eqGains + its label incrementally as setValue() fires it,
      // so by the time this loop finishes every slider has been moved, the app's live EQ matches the preset
      // exactly, and every label is already correct — no separate "apply the whole preset" step needed.
      presetButton.addActionListener(e -> { for (int i = 0; i < Equalizer.BANDS; i++) bandSliders[i].setValue((int) Math.round(preset.gains[i])); });
      if (!isCustom) { presetsWrap.add(presetButton); continue; }
      JPanel presetItem = new JPanel(new BorderLayout(2, 0)); presetItem.setOpaque(false);
      // Same look/behavior as the queue list's own remove (×) button, for the same "small, always-available delete" role.
      JButton deleteButton = new JButton("×"); deleteButton.setFont(new Font("SansSerif", Font.BOLD, 13)); deleteButton.setForeground(MUTED);
      deleteButton.setFocusPainted(false); deleteButton.setBorderPainted(false); deleteButton.setContentAreaFilled(false); deleteButton.setOpaque(false);
      deleteButton.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); deleteButton.setMargin(new Insets(0, 6, 0, 2)); deleteButton.setToolTipText("Delete preset \"" + preset.name + "\"");
      deleteButton.setFocusable(false);
      attachColorHover(deleteButton, MUTED, TEXT);
      deleteButton.addActionListener(e -> { deleteEqPreset(preset.name); refreshEqIfOpen(); });
      presetItem.add(presetButton, BorderLayout.CENTER);
      presetItem.add(deleteButton, BorderLayout.EAST);
      presetsWrap.add(presetItem);
    }
    // Scrolls instead of overflowing once there are enough presets (built-in + saved) to outgrow a fixed height —
    // FlowLayout wraps to as many rows as it needs, which without a scroll pane just runs off the bottom of the card.
    JScrollPane presetsScroll = new JScrollPane(presetsWrap);
    presetsScroll.setOpaque(false); presetsScroll.getViewport().setOpaque(false); presetsScroll.setBorder(null);
    presetsScroll.setAlignmentX(Component.LEFT_ALIGNMENT);
    presetsScroll.setHorizontalScrollBarPolicy(JScrollPane.HORIZONTAL_SCROLLBAR_NEVER);
    presetsScroll.setPreferredSize(new Dimension(480, 96));
    presetsScroll.setMaximumSize(new Dimension(Integer.MAX_VALUE, 96));
    presetsScroll.getVerticalScrollBar().setUnitIncrement(16);
    presetsScroll.getVerticalScrollBar().setUI(new GreyScrollBarUI());
    card.add(presetsScroll);
    card.add(javax.swing.Box.createVerticalStrut(14));

    JPanel saveArea = new JPanel(); saveArea.setLayout(new javax.swing.BoxLayout(saveArea, javax.swing.BoxLayout.Y_AXIS));
    saveArea.setOpaque(false); saveArea.setAlignmentX(Component.LEFT_ALIGNMENT);
    JButton saveTrigger = textButton("SAVE AS PRESET");
    saveTrigger.setAlignmentX(Component.LEFT_ALIGNMENT);
    JPanel saveInputRow = new JPanel(); saveInputRow.setOpaque(false); saveInputRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    saveInputRow.setLayout(new javax.swing.BoxLayout(saveInputRow, javax.swing.BoxLayout.X_AXIS));
    saveInputRow.setVisible(false);
    JTextField nameField = new JTextField(14);
    nameField.setMaximumSize(new Dimension(140, 24));
    JButton confirmSave = textButton("SAVE"), cancelSave = textButton("CANCEL");
    saveInputRow.add(nameField); saveInputRow.add(javax.swing.Box.createHorizontalStrut(8)); saveInputRow.add(confirmSave); saveInputRow.add(javax.swing.Box.createHorizontalStrut(4)); saveInputRow.add(cancelSave);
    // contentStack.validate() (immediate, top-down), not a local revalidate() — saveArea's preferred size changes
    // when the input row appears, and CenteredOverlay re-centers `card` via GridBagLayout based on that size;
    // a revalidate() starting from saveArea only reflows within card's *already-fixed* bounds from when showEq()
    // first validated it, so the row's own bounds come out valid but the card never grows to actually show it.
    // Same class of bug as showSettingsDialog()'s card/content-size note, same fix.
    saveTrigger.addActionListener(e -> { saveTrigger.setVisible(false); saveInputRow.setVisible(true); nameField.requestFocusInWindow(); contentStack.validate(); });
    Runnable doSave = () -> {
      String name = nameField.getText().trim();
      if (!name.isEmpty()) { saveNewEqPreset(name, eqGains.clone()); refreshEqIfOpen(); }
    };
    confirmSave.addActionListener(e -> doSave.run());
    nameField.addActionListener(e -> doSave.run()); // Enter key submits, same as clicking SAVE
    cancelSave.addActionListener(e -> { saveInputRow.setVisible(false); saveTrigger.setVisible(true); nameField.setText(""); contentStack.validate(); });
    saveArea.add(saveTrigger); saveArea.add(saveInputRow);
    card.add(saveArea);
    card.add(javax.swing.Box.createVerticalStrut(14));

    JButton close = textButton("CLOSE");
    close.addActionListener(e -> closeEq());
    JPanel buttonRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0));
    buttonRow.setOpaque(false); buttonRow.setAlignmentX(Component.LEFT_ALIGNMENT); buttonRow.add(close);
    card.add(buttonRow);
    return card;
  }
  /**
   * One parsed LRC timing point. A single source line can carry more than one leading [mm:ss.xx] tag (LRC's way
   * of repeating the same text at multiple points), which parseLrc() expands into one LyricLine per timestamp —
   * so this always represents one timestamp/text pair, never a whole raw line.
   */
  private static final class LyricLine {
    final long micros; final String text;
    LyricLine(long micros, String text) { this.micros = micros; this.text = text; }
  }
  private static final java.util.regex.Pattern LRC_TIMESTAMP = java.util.regex.Pattern.compile("^\\[(\\d{1,2}):(\\d{2})(?:\\.(\\d{1,3}))?\\]");
  /** Parses LRC timing tags out of raw tag text; returns an empty list (not null) if it isn't LRC-timed at all, which the caller uses to fall back to a plain, unsynced scrollable view. */
  private static List<LyricLine> parseLrc(String raw) {
    List<LyricLine> result = new ArrayList<LyricLine>();
    for (String rawLine : raw.split("\\R", -1)) {
      String remaining = rawLine;
      List<Long> stamps = new ArrayList<Long>();
      while (true) {
        java.util.regex.Matcher m = LRC_TIMESTAMP.matcher(remaining);
        if (!m.find()) break;
        int minutes = Integer.parseInt(m.group(1)), seconds = Integer.parseInt(m.group(2));
        String frac = m.group(3);
        int millis = frac == null ? 0 : (int) (Double.parseDouble("0." + frac) * 1000);
        stamps.add((minutes * 60L + seconds) * 1_000_000L + millis * 1000L);
        remaining = remaining.substring(m.end());
      }
      if (stamps.isEmpty()) continue; // a header tag like [ti:...] or genuinely untimed lyrics — neither starts with digits
      String text = remaining.trim();
      for (long micros : stamps) result.add(new LyricLine(micros, text));
    }
    result.sort((a, b) -> Long.compare(a.micros, b.micros));
    return result;
  }
  private List<LyricLine> currentLyricLines = java.util.Collections.emptyList();
  private List<JLabel> lyricsLineLabels; // parallel to currentLyricLines; null when showing the plain unsynced fallback instead
  private JScrollPane lyricsScrollPane;
  private int lyricsHighlightIndex = -1;
  private JPanel buildLyricsPanel() {
    JPanel card = new JPanel(new BorderLayout(0, 16));
    card.setBackground(CARD); card.setOpaque(true);
    card.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 40), 1), BorderFactory.createEmptyBorder(26, 30, 22, 30)));
    JLabel title = label("LYRICS", 16, ACCENT);
    card.add(title, BorderLayout.NORTH);
    currentLyricLines = currentLyrics == null ? java.util.Collections.<LyricLine>emptyList() : parseLrc(currentLyrics);
    lyricsHighlightIndex = -1;
    javax.swing.JComponent body;
    if (currentLyricLines.isEmpty()) {
      // Not LRC-timed (or no lyrics at all) — same plain scrollable text as before, no line-by-line sync possible.
      javax.swing.JTextArea text = new javax.swing.JTextArea(currentLyrics == null ? "" : formatLyricsForDisplay(currentLyrics));
      text.setEditable(false); text.setLineWrap(true); text.setWrapStyleWord(true);
      text.setOpaque(false); text.setForeground(TEXT); text.setFont(new Font("SansSerif", Font.PLAIN, 13));
      text.setCaretPosition(0); // JTextArea otherwise scrolls to wherever setText() last left the caret (the end), opening on the last line instead of the first
      body = text;
      lyricsLineLabels = null;
    } else {
      // One JLabel per line (not a single JTextArea) so updateLyricsSync() can restyle just the current line on
      // every tick without rebuilding or re-flowing the whole panel — cheap enough to call every 70ms.
      JPanel lines = new JPanel();
      lines.setOpaque(false);
      lines.setLayout(new javax.swing.BoxLayout(lines, javax.swing.BoxLayout.Y_AXIS));
      lyricsLineLabels = new ArrayList<JLabel>();
      for (int i = 0; i < currentLyricLines.size(); i++) {
        LyricLine ll = currentLyricLines.get(i);
        final int lineIndex = i;
        JLabel lbl = new JLabel(ll.text.isEmpty() ? " " : ll.text);
        lbl.setForeground(MUTED); lbl.setFont(new Font("SansSerif", Font.PLAIN, 13));
        lbl.setAlignmentX(Component.LEFT_ALIGNMENT);
        lbl.setBorder(BorderFactory.createEmptyBorder(3, 0, 3, 0));
        lbl.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        // Click-to-seek: jump playback straight to this line's own timestamp. The hover tint is guarded by
        // "not the currently-playing line" so it can't fight with updateLyricsSync()'s own ACCENT/BOLD styling
        // for whichever line that ticks to next — this only ever touches lines it isn't already highlighting.
        lbl.addMouseListener(new java.awt.event.MouseAdapter() {
          public void mouseClicked(java.awt.event.MouseEvent e) { seekTo(ll.micros); }
          public void mouseEntered(java.awt.event.MouseEvent e) { if (lineIndex != lyricsHighlightIndex) lbl.setForeground(TEXT); }
          public void mouseExited(java.awt.event.MouseEvent e) { if (lineIndex != lyricsHighlightIndex) lbl.setForeground(MUTED); }
        });
        lyricsLineLabels.add(lbl);
        lines.add(lbl);
      }
      body = lines;
    }
    JScrollPane scroll = new JScrollPane(body);
    scroll.setOpaque(false); scroll.getViewport().setOpaque(false); scroll.setBorder(null);
    scroll.setPreferredSize(new Dimension(420, 380));
    scroll.getVerticalScrollBar().setUnitIncrement(16);
    scroll.getVerticalScrollBar().setUI(new GreyScrollBarUI());
    lyricsScrollPane = scroll;
    card.add(scroll, BorderLayout.CENTER);
    JButton close = textButton("CLOSE");
    close.addActionListener(e -> closeLyrics());
    JPanel buttonRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0));
    buttonRow.setOpaque(false); buttonRow.add(close);
    card.add(buttonRow, BorderLayout.SOUTH);
    return card;
  }
  private JPanel buildHistoryPanel() {
    JPanel card = new JPanel(new BorderLayout(0, 16));
    card.setBackground(CARD); card.setOpaque(true);
    card.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 40), 1), BorderFactory.createEmptyBorder(26, 30, 22, 30)));
    JLabel title = label("RECENTLY PLAYED", 16, ACCENT);
    card.add(title, BorderLayout.NORTH);
    javax.swing.JComponent body;
    if (playHistory.isEmpty()) {
      JLabel empty = label("NOTHING PLAYED YET", 12, MUTED);
      JPanel wrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.LEFT, 0, 0));
      wrap.setOpaque(false); wrap.add(empty);
      wrap.setPreferredSize(new Dimension(420, 60));
      body = wrap;
    } else {
      JPanel list = new JPanel();
      list.setOpaque(false); list.setLayout(new javax.swing.BoxLayout(list, javax.swing.BoxLayout.Y_AXIS));
      for (File file : playHistory) {
        // 34px, not the queue row's 18-20px — the ADD button (a PillButton, 8px top/bottom padding around its text) is ~30px tall on its own, and a shorter row cap clips it.
        JPanel row = new JPanel(new BorderLayout(8, 0)); row.setOpaque(false); row.setAlignmentX(Component.LEFT_ALIGNMENT); row.setMaximumSize(new Dimension(Integer.MAX_VALUE, 34));
        JLabel entry = label(escape(queueDisplay(file)), 11, TEXT);
        row.add(entry, BorderLayout.CENTER);
        JButton addButton = textButton("ADD");
        addButton.setToolTipText("Add to queue");
        addButton.addActionListener(e -> addToQueue(java.util.Collections.singletonList(file)));
        JPanel east = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); east.setOpaque(false); east.add(addButton);
        row.add(east, BorderLayout.EAST);
        row.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        row.setToolTipText("Play " + queueDisplay(file));
        java.awt.event.MouseAdapter playOnClick = new java.awt.event.MouseAdapter() {
          public void mouseClicked(java.awt.event.MouseEvent e) { playFromHistory(file); }
        };
        // Also on the label, not just the row: Swing delivers a click to the single deepest component under the
        // cursor and does NOT bubble it up automatically, so without this, clicking directly on the track name
        // (the label, which — via BorderLayout.CENTER — spans nearly the whole row) would silently do nothing.
        row.addMouseListener(playOnClick);
        entry.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        entry.addMouseListener(playOnClick);
        list.add(row);
        list.add(javax.swing.Box.createVerticalStrut(4));
      }
      JScrollPane scroll = new JScrollPane(list);
      scroll.setOpaque(false); scroll.getViewport().setOpaque(false); scroll.setBorder(null);
      scroll.setPreferredSize(new Dimension(420, 380));
      scroll.getVerticalScrollBar().setUnitIncrement(16);
      scroll.getVerticalScrollBar().setUI(new GreyScrollBarUI());
      body = scroll;
    }
    card.add(body, BorderLayout.CENTER);
    JButton close = textButton("CLOSE");
    close.addActionListener(e -> closeHistory());
    JPanel buttonRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0));
    buttonRow.setOpaque(false); buttonRow.add(close);
    card.add(buttonRow, BorderLayout.SOUTH);
    return card;
  }
  /** Appends a track to the end of the live queue and jumps straight to it, same as any other manual track pick — shared by History and Search's "click a row to play it now" behavior. Returns false (no-op) if the file has since moved or been deleted. */
  private boolean appendAndPlay(File file) {
    if (!file.isFile()) return false;
    queue.add(file);
    queueIndex = queue.size() - 1;
    load(file);
    return true;
  }
  /** Plays a track picked from Recently Played immediately. Re-checks the file still exists first, since history can outlive a moved/deleted file. */
  private void playFromHistory(File file) {
    if (!appendAndPlay(file)) { status.setText("●  FILE NO LONGER FOUND"); loadHistory(); refreshHistoryIfOpen(); return; }
    closeHistory();
  }
  /** Reads previously-played track paths (most-recent first, one per line) from disk, silently dropping any that no longer exist so the panel never shows dead entries. */
  private void loadHistory() {
    playHistory.clear();
    try {
      if (!HISTORY_FILE.isFile()) return;
      for (String line : java.nio.file.Files.readAllLines(HISTORY_FILE.toPath(), StandardCharsets.UTF_8)) {
        String path = line.trim();
        if (path.isEmpty()) continue;
        File file = new File(path);
        if (file.isFile()) playHistory.add(file);
        if (playHistory.size() >= HISTORY_LIMIT) break;
      }
    } catch (Exception ignored) { /* corrupt or unreadable history file; just start with none */ }
  }
  private void saveHistory() {
    try {
      File parent = HISTORY_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      StringBuilder content = new StringBuilder();
      for (File file : playHistory) content.append(file.getAbsolutePath()).append('\n');
      java.nio.file.Files.write(HISTORY_FILE.toPath(), content.toString().getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) { /* best-effort; a failed save just means history isn't there next launch */ }
  }
  /** Records a freshly-started track at the front of the recently-played list, relocating it there instead of duplicating it if it's already present, and capping the list so it can't grow without bound. */
  private void recordHistory(File file) {
    playHistory.remove(file);
    playHistory.add(0, file);
    while (playHistory.size() > HISTORY_LIMIT) playHistory.remove(playHistory.size() - 1);
    saveHistory();
    refreshHistoryIfOpen();
  }
  private JPanel buildSearchPanel() {
    JPanel card = new JPanel(new BorderLayout(0, 12));
    card.setBackground(CARD); card.setOpaque(true);
    card.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 40), 1), BorderFactory.createEmptyBorder(26, 30, 22, 30)));
    JLabel title = label("SEARCH LIBRARY", 16, ACCENT);
    card.add(title, BorderLayout.NORTH);

    JPanel center = new JPanel();
    center.setOpaque(false); center.setLayout(new javax.swing.BoxLayout(center, javax.swing.BoxLayout.Y_AXIS));

    // Above the field, not a small muted note below it — reported directly as genuinely hard to find otherwise
    // ("SEARCH" alone doesn't suggest "this is also where Spotify links go"), so this is deliberately the first
    // thing read after the title, in the same readable TEXT color as ordinary body copy rather than MUTED.
    JLabel instructions = label("Type to search your library, or paste a Spotify track/playlist link to queue matching songs you already have", 11, TEXT);
    instructions.setAlignmentX(Component.LEFT_ALIGNMENT);
    center.add(instructions);
    center.add(javax.swing.Box.createVerticalStrut(10));

    searchStatusLabel = label("", 10, MUTED);
    searchStatusLabel.setAlignmentX(Component.LEFT_ALIGNMENT);
    center.add(searchStatusLabel);
    center.add(javax.swing.Box.createVerticalStrut(6));

    searchField = new JTextField();
    searchField.setAlignmentX(Component.LEFT_ALIGNMENT);
    searchField.setMaximumSize(new Dimension(Integer.MAX_VALUE, 26));
    searchField.getDocument().addDocumentListener(new javax.swing.event.DocumentListener() {
      public void insertUpdate(javax.swing.event.DocumentEvent e) { onSearchFieldChanged(); }
      public void removeUpdate(javax.swing.event.DocumentEvent e) { onSearchFieldChanged(); }
      public void changedUpdate(javax.swing.event.DocumentEvent e) { onSearchFieldChanged(); }
    });
    center.add(searchField);
    center.add(javax.swing.Box.createVerticalStrut(10));

    searchResultsList = new JPanel();
    searchResultsList.setOpaque(false);
    searchResultsList.setLayout(new javax.swing.BoxLayout(searchResultsList, javax.swing.BoxLayout.Y_AXIS));
    JScrollPane scroll = new JScrollPane(searchResultsList);
    scroll.setOpaque(false); scroll.getViewport().setOpaque(false); scroll.setBorder(null);
    scroll.setAlignmentX(Component.LEFT_ALIGNMENT);
    scroll.setPreferredSize(new Dimension(420, 340));
    scroll.getVerticalScrollBar().setUnitIncrement(16);
    scroll.getVerticalScrollBar().setUI(new GreyScrollBarUI());
    center.add(scroll);

    card.add(center, BorderLayout.CENTER);
    JButton close = textButton("CLOSE");
    close.addActionListener(e -> closeSearch());
    JPanel buttonRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0));
    buttonRow.setOpaque(false); buttonRow.add(close);
    card.add(buttonRow, BorderLayout.SOUTH);

    refreshSearchResults(); // reflects whatever startLibraryScan() already set up (called by showSearch() just before this)
    return card;
  }
  /** Recursively scans the last-used music folder (readLastPath(), the same folder Load a Track / playlist save/load remember) in the background, then re-filters live. Filename-only match, no per-file tag reads, to stay fast even over a large library. The generation counter guards against a slow scan overwriting a newer one's results if the panel is closed/reopened (or the folder changes) while it's still running. */
  private void startLibraryScan() {
    File folder = readLastPath();
    int generation = ++searchScanGeneration;
    searchIndex.clear(); // clear immediately so a previous folder's results don't linger while this one scans
    if (folder == null || !folder.isDirectory()) { searchScanning = false; return; }
    searchScanning = true;
    Thread worker = new Thread(() -> {
      List<File> found = new ArrayList<File>();
      collectAudio(folder, found);
      Collections.sort(found, (left, right) -> left.getName().compareToIgnoreCase(right.getName()));
      SwingUtilities.invokeLater(() -> {
        if (generation != searchScanGeneration) return; // superseded by a newer scan
        searchIndex.clear();
        searchIndex.addAll(found);
        searchScanning = false;
        if (searchOverlay != null && searchOverlay.isVisible()) refreshSearchResults();
      });
    }, "cdplayer-search-index");
    worker.setDaemon(true);
    worker.start();
  }
  /** Filters searchIndex by the live query (case-insensitive filename substring) and rebuilds the results list in place. Called on every keystroke and once the background scan completes. */
  private void refreshSearchResults() {
    if (searchResultsList == null) return;
    String query = searchField == null ? "" : searchField.getText().trim().toLowerCase();
    searchResultsList.removeAll();
    File folder = readLastPath();
    if (folder == null || !folder.isDirectory()) {
      if (searchStatusLabel != null) searchStatusLabel.setText("LOAD A TRACK FIRST TO SET A FOLDER TO SEARCH");
    } else {
      List<File> matches = new ArrayList<File>();
      for (File file : searchIndex) {
        if (query.isEmpty() || file.getName().toLowerCase().contains(query)) {
          matches.add(file);
          if (matches.size() >= SEARCH_RESULTS_LIMIT) break;
        }
      }
      if (searchStatusLabel != null) {
        searchStatusLabel.setText(searchScanning
            ? "SCANNING " + folder.getName() + "…"
            : matches.size() + (matches.size() >= SEARCH_RESULTS_LIMIT ? "+" : "") + " MATCH" + (matches.size() == 1 ? "" : "ES") + " IN " + folder.getName());
      }
      for (File file : matches) {
        // 34px, not the queue row's 18-20px — the ADD button (a PillButton, 8px top/bottom padding around its text) is ~30px tall on its own, and a shorter row cap clips it.
        JPanel row = new JPanel(new BorderLayout(8, 0)); row.setOpaque(false); row.setAlignmentX(Component.LEFT_ALIGNMENT); row.setMaximumSize(new Dimension(Integer.MAX_VALUE, 34));
        JLabel entry = label(escape(file.getName()), 11, TEXT);
        row.add(entry, BorderLayout.CENTER);
        JButton addButton = textButton("ADD");
        addButton.setToolTipText("Add to queue");
        addButton.addActionListener(e -> addToQueue(java.util.Collections.singletonList(file)));
        JPanel east = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); east.setOpaque(false); east.add(addButton);
        row.add(east, BorderLayout.EAST);
        row.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        row.setToolTipText("Play " + file.getName());
        java.awt.event.MouseAdapter playOnClick = new java.awt.event.MouseAdapter() {
          public void mouseClicked(java.awt.event.MouseEvent e) { playFromSearch(file); }
        };
        // Also on the label, not just the row — see the identical note on the History row above.
        row.addMouseListener(playOnClick);
        entry.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        entry.addMouseListener(playOnClick);
        searchResultsList.add(row);
        searchResultsList.add(javax.swing.Box.createVerticalStrut(4));
      }
      if (matches.isEmpty()) {
        JLabel empty = label(searchScanning ? "SCANNING…" : "NO MATCHES", 11, MUTED);
        searchResultsList.add(empty);
      }
    }
    searchResultsList.revalidate();
    searchResultsList.repaint();
  }
  /** searchField's real DocumentListener target — branches to Spotify import for a recognized link, otherwise falls through to the plain filename filter exactly as before. */
  private void onSearchFieldChanged() {
    String text = searchField == null ? "" : searchField.getText().trim();
    if (SPOTIFY_TRACK_URL.matcher(text).find()) { importSpotifyLink(text, false); return; }
    if (SPOTIFY_PLAYLIST_URL.matcher(text).find()) { importSpotifyLink(text, true); return; }
    lastImportedSpotifyUrl = null; // back to plain text — a later re-paste of the same link should be able to trigger again
    refreshSearchResults();
  }
  /**
   * Resolves a pasted Spotify track/playlist link and adds every track CDPlayer can actually find in your own
   * scanned library to the queue — never streams anything from Spotify itself (impossible anyway: the Web API
   * doesn't expose playable audio, by design). Runs the network resolution on a background thread; the actual
   * local-library matching happens back on the EDT in finishSpotifyImport(), since searchIndex is only ever
   * safely read/written there.
   */
  private void importSpotifyLink(String url, boolean isPlaylist) {
    if (url.equals(lastImportedSpotifyUrl)) return; // already handled this exact paste — every keystroke re-fires this while the link sits in the field
    lastImportedSpotifyUrl = url;
    searchResultsList.removeAll(); searchResultsList.revalidate(); searchResultsList.repaint();
    searchStatusLabel.setText(isPlaylist ? "RESOLVING SPOTIFY PLAYLIST…" : "RESOLVING SPOTIFY TRACK…");
    Thread worker = new Thread(() -> {
      try {
        List<String[]> tracks;
        if (isPlaylist) {
          String userToken;
          try { userToken = getSpotifyUserAccessToken(); } catch (IOException e) { userToken = null; }
          if (userToken == null) { SwingUtilities.invokeLater(() -> promptSpotifySignIn(url)); return; }
          String id = extractSpotifyId(SPOTIFY_PLAYLIST_URL, url);
          tracks = id != null ? fetchSpotifyPlaylistTracks(id) : null;
        } else {
          String id = extractSpotifyId(SPOTIFY_TRACK_URL, url);
          String[] track = id != null ? resolveSpotifyTrack(id) : null;
          tracks = new ArrayList<String[]>();
          if (track != null) tracks.add(track);
        }
        final List<String[]> resolvedTracks = tracks;
        SwingUtilities.invokeLater(() -> finishSpotifyImport(resolvedTracks));
      } catch (Exception e) {
        final String message = e.getMessage();
        SwingUtilities.invokeLater(() -> searchStatusLabel.setText("SPOTIFY IMPORT FAILED" + (message != null ? " — " + message.toUpperCase(java.util.Locale.ROOT) : "")));
      }
    }, "cdplayer-spotify-import");
    worker.setDaemon(true);
    worker.start();
  }
  /** Runs on the EDT: matches each resolved (title, artist) pair against the already-scanned local library (see startLibraryScan/searchIndex — the same index the plain filename search already uses) and adds every match to the queue in one batch, then reports how many were found so it's obvious this only ever queues songs already owned, never something streamed from Spotify. */
  private void finishSpotifyImport(List<String[]> tracks) {
    if (tracks == null) { searchStatusLabel.setText("SPOTIFY LOOKUP FAILED — CHECK THE LINK"); return; }
    if (tracks.isEmpty()) { searchStatusLabel.setText("NO TRACKS FOUND AT THAT LINK"); return; }
    if (searchIndex.isEmpty()) { searchStatusLabel.setText("LOAD A TRACK FIRST TO SET A LIBRARY FOLDER TO MATCH AGAINST"); return; }
    List<File> matched = new ArrayList<File>();
    List<String> missing = new ArrayList<String>();
    for (String[] t : tracks) {
      File f = findLocalMatch(t[0], t[1]);
      if (f != null) matched.add(f); else missing.add(t[0] + (t[1] != null && !t[1].isEmpty() ? " – " + t[1] : ""));
    }
    if (!matched.isEmpty()) addToQueue(matched);
    searchStatusLabel.setText(matched.size() + " OF " + tracks.size() + " TRACK" + (tracks.size() == 1 ? "" : "S") + " FOUND IN YOUR LIBRARY AND ADDED");
    searchResultsList.removeAll();
    for (String miss : missing) {
      JLabel row = label("NOT IN YOUR LIBRARY · " + escape(miss), 11, MUTED);
      row.setAlignmentX(Component.LEFT_ALIGNMENT);
      searchResultsList.add(row);
      searchResultsList.add(javax.swing.Box.createVerticalStrut(4));
    }
    searchResultsList.revalidate(); searchResultsList.repaint();
  }
  /** Best local file match for a resolved (title, artist) pair, filename-based — same word-overlap idea as spotifyResultLooksRelevant(), since a library file is very unlikely to be named with a song's title words by pure coincidence. Requires a real majority overlap (not just a stray shared word) before accepting a match, and returns null rather than guessing when nothing clears that bar. */
  private File findLocalMatch(String title, String artist) {
    String query = title + (artist != null && !artist.isEmpty() ? " " + artist : "");
    File best = null; double bestScore = 0;
    for (File f : searchIndex) {
      String name = f.getName();
      int dot = name.lastIndexOf('.');
      String withoutExt = dot > 0 ? name.substring(0, dot) : name;
      double score = wordOverlapRatio(query, withoutExt);
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return bestScore >= 0.5 ? best : null;
  }
  /** Shown in place of the results list when a playlist link is pasted but the user has never signed in to Spotify — the ONLY thing this app-level Client ID/Secret can't do on its own (see startSpotifySignIn's note on why). Retries the same import automatically once sign-in succeeds. */
  private void promptSpotifySignIn(String pendingUrl) {
    searchStatusLabel.setText("CONNECT SPOTIFY TO IMPORT PLAYLISTS");
    searchResultsList.removeAll();
    JLabel explain = label("Reading a playlist's songs needs you signed in to Spotify — a single track link doesn't.", 10, MUTED);
    explain.setAlignmentX(Component.LEFT_ALIGNMENT);
    searchResultsList.add(explain);
    searchResultsList.add(javax.swing.Box.createVerticalStrut(8));
    JButton connect = textButton("CONNECT SPOTIFY ACCOUNT");
    connect.setAlignmentX(Component.LEFT_ALIGNMENT);
    connect.addActionListener(e -> {
      connect.setEnabled(false);
      searchStatusLabel.setText("OPENING SPOTIFY LOGIN IN YOUR BROWSER…");
      startSpotifySignIn(result -> {
        searchStatusLabel.setText(result);
        if ("SPOTIFY CONNECTED".equals(result)) { lastImportedSpotifyUrl = null; importSpotifyLink(pendingUrl, true); }
        else connect.setEnabled(true);
      });
    });
    searchResultsList.add(connect);
    searchResultsList.revalidate(); searchResultsList.repaint();
  }
  private static String extractSpotifyId(Pattern pattern, String url) {
    Matcher m = pattern.matcher(url);
    if (!m.find()) return null;
    return m.group(1) != null ? m.group(1) : m.group(2);
  }
  /** Plays a track picked from search results immediately. Re-checks the file still exists first, since the index can outlive a file that's moved/been deleted mid-session. */
  private void playFromSearch(File file) {
    if (!appendAndPlay(file)) { status.setText("●  FILE NO LONGER FOUND"); startLibraryScan(); refreshSearchResults(); return; }
    closeSearch();
  }
  /**
   * Restyles whichever line covers the player's current position and scrolls it into view — called after every
   * open/rebuild (once bounds are valid, so the scroll math is correct) and on every tick/seek while the panel is
   * open. A cheap linear scan: real lyrics files are at most a few hundred lines, and this only runs while the
   * lyrics panel is actually visible.
   */
  private void updateLyricsSync() {
    if (lyricsLineLabels == null || lyricsLineLabels.isEmpty() || player == null) return;
    long position = player.getMicrosecondPosition();
    int index = -1;
    for (int i = 0; i < currentLyricLines.size(); i++) {
      if (currentLyricLines.get(i).micros <= position) index = i; else break;
    }
    if (index == lyricsHighlightIndex) return;
    if (lyricsHighlightIndex >= 0 && lyricsHighlightIndex < lyricsLineLabels.size()) {
      JLabel old = lyricsLineLabels.get(lyricsHighlightIndex);
      old.setForeground(MUTED); old.setFont(new Font("SansSerif", Font.PLAIN, 13));
    }
    lyricsHighlightIndex = index;
    if (index >= 0) {
      JLabel current = lyricsLineLabels.get(index);
      current.setForeground(ACCENT); current.setFont(new Font("SansSerif", Font.BOLD, 14));
      if (lyricsScrollPane != null) {
        java.awt.Rectangle bounds = current.getBounds();
        int targetY = Math.max(0, bounds.y - lyricsScrollPane.getViewport().getExtentSize().height / 2 + bounds.height / 2);
        lyricsScrollPane.getVerticalScrollBar().setValue(targetY);
      }
    }
  }
  /**
   * Strips LRC-style furniture for display only — currentLyrics itself stays exactly as extracted. Leading
   * [mm:ss.xx] timing markers and [ti:]/[ar:]/[al:]/[by:]/etc. header lines are extremely common in lyrics pulled
   * from LRC files (every real-world example seen while building this was tagged that way) and aren't something
   * anyone wants to read line by line; anything that isn't in one of those two specific forms is left untouched,
   * so plain, non-LRC lyrics text just passes through as-is.
   */
  private static String formatLyricsForDisplay(String raw) {
    StringBuilder out = new StringBuilder();
    for (String line : raw.split("\\R", -1)) {
      String stripped = line.replaceFirst("^\\[\\d{1,2}:\\d{2}(?:\\.\\d{1,3})?\\]\\s*", "");
      if (stripped.matches("^\\[(ti|ar|al|by|offset|length|re|ve):[^\\]]*\\]\\s*$")) continue;
      out.append(stripped).append('\n');
    }
    return out.toString().trim();
  }

  private void applyThemeColors() {
    status.setForeground(ACCENT); track.setForeground(TEXT); artistLabel.setForeground(ACCENT2); source.setForeground(MUTED); cdViewTrackLabel.setForeground(TEXT); cdViewArtistLabel.setForeground(ACCENT2);
    elapsed.setForeground(MUTED); length.setForeground(MUTED); queueInfo.setForeground(MUTED); queueNext.setForeground(MUTED);
    nowPlayingLabel.setForeground(ACCENT2); crossfadeTitle.setForeground(MUTED); crossfadeValueLabel.setForeground(MUTED);
    volumeTitle.setForeground(MUTED); volumeValueLabel.setForeground(MUTED);
    miniTrackLabel.setForeground(TEXT); miniArtistLabel.setForeground(MUTED); miniElapsed.setForeground(MUTED); miniLength.setForeground(MUTED);
    if (miniPanel != null) { miniPanel.setBackground(BG); miniPanel.repaint(); } // built lazily — see setMiniModeEnabled()
  }

  private static Color lerp(Color a, Color b, float t) {
    int r = Math.round(a.getRed() + (b.getRed() - a.getRed()) * t);
    int g = Math.round(a.getGreen() + (b.getGreen() - a.getGreen()) * t);
    int bl = Math.round(a.getBlue() + (b.getBlue() - a.getBlue()) * t);
    return new Color(r, g, bl);
  }

  /**
   * Builds the window content as a single tree (the original structure), wrapped in a thin OverlayLayout stack
   * so the Settings overlay (see showSettingsDialog) can still be added on top of it later. themeOverlay is
   * installed separately as the root pane's glass pane — NOT as a sibling layer in this stack.
   *
   * An earlier version tried making the disc render above the theme's animated particles by restructuring this
   * into "foreground (disc/text/buttons) > themeOverlay (particles) > background" as three OverlayLayout
   * siblings, reasoning that paint order alone would keep the disc on top cheaply. It didn't: only the glass
   * pane gets Swing's special independent-compositing treatment (JRootPane paints it as a genuinely separate
   * step). Regular sibling components don't — repainting one forces every overlapping sibling in the same
   * container to repaint too, so themeOverlay's continuous ~28fps particle animation started forcing a full
   * repaint of the entire foreground subtree (every label, button, slider, the queue list) on every tick, which
   * scales with window size just like the disc-bounds bug (worse than it was before at a fullscreen resolution,
   * per direct measurement). themeOverlay is back to being the glass pane; see ThemeOverlay's disc-exclusion
   * clip below for how it still avoids painting over the disc without that cost.
   */
  private JPanel createContent() {
    JPanel root = new BrushedMetalPanel();
    root.setBorder(BorderFactory.createEmptyBorder(32, 64, 28, 64));
    JPanel headerBlock = new JPanel(new BorderLayout()); headerBlock.setOpaque(false);
    headerPanel = header();
    headerBlock.add(headerPanel, BorderLayout.NORTH); headerBlock.add(new BarbedDivider(), BorderLayout.SOUTH); // headerBlock itself always stays visible so the divider (kept visible in CD view) still renders — only headerPanel toggles
    root.add(headerBlock, BorderLayout.NORTH);
    bodyPanel = new JPanel(new GridBagLayout()); JPanel body = bodyPanel; body.setOpaque(false);
    GridBagConstraints constraints = new GridBagConstraints();
    constraints.gridy = 0; constraints.weighty = 1;
    // BOTH on discColumn (a plain wrapper, not disc itself) so it stretches to fill its cell — GridBagLayout's
    // fill=NONE turned out to have its own, worse bug: measured it collapsing a fill=NONE component all the way
    // down to its *minimum* size (not preferred) whenever the row's available height came in even slightly under
    // the component's preferred height, which the enlarged 760px CD-view disc hits at ordinary window sizes
    // (confirmed directly — a bare 760px-preferred child in a 992x746 GridBagLayout cell landed at 10x10, its
    // Swing-default minimum, despite ample width). Capping disc's own actual size is left to BoxLayout instead:
    // disc keeps its maximumSize (set in DiscView.setEnlarged), and BoxLayout — unlike GridBagLayout — reliably
    // honors a child's maximumSize, which is exactly why fill=BOTH was avoided *directly on disc* in the first
    // place (see DiscView's own maximumSize comment: GridBagLayout ignored it and let the disc's spinning-timer
    // repaint cost balloon at 5K fullscreen). Glue above/below inside discColumn does the vertical centering
    // fill=BOTH would otherwise skip, since BoxLayout doesn't center children along its own axis on its own.
    constraints.fill = GridBagConstraints.BOTH;
    discColumn = new JPanel(); discColumn.setOpaque(false); discColumn.setLayout(new javax.swing.BoxLayout(discColumn, javax.swing.BoxLayout.Y_AXIS));
    disc.setAlignmentX(Component.CENTER_ALIGNMENT);
    discColumn.add(javax.swing.Box.createVerticalGlue());
    discColumn.add(disc);
    discColumn.add(javax.swing.Box.createVerticalGlue());
    constraints.gridx = 0; constraints.weightx = 1; constraints.insets = new Insets(10, 0, 10, 44); body.add(discColumn, constraints);
    // With fill=BOTH directly on playerPanel(), it stretched to the full window width on anything wider than the
    // ~1120px default, dragging every row's centered content (and the trailing LOAD A TRACK / CLEAR QUEUE column)
    // far from the disc and opening up a large, obviously empty gap on the left of the transport controls.
    // fill=VERTICAL alone doesn't fix this either — measured GridBagLayout still not honoring the component's own
    // preferred width even then (590px preferred, squeezed down to 484px actual in a 1120px window, clipping the
    // transport row's rightmost buttons). Wrapping in BorderLayout.WEST sidesteps GridBagLayout's fill/weightx
    // sizing entirely: the wrapper still stretches BOTH to fill the cell (simple, predictable), but WEST always
    // gives its child its own true preferred size and anchors it top-left, leaving any extra stretched space as
    // plain empty margin in the wrapper's unused CENTER — exactly where extra width on a wide window should go.
    playerPanelWrap = new JPanel(new BorderLayout()); playerPanelWrap.setOpaque(false);
    playerPanelWrap.add(playerPanel(), BorderLayout.WEST);
    constraints.fill = GridBagConstraints.BOTH;
    constraints.gridx = 1; constraints.weightx = 1.05; constraints.insets = new Insets(36, 0, 20, 0);
    playerPanelWrapConstraints = (GridBagConstraints) constraints.clone();
    body.add(playerPanelWrap, constraints);
    root.add(body, BorderLayout.CENTER);
    hintLabel = label("DROP WAV · AIFF · AU · FLAC · M4A · MP3 — SPACE/K PLAY · J/L PREV/NEXT · ←/→ SKIP 15S · C CD VIEW · M MINI MODE · F FULLSCREEN · ESC EXIT", 10, new Color(120, 122, 126));
    hintLabel.setHorizontalAlignment(SwingConstants.CENTER); hintLabel.setBorder(BorderFactory.createEmptyBorder(18, 0, 0, 0));
    // Song name + author, centered at the bottom of the window in CD view — a footer, not tucked under the disc,
    // so it stays legible regardless of the disc's own size. Shares hintLabel's SOUTH slot: only one of the two
    // is ever visible at a time (see applyCdViewState()), and BoxLayout skips invisible children, so the
    // wrapper's own height shrinks to whichever one is currently showing instead of reserving room for both.
    cdViewInfoPanel = new JPanel(); cdViewInfoPanel.setOpaque(false); cdViewInfoPanel.setLayout(new javax.swing.BoxLayout(cdViewInfoPanel, javax.swing.BoxLayout.Y_AXIS));
    cdViewInfoPanel.setBorder(BorderFactory.createEmptyBorder(0, 0, 6, 0));
    cdViewTrackLabel.setHorizontalAlignment(SwingConstants.CENTER); cdViewTrackLabel.setAlignmentX(Component.CENTER_ALIGNMENT);
    cdViewArtistLabel.setHorizontalAlignment(SwingConstants.CENTER); cdViewArtistLabel.setAlignmentX(Component.CENTER_ALIGNMENT); cdViewArtistLabel.setVisible(false);
    cdViewInfoPanel.add(cdViewTrackLabel); cdViewInfoPanel.add(javax.swing.Box.createVerticalStrut(4)); cdViewInfoPanel.add(cdViewArtistLabel);
    cdViewInfoPanel.setVisible(false);
    JPanel southBlock = new JPanel(); southBlock.setOpaque(false); southBlock.setLayout(new javax.swing.BoxLayout(southBlock, javax.swing.BoxLayout.Y_AXIS));
    southBlock.add(hintLabel); southBlock.add(cdViewInfoPanel);
    root.add(southBlock, BorderLayout.SOUTH);

    // isOptimizedDrawingEnabled must return false: JComponent defaults to true, which tells Swing's repaint
    // machinery "children never overlap" so an incremental repaint (the seek bar ticking, the disc spinning)
    // only repaints through a single layer instead of every child under the dirty rectangle. With that default,
    // once settingsOverlay is added on top of root, ordinary repaints of things below it (seek bar, disc) stop
    // reaching the card, leaving stale pixels bleeding through it. Full-tree paint() calls (used for off-screen
    // verification) always repaint everything regardless, which is why this didn't show up until real usage.
    contentStack = new JPanel() {
      public boolean isOptimizedDrawingEnabled() { return false; }
    };
    contentStack.setOpaque(false);
    contentStack.setLayout(new javax.swing.OverlayLayout(contentStack));
    contentStack.add(root); // settingsOverlay is added on top of this later, lazily, in showSettingsDialog()
    return contentStack;
  }

  private JPanel header() {
    // OverlayLayout, not BorderLayout: with a plain BorderLayout, CENTER only gets the space left over after
    // EAST claims its own width, so a FlowLayout.CENTER pill inside it lands centered on that leftover region —
    // biased noticeably left of the bar's true midpoint by roughly half the east button cluster's width, not
    // actually centered on the window. Overlaying two independent full-bar-width layers instead — one centering
    // the pill against the WHOLE bar, one right-anchoring the buttons against the WHOLE bar — centers the pill
    // for real, regardless of how wide the button cluster happens to be.
    JPanel bar = new JPanel() {
      // Same reasoning as contentStack's override elsewhere in this file: the two layers below now genuinely
      // overlap (both stretched to the bar's full bounds), so the default "children never overlap" repaint
      // optimization would risk stale pixels wherever the transparent parts of one layer sit on top of the other.
      public boolean isOptimizedDrawingEnabled() { return false; }
    };
    bar.setOpaque(false); bar.setPreferredSize(new Dimension(0, 56));
    bar.setLayout(new javax.swing.OverlayLayout(bar));
    JPanel statusPill = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 0, 0)) {
      protected void paintComponent(Graphics raw) { Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON); g.setColor(new Color(0,0,0,90)); g.fillRoundRect(0, 0, getWidth(), getHeight(), 4, 4); g.setColor(new Color(255,255,255,30)); g.setStroke(new BasicStroke(1)); g.drawRoundRect(0, 0, getWidth()-1, getHeight()-1, 4, 4); g.dispose(); super.paintComponent(raw); }
    };
    statusPill.setOpaque(false); statusPill.setBorder(BorderFactory.createEmptyBorder(6, 16, 6, 16)); statusPill.add(status);
    JPanel center = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 0, 0)); center.setOpaque(false); center.add(statusPill);
    center.setAlignmentX(Component.CENTER_ALIGNMENT); center.setAlignmentY(Component.CENTER_ALIGNMENT);
    center.setMaximumSize(new Dimension(Short.MAX_VALUE, Short.MAX_VALUE)); // stretch to the bar's full actual width under OverlayLayout — see the method-level comment above
    settingsButton.addActionListener(e -> showSettingsDialog());
    sleepTimerIndicator.setFont(new Font("SansSerif", Font.BOLD, 10));
    sleepTimerIndicator.setToolTipText("Click to cancel the sleep timer");
    sleepTimerIndicator.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
    // header() only ever runs once (called from createContent(), itself a one-time constructor call), unlike
    // buildSettingsPanel() which rebuilds every open — safe to wire directly here without risking a duplicate.
    sleepTimerIndicator.addMouseListener(new java.awt.event.MouseAdapter() {
      public void mouseClicked(java.awt.event.MouseEvent e) { armSleepTimer(0); sleepTimerSlider.setValue(0); }
    });
    historyButton.addActionListener(e -> showHistory());
    cdViewButton.setToolTipText("Distraction-free view: just the disc");
    cdViewButton.addActionListener(e -> toggleCdView());
    JPanel east = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 8, 0)); east.setOpaque(false); east.add(sleepTimerIndicator); east.add(historyButton); east.add(cdViewButton); east.add(settingsButton);
    JPanel eastLayer = new JPanel(new BorderLayout()); eastLayer.setOpaque(false); eastLayer.add(east, BorderLayout.EAST);
    eastLayer.setAlignmentX(Component.CENTER_ALIGNMENT); eastLayer.setAlignmentY(Component.CENTER_ALIGNMENT);
    eastLayer.setMaximumSize(new Dimension(Short.MAX_VALUE, Short.MAX_VALUE));
    bar.add(eastLayer); bar.add(center); // both stretch to fill the whole bar (see maximumSize above) — order doesn't affect the (non-overlapping, in practice) content, only which layer would win a click in the sliver where they could theoretically touch
    return bar;
  }

  private JPanel playerPanel() {
    JPanel panel = new JPanel(); panel.setOpaque(false); panel.setLayout(new javax.swing.BoxLayout(panel, javax.swing.BoxLayout.Y_AXIS));
    JPanel nowRow = new JPanel(); nowRow.setOpaque(false); nowRow.setAlignmentX(Component.LEFT_ALIGNMENT); nowRow.setLayout(new javax.swing.BoxLayout(nowRow, javax.swing.BoxLayout.X_AXIS));
    JLabel now = nowPlayingLabel; now.setText("NOW PLAYING"); now.setForeground(ACCENT2); now.setFont(new Font("SansSerif", Font.BOLD, 11)); nowRow.add(now); nowRow.add(javax.swing.Box.createHorizontalStrut(12)); nowRow.add(visualizer);
    nowRow.add(javax.swing.Box.createHorizontalGlue());
    lyricsButton.setVisible(false); // shown only once a loaded track actually has lyrics — see load()
    nowRow.add(lyricsButton);
    panel.add(nowRow);
    panel.add(javax.swing.Box.createVerticalStrut(14));
    track.setForeground(TEXT); track.setFont(new Font("SansSerif", Font.BOLD, 34)); track.setAlignmentX(Component.LEFT_ALIGNMENT); track.setPreferredSize(new Dimension(460, 44)); track.setMaximumSize(new Dimension(460, 44)); track.setMinimumSize(new Dimension(460, 44)); panel.add(track);
    panel.add(javax.swing.Box.createVerticalStrut(4)); artistLabel.setForeground(ACCENT2); artistLabel.setFont(new Font("SansSerif", Font.PLAIN, 15)); artistLabel.setAlignmentX(Component.LEFT_ALIGNMENT); artistLabel.setPreferredSize(new Dimension(460, 20)); artistLabel.setMaximumSize(new Dimension(460, 20)); artistLabel.setMinimumSize(new Dimension(460, 20)); artistLabel.setVisible(false); panel.add(artistLabel);
    panel.add(javax.swing.Box.createVerticalStrut(6)); source.setAlignmentX(Component.LEFT_ALIGNMENT); source.setFont(new Font("SansSerif", Font.PLAIN, 12)); source.setPreferredSize(new Dimension(460, 16)); source.setMaximumSize(new Dimension(460, 16)); source.setMinimumSize(new Dimension(460, 16)); panel.add(source);
    panel.add(javax.swing.Box.createVerticalStrut(38));
    progress.setOpaque(false); waveformSliderUI = new WaveformSliderUI(progress); progress.setUI(waveformSliderUI); progress.setAlignmentX(Component.LEFT_ALIGNMENT); progress.setMaximumSize(new Dimension(Integer.MAX_VALUE, 20)); progress.setFocusable(false);
    progress.addChangeListener(e -> { if (player != null && progress.getValueIsAdjusting()) adjusting = true; else if (player != null && adjusting) { player.setMicrosecondPosition((long) (player.getMicrosecondLength() * progress.getValue() / 1000.0)); adjusting = false; if (lyricsOverlay != null && lyricsOverlay.isVisible()) updateLyricsSync(); } });
    panel.add(progress);
    JPanel times = new JPanel(new BorderLayout()); times.setOpaque(false); times.setMaximumSize(new Dimension(Integer.MAX_VALUE, 16)); elapsed.setFont(new Font("SansSerif", Font.PLAIN, 11)); length.setFont(new Font("SansSerif", Font.PLAIN, 11)); times.add(elapsed, BorderLayout.WEST); times.add(length, BorderLayout.EAST); panel.add(times);
    panel.add(javax.swing.Box.createVerticalStrut(28));
    JPanel transportCluster = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 0, 0)); transportCluster.setOpaque(false);
    JButton skipBack = roundButton(Glyph.SKIP_BACK_15, 36, false); skipBack.setToolTipText("Back 15 seconds"); skipBack.addActionListener(e -> seek(-15)); transportCluster.add(skipBack); transportCluster.add(javax.swing.Box.createHorizontalStrut(10));
    JButton back = roundButton(Glyph.PREVIOUS_TRACK, 44, false); back.setToolTipText("Previous track"); back.addActionListener(e -> previousTrack()); transportCluster.add(back); transportCluster.add(javax.swing.Box.createHorizontalStrut(16));
    play.addActionListener(e -> toggle()); transportCluster.add(play); transportCluster.add(javax.swing.Box.createHorizontalStrut(16));
    JButton forward = roundButton(Glyph.NEXT_TRACK, 44, false); forward.setToolTipText("Next track"); forward.addActionListener(e -> nextTrack()); transportCluster.add(forward); transportCluster.add(javax.swing.Box.createHorizontalStrut(10));
    JButton skipForward = roundButton(Glyph.SKIP_FORWARD_15, 36, false); skipForward.setToolTipText("Forward 15 seconds"); skipForward.addActionListener(e -> seek(15)); transportCluster.add(skipForward);
    JButton load = textButton("LOAD A TRACK  +"); load.addActionListener(e -> choose());
    // Playlist save/load (.m3u) — playerPanel() only ever runs once (unlike buildSettingsPanel(), which rebuilds
    // on every open), so these can just be local variables here with no listener-stacking guard needed.
    JButton savePlaylistButton = textButton("SAVE"); savePlaylistButton.setToolTipText("Save the current queue as a .m3u playlist file");
    savePlaylistButton.addActionListener(e -> savePlaylist());
    JButton loadPlaylistButton = textButton("LOAD"); loadPlaylistButton.setToolTipText("Add every track from a .m3u playlist file to the queue");
    loadPlaylistButton.addActionListener(e -> loadPlaylist());
    JButton searchButton = textButton("SEARCH"); searchButton.setToolTipText("Search your music folder, or paste a Spotify track/playlist link");
    searchButton.addActionListener(e -> showSearch());
    // Names the SAVE/LOAD pair so it doesn't read as two stray, unexplained buttons.
    JLabel playlistLabel = label("PLAYLIST", 9, MUTED);
    // Both trailing columns (load button / clear queue) reserve the same width, and that same width is mirrored
    // as an invisible column on the LEFT of the transport/shuffle rows too — so the transport cluster and the
    // shuffle/repeat cluster below are genuinely centered in the row's full width (flanked symmetrically), not
    // just centered in whatever space happens to be left over after a lopsided trailing column.
    // The +6 covers FlowLayout.RIGHT's own hgap accounting: it reserves hgap as trailing padding even for a
    // single component, so without this the wrap panel was exactly as wide as the button itself with no room
    // for that padding, pushing the button to a negative x — its left few pixels were then clipped by the
    // panel's own bounds instead of just rendering flush against the right edge.
    int trailingWidth = Math.max(load.getPreferredSize().width, clearQueueButton.getPreferredSize().width) + 6;
    // BoxLayout + glue, not BorderLayout's WEST/CENTER/EAST: BorderLayout's CENTER only ever gets whatever width
    // is left after WEST/EAST, and if the surrounding BoxLayout chain hands this row even a few px less than its
    // own reported preferred width (measured happening — a few px lost to layout rounding several containers up),
    // that shortfall lands entirely on CENTER, and FlowLayout.CENTER doesn't degrade gracefully when squeezed —
    // it silently wraps the rightmost button onto an invisible second row instead of just tightening up. Glue on
    // both sides of transportCluster (capped at its own preferred size so it can't be handed extra room either)
    // absorbs any slack or shortfall instead, so transportCluster always renders at exactly its natural size.
    transportCluster.setMaximumSize(transportCluster.getPreferredSize());
    JPanel controls = new JPanel(); controls.setLayout(new javax.swing.BoxLayout(controls, javax.swing.BoxLayout.X_AXIS));
    controls.setOpaque(false); controls.setAlignmentX(Component.LEFT_ALIGNMENT);
    controls.setMaximumSize(new Dimension(Integer.MAX_VALUE, 68));
    controls.add(javax.swing.Box.createHorizontalStrut(trailingWidth)); // mirrors loadWrap's width so transportCluster centers on the same axis loadWrap is anchored to, not the raw row width
    controls.add(javax.swing.Box.createHorizontalGlue());
    controls.add(transportCluster);
    controls.add(javax.swing.Box.createHorizontalGlue());
    controls.add(javax.swing.Box.createHorizontalStrut(24)); // a real minimum gap, not just glue — at the default window width both glues above shrink to 0 with nothing left over, otherwise leaving Load a Track flush against the transport buttons
    JPanel loadWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 6, 0)); loadWrap.setOpaque(false);
    // Height left free (not pinned to load's own preferred height) and centered via the default alignmentY, so it
    // sits vertically centered against transportCluster's taller round buttons instead of being squashed to fit.
    loadWrap.setPreferredSize(new Dimension(trailingWidth, load.getPreferredSize().height));
    loadWrap.setMaximumSize(new Dimension(trailingWidth, Integer.MAX_VALUE));
    loadWrap.add(load);
    controls.add(loadWrap);
    panel.add(controls);
    panel.add(javax.swing.Box.createVerticalStrut(10));
    // Playlist/search cluster gets its own row directly under the transport controls, instead of crowding that
    // row — it was wrapping to two lines once this cluster grew past a few buttons. Left-aligned, starting at
    // the same x as the transport cluster's own left edge (the matching leading strut below), not right-aligned
    // under Load a Track — reads as grouped with the controls above it rather than orphaned under the far-right
    // Load a Track button.
    JPanel playlistRow = new JPanel(); playlistRow.setLayout(new javax.swing.BoxLayout(playlistRow, javax.swing.BoxLayout.X_AXIS));
    playlistRow.setOpaque(false); playlistRow.setAlignmentX(Component.LEFT_ALIGNMENT);
    playlistRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));
    JPanel playlistWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.LEFT, 6, 0)); playlistWrap.setOpaque(false);
    playlistWrap.add(playlistLabel); playlistWrap.add(savePlaylistButton); playlistWrap.add(loadPlaylistButton); playlistWrap.add(searchButton);
    playlistRow.add(javax.swing.Box.createHorizontalStrut(trailingWidth));
    playlistRow.add(playlistWrap);
    playlistRow.add(javax.swing.Box.createHorizontalGlue());
    panel.add(playlistRow);
    panel.add(javax.swing.Box.createVerticalStrut(16));
    JPanel modesCluster = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 0, 0)); modesCluster.setOpaque(false);
    shuffleButton.addActionListener(e -> { shuffle = !shuffle; shuffleButton.setOn(shuffle); shuffleNextCacheIndex = Integer.MIN_VALUE; updateQueueUI(); }); modesCluster.add(shuffleButton); modesCluster.add(javax.swing.Box.createHorizontalStrut(20));
    // Cycles OFF -> ONE -> ALL -> OFF. setOn() (the button's existing binary gradient fill) tracks "not OFF", and
    // a small "1" badge distinguishes ONE from ALL without needing a whole second visual state in the button.
    repeatButton.addActionListener(e -> {
      repeatMode = repeatMode == RepeatMode.OFF ? RepeatMode.ONE : repeatMode == RepeatMode.ONE ? RepeatMode.ALL : RepeatMode.OFF;
      repeatButton.setOn(repeatMode != RepeatMode.OFF);
      repeatButton.setBadge(repeatMode == RepeatMode.ONE ? "1" : null);
      repeatButton.setToolTipText(repeatMode == RepeatMode.OFF ? "Repeat" : repeatMode == RepeatMode.ONE ? "Repeat: one track" : "Repeat: whole queue");
      updateQueueUI();
    });
    modesCluster.add(repeatButton);
    clearQueueButton.addActionListener(e -> clearQueue());
    // Same BoxLayout + glue construction as controls above, and the same reasoning: modesCluster capped at its
    // own preferred size so it can't be handed extra room, leaving glue to absorb any slack or shortfall instead
    // of BorderLayout's CENTER silently squeezing modesCluster's FlowLayout into wrapping.
    modesCluster.setMaximumSize(modesCluster.getPreferredSize());
    JPanel modes = new JPanel(); modes.setLayout(new javax.swing.BoxLayout(modes, javax.swing.BoxLayout.X_AXIS));
    modes.setOpaque(false); modes.setAlignmentX(Component.LEFT_ALIGNMENT);
    modes.setMaximumSize(new Dimension(Integer.MAX_VALUE, 40)); // see controls' setMaximumSize above
    modes.add(javax.swing.Box.createHorizontalStrut(trailingWidth));
    modes.add(javax.swing.Box.createHorizontalGlue());
    modes.add(modesCluster);
    modes.add(javax.swing.Box.createHorizontalGlue());
    // hgap must match loadWrap's (6, not 0) — FlowLayout reserves hgap as trailing padding even for a single
    // component, so a mismatched hgap here was leaving CLEAR QUEUE's right edge a few px off from LOAD A TRACK's,
    // even though both wraps are given the exact same trailingWidth.
    JPanel clearWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 6, 0)); clearWrap.setOpaque(false);
    clearWrap.setPreferredSize(new Dimension(trailingWidth, clearQueueButton.getPreferredSize().height));
    clearWrap.setMaximumSize(new Dimension(trailingWidth, Integer.MAX_VALUE));
    clearWrap.add(clearQueueButton);
    modes.add(clearWrap);
    panel.add(modes);
    panel.add(javax.swing.Box.createVerticalStrut(18));
    // Crossfade now lives in the Settings dialog (see buildSettingsPanel) — it's a set-once preference, not
    // something adjusted every session, so it doesn't need permanent real estate on the main screen.
    JPanel volumeRow = new JPanel(); volumeRow.setOpaque(false); volumeRow.setAlignmentX(Component.LEFT_ALIGNMENT); volumeRow.setLayout(new javax.swing.BoxLayout(volumeRow, javax.swing.BoxLayout.X_AXIS));
    volumeTitle.setFont(new Font("SansSerif", Font.BOLD, 10)); volumeTitle.setForeground(MUTED);
    volumeSlider.setOpaque(false); volumeSlider.setUI(new AccentSliderUI(volumeSlider)); volumeSlider.setFocusable(false);
    volumeSlider.setPreferredSize(new Dimension(120, 20)); volumeSlider.setMaximumSize(new Dimension(120, 20));
    volumeValueLabel.setFont(new Font("SansSerif", Font.BOLD, 10)); volumeValueLabel.setForeground(MUTED); volumeValueLabel.setPreferredSize(new Dimension(36, 16));
    volumeSlider.addChangeListener(e -> {
      int v = volumeSlider.getValue();
      volume = v / 100f;
      volumeValueLabel.setText(v + "%");
      // While a crossfade is actively running, its own timer recomputes both players' gain from the live volume
      // field every tick, so it self-corrects on its own. Only apply directly when nothing else is driving gain.
      // Gain is applied per-chunk on the pump thread (see StreamPlayer), so this takes effect within ~20ms.
      if (player != null && !crossfading) player.setGain(volume);
    });
    volumeSlider.setToolTipText("Playback volume");
    volumeRow.add(volumeTitle); volumeRow.add(javax.swing.Box.createHorizontalStrut(10)); volumeRow.add(volumeSlider); volumeRow.add(javax.swing.Box.createHorizontalStrut(8)); volumeRow.add(volumeValueLabel); volumeRow.add(javax.swing.Box.createHorizontalGlue());
    panel.add(volumeRow);
    panel.add(javax.swing.Box.createVerticalStrut(22));
    JPanel queueCard = new JPanel(); queueCard.setOpaque(false); queueCard.setAlignmentX(Component.LEFT_ALIGNMENT); queueCard.setLayout(new javax.swing.BoxLayout(queueCard, javax.swing.BoxLayout.Y_AXIS)); queueCard.setBorder(BorderFactory.createMatteBorder(1, 0, 0, 0, new Color(255, 255, 255, 22)));
    queueInfo.setAlignmentX(Component.LEFT_ALIGNMENT); queueNext.setAlignmentX(Component.LEFT_ALIGNMENT); queueCard.add(javax.swing.Box.createVerticalStrut(9)); queueCard.add(queueInfo); queueCard.add(javax.swing.Box.createVerticalStrut(5)); queueCard.add(queueNext);
    // prepare the queue list container (scrollable)
    queueList.setOpaque(false); queueList.setLayout(new javax.swing.BoxLayout(queueList, javax.swing.BoxLayout.Y_AXIS));
    JScrollPane queueScroll = new JScrollPane(queueList); queueScroll.setOpaque(false); queueScroll.getViewport().setOpaque(false); queueScroll.setBorder(null); queueScroll.setAlignmentX(Component.LEFT_ALIGNMENT);
    // Only a maximumSize was set here before, with no floor — under vertical space pressure BoxLayout is free to
    // shrink this toward the look-and-feel's own tiny computed minimum for an empty scroll pane (the same failure
    // mode the transport buttons had). Locking a minimum height keeps a few queue rows visible no matter what.
    queueScroll.setMinimumSize(new Dimension(1, 90));
    queueScroll.setPreferredSize(new Dimension(1, 150));
    queueScroll.setMaximumSize(new Dimension(Integer.MAX_VALUE, 150));
    // queueList isn't a Scrollable, so the default per-notch unit increment is a sluggish 1px; scale it to roughly one row (18px row + 3px gap) per notch.
    queueScroll.getVerticalScrollBar().setUnitIncrement(21);
    queueScroll.getVerticalScrollBar().setBlockIncrement(126);
    queueScroll.getVerticalScrollBar().setUI(new GreyScrollBarUI());
    queueCard.add(javax.swing.Box.createVerticalStrut(8)); queueCard.add(queueScroll);
    panel.add(queueCard);
    return panel;
  }

  private void choose() {
    JFileChooser chooser = new JFileChooser();
    chooser.setMultiSelectionEnabled(true);
    chooser.setFileSelectionMode(JFileChooser.FILES_AND_DIRECTORIES);
    chooser.setFileFilter(new FileNameExtensionFilter("Audio files (WAV, AIFF, AU, FLAC, M4A, MP3)", "wav", "wave", "aif", "aiff", "au", "flac", "m4a", "mp3"));
    File lastDir = readLastPath();
    if (lastDir != null && lastDir.isDirectory()) chooser.setCurrentDirectory(lastDir);
    if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
      File[] selected = chooser.getSelectedFiles();
      if (selected.length == 0) selected = new File[] { chooser.getSelectedFile() };
      addToQueue(java.util.Arrays.asList(selected));
      saveLastPath(chooser.getCurrentDirectory()); // wherever the chooser was browsing when the user picked, not just the file's own folder
    }
  }
  /** Writes the current queue out as a standard .m3u (UTF-8, so #EXTM3U is implicitly the "extended" M3U8 dialect) — absolute paths, so the file stays valid regardless of where it's later opened from. */
  private void savePlaylist() {
    if (queue.isEmpty()) { status.setText("●  QUEUE IS EMPTY"); return; }
    JFileChooser chooser = new JFileChooser();
    chooser.setSelectedFile(new File("playlist.m3u"));
    File lastDir = readLastPath();
    if (lastDir != null && lastDir.isDirectory()) chooser.setCurrentDirectory(lastDir);
    if (chooser.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
    File target = chooser.getSelectedFile();
    if (!target.getName().toLowerCase().endsWith(".m3u") && !target.getName().toLowerCase().endsWith(".m3u8")) {
      target = new File(target.getParentFile(), target.getName() + ".m3u");
    }
    try (java.io.PrintWriter writer = new java.io.PrintWriter(new java.io.OutputStreamWriter(new java.io.FileOutputStream(target), StandardCharsets.UTF_8))) {
      writer.println("#EXTM3U");
      for (File f : queue) { writer.println("#EXTINF:-1," + queueDisplay(f)); writer.println(f.getAbsolutePath()); }
      status.setText("●  SAVED PLAYLIST · " + target.getName());
      saveLastPath(chooser.getCurrentDirectory());
    } catch (Exception ex) { status.setText("●  COULDN'T SAVE PLAYLIST"); }
  }
  /** Reads a .m3u/.m3u8 file and queues whatever tracks in it still exist and are playable — anything else (missing files, unsupported formats, blank lines, comments other than #EXTINF) is silently skipped rather than failing the whole load. A relative path in the file resolves against the playlist's own folder, matching how every other player treats them. */
  private void loadPlaylist() {
    JFileChooser chooser = new JFileChooser();
    chooser.setFileFilter(new FileNameExtensionFilter("Playlist (M3U)", "m3u", "m3u8"));
    File lastDir = readLastPath();
    if (lastDir != null && lastDir.isDirectory()) chooser.setCurrentDirectory(lastDir);
    if (chooser.showOpenDialog(this) != JFileChooser.APPROVE_OPTION) return;
    File source = chooser.getSelectedFile();
    List<File> tracks = new ArrayList<File>();
    try {
      for (String rawLine : java.nio.file.Files.readAllLines(source.toPath(), StandardCharsets.UTF_8)) {
        String line = rawLine.trim();
        if (line.isEmpty() || line.startsWith("#")) continue;
        File f = new File(line);
        if (!f.isAbsolute()) f = new File(source.getParentFile(), line);
        if (f.isFile() && isSupportedAudio(f)) tracks.add(f);
      }
    } catch (Exception ex) { status.setText("●  COULDN'T READ PLAYLIST"); return; }
    saveLastPath(chooser.getCurrentDirectory());
    if (tracks.isEmpty()) { status.setText("●  NO PLAYABLE TRACKS IN PLAYLIST"); return; }
    // Appends in file order rather than going through addToQueue() — that alphabetically re-sorts everything it
    // adds, which makes sense for a drag-and-dropped batch of files but would silently discard the whole point of
    // a playlist: the curated order it was saved in (very possibly built with the queue's own drag-to-reorder).
    queue.addAll(tracks);
    status.setText("●  LOADED PLAYLIST · " + tracks.size() + " TRACK" + (tracks.size() == 1 ? "" : "S"));
    updateQueueUI();
    if (queueIndex < 0) { queueIndex = 0; load(queue.get(queueIndex)); }
  }
  private static File readLastPath() {
    try {
      if (!LAST_PATH_FILE.isFile()) return null;
      String path = new String(java.nio.file.Files.readAllBytes(LAST_PATH_FILE.toPath()), StandardCharsets.UTF_8).trim();
      return path.isEmpty() ? null : new File(path);
    } catch (Exception ignored) { return null; }
  }
  private static void saveLastPath(File directory) {
    try {
      if (directory == null) return;
      File parent = LAST_PATH_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      java.nio.file.Files.write(LAST_PATH_FILE.toPath(), directory.getAbsolutePath().getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) { /* best-effort; worst case the chooser just opens to the default location next time */ }
  }
  private void addToQueue(List<File> dropped) {
    List<File> songs = new ArrayList<File>(); for (File item : dropped) collectAudio(item, songs); Collections.sort(songs, (left, right) -> left.getName().compareToIgnoreCase(right.getName()));
    if (songs.isEmpty()) { status.setText("●  NO SUPPORTED AUDIO FOUND"); return; }
    queue.addAll(songs); status.setText("●  ADDED " + songs.size() + " TO QUEUE"); updateQueueUI();
    if (queueIndex < 0) { queueIndex = 0; load(queue.get(queueIndex)); }
  }
  private void collectAudio(File item, List<File> songs) { if (item.isDirectory()) { File[] children = item.listFiles(); if (children != null) for (File child : children) collectAudio(child, songs); } else if (isSupportedAudio(item)) songs.add(item); }
  private static boolean isSupportedAudio(File item) { String type = extension(item); return "wav".equals(type) || "wave".equals(type) || "aif".equals(type) || "aiff".equals(type) || "au".equals(type) || "flac".equals(type) || "m4a".equals(type) || "mp3".equals(type); }
  private void updateQueueUI() {
    queueRows.clear(); hoveredQueueIndex = -1;
    clearQueueButton.setEnabled(!queue.isEmpty());
    if (queue.isEmpty() || queueIndex < 0) {
      queueInfo.setText("QUEUE EMPTY"); queueNext.setText("DROP SONGS OR A FOLDER TO BUILD A QUEUE");
      queueList.removeAll(); queueList.revalidate(); queueList.repaint();
      return;
    }
    queueInfo.setText("QUEUE " + (queueIndex + 1) + " / " + queue.size() + (shuffle ? " · SHUFFLED" : ""));
    // trackFinished() loops the current track whenever repeat-one is on, regardless of queue position — so that
    // (not whatever nextIndex() would return) is what actually plays next, and must take priority in this label.
    // Repeat-all wraps back to the front of the queue once nextIndex() runs out, same as trackFinished()/tick().
    int next = nextIndex();
    if (next < 0 && repeatMode == RepeatMode.ALL && !queue.isEmpty()) next = 0;
    queueNext.setText(repeatMode == RepeatMode.ONE ? "REPEATING THIS TRACK" : (next >= 0 && next != queueIndex ? "UP NEXT · " + queueDisplay(queue.get(next)) : "END OF QUEUE"));
    // rebuild the full queue list UI
    queueList.removeAll();
    for (int i = 0; i < queue.size(); i++) {
      File f = queue.get(i);
      int index = i;
      boolean active = i == queueIndex;
      JPanel row = new JPanel(new BorderLayout(8, 0)); row.setOpaque(false); row.setAlignmentX(Component.LEFT_ALIGNMENT); row.setMaximumSize(new Dimension(Integer.MAX_VALUE, 18));
      // A thin top/bottom rule while this exact row is mid-drag, so there's a clear cue for which one is moving
      // (the row itself can't visually "float" above its siblings the way a real drag-and-drop library would —
      // see the drag handlers below for why a live swap-as-you-cross-a-row-boundary approach was used instead).
      if (i == draggingIndex) row.setBorder(BorderFactory.createMatteBorder(1, 0, 1, 0, ACCENT));
      JLabel entry = label((i + 1) + ". " + escape(queueDisplay(f)), 10, active ? ACCENT : MUTED);
      if (active) entry.setFont(new Font("SansSerif", Font.BOLD, 10));
      JLabel durationLabel = label(formatDuration(getDuration(f)), 10, active ? ACCENT2 : MUTED);
      java.awt.CardLayout eastCards = new java.awt.CardLayout();
      JPanel eastPanel = new JPanel(eastCards); eastPanel.setOpaque(false);
      eastPanel.add(durationLabel, "duration");
      JButton closeButton = new JButton("×"); closeButton.setFont(new Font("SansSerif", Font.BOLD, 13)); closeButton.setForeground(MUTED);
      closeButton.setFocusPainted(false); closeButton.setBorderPainted(false); closeButton.setContentAreaFilled(false); closeButton.setOpaque(false);
      closeButton.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); closeButton.setMargin(new Insets(0, 6, 0, 0)); closeButton.setToolTipText("Remove from queue");
      closeButton.setFocusable(false);
      attachColorHover(closeButton, MUTED, TEXT);
      closeButton.addActionListener(e -> removeFromQueue(index));
      eastPanel.add(closeButton, "close");
      row.add(entry, BorderLayout.CENTER); row.add(eastPanel, BorderLayout.EAST);
      row.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); row.setToolTipText("Play " + queueDisplay(f));
      entry.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
      queueRows.add(new QueueRowUI(entry, eastCards, eastPanel, index));
      java.awt.event.MouseAdapter rowMouseHandler = new java.awt.event.MouseAdapter() {
        // Only plays the track if this press/release didn't turn into a drag — dragMoved is set the instant the
        // gesture crosses the swap threshold below, so a real reorder never also fires a play.
        public void mouseClicked(java.awt.event.MouseEvent e) { if (!dragMoved) { queueIndex = index; load(f); } }
        // draggingIndex (not the captured `index`) is the live position: once a swap rebuilds the list, this same
        // physical row component keeps receiving drag events (AWT grabs the mouse to whichever component received
        // the press, even after it's removed from its parent), but `index` is now stale — draggingIndex is kept
        // in sync with every swap in mouseDragged below instead.
        public void mousePressed(java.awt.event.MouseEvent e) {
          draggingIndex = index; dragLastScreenY = e.getYOnScreen(); dragAccumulatedY = 0; dragMoved = false;
        }
        // Only rebuilds (to clear the drag-highlight border) if a real drag actually happened — every swap during
        // a drag already rebuilds via updateQueueUI() in mouseDragged below, so this just clears that border for
        // the final position. Rebuilding on every plain click too (i.e. unconditionally) tore the row out from
        // under the real MOUSE_CLICKED event AWT synthesizes right after MOUSE_RELEASED, before it could still
        // land on this row the way mouseClicked below expects — clicking a track stopped starting playback.
        public void mouseReleased(java.awt.event.MouseEvent e) { draggingIndex = -1; if (dragMoved) updateQueueUI(); }
        // Swing's per-component enter/exit events aren't reliable when the cursor moves quickly between sibling
        // rows — a row can be "entered" without a matching "exited" ever reaching its previous neighbor, leaving
        // multiple rows stuck highlighted. Rebuilding every row's hover state from scratch on each entry is
        // self-healing: at most one row can ever end up highlighted, regardless of missed exit events.
        public void mouseEntered(java.awt.event.MouseEvent e) { setHoveredQueueRow(index); }
        // The row and its children (duration label / close button) each fire their own enter/exit pair as the
        // cursor crosses between them, so a naive mouseExited here would hide the button the instant the pointer
        // reaches it. getMousePosition() considers descendants, so this only fires once the pointer has actually
        // left the whole row.
        public void mouseExited(java.awt.event.MouseEvent e) {
          if (row.getMousePosition() != null) return;
          clearHoveredQueueRow(index);
        }
      };
      // Reorders by swapping with a neighbor every time the drag crosses one row's height, rebuilding the list
      // immediately for live feedback — simpler and more robust than a floating "ghost row" drag visual, and this
      // codebase has no drag-and-drop infrastructure elsewhere to build on.
      java.awt.event.MouseMotionAdapter rowDragHandler = new java.awt.event.MouseMotionAdapter() {
        public void mouseDragged(java.awt.event.MouseEvent e) {
          if (draggingIndex < 0) return;
          int nowY = e.getYOnScreen();
          dragAccumulatedY += nowY - dragLastScreenY;
          dragLastScreenY = nowY;
          int rowStep = 21; // 18px row height + 3px gap between rows, matching the layout above
          while (Math.abs(dragAccumulatedY) >= rowStep && queue.size() > 1) {
            int direction = dragAccumulatedY > 0 ? 1 : -1;
            int target = draggingIndex + direction;
            if (target < 0 || target >= queue.size()) break;
            dragMoved = true;
            java.util.Collections.swap(queue, draggingIndex, target);
            if (queueIndex == draggingIndex) queueIndex = target;
            else if (queueIndex == target) queueIndex = draggingIndex;
            draggingIndex = target;
            dragAccumulatedY -= direction * rowStep;
            updateQueueUI();
          }
        }
      };
      row.addMouseListener(rowMouseHandler);
      row.addMouseMotionListener(rowDragHandler);
      // Also on the label, not just the row: Swing delivers a click (or drag-start press) to the single deepest
      // component under the cursor and does NOT bubble it up automatically, so without this, clicking or starting
      // a drag directly on the track name (the label, which — via BorderLayout.CENTER — spans nearly the whole
      // row) would silently do nothing.
      entry.addMouseListener(rowMouseHandler);
      entry.addMouseMotionListener(rowDragHandler);
      queueList.add(row);
      if (i < queue.size() - 1) queueList.add(javax.swing.Box.createVerticalStrut(3));
    }
    queueList.revalidate(); queueList.repaint();
  }
  /** Highlights exactly one queue row and its remove button, forcing every other row back to its resting state. */
  private void setHoveredQueueRow(int index) {
    hoveredQueueIndex = index;
    for (QueueRowUI row : queueRows) {
      boolean hovered = row.index == index;
      boolean active = row.index == queueIndex;
      row.entry.setForeground(active ? ACCENT : (hovered ? TEXT : MUTED));
      row.cards.show(row.eastPanel, hovered ? "close" : "duration");
    }
  }
  private void clearHoveredQueueRow(int index) {
    if (hoveredQueueIndex != index) return;
    hoveredQueueIndex = -1;
    for (QueueRowUI row : queueRows) {
      if (row.index != index) continue;
      row.entry.setForeground(row.index == queueIndex ? ACCENT : MUTED);
      row.cards.show(row.eastPanel, "duration");
    }
  }
  /**
   * Which queue index plays after the current one. For shuffle, the random pick is cached (keyed on the current
   * queueIndex + queue size) rather than re-rolled on every call — otherwise the "UP NEXT" label shown by
   * updateQueueUI() and the track nextTrack()/tick() actually jump to would be two independent random draws,
   * so "up next" would routinely lie about what plays next. The cache naturally invalidates itself once the
   * queue actually advances (new queueIndex) or is mutated (new size), which is exactly when a fresh pick is due.
   */
  private int shuffleNextCacheIndex = Integer.MIN_VALUE, shuffleNextCacheSize = -1, shuffleNextCacheValue = -1;
  private int nextIndex() {
    if (queue.isEmpty()) return -1;
    if (shuffle && queue.size() > 1) {
      if (shuffleNextCacheIndex != queueIndex || shuffleNextCacheSize != queue.size()) {
        int next;
        do { next = ThreadLocalRandom.current().nextInt(queue.size()); } while (next == queueIndex);
        shuffleNextCacheIndex = queueIndex; shuffleNextCacheSize = queue.size(); shuffleNextCacheValue = next;
      }
      return shuffleNextCacheValue;
    }
    return queueIndex + 1 < queue.size() ? queueIndex + 1 : -1;
  }
  private static String displayName(File file) { return file.getName().replaceFirst("\\.[^.]+$", "").replace('_', ' ').replace('-', ' '); }

  private SongDetails getSongDetails(File file) {
    SongDetails details = metadataCache.get(file);
    if (details == null) {
      details = inspectSong(file);
      metadataCache.put(file, details);
    }
    return details;
  }

  private String queueDisplay(File file) {
    try {
      SongDetails d = getSongDetails(file);
      if (d != null && d.artist != null && !d.artist.trim().isEmpty()) return d.artist + " · " + d.title;
    } catch (Exception ignored) { }
    return displayName(file);
  }
  private void load(File file) { load(file, true, false); }
  private void load(File file, boolean autoPlay) { load(file, autoPlay, false); }
  /**
   * @param allowCrossfade Only true for the automatic "queue naturally advancing to the next track" path (the
   *     pre-emptive trigger in {@link #tick}). Manual navigation — clicking a queue row, Prev/Next, choosing a
   *     file — always passes false, so crossfade only ever kicks in when a track finishes on its own, never when
   *     the user actively picks a different song to jump to.
   */
  private void load(File file, boolean autoPlay, boolean allowCrossfade) {
    try {
      StreamPlayer outgoing = player;
      int fadeSeconds = crossfadeSlider.getValue();
      boolean doCrossfade = allowCrossfade && outgoing != null && outgoing.isRunning() && fadeSeconds > 0;
      if (!doCrossfade && outgoing != null) { player = null; outgoing.close(); }
      deleteTemporaryAudio();
      File playable = prepareAudio(file);
      AudioInputStream decodedStream = AudioSystem.getAudioInputStream(playable);
      byte[] audioBytes = readAll(decodedStream);
      AudioFormat format = decodedStream.getFormat();
      decodedStream.close();
      StreamPlayer opened = new StreamPlayer(format, audioBytes);
      // Pulled from the player, not the raw decode above: StreamPlayer may have normalized the format to 16-bit
      // PCM internally, and computeLevels() below must read the exact bytes/format actually being played.
      player = opened; loadedFile = file; rawAudio = opened.getAudioBytes(); audioFormat = opened.getFormat(); crossfadeStarted = false;
      if (autoPlay) recordHistory(file); // not on the silent session-restore load (autoPlay=false) — that's not a new play, just resuming where we left off
      waveformSliderUI.setWaveform(null); // clear immediately so the previous track's shape doesn't linger while this one's computes
      computeWaveformAsync(rawAudio, audioFormat);
      opened.setMono(monoAudio);
      opened.setEqGains(eqGains);
      opened.onFinished = () -> trackFinished(opened);
      // getSongDetails() (not inspectSong() directly) so a replayed track — common with shuffle/repeat over a
      // long session — reuses the cached result instead of re-spawning ffprobe + an ffmpeg cover extraction on
      // every single play.
      SongDetails details = getSongDetails(file);
      String name = details.title;
      setTrackTitle(name, details.artist); source.setText("LOCAL AUDIO FILE · " + file.getName().substring(file.getName().lastIndexOf('.') + 1).toUpperCase());
      // Mirrors what's playing in the window title, same idea as Spotify/most media apps — visible in the
      // taskbar/dock even when the window itself isn't focused or is minimized.
      setTitle((details.artist != null && !details.artist.trim().isEmpty() ? details.artist + " – " : "") + name);
      fadeInNowPlaying();
      length.setText(format(opened.getMicrosecondLength())); elapsed.setText("0:00"); progress.setValue(0); status.setText("●  TRACK LOADED"); syncMiniProgress();
      boolean canLookUp = details.embeddedCover == null && details.title != null && !details.title.trim().isEmpty();
      disc.setCover(details.embeddedCover); disc.setLookingUp(canLookUp);
      if (details.embeddedCover != null) source.setText("EMBEDDED ALBUM ART · " + extension(file).toUpperCase());
      else if (canLookUp) findCover(details.lookupQuery(), file);
      else source.setText("NO EMBEDDED COVER · ADD SONG METADATA");
      currentLyrics = details.lyrics;
      lyricsButton.setVisible(currentLyrics != null);
      // No embedded lyrics tag — same "don't leave the user with nothing just because this particular file
      // wasn't tagged" reasoning as the cover art lookup fallback above, mirroring its async/best-effort shape:
      // silently does nothing on failure (no network, no match), never blocks playback.
      if (currentLyrics == null && details.title != null && !details.title.trim().isEmpty()) findLyrics(details, file);
      refreshLyricsIfOpen();
      updateQueueUI();
      opened.setGain(doCrossfade ? 0f : volume);
      if (autoPlay) {
        opened.start(); setPlaying(true);
        if (doCrossfade) { status.setText("●  CROSSFADING"); startCrossfade(outgoing, opened, fadeSeconds); }
      } else {
        setPlaying(false); // restored from a saved session: track is ready, but wait for the user to press play
      }
    } catch (Exception error) { status.setText("●  INSTALL FFMPEG FOR FLAC / M4A"); }
  }
  /** Fades `outgoing` out and `incoming` in over `seconds` using an equal-power curve, then closes the outgoing player. Equal-power (cos/sin, not linear 1-t/t) keeps the combined perceived loudness roughly constant through the transition, instead of dipping in the middle — this is the same principle Spotify's crossfade (and most professional DJ mixers) use. */
  private void startCrossfade(final StreamPlayer outgoing, final StreamPlayer incoming, int seconds) {
    final long durationMillis = seconds * 1000L;
    final long startTime = System.currentTimeMillis();
    crossfading = true;
    outgoing.setGain(volume); incoming.setGain(0f);
    Timer fade = new Timer(30, null);
    fade.addActionListener(e -> {
      long elapsedMillis = System.currentTimeMillis() - startTime;
      float t = Math.min(1f, elapsedMillis / (float) durationMillis);
      double angle = t * (Math.PI / 2.0);
      float outGain = (float) Math.cos(angle);   // 1 -> 0, equal-power taper
      float inGain = (float) Math.sin(angle);    // 0 -> 1, equal-power taper
      // scaled by the live volume field so dragging the volume slider mid-crossfade is picked up on the next tick
      outgoing.setGain(outGain * volume); incoming.setGain(inGain * volume);
      if (t >= 1f) {
        ((Timer) e.getSource()).stop();
        outgoing.close();
        crossfading = false;
        if (player == incoming) { incoming.setGain(volume); status.setText("●  NOW SPINNING"); }
      }
    });
    fade.start();
  }
  private static final Map<String, String> BINARY_PATH_CACHE = new HashMap<String, String>();
  /**
   * Resolves a binary like "ffmpeg" or "ffprobe" to an absolute path when possible.
   * Unlike a packaged macOS .app (launched via LaunchServices, which does NOT inherit the shell's PATH), a
   * Windows process normally does inherit the user/system PATH regardless of how it's launched — so this mostly
   * exists as a safety net for two real gaps: (1) right after `winget install`, PATH broadcasts to the
   * environment don't reach a process that was already running before the install, so this checks winget's own
   * shim directory directly; (2) plenty of manual-install guides for FFmpeg on Windows tell people to extract the
   * zip to a fixed folder (most commonly C:\ffmpeg) without ever touching PATH at all.
   */
  private static String resolveBinary(String name) {
    String cached = BINARY_PATH_CACHE.get(name);
    if (cached != null) return cached;
    String exe = name + ".exe";
    String localAppData = System.getenv("LOCALAPPDATA");
    String programFiles = System.getenv("ProgramFiles");
    String programFilesX86 = System.getenv("ProgramFiles(x86)");
    String[] candidates = {
      localAppData != null ? localAppData + "\\Microsoft\\WinGet\\Links\\" + exe : null, // winget shim, immediately valid post-install
      programFiles != null ? programFiles + "\\ffmpeg\\bin\\" + exe : null,
      programFilesX86 != null ? programFilesX86 + "\\ffmpeg\\bin\\" + exe : null,
      "C:\\ffmpeg\\bin\\" + exe, // the folder most Windows FFmpeg install guides tell users to extract to
      "C:\\ProgramData\\chocolatey\\bin\\" + exe,
    };
    for (String candidate : candidates) { if (candidate != null && new File(candidate).canExecute()) { BINARY_PATH_CACHE.put(name, candidate); return candidate; } }
    BINARY_PATH_CACHE.put(name, exe); // fall back to relying on PATH — the common case once winget/choco have fully registered it
    return exe;
  }
  private File prepareAudio(File sourceFile) throws Exception {
    String extension = extension(sourceFile);
    if (!"flac".equals(extension) && !"m4a".equals(extension) && !"mp3".equals(extension)) return sourceFile;
    temporaryAudio = File.createTempFile("cdplayer-", ".wav"); temporaryAudio.deleteOnExit();
    Process process;
    try {
      process = new ProcessBuilder(resolveBinary("ffmpeg"), "-nostdin", "-y", "-v", "error", "-i", sourceFile.getAbsolutePath(), "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", temporaryAudio.getAbsolutePath()).inheritIO().start();
    } catch (IOException missingFfmpeg) {
      deleteTemporaryAudio(); throw new IOException("FFmpeg was not found", missingFfmpeg);
    }
    if (process.waitFor() != 0 || !temporaryAudio.isFile() || temporaryAudio.length() == 0) { deleteTemporaryAudio(); throw new IOException("FFmpeg could not decode this audio file"); }
    return temporaryAudio;
  }
  private void deleteTemporaryAudio() { if (temporaryAudio != null) { temporaryAudio.delete(); temporaryAudio = null; } }
  private static String extension(File file) { String name = file.getName(); int dot = name.lastIndexOf('.'); return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(); }
  private static SongDetails inspectSong(File file) {
    String fallbackTitle = displayName(file).replaceFirst("^\\s*\\d{1,3}[ ._-]+", "");
    String title = null, artist = null, album = null;
    Process probe = null;
    try {
      probe = new ProcessBuilder(resolveBinary("ffprobe"), "-v", "error", "-show_entries", "format_tags=title,artist,album", "-of", "default=noprint_wrappers=1", file.getAbsolutePath()).redirectErrorStream(true).start();
      String tags = new String(readAll(probe.getInputStream()), StandardCharsets.UTF_8); probe.waitFor();
      for (String line : tags.split("\\R")) { int equals = line.indexOf('='); if (equals < 1) continue; String key = line.substring(0, equals).toLowerCase(); String value = line.substring(equals + 1).trim(); if ("tag:title".equals(key)) title = value; else if ("tag:artist".equals(key)) artist = value; else if ("tag:album".equals(key)) album = value; }
    } catch (Exception ignored) { /* FFmpeg metadata is optional. */ }
    finally { if (probe != null) closeProcessStreams(probe); }
    BufferedImage embeddedCover = extractEmbeddedCover(file);
    String lyrics = extractLyrics(file);
    return new SongDetails(title == null || title.isEmpty() ? fallbackTitle : title, artist, album, embeddedCover, lyrics);
  }
  private static BufferedImage extractEmbeddedCover(File file) {
    File image = null;
    Process extract = null;
    try {
      image = File.createTempFile("cdplayer-art-", ".jpg");
      extract = new ProcessBuilder(resolveBinary("ffmpeg"), "-nostdin", "-y", "-v", "error", "-i", file.getAbsolutePath(), "-map", "0:v:0", "-frames:v", "1", "-pix_fmt", "yuvj420p", image.getAbsolutePath()).redirectErrorStream(true).start();
      readAll(extract.getInputStream()); if (extract.waitFor() == 0 && image.length() > 0) { BufferedImage decoded = ImageIO.read(image); if (decoded != null) return decoded; }
    } catch (Exception ignored) { /* No embedded artwork is normal. */ }
    finally { if (image != null) image.delete(); if (extract != null) closeProcessStreams(extract); }
    return null;
  }
  /**
   * A dedicated call per tag name, not folded into the title/artist/album probe above: that one relies on
   * ffprobe's plain "TAG:key=value" output being one tag per line, which breaks for a value that itself contains
   * newlines — exactly what lyrics are. Fetching just one tag at a time with nokey=1 (no "TAG:key=" prefix at
   * all) sidesteps that entirely: the raw stdout, trimmed, IS the tag's full value, multi-line and all. There's
   * no single standard tag name for lyrics across formats/taggers, so this tries the two common ones in order.
   */
  private static String extractLyrics(File file) {
    for (String tagName : new String[] { "lyrics", "unsyncedlyrics" }) {
      Process probe = null;
      try {
        probe = new ProcessBuilder(resolveBinary("ffprobe"), "-v", "error", "-show_entries", "format_tags=" + tagName, "-of", "default=noprint_wrappers=1:nokey=1", file.getAbsolutePath()).redirectErrorStream(true).start();
        String raw = new String(readAll(probe.getInputStream()), StandardCharsets.UTF_8); probe.waitFor();
        String trimmed = raw.trim();
        if (!trimmed.isEmpty()) return trimmed;
      } catch (Exception ignored) { /* Lyrics are optional, and so is FFmpeg itself. */ }
      finally { if (probe != null) closeProcessStreams(probe); }
    }
    return null;
  }
  private static final class SongDetails {
    final String title, artist, album; final BufferedImage embeddedCover; final String lyrics;
    SongDetails(String title, String artist, String album, BufferedImage embeddedCover, String lyrics) { this.title = title; this.artist = artist; this.album = album; this.embeddedCover = embeddedCover; this.lyrics = lyrics; }
    boolean hasArtist() { return artist != null && !artist.trim().isEmpty(); }
    String lookupQuery() { return (hasArtist() ? artist + " " : "") + title; }
  }
  /** Handle onto one queue-list row's live components, kept around so hover state can be recomputed for every row on demand. */
  private static final class QueueRowUI {
    final JLabel entry; final java.awt.CardLayout cards; final JPanel eastPanel; final int index;
    QueueRowUI(JLabel entry, java.awt.CardLayout cards, JPanel eastPanel, int index) { this.entry = entry; this.cards = cards; this.eastPanel = eastPanel; this.index = index; }
  }
  private void findCover(final String query, final File requestedFile) {
    Thread lookup = new Thread(() -> {
      String sourceLabel = null;
      BufferedImage foundCover = null;
      boolean networkError = false;
      try {
        foundCover = searchITunesCover(query);
        if (foundCover != null) sourceLabel = "ITUNES";
      } catch (Exception ignored) { networkError = true; }
      if (foundCover == null) {
        try {
          foundCover = searchDeezerCover(query);
          if (foundCover != null) sourceLabel = "DEEZER";
        } catch (Exception ignored) { networkError = true; }
      }
      // Tried last, not first: unlike iTunes/Deezer this needs an OAuth token round-trip before the actual
      // search even starts, and requires the user's own Spotify API credentials to be present at all (see
      // SPOTIFY_CREDENTIALS_FILE) — genuinely broader catalog coverage for the niche/international tracks the
      // two keyless sources tend to miss, but no reason to pay that cost on the (majority) common case those
      // two already handle.
      if (foundCover == null) {
        try {
          foundCover = searchSpotifyCover(query);
          if (foundCover != null) sourceLabel = "SPOTIFY";
        } catch (Exception ignored) { networkError = true; }
      }
      final BufferedImage cover = foundCover; final String label = sourceLabel; final boolean hadNetworkError = networkError && cover == null;
      SwingUtilities.invokeLater(() -> {
        if (!requestedFile.equals(loadedFile)) return;
        disc.setLookingUp(false);
        if (cover != null) { disc.setCover(cover); source.setText(label + " COVER ART · " + extension(requestedFile).toUpperCase()); }
        else source.setText((hadNetworkError ? "COVER LOOKUP UNAVAILABLE · " : "COVER NOT FOUND · ") + extension(requestedFile).toUpperCase());
      });
    }, "cdplayer-cover-lookup");
    lookup.setDaemon(true); lookup.start();
  }
  /**
   * Same fallback idea as findCover() — a file with no embedded lyrics tag doesn't have to mean no lyrics
   * button ever appears — but a separate lookup rather than folding into findCover()'s thread: the two can
   * legitimately both be missing/present in any combination, and stalling the (usually faster, more likely to
   * succeed) cover art lookup behind a lyrics API call would make the disc's cover show up later for no reason.
   */
  private void findLyrics(final SongDetails details, final File requestedFile) {
    Thread lookup = new Thread(() -> {
      String lyrics = null;
      try { lyrics = searchLrcLibLyrics(details); } catch (Exception ignored) { /* No match, or lrclib.net unreachable — lyrics are optional. */ }
      final String found = lyrics;
      if (found == null) return;
      SwingUtilities.invokeLater(() -> {
        if (!requestedFile.equals(loadedFile)) return; // track changed again before this landed
        currentLyrics = found;
        lyricsButton.setVisible(true);
        refreshLyricsIfOpen(); // in case the Lyrics panel was already open (from a previous track) when this arrives
      });
    }, "cdplayer-lyrics-lookup");
    lookup.setDaemon(true); lookup.start();
  }
  /** lrclib.net: free, no API key, and returns synced (LRC-timestamped) lyrics when available — exactly the format this app's own LRC parser already expects, so a successful lookup gets the same click-to-seek/auto-scroll treatment as embedded lyrics, not just a plain read. Falls back to plain (unsynced) lyrics if that's all the track has. */
  private static String searchLrcLibLyrics(SongDetails details) throws IOException {
    // /api/get requires an exact match on title+artist(+album) — real files' own tags routinely diverge from
    // lrclib's credited metadata (confirmed directly: a game track tagged with its featured vocalist 404's here
    // even though the same song is in their database many times over, credited to the composer instead) — so a
    // clean-looking exact lookup can 404 on a track that's genuinely there. Tried first anyway since it's fast
    // and precise when tags DO line up.
    StringBuilder getUrl = new StringBuilder("https://lrclib.net/api/get?track_name=").append(URLEncoder.encode(details.title, "UTF-8"));
    if (details.hasArtist()) getUrl.append("&artist_name=").append(URLEncoder.encode(details.artist, "UTF-8"));
    if (details.album != null && !details.album.trim().isEmpty()) getUrl.append("&album_name=").append(URLEncoder.encode(details.album, "UTF-8"));
    try {
      String lyrics = extractLrcLibLyrics(fetchText(getUrl.toString()));
      if (lyrics != null) return lyrics;
    } catch (IOException exactMatchNotFound) { /* fall through to the broader search below */ }
    // /api/search: title only, no artist/album constraint — the same "just search, take the best hit" approach
    // searchITunesCover/searchDeezerCover already use, rather than requiring every tag to match exactly.
    String searchUrl = "https://lrclib.net/api/search?track_name=" + URLEncoder.encode(details.title, "UTF-8");
    return extractLrcLibLyrics(fetchText(searchUrl));
  }
  /** Pulls the first syncedLyrics (preferred) or plainLyrics field out of an lrclib.net response — works unchanged for both /api/get's single object and /api/search's array of results, since it just takes the first match regardless of which result object it came from (the first search result, same as how searchITunesCover/searchDeezerCover already just take limit=1's one answer). */
  private static String extractLrcLibLyrics(String json) {
    String synced = extractJsonStringField(json, LRCLIB_SYNCED_KEY);
    if (synced != null && !synced.isEmpty()) return unescapeJsonString(synced);
    String plain = extractJsonStringField(json, LRCLIB_PLAIN_KEY);
    if (plain != null && !plain.isEmpty()) return unescapeJsonString(plain);
    return null;
  }
  /**
   * Pulls a JSON string field's raw (still-escaped) contents out by scanning for the closing quote by hand,
   * rather than matching it with a regex like {@code (?:[^"\\]|\\.)*"} — Java's regex engine recurses once per
   * loop iteration for a quantified alternation with no tail-call optimization, so that pattern StackOverflowErrors
   * on real lyrics (many KB of text, one escaped \n per line). A hand-rolled scan is O(n) with no recursion.
   */
  private static String extractJsonStringField(String json, Pattern keyPattern) {
    Matcher key = keyPattern.matcher(json);
    if (!key.find()) return null;
    int start = key.end();
    StringBuilder value = new StringBuilder();
    for (int i = start; i < json.length(); i++) {
      char c = json.charAt(i);
      if (c == '\\' && i + 1 < json.length()) {
        value.append(c).append(json.charAt(i + 1));
        i++;
      } else if (c == '"') {
        return value.toString();
      } else {
        value.append(c);
      }
    }
    return null; // unterminated string — malformed JSON
  }
  /** Un-escapes a JSON string literal's contents (newlines, quotes, backslashes, unicode escapes, etc.) — lyrics text is almost entirely escaped newlines, so this can't just be skipped. */
  private static String unescapeJsonString(String raw) {
    StringBuilder out = new StringBuilder(raw.length());
    for (int i = 0; i < raw.length(); i++) {
      char c = raw.charAt(i);
      if (c == '\\' && i + 1 < raw.length()) {
        char next = raw.charAt(++i);
        switch (next) {
          case 'n': out.append('\n'); break;
          case 't': out.append('\t'); break;
          case 'r': out.append('\r'); break;
          case 'b': out.append('\b'); break;
          case 'f': out.append('\f'); break;
          case '"': out.append('"'); break;
          case '\\': out.append('\\'); break;
          case '/': out.append('/'); break;
          case 'u':
            if (i + 4 < raw.length()) { out.append((char) Integer.parseInt(raw.substring(i + 1, i + 5), 16)); i += 4; }
            break;
          default: out.append(next);
        }
      } else out.append(c);
    }
    return out.toString();
  }
  private static BufferedImage searchITunesCover(String query) throws IOException {
    String encoded = URLEncoder.encode(query, "UTF-8");
    String json = fetchText("https://itunes.apple.com/search?term=" + encoded + "&entity=song&limit=1");
    Matcher match = ITUNES_COVER.matcher(json);
    if (!match.find()) return null;
    return fetchImage(match.group(1).replace("\\/", "/").replace("100x100bb", "600x600bb"));
  }
  private static BufferedImage searchDeezerCover(String query) throws IOException {
    String encoded = URLEncoder.encode(query, "UTF-8");
    String json = fetchText("https://api.deezer.com/search?q=" + encoded + "&limit=1");
    Matcher match = DEEZER_COVER.matcher(json);
    if (!match.find()) return null;
    return fetchImage(match.group(1).replace("\\/", "/"));
  }
  private static String spotifyClientId, spotifyClientSecret;
  private static boolean spotifyCredentialsLoaded;
  private static String spotifyAccessToken;
  private static long spotifyTokenExpiryMillis;
  // Set once the user completes the one-time browser sign-in (see startSpotifySignIn) — a third, optional line
  // in the same credentials file, persisted so sign-in only has to happen once per machine, not once per launch.
  private static String spotifyUserRefreshToken;
  private static String spotifyUserAccessToken;
  private static long spotifyUserTokenExpiryMillis;
  /** Loaded once, lazily, on the first cover lookup that actually needs it — not at startup, since most launches never fall through to Spotify at all. */
  private static void loadSpotifyCredentialsIfNeeded() {
    if (spotifyCredentialsLoaded) return;
    spotifyCredentialsLoaded = true;
    if (!SPOTIFY_CREDENTIALS_FILE.isFile()) return;
    try {
      List<String> lines = java.nio.file.Files.readAllLines(SPOTIFY_CREDENTIALS_FILE.toPath(), StandardCharsets.UTF_8);
      if (lines.size() >= 2) { spotifyClientId = lines.get(0).trim(); spotifyClientSecret = lines.get(1).trim(); }
      if (lines.size() >= 3 && !lines.get(2).trim().isEmpty()) spotifyUserRefreshToken = lines.get(2).trim();
    } catch (IOException ignored) { /* Spotify fallback just stays unavailable */ }
  }
  /** Rewrites the credentials file with the current app credentials plus (now known) a user refresh token, so a future launch doesn't need to sign in again. */
  private static void saveSpotifyRefreshToken(String refreshToken) {
    try {
      File parent = SPOTIFY_CREDENTIALS_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      String content = (spotifyClientId == null ? "" : spotifyClientId) + "\n" + (spotifyClientSecret == null ? "" : spotifyClientSecret) + "\n" + refreshToken + "\n";
      java.nio.file.Files.write(SPOTIFY_CREDENTIALS_FILE.toPath(), content.getBytes(StandardCharsets.UTF_8));
    } catch (IOException ignored) { /* sign-in still works for the rest of this session even if persisting it fails */ }
  }
  /**
   * Spotify's Client Credentials OAuth flow — appropriate here specifically because this app only ever does
   * catalog search (no user data, no login), which is exactly what Client Credentials is for. Token is cached
   * and reused (refreshed a minute before its real expiry, not right at it) rather than re-requested on every
   * cover lookup — an unnecessary extra network round-trip otherwise, given tokens are valid for an hour.
   * Returns null (never throws for this specific reason) when no credentials are configured at all — that's
   * "feature not set up," not an error, and findCover()'s fallback chain already treats a null result as "try
   * nothing further from this source" either way.
   */
  private static synchronized String getSpotifyAccessToken() throws IOException {
    loadSpotifyCredentialsIfNeeded();
    if (spotifyClientId == null || spotifyClientId.isEmpty() || spotifyClientSecret == null || spotifyClientSecret.isEmpty()) return null;
    if (spotifyAccessToken != null && System.currentTimeMillis() < spotifyTokenExpiryMillis) return spotifyAccessToken;
    HttpURLConnection connection = (HttpURLConnection) new URL("https://accounts.spotify.com/api/token").openConnection();
    connection.setRequestMethod("POST");
    connection.setRequestProperty("Authorization", "Basic " + java.util.Base64.getEncoder().encodeToString((spotifyClientId + ":" + spotifyClientSecret).getBytes(StandardCharsets.UTF_8)));
    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
    connection.setConnectTimeout(5000); connection.setReadTimeout(8000); connection.setDoOutput(true);
    try (java.io.OutputStream body = connection.getOutputStream()) { body.write("grant_type=client_credentials".getBytes(StandardCharsets.UTF_8)); }
    String json;
    try (InputStream stream = connection.getInputStream()) { json = new String(readAll(stream), StandardCharsets.UTF_8); }
    finally { connection.disconnect(); }
    Matcher tokenMatch = SPOTIFY_ACCESS_TOKEN.matcher(json);
    if (!tokenMatch.find()) return null; // malformed/unexpected response — treat exactly like "not configured"
    spotifyAccessToken = tokenMatch.group(1);
    Matcher expiresMatch = SPOTIFY_EXPIRES_IN.matcher(json);
    long expiresInSeconds = expiresMatch.find() ? Long.parseLong(expiresMatch.group(1)) : 3600;
    spotifyTokenExpiryMillis = System.currentTimeMillis() + Math.max(0, expiresInSeconds - 60) * 1000L;
    return spotifyAccessToken;
  }
  /**
   * Full user sign-in (Authorization Code flow) — needed specifically because Spotify's playlist-tracks
   * endpoint rejects the plain app-only Client Credentials token above with a 403, confirmed directly against
   * the real API for both Spotify's own editorial playlists and a plain user-created public one (their late-
   * 2024 API policy changes restrict reading a playlist's actual song list to a real signed-in user, no matter
   * whose playlist it is or what scope is requested — reading a single track by ID, by contrast, isn't
   * affected, which is why track links don't need any of this). Opens the system browser to Spotify's own
   * consent screen (the user's actual login/password never passes through this app at all) and spins up a
   * one-shot local HTTP server on the loopback redirect URI to catch the resulting authorization code — the
   * standard OAuth pattern for a desktop app with no way to host a real HTTPS redirect target. onDone is always
   * invoked back on the EDT with a short human-readable result string, success or failure.
   */
  private static void startSpotifySignIn(java.util.function.Consumer<String> onDone) {
    Thread worker = new Thread(() -> {
      String result;
      try {
        loadSpotifyCredentialsIfNeeded();
        if (spotifyClientId == null || spotifyClientId.isEmpty()) { SwingUtilities.invokeLater(() -> onDone.accept("SPOTIFY APP CREDENTIALS NOT CONFIGURED")); return; }
        if (!java.awt.Desktop.isDesktopSupported() || !java.awt.Desktop.getDesktop().isSupported(java.awt.Desktop.Action.BROWSE)) { SwingUtilities.invokeLater(() -> onDone.accept("CAN'T OPEN A BROWSER ON THIS SYSTEM")); return; }
        String state = Long.toHexString(new java.security.SecureRandom().nextLong());
        String authUrl = "https://accounts.spotify.com/authorize?response_type=code&client_id=" + URLEncoder.encode(spotifyClientId, "UTF-8")
            + "&redirect_uri=" + URLEncoder.encode(SPOTIFY_REDIRECT_URI, "UTF-8") + "&state=" + state;
        java.awt.Desktop.getDesktop().browse(new java.net.URI(authUrl));
        String code = awaitSpotifyAuthorizationCode(state);
        exchangeSpotifyAuthorizationCode(code);
        result = "SPOTIFY CONNECTED";
      } catch (Exception e) {
        result = "SPOTIFY SIGN-IN FAILED" + (e.getMessage() != null ? " — " + e.getMessage().toUpperCase(java.util.Locale.ROOT) : "");
      }
      final String finalResult = result;
      SwingUtilities.invokeLater(() -> onDone.accept(finalResult));
    }, "cdplayer-spotify-signin");
    worker.setDaemon(true);
    worker.start();
  }
  /** Blocks (on the caller's own background thread, never the EDT) until the browser redirect lands on the local server, or 3 minutes pass with nobody completing the login. */
  private static String awaitSpotifyAuthorizationCode(String expectedState) throws IOException {
    final String[] resultCode = new String[1];
    final String[] resultError = new String[1];
    final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
    com.sun.net.httpserver.HttpServer server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 8080), 0);
    server.createContext("/callback", exchange -> {
      try {
        java.util.Map<String, String> params = parseQueryParams(exchange.getRequestURI().getQuery());
        String code = params.get("code"), state = params.get("state"), error = params.get("error");
        String html;
        if (error != null) { resultError[0] = error; html = "<html><body style='font-family:sans-serif'><h2>Spotify sign-in was cancelled</h2><p>You can close this tab and try again in CDPlayer.</p></body></html>"; }
        else if (code != null && expectedState.equals(state)) { resultCode[0] = code; html = "<html><body style='font-family:sans-serif'><h2>Connected to Spotify</h2><p>You can close this tab and return to CDPlayer.</p></body></html>"; }
        else { resultError[0] = "state mismatch"; html = "<html><body style='font-family:sans-serif'><h2>Something went wrong</h2><p>You can close this tab and try again in CDPlayer.</p></body></html>"; }
        byte[] bytes = html.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
        exchange.sendResponseHeaders(200, bytes.length);
        try (java.io.OutputStream os = exchange.getResponseBody()) { os.write(bytes); }
      } finally { latch.countDown(); }
    });
    server.start();
    try {
      boolean arrived = latch.await(180, java.util.concurrent.TimeUnit.SECONDS);
      if (!arrived) throw new IOException("timed out waiting for sign-in");
      if (resultError[0] != null) throw new IOException(resultError[0]);
      return resultCode[0];
    } catch (InterruptedException e) { throw new IOException("interrupted while waiting for sign-in"); }
    finally { server.stop(0); }
  }
  private static java.util.Map<String, String> parseQueryParams(String query) {
    java.util.Map<String, String> result = new java.util.HashMap<String, String>();
    if (query == null) return result;
    for (String pair : query.split("&")) {
      int eq = pair.indexOf('=');
      if (eq < 0) continue;
      try { result.put(java.net.URLDecoder.decode(pair.substring(0, eq), "UTF-8"), java.net.URLDecoder.decode(pair.substring(eq + 1), "UTF-8")); } catch (Exception ignored) { }
    }
    return result;
  }
  private static void exchangeSpotifyAuthorizationCode(String code) throws IOException {
    String json = postToSpotifyTokenEndpoint("grant_type=authorization_code&code=" + URLEncoder.encode(code, "UTF-8") + "&redirect_uri=" + URLEncoder.encode(SPOTIFY_REDIRECT_URI, "UTF-8"));
    Matcher accessMatch = SPOTIFY_ACCESS_TOKEN.matcher(json);
    Matcher refreshMatch = SPOTIFY_REFRESH_TOKEN.matcher(json);
    if (!accessMatch.find() || !refreshMatch.find()) throw new IOException("unexpected response");
    spotifyUserAccessToken = accessMatch.group(1);
    spotifyUserRefreshToken = refreshMatch.group(1);
    Matcher expiresMatch = SPOTIFY_EXPIRES_IN.matcher(json);
    long expiresInSeconds = expiresMatch.find() ? Long.parseLong(expiresMatch.group(1)) : 3600;
    spotifyUserTokenExpiryMillis = System.currentTimeMillis() + Math.max(0, expiresInSeconds - 60) * 1000L;
    saveSpotifyRefreshToken(spotifyUserRefreshToken);
  }
  /** User-context token for playlist reads — separate from getSpotifyAccessToken()'s app-only one above, refreshed from the stored refresh token as needed. Returns null if the user has never signed in (not an error — the caller prompts for sign-in in that case) rather than throwing. */
  private static synchronized String getSpotifyUserAccessToken() throws IOException {
    loadSpotifyCredentialsIfNeeded();
    if (spotifyUserAccessToken != null && System.currentTimeMillis() < spotifyUserTokenExpiryMillis) return spotifyUserAccessToken;
    if (spotifyUserRefreshToken == null || spotifyUserRefreshToken.isEmpty()) return null;
    String json = postToSpotifyTokenEndpoint("grant_type=refresh_token&refresh_token=" + URLEncoder.encode(spotifyUserRefreshToken, "UTF-8"));
    Matcher accessMatch = SPOTIFY_ACCESS_TOKEN.matcher(json);
    if (!accessMatch.find()) return null;
    spotifyUserAccessToken = accessMatch.group(1);
    Matcher refreshMatch = SPOTIFY_REFRESH_TOKEN.matcher(json); // Spotify sometimes rotates the refresh token on use — if so, the new one is what has to be persisted, not the old
    if (refreshMatch.find()) { spotifyUserRefreshToken = refreshMatch.group(1); saveSpotifyRefreshToken(spotifyUserRefreshToken); }
    Matcher expiresMatch = SPOTIFY_EXPIRES_IN.matcher(json);
    long expiresInSeconds = expiresMatch.find() ? Long.parseLong(expiresMatch.group(1)) : 3600;
    spotifyUserTokenExpiryMillis = System.currentTimeMillis() + Math.max(0, expiresInSeconds - 60) * 1000L;
    return spotifyUserAccessToken;
  }
  private static String postToSpotifyTokenEndpoint(String body) throws IOException {
    HttpURLConnection connection = (HttpURLConnection) new URL("https://accounts.spotify.com/api/token").openConnection();
    connection.setRequestMethod("POST");
    connection.setRequestProperty("Authorization", "Basic " + java.util.Base64.getEncoder().encodeToString((spotifyClientId + ":" + spotifyClientSecret).getBytes(StandardCharsets.UTF_8)));
    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
    connection.setConnectTimeout(5000); connection.setReadTimeout(8000); connection.setDoOutput(true);
    try (java.io.OutputStream out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
    try (InputStream stream = connection.getInputStream()) { return new String(readAll(stream), StandardCharsets.UTF_8); }
    finally { connection.disconnect(); }
  }
  private static BufferedImage searchSpotifyCover(String query) throws IOException {
    String token = getSpotifyAccessToken();
    if (token == null) return null; // no credentials configured
    String encoded = URLEncoder.encode(query, "UTF-8");
    HttpURLConnection connection = open("https://api.spotify.com/v1/search?q=" + encoded + "&type=track&limit=1");
    connection.setRequestProperty("Authorization", "Bearer " + token);
    String json;
    try (InputStream stream = connection.getInputStream()) { json = new String(readAll(stream), StandardCharsets.UTF_8); }
    finally { connection.disconnect(); }
    // Spotify's search is fuzzy/tokenized, not exact — for an unusual query (a fan-made medley title, an
    // uncommon artist name shared with someone else entirely) that genuinely isn't in its catalog, it can still
    // confidently hand back its closest tokenized guess instead of "no results," which without a sanity check
    // here means a track's disc/thumbnail can end up showing a totally unrelated cover (confirmed directly: a
    // "Vinicius" + fan-made "METAL GEAR SOLID PEACE WALKER MEDLEY" query returned some unrelated artist's rap
    // single instead of no match). Reject a result whose own track+artist name barely overlaps with what was
    // actually searched for, rather than trusting limit=1's top hit unconditionally.
    if (!spotifyResultLooksRelevant(query, json)) return null;
    // The first "images" array in the response is the first (only, given limit=1) track's album artwork, and
    // Spotify always orders that array largest-first, so the first "url" within it is the largest size on offer.
    String imageUrl = firstSpotifyImageUrl(json);
    if (imageUrl == null) return null;
    return fetchImage(imageUrl.replace("\\/", "/"));
  }
  /**
   * Finds the "url" inside the first "images" array's first object, by plain indexOf scanning rather than a
   * regex — a chained \s*-separated regex over this same shape was flagged by CodeQL as a polynomial-ReDoS risk
   * on untrusted network input (a crafted response with long runs of near-matching whitespace/braces could make
   * backtracking cost grow with the square of the input length). Linear indexOf scanning can't backtrack at all,
   * so the same risk doesn't exist here. requiring the "url" key to appear before the first "}" preserves the
   * original regex's guarantee of matching within the first images[] element specifically — not just any "url"
   * anywhere in the response, which could otherwise match an artist image or a later track's art instead of the
   * first (and, per Spotify's own ordering, largest) one.
   */
  private static String firstSpotifyImageUrl(String json) {
    int imagesIdx = json.indexOf("\"images\"");
    if (imagesIdx < 0) return null;
    int openBrace = json.indexOf('{', imagesIdx);
    if (openBrace < 0) return null;
    int closeBrace = json.indexOf('}', openBrace);
    int urlKeyIdx = json.indexOf("\"url\"", openBrace);
    if (urlKeyIdx < 0 || (closeBrace >= 0 && urlKeyIdx > closeBrace)) return null;
    int colonIdx = json.indexOf(':', urlKeyIdx + 5);
    if (colonIdx < 0) return null;
    int firstQuote = json.indexOf('"', colonIdx + 1);
    if (firstQuote < 0) return null;
    int secondQuote = json.indexOf('"', firstQuote + 1);
    if (secondQuote < 0) return null;
    return json.substring(firstQuote + 1, secondQuote);
  }
  /**
   * True if enough of the query's own words turn up somewhere in the raw response to trust the match — checked
   * against the WHOLE response text, not one specifically-extracted field. Tried extracting just the matched
   * track's own name+artist first and abandoned it: Spotify's "artists" key appears at both the album level and
   * the track level with "name" nowhere near either one (confirmed directly against real responses — album_type,
   * artists, external_urls, href, id, images, name, ... — several fields sit between "artists" closing and the
   * album's own "name"), and reliably distinguishing "the track's own artists/name" from "the album's" needs
   * actual brace-depth-aware JSON parsing, not a regex. Checking the whole blob sidesteps that: the track's
   * title/artist/album all appear as literal substrings SOMEWHERE in a real response regardless of exact key
   * order, and a totally unrelated result's response text won't happen to also contain most of the query's own
   * distinctive words (ordinary IDs/URLs elsewhere in the JSON don't coincidentally spell out real title words).
   */
  private static boolean spotifyResultLooksRelevant(String query, String json) {
    return wordOverlapRatio(query, json) >= 0.3;
  }
  /** Fraction of query's own significant (3+ letter/digit) words that also appear in result, case-insensitively — a cheap, format-agnostic-enough stand-in for "does this actually look like the same song," without needing real fuzzy-matching machinery. An empty query has nothing to check, so it's treated as trivially relevant rather than always failing. */
  private static double wordOverlapRatio(String query, String result) {
    java.util.Set<String> queryWords = significantWords(query);
    if (queryWords.isEmpty()) return 1.0;
    java.util.Set<String> resultWords = significantWords(result);
    int matched = 0;
    for (String w : queryWords) if (resultWords.contains(w)) matched++;
    return (double) matched / queryWords.size();
  }
  private static java.util.Set<String> significantWords(String text) {
    java.util.Set<String> words = new java.util.HashSet<String>();
    for (String w : text.toLowerCase(java.util.Locale.ROOT).split("[^a-z0-9]+")) if (w.length() >= 3) words.add(w);
    return words;
  }
  /**
   * Index of the closing brace matching the '{' at json.charAt(openBraceIndex), skipping over brace characters
   * that appear inside quoted string values (including escaped quotes) so those never throw off the depth
   * count. Needed here specifically because Spotify's track objects reuse the same key names ("artists",
   * "name") at multiple nesting depths (the album's own artists/name vs. the track's own) — regex alone can't
   * reliably tell those apart, but "skip past this whole nested object first" can. Returns -1 if unmatched.
   */
  private static int findMatchingBrace(String json, int openBraceIndex) {
    int depth = 0; boolean inString = false;
    for (int i = openBraceIndex; i < json.length(); i++) {
      char c = json.charAt(i);
      if (inString) { if (c == '\\') { i++; continue; } if (c == '"') inString = false; continue; }
      if (c == '"') inString = true;
      else if (c == '{') depth++;
      else if (c == '}') { depth--; if (depth == 0) return i; }
    }
    return -1;
  }
  /** {title, artist} for a single public track by Spotify ID — via the app-only Client Credentials token, which (unlike a playlist's full listing) is sufficient for reading one public track. Returns null if the track doesn't exist, credentials aren't configured, or the response couldn't be parsed. */
  private static String[] resolveSpotifyTrack(String trackId) throws IOException {
    String token = getSpotifyAccessToken();
    if (token == null) return null;
    HttpURLConnection connection = open("https://api.spotify.com/v1/tracks/" + trackId);
    connection.setRequestProperty("Authorization", "Bearer " + token);
    String json;
    try (InputStream stream = connection.getInputStream()) { json = new String(readAll(stream), StandardCharsets.UTF_8); }
    finally { connection.disconnect(); }
    return extractTrackNameAndArtist(json, 0, json.length());
  }
  /**
   * Every track (up to 1000, a generous real-world cap) in a public playlist, as {title, artist} pairs, via the
   * user-signed-in token (see startSpotifySignIn — required, app-only Client Credentials 403s here). Requests
   * only name+artists per track (fields=) rather than the full verbose object Spotify would otherwise return —
   * smaller responses, and each track object is unambiguous on its own (no nested album to confuse "artists"/
   * "name" with, unlike resolveSpotifyTrack's fuller response), so straightforward regex extraction is fine
   * within each one's own bounded text. Paginates via the response's own "next" URL until exhausted or the cap
   * is hit. Returns null specifically when there's no user token at all, distinct from "empty playlist"
   * (empty list) — the caller uses that distinction to prompt sign-in only when it's actually needed.
   */
  private static List<String[]> fetchSpotifyPlaylistTracks(String playlistId) throws IOException {
    String token = getSpotifyUserAccessToken();
    if (token == null) return null;
    List<String[]> results = new ArrayList<String[]>();
    String url = "https://api.spotify.com/v1/playlists/" + playlistId + "/tracks?limit=50&fields=" + URLEncoder.encode("items(track(name,artists(name))),next", "UTF-8");
    int pages = 0;
    while (url != null && pages < 20) {
      pages++;
      HttpURLConnection connection = open(url);
      connection.setRequestProperty("Authorization", "Bearer " + token);
      String json;
      try (InputStream stream = connection.getInputStream()) { json = new String(readAll(stream), StandardCharsets.UTF_8); }
      finally { connection.disconnect(); }
      int searchFrom = 0;
      while (true) {
        int trackKeyIdx = json.indexOf("\"track\":{", searchFrom);
        if (trackKeyIdx < 0) break;
        int braceStart = trackKeyIdx + "\"track\":".length();
        int braceEnd = findMatchingBrace(json, braceStart);
        if (braceEnd < 0) break;
        String[] nameAndArtist = extractTrackNameAndArtist(json, braceStart, braceEnd + 1);
        if (nameAndArtist != null) results.add(nameAndArtist);
        searchFrom = braceEnd + 1;
      }
      Matcher nextMatch = Pattern.compile("\\\"next\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"").matcher(json);
      url = nextMatch.find() ? nextMatch.group(1).replace("\\/", "/") : null;
    }
    return results;
  }
  /**
   * Track name + first artist name from the JSON object spanning json[from,to). Deliberately doesn't assume any
   * relative order between "album", "artists", and "name" (resolveSpotifyTrack's fuller /v1/tracks/{id}
   * response has all three, alphabetically ordered so "name" comes last; the playlist-tracks fields= request
   * below asks for name before artists, and it turned out Spotify preserves THAT order in the response instead
   * of re-alphabetizing it — confirmed the hard way, an earlier version of this method assumed artists always
   * comes first and silently returned null for every playlist track as a result). Instead: locate the bounds of
   * the "album" object and "artists" array (if present) first, then take the first "name" field that falls
   * outside BOTH of those spans — order-independent by construction, since it only cares whether a candidate
   * "name" match is nested inside one of the known sub-structures, not what came before it textually.
   */
  private static String[] extractTrackNameAndArtist(String json, int from, int to) {
    int albumStart = -1, albumEnd = -1;
    int albumKeyIdx = json.indexOf("\"album\":{", from);
    if (albumKeyIdx >= 0 && albumKeyIdx < to) {
      albumStart = albumKeyIdx;
      int albumBraceEnd = findMatchingBrace(json, albumKeyIdx + "\"album\":".length());
      if (albumBraceEnd > 0 && albumBraceEnd < to) albumEnd = albumBraceEnd;
    }
    // The track's own "artists" key, specifically — indexOf alone would find the ALBUM's nested "artists"
    // first if there is one (it appears earlier in the text), same class of bug as "name" above, so this scans
    // past any occurrence that falls inside the already-located album span before accepting one.
    int artistsStart = -1, artistsEnd = -1;
    int artistsScanFrom = from;
    while (true) {
      int candidateIdx = json.indexOf("\"artists\":[", artistsScanFrom);
      if (candidateIdx < 0 || candidateIdx >= to) break;
      if (albumStart >= 0 && candidateIdx > albumStart && candidateIdx < albumEnd) { artistsScanFrom = candidateIdx + 1; continue; }
      artistsStart = candidateIdx;
      int arrayEnd = findMatchingBracket(json, candidateIdx + "\"artists\":".length());
      if (arrayEnd > 0 && arrayEnd < to) artistsEnd = arrayEnd;
      break;
    }
    // Bounded to the FIRST artist object specifically (via findMatchingBrace, not a [^}]*? character class) —
    // a real artist object nests its own "external_urls":{...} before "name" alphabetically, and [^}]*? can't
    // cross that nested object's closing brace at all, so it silently found nothing for every real API response
    // even though the exact same pattern worked fine against a flatter synthetic test object with no nesting.
    String artist = null;
    if (artistsStart >= 0 && artistsEnd > 0) {
      int firstArtistObjStart = json.indexOf('{', artistsStart);
      int firstArtistObjEnd = firstArtistObjStart >= 0 && firstArtistObjStart < artistsEnd ? findMatchingBrace(json, firstArtistObjStart) : -1;
      if (firstArtistObjEnd > 0 && firstArtistObjEnd <= artistsEnd) {
        Matcher artistMatch = Pattern.compile("\\\"name\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"").matcher(json);
        artistMatch.region(firstArtistObjStart, firstArtistObjEnd + 1);
        if (artistMatch.find()) artist = unescapeJsonString(artistMatch.group(1));
      }
    }
    Matcher nameMatch = Pattern.compile("\\\"name\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"").matcher(json);
    nameMatch.region(from, to);
    String name = null;
    while (nameMatch.find()) {
      int matchStart = nameMatch.start();
      if (albumStart >= 0 && matchStart > albumStart && matchStart < albumEnd) continue; // inside "album": skip — that's the album's own name
      if (artistsStart >= 0 && matchStart > artistsStart && matchStart < artistsEnd) continue; // inside "artists": skip — that's an artist's own name
      name = unescapeJsonString(nameMatch.group(1));
      break;
    }
    if (name == null) return null;
    return new String[] { name, artist };
  }
  /** '[' / ']' counterpart to findMatchingBrace — same string-aware depth counting, needed because the array itself contains { } objects whose braces must not be mistaken for the array's own boundary. */
  private static int findMatchingBracket(String json, int openBracketIndex) {
    int depth = 0; boolean inString = false;
    for (int i = openBracketIndex; i < json.length(); i++) {
      char c = json.charAt(i);
      if (inString) { if (c == '\\') { i++; continue; } if (c == '"') inString = false; continue; }
      if (c == '"') inString = true;
      else if (c == '[') depth++;
      else if (c == ']') { depth--; if (depth == 0) return i; }
    }
    return -1;
  }
  private static String fetchText(String location) throws IOException { HttpURLConnection connection = open(location); try (InputStream stream = connection.getInputStream()) { return new String(readAll(stream), StandardCharsets.UTF_8); } finally { connection.disconnect(); } }
  private static BufferedImage fetchImage(String location) throws IOException { HttpURLConnection connection = open(location); try (InputStream stream = connection.getInputStream()) { return ImageIO.read(stream); } finally { connection.disconnect(); } }
  private static HttpURLConnection open(String location) throws IOException { HttpURLConnection connection = (HttpURLConnection) new URL(location).openConnection(); connection.setRequestProperty("User-Agent", "CDPlayer/1.0 (open cover lookup)"); connection.setConnectTimeout(5000); connection.setReadTimeout(8000); return connection; }
  private static byte[] readAll(InputStream stream) throws IOException { java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count; while ((count = stream.read(buffer)) >= 0) output.write(buffer, 0, count); return output.toByteArray(); }
  /**
   * Closes a Process's stdin/stdout/stderr pipes explicitly instead of leaving that to GC/finalization. Every
   * ffprobe/ffmpeg call in this file (metadata, embedded cover, duration probing) runs on every track load, and
   * on macOS each of those pipe streams holds a native (Mach-port-backed) file descriptor open until closed —
   * over a long session with many track changes, relying on finalization to eventually reclaim them let threads
   * and ports pile up (observed via Activity Monitor: hundreds of ports, dozens of threads, elevated CPU).
   */
  private static void closeProcessStreams(Process process) {
    try { process.getInputStream().close(); } catch (Exception ignored) { }
    try { process.getOutputStream().close(); } catch (Exception ignored) { }
    try { process.getErrorStream().close(); } catch (Exception ignored) { }
  }
  private void toggle() { if (player == null) { choose(); return; } if (player.isRunning()) { player.pause(); setPlaying(false); } else { player.start(); setPlaying(true); } }
  private void trackFinished(StreamPlayer finishedPlayer) {
    if (player != finishedPlayer) return;
    if (repeatMode == RepeatMode.ONE) { player.setMicrosecondPosition(0); player.start(); setPlaying(true); return; }
    if (nextTrack()) return;
    setPlaying(false);
  }
  /**
   * Advances to the next queue track, wrapping back to the front when repeat-all is on and the queue's already at
   * its end. The wraparound used to live only in trackFinished()'s own fallback, so it worked when a track ended
   * naturally but not when nextTrack() was called directly — the Next button and the L shortcut both call this
   * directly, so pressing Next on the last track with repeat-all on silently did nothing instead of looping back.
   */
  private boolean nextTrack() {
    int next = nextIndex();
    if (next < 0 && repeatMode == RepeatMode.ALL && !queue.isEmpty()) next = 0; // shuffle's nextIndex() always has somewhere to go with >1 track, so this only ever triggers at the true end of a non-shuffled queue
    if (next < 0) return false;
    queueIndex = next; load(queue.get(queueIndex)); return true;
  }
  private void previousTrack() { if (player != null && player.getMicrosecondPosition() > 5_000_000L) { player.setMicrosecondPosition(0); return; } if (queueIndex > 0) { queueIndex--; load(queue.get(queueIndex)); } else if (player != null) player.setMicrosecondPosition(0); }
  private void removeFromQueue(int index) {
    if (index < 0 || index >= queue.size()) return;
    queue.remove(index);
    if (queue.isEmpty()) {
      resetPlaybackToIdle("●  QUEUE EMPTY");
      updateQueueUI();
    } else if (index == queueIndex) {
      queueIndex = Math.min(index, queue.size() - 1);
      load(queue.get(queueIndex)); // load() also refreshes the queue UI
    } else {
      if (index < queueIndex) queueIndex--;
      updateQueueUI();
    }
  }
  private void clearQueue() {
    if (queue.isEmpty()) return;
    queue.clear();
    resetPlaybackToIdle("●  QUEUE CLEARED");
    updateQueueUI();
  }
  /** Stops and releases the current player and resets the now-playing UI back to its empty-queue state. */
  private void resetPlaybackToIdle(String statusMessage) {
    queueIndex = -1;
    if (player != null) { StreamPlayer closing = player; player = null; closing.close(); }
    deleteTemporaryAudio();
    setTrackTitle("Pick a track to get started.", null); source.setText("YOUR MUSIC LIBRARY");
    setTitle("CDPlayer");
    elapsed.setText("0:00"); length.setText("0:00"); progress.setValue(0); syncMiniProgress();
    disc.setCover(null); disc.setLookingUp(false); loadedFile = null; setPlaying(false);
    currentLyrics = null; lyricsButton.setVisible(false); refreshLyricsIfOpen();
    waveformSliderUI.setWaveform(null);
    status.setText(statusMessage);
  }
  /**
   * Persists the queue (as absolute file paths), current track index, and playback position so the session can
   * resume next launch exactly where it left off, not just on the right track. Runs on a JVM shutdown hook, so
   * it must not touch anything the EDT might still be mutating concurrently — by the time shutdown hooks run for
   * EXIT_ON_CLOSE, the EDT thread is the one blocked inside System.exit(), so nothing else is mutating
   * `queue`/`queueIndex`/`player` at this point.
   */
  private void saveQueueState() {
    try {
      File parent = QUEUE_STATE_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      long position = player != null ? player.getMicrosecondPosition() : 0L;
      StringBuilder content = new StringBuilder();
      content.append(queueIndex).append(',').append(position).append('\n');
      for (File file : queue) content.append(file.getAbsolutePath()).append('\n');
      java.nio.file.Files.write(QUEUE_STATE_FILE.toPath(), content.toString().getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) { /* best-effort persistence; a failed save just means an empty queue next launch */ }
  }
  /** Restores a queue saved by {@link #saveQueueState()}, including seeking back to the exact playback position the current track was at. Tracks that were moved or deleted since the last session are silently skipped rather than failing the whole restore. The position field is optional (absent in files saved before it existed), defaulting to the start of the track. */
  private void restoreQueueState() {
    try {
      if (!QUEUE_STATE_FILE.isFile()) return;
      List<String> lines = java.nio.file.Files.readAllLines(QUEUE_STATE_FILE.toPath(), StandardCharsets.UTF_8);
      if (lines.isEmpty()) return;
      String[] header = lines.get(0).trim().split(",", 2);
      int savedIndex = Integer.parseInt(header[0].trim());
      long savedPosition = header.length > 1 ? Long.parseLong(header[1].trim()) : 0L;
      List<File> restored = new ArrayList<File>();
      for (int i = 1; i < lines.size(); i++) {
        String path = lines.get(i).trim();
        if (path.isEmpty()) continue;
        File file = new File(path);
        if (file.isFile()) restored.add(file);
      }
      if (restored.isEmpty()) return;
      queue.addAll(restored);
      queueIndex = Math.max(0, Math.min(savedIndex, queue.size() - 1));
      updateQueueUI();
      load(queue.get(queueIndex), false);
      if (savedPosition > 0 && player != null) {
        long target = Math.max(0, Math.min(player.getMicrosecondLength(), savedPosition));
        player.setMicrosecondPosition(target);
        long duration = player.getMicrosecondLength();
        progress.setValue(duration == 0 ? 0 : (int) (target * 1000 / duration));
        elapsed.setText(format(target));
        syncMiniProgress();
      }
    } catch (Exception ignored) { /* corrupt or unreadable state file; just start with an empty queue */ }
  }
  /** Persists volume, crossfade, mono audio, the animations toggle, the current theme, the EQ band gains, the waveform toggle, and Mini Mode so they carry over to the next launch instead of resetting to defaults. Runs on the same shutdown hook as {@link #saveQueueState()}, same EDT-quiescence rationale. Theme is stored by name (not index) so it survives THEMES being reordered later. */
  private void saveSettingsState() {
    try {
      File parent = SETTINGS_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      StringBuilder eqLine = new StringBuilder();
      for (int i = 0; i < eqGains.length; i++) { if (i > 0) eqLine.append(','); eqLine.append(eqGains[i]); }
      String content = volumeSlider.getValue() + "\n" + crossfadeSlider.getValue() + "\n" + (monoAudio ? "1" : "0") + "\n" + (animationsEnabled ? "1" : "0") + "\n" + THEMES[currentThemeIndex].name + "\n" + eqLine + "\n" + (waveformEnabled ? "1" : "0") + "\n" + (miniModeEnabled ? "1" : "0") + "\n";
      java.nio.file.Files.write(SETTINGS_FILE.toPath(), content.getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) { /* best-effort persistence; a failed save just means defaults next launch */ }
  }
  /** Restores settings saved by {@link #saveSettingsState()}. Must run after createContent() has wired up the sliders' change listeners, so setting each value here also updates its label/live state the same way a manual drag would. The animations, theme, EQ, waveform, and Mini Mode lines are optional (absent in files saved before those existed), defaulting to enabled / RED / flat / enabled / off. */
  private void restoreSettingsState() {
    try {
      if (!SETTINGS_FILE.isFile()) return;
      List<String> lines = java.nio.file.Files.readAllLines(SETTINGS_FILE.toPath(), StandardCharsets.UTF_8);
      if (lines.size() < 3) return;
      int savedVolume = Integer.parseInt(lines.get(0).trim());
      int savedCrossfade = Integer.parseInt(lines.get(1).trim());
      boolean savedMono = "1".equals(lines.get(2).trim());
      boolean savedAnimations = lines.size() < 4 || "1".equals(lines.get(3).trim());
      String savedThemeName = lines.size() >= 5 ? lines.get(4).trim() : null;
      String savedEq = lines.size() >= 6 ? lines.get(5).trim() : null;
      boolean savedWaveform = lines.size() < 7 || "1".equals(lines.get(6).trim());
      boolean savedMiniMode = lines.size() >= 8 && "1".equals(lines.get(7).trim()); // absent (new feature) defaults to off, unlike waveform's "absent defaults to on" — an old settings file never opted into this
      volumeSlider.setValue(Math.max(0, Math.min(100, savedVolume)));
      crossfadeSlider.setValue(Math.max(0, Math.min(15, savedCrossfade)));
      setMonoAudio(savedMono);
      setAnimationsEnabled(savedAnimations);
      setWaveformEnabled(savedWaveform);
      if (savedThemeName != null) {
        for (int i = 0; i < THEMES.length; i++) {
          if (THEMES[i].name.equals(savedThemeName)) { applyThemeInstant(i); break; }
        }
      }
      if (savedEq != null && !savedEq.isEmpty()) {
        String[] parts = savedEq.split(",");
        if (parts.length == Equalizer.BANDS) {
          double[] gains = new double[Equalizer.BANDS];
          for (int i = 0; i < parts.length; i++) gains[i] = Double.parseDouble(parts[i].trim());
          setEqGains(gains); // player is still null this early — just seeds eqGains for load() to pick up
        }
      }
      // Last: buildMiniPanel() (called lazily from setMiniModeEnabled()) reads the live TEXT/ACCENT2/BG/MUTED
      // fields for its labels' initial colors, which only reflect the restored theme once applyThemeInstant()
      // above has already run.
      if (savedMiniMode) setMiniModeEnabled(true);
    } catch (Exception ignored) { /* corrupt or unreadable state file; just start with defaults */ }
  }
  /** One preset per line: name|gain1,gain2,...,gain10. Loaded once at startup into customEqPresets, which the EQ panel's preset row reads directly. */
  private void loadCustomEqPresets() {
    customEqPresets.clear();
    try {
      if (!EQ_PRESETS_FILE.isFile()) return;
      for (String line : java.nio.file.Files.readAllLines(EQ_PRESETS_FILE.toPath(), StandardCharsets.UTF_8)) {
        int bar = line.indexOf('|');
        if (bar < 1) continue;
        String name = line.substring(0, bar).trim();
        String[] parts = line.substring(bar + 1).split(",");
        if (name.isEmpty() || parts.length != Equalizer.BANDS) continue;
        double[] gains = new double[Equalizer.BANDS];
        for (int i = 0; i < parts.length; i++) gains[i] = Double.parseDouble(parts[i].trim());
        customEqPresets.add(new EqPreset(name, gains));
      }
    } catch (Exception ignored) { /* corrupt or unreadable presets file; just start with none */ }
  }
  private void saveCustomEqPresets() {
    try {
      File parent = EQ_PRESETS_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      StringBuilder content = new StringBuilder();
      for (EqPreset preset : customEqPresets) {
        content.append(preset.name).append('|');
        for (int i = 0; i < preset.gains.length; i++) { if (i > 0) content.append(','); content.append(preset.gains[i]); }
        content.append('\n');
      }
      java.nio.file.Files.write(EQ_PRESETS_FILE.toPath(), content.toString().getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) { /* best-effort; a failed save just means this preset isn't there next launch */ }
  }
  /** Adds (or overwrites, if the name matches an existing custom preset) a preset built from the EQ panel's current sliders, and persists the whole list immediately. */
  private void saveNewEqPreset(String name, double[] gains) {
    for (int i = 0; i < customEqPresets.size(); i++) {
      if (customEqPresets.get(i).name.equalsIgnoreCase(name)) { customEqPresets.set(i, new EqPreset(name, gains)); saveCustomEqPresets(); return; }
    }
    customEqPresets.add(new EqPreset(name, gains));
    saveCustomEqPresets();
  }
  /** Only ever called on a custom preset's own delete button, so there's no built-in name to accidentally match — still scoped to customEqPresets regardless, since built-ins live in a separate fixed array entirely. */
  private void deleteEqPreset(String name) {
    for (int i = 0; i < customEqPresets.size(); i++) {
      if (customEqPresets.get(i).name.equals(name)) { customEqPresets.remove(i); saveCustomEqPresets(); return; }
    }
  }
  private void seek(int seconds) { if (player == null) return; seekTo(player.getMicrosecondPosition() + seconds * 1_000_000L); }
  /** Absolute-position counterpart to seek()'s relative offset — shared tail logic (clamp, apply, sync the progress bar/elapsed label/lyrics highlight) factored out so click-to-seek on a lyric line can jump straight to that line's timestamp instead of stepping by a fixed number of seconds. */
  private void seekTo(long micros) {
    if (player == null) return;
    long duration = player.getMicrosecondLength();
    long target = Math.max(0, Math.min(duration, micros));
    player.setMicrosecondPosition(target);
    progress.setValue(duration == 0 ? 0 : (int) (target * 1000 / duration));
    elapsed.setText(format(target));
    syncMiniProgress();
    if (lyricsOverlay != null && lyricsOverlay.isVisible()) updateLyricsSync();
  }
  /**
   * Mirrors progress/elapsed/length's just-updated state onto the Mini Mode window's own small widgets. Called
   * right after every place those three change (load(), resetPlaybackToIdle(), restoreQueueState(), seekTo(),
   * tick()) rather than re-parenting the live shared components themselves — progress/elapsed/length are built
   * once inside playerPanel() and wired directly to player state, and moving actual JComponents in and out of
   * that tree on every Mini Mode toggle risks disturbing their listeners for no real benefit when a plain mirror
   * is this cheap. Gated on miniModeEnabled purely to skip pointless repaints while the window isn't showing it.
   */
  private void syncMiniProgress() {
    if (!miniModeEnabled) return;
    miniProgress.setValue(progress.getValue());
    miniElapsed.setText(elapsed.getText());
    miniLength.setText(length.getText());
  }
  private void tick(ActionEvent event) {
    if (player == null || adjusting) return;
    long duration = player.getMicrosecondLength(); long position = player.getMicrosecondPosition();
    progress.setValue(duration == 0 ? 0 : (int) (position * 1000 / duration)); elapsed.setText(format(position));
    syncMiniProgress();
    double[] levels = computeLevels(5, 90);
    if (levels != null) {
      double instantEnergy = 0; for (double v : levels) instantEnergy += v; instantEnergy /= levels.length;
      updateBeatDetection(instantEnergy);
      if (beatPulse > 0) for (int i = 0; i < levels.length; i++) levels[i] = Math.min(1.0, levels[i] * (1 + beatPulse * 0.6));
      visualizer.setLevels(levels);
    } else {
      visualizer.setLevels(fallbackLevels());
    }
    if (lyricsOverlay != null && lyricsOverlay.isVisible()) updateLyricsSync();
    int fadeSeconds = crossfadeSlider.getValue();
    // allowCrossfade=true only here: this is the one path where the queue is naturally advancing on its own,
    // not the user actively choosing a different track (see load()'s allowCrossfade doc for the full rationale).
    // repeat-one is checked first, unconditionally — matching trackFinished()'s priority — since with it on the
    // track always loops regardless of queue position; checking nextIndex() first here would crossfade into the
    // next queue track instead of looping whenever repeat-one was on but the current track wasn't the last one.
    if (!crossfadeStarted && fadeSeconds > 0 && duration > 0 && duration - position <= fadeSeconds * 1_000_000L) {
      if (repeatMode == RepeatMode.ONE && loadedFile != null) { crossfadeStarted = true; load(loadedFile, true, true); } // seamless loop crossfade back into the same track
      else {
        int next = nextIndex();
        if (next < 0 && repeatMode == RepeatMode.ALL && !queue.isEmpty()) next = 0; // wrap back to the start, same as trackFinished()
        if (next >= 0) { crossfadeStarted = true; queueIndex = next; load(queue.get(queueIndex), true, true); }
      }
    }
  }
  /** Feeds one more instant-energy sample into the rolling history and decides whether this tick counts as a beat — see beatEnergyHistory's field comment for the technique. beatPulse decays a bit each tick regardless, so a detected beat reads as a snap-and-fade pulse rather than a hard on/off flicker. */
  private void updateBeatDetection(double instantEnergy) {
    double sum = 0;
    for (double e : beatEnergyHistory) sum += e;
    double average = sum / beatEnergyHistory.length;
    boolean isBeat = instantEnergy > 0.015 && instantEnergy > average * 1.4;
    beatEnergyHistory[beatEnergyHistoryIndex] = instantEnergy;
    beatEnergyHistoryIndex = (beatEnergyHistoryIndex + 1) % beatEnergyHistory.length;
    beatPulse = isBeat ? 1.0 : Math.max(0, beatPulse - BEAT_DECAY_PER_TICK);
  }
  private void setPlaying(boolean playing) {
    disc.setSpinning(playing); play.setGlyph(playing ? Glyph.PAUSE : Glyph.PLAY); play.pulse();
    if (miniPlayButton != null) { miniPlayButton.setGlyph(playing ? Glyph.PAUSE : Glyph.PLAY); miniPlayButton.pulse(); }
    status.setText(playing ? "●  NOW SPINNING" : (loadedFile == null ? "●  READY TO PLAY" : "●  PAUSED"));
    visualizer.setActive(playing);
    if (playing) clock.start(); else clock.stop();
  }
  private double[] computeLevels(int bars, int windowMillis) {
    try {
      if (rawAudio == null || audioFormat == null || player == null) return null;
      AudioFormat.Encoding encoding = audioFormat.getEncoding();
      if (encoding != AudioFormat.Encoding.PCM_SIGNED && encoding != AudioFormat.Encoding.PCM_UNSIGNED) return null;
      int frameSize = audioFormat.getFrameSize();
      int bytesPerSample = audioFormat.getSampleSizeInBits() / 8;
      if (frameSize <= 0 || bytesPerSample <= 0) return null;
      boolean bigEndian = audioFormat.isBigEndian();
      boolean unsigned = encoding == AudioFormat.Encoding.PCM_UNSIGNED;
      int totalFrames = rawAudio.length / frameSize;
      int windowFrames = Math.max(bars, (int) (audioFormat.getFrameRate() * windowMillis / 1000.0));
      long framePos = player.getFramePosition();
      int startFrame = (int) Math.min(Math.max(0, framePos), Math.max(0, totalFrames - windowFrames));
      int framesPerBar = Math.max(1, windowFrames / bars);
      double maxAmp = bytesPerSample >= 3 ? 32768.0 * 256 : (bytesPerSample == 2 ? 32768.0 : 128.0);
      double[] levels = new double[bars];
      for (int bar = 0; bar < bars; bar++) {
        long sumSquares = 0; int count = 0;
        int bandStart = startFrame + bar * framesPerBar, bandEnd = Math.min(totalFrames, bandStart + framesPerBar);
        for (int f = bandStart; f < bandEnd; f++) {
          int offset = f * frameSize;
          if (offset + bytesPerSample > rawAudio.length) break;
          int sample = readSample(rawAudio, offset, bytesPerSample, bigEndian, unsigned);
          sumSquares += (long) sample * sample; count++;
        }
        double rms = count > 0 ? Math.sqrt((double) sumSquares / count) : 0;
        levels[bar] = Math.min(1.0, (rms / maxAmp) * 3.4);
      }
      return levels;
    } catch (Exception ignored) { return null; }
  }
  private static int readSample(byte[] data, int offset, int bytesPerSample, boolean bigEndian, boolean unsigned) {
    if (bytesPerSample == 1) { int v = data[offset] & 0xFF; return unsigned ? v - 128 : (byte) v; }
    int b0 = data[offset] & 0xFF, b1 = offset + 1 < data.length ? data[offset + 1] & 0xFF : 0;
    int value = bigEndian ? ((b0 << 8) | b1) : ((b1 << 8) | b0);
    return unsigned ? value - 32768 : (short) value;
  }
  /**
   * Scans the *whole* track (unlike computeLevels(), which only looks at a small window around the current
   * position) to build a fixed-size amplitude summary for the progress bar's waveform — cheap enough (a single
   * pass over already-decoded PCM) that it doesn't need caching to disk, but still dispatched on a background
   * thread from load() rather than blocking track-load itself, since a long track is a few tens of millions of
   * samples. The audioBytesSnapshot identity check in the caller guards against a stale result from a track
   * that's since been replaced by a fast next/previous landing after this finishes.
   */
  private void computeWaveformAsync(byte[] audioBytesSnapshot, AudioFormat formatSnapshot) {
    Thread worker = new Thread(() -> {
      float[] data = computeWaveformSync(audioBytesSnapshot, formatSnapshot, 220);
      SwingUtilities.invokeLater(() -> { if (audioBytesSnapshot == rawAudio) waveformSliderUI.setWaveform(data); });
    }, "cdplayer-waveform");
    worker.setDaemon(true);
    worker.start();
  }
  private static float[] computeWaveformSync(byte[] audioBytes, AudioFormat format, int buckets) {
    try {
      if (audioBytes == null || format == null) return null;
      AudioFormat.Encoding encoding = format.getEncoding();
      if (encoding != AudioFormat.Encoding.PCM_SIGNED && encoding != AudioFormat.Encoding.PCM_UNSIGNED) return null;
      int frameSize = format.getFrameSize();
      int bytesPerSample = format.getSampleSizeInBits() / 8;
      if (frameSize <= 0 || bytesPerSample <= 0) return null;
      boolean bigEndian = format.isBigEndian();
      boolean unsigned = encoding == AudioFormat.Encoding.PCM_UNSIGNED;
      int totalFrames = audioBytes.length / frameSize;
      if (totalFrames <= 0) return null;
      int framesPerBucket = Math.max(1, totalFrames / buckets);
      double[] rmsPerBucket = new double[buckets];
      double peak = 0;
      for (int b = 0; b < buckets; b++) {
        long sumSquares = 0; int count = 0;
        int startFrame = b * framesPerBucket, endFrame = Math.min(totalFrames, startFrame + framesPerBucket);
        for (int f = startFrame; f < endFrame; f++) {
          int offset = f * frameSize;
          if (offset + bytesPerSample > audioBytes.length) break;
          int sample = readSample(audioBytes, offset, bytesPerSample, bigEndian, unsigned);
          sumSquares += (long) sample * sample; count++;
        }
        double rms = count > 0 ? Math.sqrt((double) sumSquares / count) : 0;
        rmsPerBucket[b] = rms;
        peak = Math.max(peak, rms);
      }
      // Normalized against this track's own loudest bucket, not a fixed fraction of the theoretical sample-format
      // ceiling (what computeLevels() does, tuned for the live visualizer's much shorter window) — a full-track
      // RMS-per-bucket scan naturally averages out transients into a smoother, generally louder-reading baseline,
      // and different masters sit at very different overall loudness levels. Without per-track normalization,
      // most buckets clipped to the visual max and the waveform read as an almost flat line.
      float[] result = new float[buckets];
      if (peak > 0) for (int b = 0; b < buckets; b++) result[b] = (float) Math.min(1.0, rmsPerBucket[b] / peak);
      return result;
    } catch (Exception ignored) { return null; }
  }
  private double[] fallbackLevels() {
    double t = System.nanoTime() / 1e8;
    double[] levels = new double[5];
    for (int i = 0; i < levels.length; i++) levels[i] = 0.32 + 0.32 * Math.abs(Math.sin(t + i * 0.6));
    return levels;
  }
  private static String format(long micros) { long seconds = micros / 1_000_000L; return String.format("%d:%02d", seconds / 60, seconds % 60); }
  private static String formatDuration(long micros) { return micros <= 0 ? "--:--" : format(micros); }
  private long getDuration(File file) {
    Long cached = durationCache.get(file);
    if (cached != null) return cached;
    long micros = probeDuration(file);
    durationCache.put(file, micros);
    return micros;
  }
  private static long probeDuration(File file) {
    try (AudioInputStream stream = AudioSystem.getAudioInputStream(file)) {
      AudioFormat format = stream.getFormat();
      long frames = stream.getFrameLength();
      if (frames > 0 && format.getFrameRate() > 0) return (long) (frames / format.getFrameRate() * 1_000_000L);
    } catch (Exception ignored) { /* not natively decodable, e.g. flac/m4a; fall through to ffprobe */ }
    Process probe = null;
    try {
      probe = new ProcessBuilder(resolveBinary("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file.getAbsolutePath()).redirectErrorStream(true).start();
      String output = new String(readAll(probe.getInputStream()), StandardCharsets.UTF_8).trim();
      probe.waitFor();
      return (long) (Double.parseDouble(output) * 1_000_000L);
    } catch (Exception ignored) { return 0L; }
    finally { if (probe != null) closeProcessStreams(probe); }
  }
  private static String escape(String value) { return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); }
  /**
   * Sets the now-playing title and (when present) author, shrinking each label's font to fit before falling back
   * to an ellipsis, so none of the four boxes involved (normal-view title/artist, CD-view title/artist) ever have
   * to change size. CD view's copies get their own, wider fit pass rather than reusing the normal-view text as-is
   * (already possibly truncated for its narrower box) — cdViewTrackLabel/cdViewArtistLabel now sit in a
   * full-width footer at the bottom of the window (see createContent()'s cdViewInfoPanel), not squeezed under
   * the disc, so they have much more room to work with.
   */
  private void setTrackTitle(String name, String artist) {
    currentTrackName = name; currentTrackArtist = artist;
    fitText(track, name, 456, 34, 20, true);
    fitText(cdViewTrackLabel, name, 860, 30, 18, true);
    boolean hasArtist = artist != null && !artist.trim().isEmpty();
    artistLabel.setVisible(hasArtist);
    cdViewArtistLabel.setVisible(hasArtist);
    if (hasArtist) {
      fitText(artistLabel, artist, 456, 15, 12, false);
      fitText(cdViewArtistLabel, artist, 860, 18, 13, false);
    } else {
      artistLabel.setText(""); cdViewArtistLabel.setText("");
    }
    // Mini Mode gets its own title + artist lines, same hasArtist-visibility pattern as the main/CD-View labels
    // above, rather than one combined "Artist – Title" line: a long title and a long artist name were fighting
    // over the same fitText budget on one line, so a long-enough combination lost both to a single ellipsis
    // instead of at least the title staying legible on its own line.
    fitText(miniTrackLabel, name, 220, 13, 10, true);
    miniArtistLabel.setVisible(hasArtist);
    if (hasArtist) fitText(miniArtistLabel, artist, 220, 10, 8, false); else miniArtistLabel.setText("");
  }
  /** Shrinks label's font from startSize down to minSize (stepping by 1pt) until text fits maxWidth, falling back to an ellipsis if it still doesn't fit at minSize. */
  private static void fitText(JLabel label, String text, int maxWidth, int startSize, int minSize, boolean bold) {
    int size = startSize;
    Font font = new Font("SansSerif", bold ? Font.BOLD : Font.PLAIN, size);
    java.awt.FontMetrics metrics = label.getFontMetrics(font);
    while (metrics.stringWidth(text) > maxWidth && size > minSize) {
      size--;
      font = new Font("SansSerif", bold ? Font.BOLD : Font.PLAIN, size);
      metrics = label.getFontMetrics(font);
    }
    label.setFont(font);
    label.setText("<html>" + escape(ellipsize(label, text, maxWidth)) + "</html>");
  }
  /**
   * Fades the track title, artist, and source labels in from transparent to their current theme color, so a new
   * track's info eases into view instead of just snapping into place. Reads TEXT/ACCENT2/MUTED live on every tick
   * rather than capturing a fixed target color once at the start: this is called from load() BEFORE disc.setCover()
   * — which is what actually triggers an AUTO theme re-derivation for the new track's (possibly missing) cover art
   * — so a frozen snapshot taken here would still be the PREVIOUS track's colors. That previously left these three
   * labels visibly mismatched against the rest of the UI (an artist name in an old track's accent color, while
   * everything else — the disc, buttons — had already moved on to the new one) any time AUTO's derived palette
   * actually changed between tracks, which a missing cover falling back to the placeholder palette makes obvious.
   * Reading the live fields sidesteps the ordering issue entirely and self-corrects even if the AUTO re-derivation
   * is itself still mid-transition when this fade finishes.
   */
  private void fadeInNowPlaying() {
    if (nowPlayingFadeTimer != null && nowPlayingFadeTimer.isRunning()) nowPlayingFadeTimer.stop();
    if (!animationsEnabled) {
      track.setForeground(TEXT); artistLabel.setForeground(ACCENT2); source.setForeground(MUTED);
      return;
    }
    final int steps = 6;
    final int[] step = { 0 };
    nowPlayingFadeTimer = new Timer(8, null);
    nowPlayingFadeTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      int alpha = (int) (255 * t);
      track.setForeground(new Color(TEXT.getRed(), TEXT.getGreen(), TEXT.getBlue(), alpha));
      artistLabel.setForeground(new Color(ACCENT2.getRed(), ACCENT2.getGreen(), ACCENT2.getBlue(), alpha));
      source.setForeground(new Color(MUTED.getRed(), MUTED.getGreen(), MUTED.getBlue(), alpha));
      if (t >= 1f) ((Timer) e.getSource()).stop();
    });
    nowPlayingFadeTimer.start();
  }
  private static String ellipsize(JLabel label, String text, int maxWidth) {
    java.awt.FontMetrics metrics = label.getFontMetrics(label.getFont());
    if (metrics.stringWidth(text) <= maxWidth) return text;
    int ellipsisWidth = metrics.stringWidth("…");
    StringBuilder builder = new StringBuilder();
    int width = 0;
    for (int i = 0; i < text.length(); i++) {
      int charWidth = metrics.charWidth(text.charAt(i));
      if (width + charWidth + ellipsisWidth > maxWidth) break;
      builder.append(text.charAt(i)); width += charWidth;
    }
    return builder.toString() + "…";
  }
  private static JLabel label(String value, int size, Color color) { JLabel result = new JLabel("<html>" + value.replace("\n", "<br>") + "</html>"); result.setForeground(color); result.setFont(new Font("SansSerif", Font.BOLD, size)); return result; }
  private static JButton roundButton(Glyph glyph, int size, boolean primary) { return new TransportButton(glyph, size, primary); }
  /** Which vector icon a TransportButton draws. PLAY/PAUSE are swapped on the same button as playback toggles. */
  private enum Glyph { PLAY, PAUSE, PREVIOUS_TRACK, NEXT_TRACK, SKIP_BACK_15, SKIP_FORWARD_15, SHUFFLE, REPEAT }
  private static JButton textButton(String caption) { return new PillButton(caption); }

  /**
   * A small, reusable 0..1 progress value that eases toward 1 while hovered and back to 0 when the pointer
   * leaves, driven by a short-lived Timer (auto-stops once the target is reached, so it costs nothing while
   * idle) instead of every hoverable component rolling its own copy of the same fade logic. Components read
   * {@link #value()} in paintComponent to blend their hover-highlight alpha/color instead of snapping between
   * two fixed states. {@link #forButton} wires this to a button's own rollover state automatically; components
   * with no ButtonModel (e.g. a plain JPanel acting as a link) call {@link #set} from their own mouse listener.
   */
  private static final class HoverFade {
    private float value;
    private boolean lastHovered;
    private Timer timer;
    private final Runnable onRepaint;
    HoverFade(Runnable onRepaint) { this.onRepaint = onRepaint; }
    static HoverFade forButton(javax.swing.AbstractButton owner) {
      HoverFade fade = new HoverFade(owner::repaint);
      owner.getModel().addChangeListener(e -> fade.set(owner.getModel().isRollover()));
      return fade;
    }
    void set(boolean hovered) {
      if (hovered == lastHovered) return;
      lastHovered = hovered;
      if (timer != null && timer.isRunning()) timer.stop();
      final float start = value, target = hovered ? 1f : 0f;
      if (!animationsEnabled) { value = target; onRepaint.run(); return; }
      final int steps = 4; // hover fades are subtle and frequent, so keep them quick and cheap
      final int[] step = { 0 };
      timer = new Timer(8, null);
      timer.addActionListener(e -> {
        step[0]++;
        float t = Math.min(1f, step[0] / (float) steps);
        value = start + (target - start) * t;
        onRepaint.run();
        if (t >= 1f) ((Timer) e.getSource()).stop();
      });
      timer.start();
    }
    float value() { return value; }
  }
  /** Wires a HoverFade to a plain button that isn't custom-painted (no paintComponent override to read hover.value() from), animating its foreground color between two fixed colors on hover instead of the color just snapping. */
  private static void attachColorHover(javax.swing.AbstractButton button, Color from, Color to) {
    HoverFade[] holder = new HoverFade[1];
    holder[0] = new HoverFade(() -> button.setForeground(lerp(from, to, holder[0].value())));
    button.getModel().addChangeListener(e -> holder[0].set(button.getModel().isRollover()));
  }

  private static final class PillButton extends JButton {
    private final HoverFade hover = HoverFade.forButton(this);
    private float onProgress; // 0 = off-look, 1 = on-look (gradient) — only meaningful for on/off toggle buttons like Mono Audio
    private float scale = 1f;
    private Timer transitionTimer, pulseTimer;
    PillButton(String caption) {
      super(caption); setFont(new Font("SansSerif", Font.BOLD, 11)); setForeground(TEXT); setFocusPainted(false); setFocusable(false); setBorderPainted(false); setContentAreaFilled(false); setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); setBorder(BorderFactory.createEmptyBorder(8, 16, 8, 16)); setAlignmentY(Component.CENTER_ALIGNMENT);
      onProgress = isOn(caption) ? 1f : 0f;
    }
    private static boolean isOn(String text) { return text != null && text.endsWith("ON"); }
    /** Detects an ON/OFF text flip (used by the Mono Audio toggle) and eases the fill between the two looks instead of it snapping, mirroring {@link ModeIconButton}. Buttons whose text never ends in "ON"/"OFF" (Load a Track, Clear Queue, Close, the theme name) are unaffected — wasOn == nowOn == false throughout. */
    public void setText(String text) {
      boolean wasOn = isOn(getText());
      super.setText(text);
      boolean nowOn = isOn(text);
      if (wasOn != nowOn) { animateTransition(nowOn); pulse(); }
    }
    private void animateTransition(boolean on) {
      if (transitionTimer != null && transitionTimer.isRunning()) transitionTimer.stop();
      final float start = onProgress, target = on ? 1f : 0f;
      if (!animationsEnabled) { onProgress = target; repaint(); return; }
      final int steps = 6;
      final int[] step = { 0 };
      transitionTimer = new Timer(8, null);
      transitionTimer.addActionListener(e -> {
        step[0]++;
        float t = Math.min(1f, step[0] / (float) steps);
        onProgress = start + (target - start) * t;
        repaint();
        if (t >= 1f) ((Timer) e.getSource()).stop();
      });
      transitionTimer.start();
    }
    private void pulse() {
      if (!animationsEnabled) return;
      if (pulseTimer != null && pulseTimer.isRunning()) pulseTimer.stop();
      final int steps = 5;
      final int[] step = { 0 };
      pulseTimer = new Timer(8, null);
      pulseTimer.addActionListener(e -> {
        step[0]++;
        float t = Math.min(1f, step[0] / (float) steps);
        scale = 1f - 0.08f * (float) Math.sin(Math.PI * t); // a touch subtler than the round icon buttons' pulse — this shape reads busier when squished
        repaint();
        if (t >= 1f) { ((Timer) e.getSource()).stop(); scale = 1f; }
      });
      pulseTimer.start();
    }
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      int w = getWidth(), h = getHeight(), arc = h;
      if (scale != 1f) { g.translate(w / 2.0, h / 2.0); g.scale(scale, scale); g.translate(-w / 2.0, -h / 2.0); }
      int offAlpha = 12 + Math.round(8 * hover.value());
      g.setColor(new Color(255, 255, 255, offAlpha)); g.fillRoundRect(0, 0, w, h, arc, arc);
      g.setColor(new Color(255, 255, 255, 26)); g.setStroke(new BasicStroke(1)); g.drawRoundRect(0, 0, w - 1, h - 1, arc, arc);
      if (onProgress > 0f) {
        java.awt.Composite original = g.getComposite();
        g.setComposite(java.awt.AlphaComposite.getInstance(java.awt.AlphaComposite.SRC_OVER, onProgress));
        g.setPaint(new GradientPaint(0, 0, ACCENT, w, h, ACCENT2));
        g.fillRoundRect(0, 0, w, h, arc, arc);
        g.setComposite(original);
      }
      g.dispose();
      Color base = lerp(MUTED, BG, onProgress);
      setForeground(isEnabled() ? base : new Color(base.getRed(), base.getGreen(), base.getBlue(), 100));
      super.paintComponent(raw);
    }
  }

  private static final class TransportButton extends JButton {
    private final boolean primary;
    private final HoverFade hover = HoverFade.forButton(this);
    private Glyph glyph;
    private float scale = 1f;
    private Timer pulseTimer;
    TransportButton(Glyph glyph, int size, boolean primary) {
      this.glyph = glyph; this.primary = primary;
      setForeground(primary ? BG : TEXT); setFocusPainted(false); setFocusable(false); setBorderPainted(false); setContentAreaFilled(false); setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
      // Locking min = preferred = max is required, not just preferred+max: this button has no text, so the
      // look-and-feel's own computed minimum size can be small and arbitrary (observed varying run-to-run on
      // Aqua), and BoxLayout is free to shrink a component down to its minimumSize under space pressure. Without
      // an explicit minimum matching the intended square size, that shrink could squash the circle into an oval.
      Dimension fixed = new Dimension(size, size);
      setMinimumSize(fixed); setPreferredSize(fixed); setMaximumSize(fixed);
    }
    /** Swaps which icon is drawn without needing a new button (used to flip PLAY/PAUSE in place). */
    void setGlyph(Glyph value) { if (glyph == value) return; glyph = value; repaint(); }
    /** A quick squish-and-recover scale animation, played whenever playback toggles, so the button reacts instead of the icon just silently flipping. */
    void pulse() {
      if (!animationsEnabled) return;
      if (pulseTimer != null && pulseTimer.isRunning()) pulseTimer.stop();
      final int steps = 5;
      final int[] step = { 0 };
      pulseTimer = new Timer(8, null);
      pulseTimer.addActionListener(e -> {
        step[0]++;
        float t = Math.min(1f, step[0] / (float) steps);
        scale = 1f - 0.12f * (float) Math.sin(Math.PI * t); // dips to 0.88 at the midpoint, back to 1.0 at the end
        repaint();
        if (t >= 1f) { ((Timer) e.getSource()).stop(); scale = 1f; }
      });
      pulseTimer.start();
    }
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      int width = getWidth(), height = getHeight();
      if (scale != 1f) { g.translate(width / 2.0, height / 2.0); g.scale(scale, scale); g.translate(-width / 2.0, -height / 2.0); }
      if (primary) {
        if (getModel().isPressed()) g.setPaint(new GradientPaint(0, 0, ACCENT.darker(), width, height, ACCENT2.darker()));
        else g.setPaint(new GradientPaint(0, 0, ACCENT, width, height, ACCENT2));
        g.fillOval(0, 0, width, height);
      } else {
        g.setColor(new Color(255,255,255, 12 + Math.round(10 * hover.value()))); g.fillOval(0, 0, width, height);
        g.setColor(new Color(255,255,255, 30)); g.setStroke(new BasicStroke(1)); g.drawOval(0, 0, width - 1, height - 1);
      }
      g.setColor(getForeground());
      drawGlyph(g, width, height);
      g.dispose();
    }
    private void drawGlyph(Graphics2D g, int w, int h) {
      switch (glyph) {
        case PLAY: drawPlay(g, w, h); break;
        case PAUSE: drawPause(g, w, h); break;
        case PREVIOUS_TRACK: drawTrackSkip(g, w, h, false); break;
        case NEXT_TRACK: drawTrackSkip(g, w, h, true); break;
        case SKIP_BACK_15: drawSeek15(g, w, h, false); break;
        case SKIP_FORWARD_15: drawSeek15(g, w, h, true); break;
      }
    }
    private static void drawPlay(Graphics2D g, int w, int h) {
      int cx = w / 2, cy = h / 2;
      int triW = (int) (w * 0.34), triH = (int) (h * 0.40);
      int nudge = (int) (w * 0.04); // triangles read as optically off-center; nudge right to compensate
      int left = cx - triW / 2 + nudge, right = left + triW;
      g.fillPolygon(new int[] { left, left, right }, new int[] { cy - triH / 2, cy + triH / 2, cy }, 3);
    }
    private static void drawPause(Graphics2D g, int w, int h) {
      int cx = w / 2, cy = h / 2;
      int barW = Math.max(2, (int) (w * 0.11)), barH = (int) (h * 0.38), gap = (int) (w * 0.12);
      g.fillRoundRect(cx - gap / 2 - barW, cy - barH / 2, barW, barH, 2, 2);
      g.fillRoundRect(cx + gap / 2, cy - barH / 2, barW, barH, 2, 2);
    }
    /** Previous/next track: a filled triangle chevron plus the trailing bar of a classic media "skip" icon. */
    private static void drawTrackSkip(Graphics2D g, int w, int h, boolean forward) {
      int cx = w / 2, cy = h / 2;
      int barW = Math.max(2, (int) (w * 0.09)), barH = (int) (h * 0.42);
      int triW = (int) (w * 0.26), triH = (int) (h * 0.42);
      int dir = forward ? 1 : -1;
      int barX = cx + dir * (int) (w * 0.20) - (forward ? 0 : barW);
      g.fillRoundRect(barX, cy - barH / 2, barW, barH, 2, 2);
      int triNearX = cx - dir * (int) (w * 0.06); // triangle edge nearer to center
      int triFarX = triNearX + dir * triW;         // triangle apex, pointing away from center
      g.fillPolygon(new int[] { triFarX, triNearX, triNearX }, new int[] { cy, cy - triH / 2, cy + triH / 2 }, 3);
    }
    /** Skip back/forward 15s: a partial ring with an arrowhead showing rotation direction, "15" in the middle — the same shape apps like Overcast/Apple Podcasts use for their skip controls. */
    private static void drawSeek15(Graphics2D g, int w, int h, boolean forward) {
      double cx = w / 2.0, cy = h / 2.0;
      // r is deliberately well inside the button's own radius (min(w,h)/2): the arrowhead tip extends past r by
      // arrowLen, and needs to still land inside the circular button background instead of poking outside it.
      double r = Math.min(w, h) * 0.30;
      int gapHalf = 35; // degrees of gap on each side of top-center, so the ring reads as "open" at the top
      float ringWidth = Math.max(1.4f, w * 0.045f);
      g.setStroke(new BasicStroke(ringWidth, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
      int diameter = (int) (r * 2);
      int arcX = (int) (cx - r), arcY = (int) (cy - r);
      double endAngleDeg;
      if (forward) { g.drawArc(arcX, arcY, diameter, diameter, 90 - gapHalf, -(360 - 2 * gapHalf)); endAngleDeg = 90 + gapHalf; }
      else { g.drawArc(arcX, arcY, diameter, diameter, 90 + gapHalf, 360 - 2 * gapHalf); endAngleDeg = 90 - gapHalf; }
      double rad = Math.toRadians(endAngleDeg);
      double px = cx + r * Math.cos(rad), py = cy - r * Math.sin(rad);
      // tangent direction at this point, walking the ring the same way it was just drawn (clockwise for forward, counter-clockwise for back)
      double dx = forward ? Math.sin(rad) : -Math.sin(rad);
      double dy = forward ? Math.cos(rad) : -Math.cos(rad);
      double arrowLen = r * 0.45, arrowHalf = r * 0.40;
      double tipX = px + dx * arrowLen, tipY = py + dy * arrowLen;
      double perpX = -dy, perpY = dx;
      int[] xs = { (int) tipX, (int) (px + perpX * arrowHalf), (int) (px - perpX * arrowHalf) };
      int[] ys = { (int) tipY, (int) (py + perpY * arrowHalf), (int) (py - perpY * arrowHalf) };
      g.fillPolygon(xs, ys, 3);
      g.setFont(new Font("SansSerif", Font.BOLD, Math.max(8, (int) (w * 0.30))));
      java.awt.FontMetrics fm = g.getFontMetrics();
      String label = "15";
      g.drawString(label, (int) (cx - fm.stringWidth(label) / 2.0), (int) (cy + fm.getAscent() / 2.0) - 1);
    }
  }

  /** Draws a straight line that stops short of (x2, y2) and caps it with a filled triangular arrowhead pointing along the line's direction — shared by the shuffle and repeat glyphs below. */
  private static void drawArrowSegment(Graphics2D g, double x1, double y1, double x2, double y2, double arrowLen, double arrowHalf) {
    double dx = x2 - x1, dy = y2 - y1;
    double len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    double ux = dx / len, uy = dy / len;
    double lineEndX = x2 - ux * arrowLen * 0.6, lineEndY = y2 - uy * arrowLen * 0.6;
    g.draw(new java.awt.geom.Line2D.Double(x1, y1, lineEndX, lineEndY));
    double baseX = x2 - ux * arrowLen, baseY = y2 - uy * arrowLen;
    double perpX = -uy, perpY = ux;
    int[] xs = { (int) x2, (int) (baseX + perpX * arrowHalf), (int) (baseX - perpX * arrowHalf) };
    int[] ys = { (int) y2, (int) (baseY + perpY * arrowHalf), (int) (baseY - perpY * arrowHalf) };
    g.fillPolygon(xs, ys, 3);
  }
  /** Two crossing diagonals, each ending in an arrowhead — the standard "shuffle" glyph. */
  private static void drawShuffleGlyph(Graphics2D g, int w, int h) {
    g.setStroke(new BasicStroke(Math.max(1.5f, w * 0.075f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
    double x1 = w * 0.20, x2 = w * 0.76, top = h * 0.28, bottom = h * 0.72;
    double arrowLen = w * 0.15, arrowHalf = w * 0.11;
    drawArrowSegment(g, x1, top, x2, bottom, arrowLen, arrowHalf);
    drawArrowSegment(g, x1, bottom, x2, top, arrowLen, arrowHalf);
  }
  /** An open rectangular loop with an arrowhead on each of two opposite corners — the standard "repeat" glyph. */
  private static void drawRepeatGlyph(Graphics2D g, int w, int h) {
    g.setStroke(new BasicStroke(Math.max(1.5f, w * 0.075f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
    double left = w * 0.24, right = w * 0.76, top = h * 0.30, bottom = h * 0.70, mid = h * 0.50;
    double arrowLen = w * 0.14, arrowHalf = w * 0.11;
    g.draw(new java.awt.geom.Line2D.Double(left, top, right, top));
    drawArrowSegment(g, right, top, right, mid, arrowLen, arrowHalf);
    g.draw(new java.awt.geom.Line2D.Double(right, bottom, left, bottom));
    drawArrowSegment(g, left, bottom, left, mid, arrowLen, arrowHalf);
  }
  /** A circular toggle button for the shuffle/repeat modes: gradient-filled when on, translucent outline when off — mirrors {@link TransportButton}'s style but tracks a persistent on/off state instead of momentary presses. */
  private static final class ModeIconButton extends JButton {
    private final HoverFade hover = HoverFade.forButton(this);
    private final Glyph glyph;
    private boolean on;
    private float onProgress; // 0 = fully off, 1 = fully on; animates between them instead of snapping
    private float scale = 1f;
    private String badgeText; // small text drawn over the glyph (e.g. "1" for repeat-one); null = no badge
    private Timer transitionTimer, pulseTimer;
    ModeIconButton(Glyph glyph, String tooltip) {
      this.glyph = glyph;
      setToolTipText(tooltip);
      setFocusPainted(false); setFocusable(false); setBorderPainted(false); setContentAreaFilled(false); setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
      setAlignmentY(Component.CENTER_ALIGNMENT);
      Dimension fixed = new Dimension(40, 40);
      setMinimumSize(fixed); setPreferredSize(fixed); setMaximumSize(fixed);
    }
    void setBadge(String text) { if (java.util.Objects.equals(badgeText, text)) return; badgeText = text; repaint(); }
    void setOn(boolean value) {
      if (on == value) return;
      on = value;
      animateTransition();
      pulse();
    }
    /** Eases onProgress toward the new on/off state instead of the fill just snapping between the two looks. */
    private void animateTransition() {
      if (transitionTimer != null && transitionTimer.isRunning()) transitionTimer.stop();
      final float start = onProgress, target = on ? 1f : 0f;
      if (!animationsEnabled) { onProgress = target; repaint(); return; }
      final int steps = 6;
      final int[] step = { 0 };
      transitionTimer = new Timer(8, null);
      transitionTimer.addActionListener(e -> {
        step[0]++;
        float t = Math.min(1f, step[0] / (float) steps);
        onProgress = start + (target - start) * t;
        repaint();
        if (t >= 1f) ((Timer) e.getSource()).stop();
      });
      transitionTimer.start();
    }
    /** Same squish-and-recover feedback as the transport buttons, played on every toggle. */
    private void pulse() {
      if (!animationsEnabled) return;
      if (pulseTimer != null && pulseTimer.isRunning()) pulseTimer.stop();
      final int steps = 5;
      final int[] step = { 0 };
      pulseTimer = new Timer(8, null);
      pulseTimer.addActionListener(e -> {
        step[0]++;
        float t = Math.min(1f, step[0] / (float) steps);
        scale = 1f - 0.12f * (float) Math.sin(Math.PI * t);
        repaint();
        if (t >= 1f) { ((Timer) e.getSource()).stop(); scale = 1f; }
      });
      pulseTimer.start();
    }
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      int w = getWidth(), h = getHeight();
      if (scale != 1f) { g.translate(w / 2.0, h / 2.0); g.scale(scale, scale); g.translate(-w / 2.0, -h / 2.0); }
      // Off-state look is always drawn first; the gradient fades in over it via onProgress, so both endpoints
      // match the original instant on/off rendering exactly, with a smooth crossfade in between.
      g.setColor(new Color(255, 255, 255, 12 + Math.round(10 * hover.value()))); g.fillOval(0, 0, w, h);
      g.setColor(new Color(255, 255, 255, 30)); g.setStroke(new BasicStroke(1)); g.drawOval(0, 0, w - 1, h - 1);
      if (onProgress > 0f) {
        java.awt.Composite original = g.getComposite();
        g.setComposite(java.awt.AlphaComposite.getInstance(java.awt.AlphaComposite.SRC_OVER, onProgress));
        g.setPaint(new GradientPaint(0, 0, ACCENT, w, h, ACCENT2));
        g.fillOval(0, 0, w, h);
        g.setComposite(original);
      }
      g.setColor(lerp(TEXT, BG, onProgress));
      if (glyph == Glyph.SHUFFLE) drawShuffleGlyph(g, w, h); else drawRepeatGlyph(g, w, h);
      if (badgeText != null) {
        g.setFont(new Font("SansSerif", Font.BOLD, Math.max(8, Math.round(w * 0.28f))));
        java.awt.FontMetrics fm = g.getFontMetrics();
        g.drawString(badgeText, (w - fm.stringWidth(badgeText)) / 2f, h * 0.5f + fm.getAscent() * 0.32f);
      }
      g.dispose();
    }
  }

  /** A small "icon + username" link that opens the GitHub profile in the system browser — the URL itself is never shown, just the icon and handle. */
  private static final class GitHubLinkButton extends JPanel {
    GitHubLinkButton(String username) {
      super(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 6, 0));
      setOpaque(false);
      final HoverFade[] hover = new HoverFade[1];
      JLabel icon = new JLabel() {
        protected void paintComponent(Graphics raw) {
          Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
          g.setColor(lerp(MUTED, TEXT, hover[0].value()));
          drawCatGlyph(g, getWidth(), getHeight());
          g.dispose();
        }
      };
      icon.setPreferredSize(new Dimension(15, 15));
      JLabel name = new JLabel(username);
      name.setFont(new Font("SansSerif", Font.BOLD, 11));
      name.setForeground(MUTED);
      hover[0] = new HoverFade(() -> { name.setForeground(lerp(MUTED, TEXT, hover[0].value())); icon.repaint(); });
      add(icon); add(name);
      setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
      setToolTipText("Open GitHub profile");
      addMouseListener(new java.awt.event.MouseAdapter() {
        public void mouseClicked(java.awt.event.MouseEvent e) {
          try { java.awt.Desktop.getDesktop().browse(new java.net.URI("https://github.com/" + username)); } catch (Exception ignored) { }
        }
        public void mouseEntered(java.awt.event.MouseEvent e) { hover[0].set(true); }
        public void mouseExited(java.awt.event.MouseEvent e) { hover[0].set(false); }
      });
    }
    /** A minimal, generic cat-silhouette glyph (round head, two ear triangles) used to suggest "GitHub" alongside the username, without reproducing GitHub's own mark. */
    private static void drawCatGlyph(Graphics2D g, int w, int h) {
      double cx = w / 2.0, cy = h * 0.58;
      double r = w * 0.34;
      int earH = (int) (h * 0.30);
      g.fillPolygon(new int[]{ (int) (cx - r * 0.9), (int) (cx - r * 0.15), (int) (cx - r * 1.05) }, new int[]{ (int) (cy - r * 0.55), (int) (cy - r * 0.55), (int) (cy - r * 0.55 - earH) }, 3);
      g.fillPolygon(new int[]{ (int) (cx + r * 0.9), (int) (cx + r * 0.15), (int) (cx + r * 1.05) }, new int[]{ (int) (cy - r * 0.55), (int) (cy - r * 0.55), (int) (cy - r * 0.55 - earH) }, 3);
      g.fillOval((int) (cx - r), (int) (cy - r), (int) (r * 2), (int) (r * 2));
    }
  }

  /**
   * A flat, neutral-grey scrollbar (no arrow buttons, transparent track, a rounded grey thumb) applied to every
   * JScrollPane in the app — the system Look and Feel's default scrollbar otherwise renders with its own accent
   * color and a light track that clashes with this app's uniformly dark theme backgrounds.
   */
  private static final class GreyScrollBarUI extends BasicScrollBarUI {
    protected void configureScrollBarColors() { /* deliberately empty — colors are hardcoded directly in paintThumb/paintTrack below instead of relying on the *Color fields this would otherwise set, since we also skip the arrow buttons and default track painting entirely */ }
    protected JButton createDecreaseButton(int orientation) { return zeroSizeButton(); }
    protected JButton createIncreaseButton(int orientation) { return zeroSizeButton(); }
    private JButton zeroSizeButton() {
      JButton button = new JButton();
      button.setPreferredSize(new Dimension(0, 0));
      button.setMinimumSize(new Dimension(0, 0));
      button.setMaximumSize(new Dimension(0, 0));
      return button;
    }
    protected void paintTrack(Graphics g, javax.swing.JComponent c, java.awt.Rectangle trackBounds) { /* transparent — nothing to paint */ }
    protected void paintThumb(Graphics raw, javax.swing.JComponent c, java.awt.Rectangle thumbBounds) {
      if (thumbBounds.isEmpty() || !c.isEnabled()) return;
      Graphics2D g = (Graphics2D) raw.create();
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      g.setColor(new Color(150, 150, 150, 130));
      int inset = 2;
      g.fillRoundRect(thumbBounds.x + inset, thumbBounds.y + inset, thumbBounds.width - inset * 2, thumbBounds.height - inset * 2, 8, 8);
      g.dispose();
    }
  }
  private static class AccentSliderUI extends BasicSliderUI {
    AccentSliderUI(JSlider slider) { super(slider); }
    public void paintTrack(Graphics raw) { Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON); int y = trackRect.y + trackRect.height / 2 - 1; g.setColor(new Color(255,255,255,18)); g.fillRoundRect(trackRect.x, y, trackRect.width, 3, 3, 3); int fill = thumbRect.x + thumbRect.width / 2 - trackRect.x; g.setPaint(new GradientPaint(trackRect.x, y, ACCENT, trackRect.x + Math.max(1, fill), y, ACCENT2)); g.fillRoundRect(trackRect.x, y, Math.max(0, fill), 3, 3, 3); g.dispose(); }
    public void paintThumb(Graphics raw) { Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON); g.setColor(new Color(255,255,255,35)); g.fillOval(thumbRect.x - 3, thumbRect.y - 3, thumbRect.width + 6, thumbRect.height + 6); g.setColor(TEXT); g.fillOval(thumbRect.x, thumbRect.y, thumbRect.width, thumbRect.height); g.dispose(); }
    protected Dimension getThumbSize() { return new Dimension(11, 11); }
    // BasicSliderUI's default track click only nudges the thumb by one block increment toward the click,
    // instead of jumping straight to it, which feels laggy for a scrub bar. Map the value directly to the
    // cursor's x position on press and while dragging, so the thumb always sits exactly under the cursor.
    protected TrackListener createTrackListener(JSlider slider) {
      return new TrackListener() {
        public void mousePressed(java.awt.event.MouseEvent e) { scrubTo(e); }
        public void mouseDragged(java.awt.event.MouseEvent e) { scrubTo(e); }
        public void mouseReleased(java.awt.event.MouseEvent e) { scrubTo(e); slider.setValueIsAdjusting(false); }
        private void scrubTo(java.awt.event.MouseEvent e) {
          if (!slider.isEnabled()) return;
          slider.setValueIsAdjusting(true);
          slider.setValue(valueForXPosition(e.getX()));
        }
      };
    }
  }

  /**
   * The progress slider's UI, extended to draw a real waveform (from PCM already decoded in memory for the
   * current track — see computeWaveformSync()) instead of the plain thin line, once it's been computed. The
   * waveform bars entirely replace the base class's line-and-fill track when present; falls back to the normal
   * AccentSliderUI look whenever it's null (no track loaded yet, or the background computation hasn't finished).
   */
  private static final class WaveformSliderUI extends AccentSliderUI {
    private float[] waveform;
    private boolean enabled = true; // the Settings toggle — data stays cached/computed either way, this just controls whether paintTrack() uses it
    WaveformSliderUI(JSlider slider) { super(slider); }
    void setWaveform(float[] data) { waveform = data; slider.repaint(); }
    void setEnabled(boolean value) { if (enabled == value) return; enabled = value; slider.repaint(); }
    public void paintTrack(Graphics raw) {
      if (!enabled || waveform == null || waveform.length == 0) { super.paintTrack(raw); return; }
      Graphics2D g = (Graphics2D) raw.create();
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      int centerY = trackRect.y + trackRect.height / 2;
      int maxBarHeight = Math.max(4, trackRect.height - 2);
      int fillX = thumbRect.x + thumbRect.width / 2; // same played/unplayed boundary the base class's fill uses
      int n = waveform.length;
      for (int i = 0; i < n; i++) {
        int x = trackRect.x + i * trackRect.width / n;
        int barWidth = Math.max(1, (trackRect.x + (i + 1) * trackRect.width / n) - x - 1);
        int barHeight = Math.max(2, Math.round(waveform[i] * maxBarHeight));
        g.setColor(x <= fillX ? ACCENT : new Color(255, 255, 255, 35));
        g.fillRoundRect(x, centerY - barHeight / 2, barWidth, barHeight, 2, 2);
      }
      g.dispose();
    }
  }

  /**
   * A FlowLayout panel that wraps to the viewport's width instead of just growing wider forever — plain JPanel
   * doesn't implement Scrollable, so a JScrollPane around one gives FlowLayout an unconstrained width to lay out
   * in, and it never wraps to a second row at all; it just runs off the edge and gets clipped instead of
   * scrolling. Used for the EQ panel's presets list once there are enough presets to need it.
   */
  private static final class ScrollableFlowPanel extends JPanel implements javax.swing.Scrollable {
    ScrollableFlowPanel(java.awt.FlowLayout layout) { super(layout); }
    public Dimension getPreferredScrollableViewportSize() { return getPreferredSize(); }
    public int getScrollableUnitIncrement(java.awt.Rectangle visibleRect, int orientation, int direction) { return 16; }
    public int getScrollableBlockIncrement(java.awt.Rectangle visibleRect, int orientation, int direction) { return 64; }
    public boolean getScrollableTracksViewportWidth() { return true; }
    public boolean getScrollableTracksViewportHeight() { return false; }
    /**
     * FlowLayout.preferredLayoutSize() always reports "everything laid out in a single row," regardless of any
     * width the container might actually be constrained to — there's no "preferred height for a given width"
     * concept in the plain LayoutManager contract it implements. That's exactly wrong for a wrap-and-scroll
     * panel: getScrollableTracksViewportWidth() above correctly constrains this panel's WIDTH to the viewport
     * (so FlowLayout really does wrap when actually laid out), but the viewport sizes the view's HEIGHT from this
     * method, so without overriding it the view never gets tall enough to hold the wrapped rows — everything
     * past the first row is allocated no space at all, not just scrolled out of view. This simulates FlowLayout's
     * own wrapping logic against the current width to compute the height it should have reported in the first place.
     */
    public Dimension getPreferredSize() {
      int width = getWidth();
      if (width <= 0 && getParent() != null) width = getParent().getWidth();
      if (width <= 0) return super.getPreferredSize();
      Insets insets = getInsets();
      int maxRowWidth = Math.max(1, width - insets.left - insets.right);
      java.awt.FlowLayout flow = (java.awt.FlowLayout) getLayout();
      int hgap = flow.getHgap(), vgap = flow.getVgap();
      int rowWidth = 0, rowHeight = 0, totalHeight = vgap;
      boolean firstInRow = true;
      for (Component c : getComponents()) {
        if (!c.isVisible()) continue; 
        Dimension d = c.getPreferredSize();
        if (!firstInRow && rowWidth + hgap + d.width > maxRowWidth) {
          totalHeight += rowHeight + vgap;
          rowWidth = 0; rowHeight = 0; firstInRow = true;
        }
        if (!firstInRow) rowWidth += hgap;
        rowWidth += d.width;
        rowHeight = Math.max(rowHeight, d.height);
        firstInRow = false;
      }
      totalHeight += rowHeight + vgap;
      return new Dimension(maxRowWidth, totalHeight);
    }
  }

  private static final class BrushedMetalPanel extends JPanel {
    BrushedMetalPanel() { super(new BorderLayout()); setOpaque(true); }
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); int w = getWidth(), h = getHeight();
      g.setPaint(new GradientPaint(0, 0, new Color(28, 28, 31), 0, h, new Color(9, 9, 10)));
      g.fillRect(0, 0, w, h);
      g.setColor(new Color(255, 255, 255, 6));
      // Only iterate scanlines actually within the current paint clip. This panel is the content pane's opaque
      // background, so it repaints (clipped to just the damaged rectangle) every time any non-opaque child above
      // it repaints — including the disc's own 16ms spin timer while playing. The loop previously always ran
      // from 0 to the full window height regardless of clip, so its per-call overhead scaled directly with
      // window size: at a 5K fullscreen resolution that's ~960 drawLine calls, 60 times a second, for a repaint
      // that's almost always clipped down to a small region like the disc — this was the actual dominant,
      // theme-agnostic cost behind high CPU/GPU usage in fullscreen (not specific to any one animated theme).
      java.awt.Rectangle clip = g.getClipBounds();
      int startY = clip == null ? 0 : Math.max(0, clip.y - (clip.y % 3));
      int endY = clip == null ? h : Math.min(h, clip.y + clip.height);
      for (int lineY = startY; lineY < endY; lineY += 3) g.drawLine(0, lineY, w, lineY);
      g.setPaint(new GradientPaint(0, 0, new Color(0, 0, 0, 130), 0, h * 0.18f, new Color(0, 0, 0, 0)));
      g.fillRect(0, 0, w, (int) (h * 0.18f));
      g.dispose();
    }
  }

  /** Applies a scale+alpha transform to everything painted within it (background, border, and every child component) by wrapping the Graphics context passed to paint(), instead of relying on Window.setOpacity() — used by SettingsOverlay so its open/close animation works as a plain in-window component rather than a separate top-level Window. */
  private static final class FadeableCard extends JPanel {
    float opacity = 1f, scale = 1f;
    private BufferedImage snapshot;
    FadeableCard() { setOpaque(false); setLayout(new BorderLayout()); }
    /**
     * Renders the card's current contents into an offscreen buffer once, up front, so the open/close animation
     * can scale/fade that cached bitmap via a plain drawImage() each frame instead of re-compositing the live
     * component subtree under a scale transform + AlphaComposite on every single frame. The latter (the original
     * implementation of paint() below) measured leaking native/GPU-accelerated surface memory on macOS — about
     * 1.5MB per open/close cycle, unbounded over a long session — most likely because Java2D's accelerated
     * pipeline renders a transformed/alpha-composited subtree to an internal offscreen surface it doesn't reuse
     * or release reliably. A single cached snapshot, blitted with drawImage() (ordinary texture sampling, not
     * "re-render an arbitrary component tree into a temp buffer"), doesn't hit that path — confirmed by disabling
     * just the transform/composite step (animations off) and seeing the leak drop to near zero.
     */
    void beginTransformAnimation() {
      int w = Math.max(1, getWidth()), h = Math.max(1, getHeight());
      BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
      Graphics2D g = image.createGraphics();
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      super.paint(g);
      g.dispose();
      if (snapshot != null) snapshot.flush();
      snapshot = image;
    }
    /** Releases the cached snapshot and returns to painting the live subtree directly (the card sits at rest, no transform, so there's nothing costly about that path). */
    void endTransformAnimation() { if (snapshot != null) { snapshot.flush(); snapshot = null; } repaint(); }
    public void paint(Graphics g) {
      if (snapshot == null) { super.paint(g); return; }
      Graphics2D g2 = (Graphics2D) g.create();
      g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
      if (scale != 1f) { g2.translate(getWidth() / 2.0, getHeight() / 2.0); g2.scale(scale, scale); g2.translate(-getWidth() / 2.0, -getHeight() / 2.0); }
      if (opacity < 1f) g2.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, Math.max(0f, Math.min(1f, opacity))));
      g2.drawImage(snapshot, 0, 0, null);
      g2.dispose();
    }
  }

  /**
   * A one-shot full-window crossfade: painted as a frozen snapshot of "how things looked right before" a layout
   * change, then faded out over a short animation to reveal the already-applied "how things look now" underneath
   * — used by toggleCdView() so switching to/from CD view dissolves smoothly instead of the header/track panel/
   * hint line just vanishing and the disc snapping straight to its new size. Same snapshot-blit idea as
   * FadeableCard (see its own doc comment on why: cheap, and avoids the native-surface leak a live transformed
   * repaint measured), just a plain fade with no scale, and covering the whole window instead of one card.
   */
  private static final class SnapshotFadeOverlay extends javax.swing.JComponent {
    private final BufferedImage snapshot;
    private float alpha = 1f;
    SnapshotFadeOverlay(BufferedImage snapshot) { this.snapshot = snapshot; setOpaque(false); }
    void setAlpha(float value) { alpha = value; repaint(); }
    // Same rationale as DiscView.setCover's flush(): once drawn, a BufferedImage can pick up an off-heap
    // GPU-accelerated cache surface that outlives the plain Java heap reference and isn't reclaimed until GC
    // gets around to the wrapper object — measured as never keeping up under a rapid-fire stress test elsewhere
    // in this file. Each CD-view toggle allocates a fresh full-window snapshot, so releasing it explicitly the
    // moment this overlay is discarded (toggleCdView, on both the normal-completion and interrupted-mid-fade
    // paths) matters here for the same reason.
    void releaseSnapshot() { snapshot.flush(); }
    protected void paintComponent(Graphics raw) {
      if (alpha <= 0f) return;
      Graphics2D g = (Graphics2D) raw.create();
      g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, Math.max(0f, Math.min(1f, alpha))));
      // Scaled draw, not a 1:1 blit: the snapshot may have been captured at a capped, smaller-than-actual
      // resolution (see toggleCdView()'s CD_VIEW_SNAPSHOT_CAP) — this is a no-op scale (1.0) and identical to the
      // old 1:1 draw whenever it wasn't.
      g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
      g.drawImage(snapshot, 0, 0, getWidth(), getHeight(), null);
      g.dispose();
    }
  }

  /**
   * Hosts a card (Settings/Lyrics/EQ/History/Search) as a full-window overlay layer (added to contentStack, see
   * createContent) instead of a separate JDialog. A separate top-level window doesn't reliably layer above either
   * the OS's native fullscreen (opens on an entirely different Space) or this app's own exclusive GraphicsDevice
   * fullscreen (didn't appear at all). Being a plain component in the same window sidesteps both: it's always
   * positioned and painted correctly relative to the main window's current bounds, fullscreen or not.
   * Modal: sized to fill the whole contentStack (see getMaximumSize()) and paints a dimmed backdrop behind the
   * card, so it's the topmost thing hit-tested everywhere in the window while open, not just over the card
   * itself. This used to be deliberately non-modal instead (contains() reported true only over the card, so a
   * click anywhere else on the overlay fell through to whatever was beneath it — matching the original JDialog's
   * non-modal flag), but the card routinely sits close enough to real transport/queue controls in the main
   * window (confirmed via screen recording: Settings' own rows sit directly beside the live Skip Forward 15s /
   * Load a Track / queue buttons, fully exposed) that a click meant for the card, or just outside it, could land
   * on and trigger a real control in the player behind it instead. A click on the dimmed backdrop is simply
   * absorbed (there's no listener on this panel at all, so it does nothing) rather than closing the panel —
   * that was tried first (matching ThemeMenuOverlay's click-outside-to-dismiss), but the backdrop still shows
   * the dimmed app underneath, so it doesn't read as "outside" the panel — closing on a click there felt like
   * clicking blank space inside Settings randomly closed it.
   */
  private static final class CenteredOverlay extends JPanel {
    final FadeableCard card = new FadeableCard();
    CenteredOverlay() {
      // Deliberately NOT opaque, even though paintComponent() always fully covers its own bounds: marking it
      // opaque triggers a Swing paint optimization that skips repainting whatever's underneath an opaque
      // component — exactly what contentStack's own isOptimizedDrawingEnabled() override (see createContent) is
      // there to prevent for ITS overlapping children, but that override doesn't reach this deep; the visible
      // effect was the dimmed backdrop coming out fully opaque black instead of translucent over the app.
      setOpaque(false); setLayout(new GridBagLayout()); add(card);
      // A no-op listener, but a load-bearing one: a lightweight component with no registered mouse interest of
      // its own is transparent to AWT's real event dispatch regardless of its bounds or Z-order — confirmed
      // directly with a genuine OS-level click via Robot (SwingUtilities.getDeepestComponentAt, a purely
      // geometric query, said the click resolved harmlessly inside this overlay; the real click still landed on
      // the Play button two layers behind it). Without this, any point on the dimmed backdrop that isn't itself
      // a real interactive child (blank space around the card, gaps between rows inside it) falls straight
      // through to whatever's really underneath, exactly the "control buttons still work behind Settings" bug.
      // addMouseListener alone is enough to register interest for both press/release/click; MouseMotionListener
      // isn't needed since nothing here cares about drag/move, only about being a legitimate click target.
      addMouseListener(new java.awt.event.MouseAdapter() { });
    }
    // Forces OverlayLayout to stretch this to the full contentStack size (its natural preferred size, from
    // GridBagLayout wrapping just the card, would otherwise only be as big as the card) — that's what makes the
    // backdrop actually cover the whole window instead of just a tight box around the card.
    public Dimension getMaximumSize() { return new Dimension(Short.MAX_VALUE, Short.MAX_VALUE); }
    protected void paintComponent(Graphics g) {
      g.setColor(new Color(0, 0, 0, 140));
      g.fillRect(0, 0, getWidth(), getHeight());
    }
  }

  /**
   * The theme picker (see showThemeMenu). Unlike CenteredOverlay, this one is NOT pass-through outside its menu:
   * a click anywhere else on it (registered by the owner) closes the menu, matching how a real popup dismisses
   * on an outside click — the menu itself sits at an explicit pixel position (null layout + setBounds()) rather
   * than being centered, since it needs to stay anchored under themeButton.
   */
  private static final class ThemeMenuOverlay extends JPanel {
    final JPanel menu = new JPanel();
    ThemeMenuOverlay() {
      setOpaque(false); setLayout(null);
      menu.setLayout(new javax.swing.BoxLayout(menu, javax.swing.BoxLayout.Y_AXIS));
      add(menu);
    }
  }

  private static final class BarbedDivider extends JPanel {
    BarbedDivider() { setOpaque(false); setPreferredSize(new Dimension(0, 14)); }
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      int w = getWidth(), midY = getHeight() / 2;
      g.setColor(new Color(255, 255, 255, 40)); g.setStroke(new BasicStroke(1.5f)); g.drawLine(0, midY, w, midY);
      g.setColor(ACCENT);
      for (int spikeX = 12; spikeX < w; spikeX += 26) {
        int[] xs = { spikeX - 4, spikeX, spikeX + 4 }; int[] ys = { midY, midY - 6, midY };
        g.fillPolygon(xs, ys, 3);
        g.setColor(new Color(255, 255, 255, 60)); g.drawLine(spikeX - 3, midY - 1, spikeX, midY - 5);
        g.setColor(ACCENT);
      }
      g.dispose();
    }
  }

  /**
   * Streams pre-decoded PCM audio out to a {@link SourceDataLine} in small chunks on a dedicated pump thread,
   * applying gain (and optional mono downmix) in software to each chunk just before it's written.
   *
   * This replaces {@code javax.sound.sampled.Clip}, whose default implementation ({@code DirectAudioDevice}) hard-caps
   * its internal playback buffer at exactly 1 second of audio regardless of what buffer size is requested — verified
   * empirically, not documented. Gain is applied to samples as they enter that buffer, so a MASTER_GAIN change only
   * affects newly-buffered audio; up to a second of already-buffered audio at the *old* gain plays first. There is no
   * public API to shrink that. Streaming our own small buffer (a few tens of milliseconds) via SourceDataLine, with
   * gain multiplied into the samples directly, makes volume changes (and mono toggling) apply almost immediately, and
   * makes seeking exact (via {@code line.flush()}) instead of playing a stale buffered tail from the old position.
   */
  private static final class StreamPlayer {
    private final AudioFormat format;
    private final byte[] audioBytes;
    private final int frameSize;
    private final long totalFrames;
    private final SourceDataLine line;
    private final int chunkFrames;
    private volatile long framePosition;
    private volatile boolean playing;
    private volatile boolean closed;
    private volatile float gain = 1f;
    private volatile boolean mono;
    // null = flat/bypassed (skip EQ processing entirely — the common case). Rebuilt wholesale and published via
    // this single volatile reference whenever gains change, so the pump thread never sees a half-updated set of
    // coefficients; the filter STATE below is only ever touched by the pump thread itself, never cross-thread.
    private volatile double[] eqCoefficients;
    private final double[] eqStateL = new double[Equalizer.BANDS * 4]; // per band: x1, x2, y1, y2
    private final double[] eqStateR = new double[Equalizer.BANDS * 4];
    private Thread pumpThread;
    /** Invoked on the EDT when playback reaches the end of the audio on its own (not on pause/close). */
    Runnable onFinished;

    StreamPlayer(AudioFormat sourceFormat, byte[] sourceBytes) throws LineUnavailableException {
      // Normalize to signed 16-bit little-endian PCM: SourceDataLine needs an exact format match (no
      // auto-conversion the way Clip.open(AudioInputStream) can do internally), and standardizing here keeps the
      // gain/mono sample math below simple instead of having to branch on bit depth/encoding.
      AudioFormat target = new AudioFormat(AudioFormat.Encoding.PCM_SIGNED, sourceFormat.getSampleRate(), 16,
          sourceFormat.getChannels(), sourceFormat.getChannels() * 2, sourceFormat.getSampleRate(), false);
      if (sourceFormat.matches(target)) {
        this.format = sourceFormat;
        this.audioBytes = sourceBytes;
      } else {
        AudioInputStream converted = AudioSystem.getAudioInputStream(target,
            new AudioInputStream(new java.io.ByteArrayInputStream(sourceBytes), sourceFormat, sourceBytes.length / Math.max(1, sourceFormat.getFrameSize())));
        byte[] convertedBytes;
        try { convertedBytes = readAllStatic(converted); } catch (IOException io) { throw new LineUnavailableException(io.getMessage()); }
        finally { try { converted.close(); } catch (IOException ignored) { } }
        this.format = target;
        this.audioBytes = convertedBytes;
      }
      this.frameSize = format.getFrameSize();
      this.totalFrames = audioBytes.length / frameSize;
      DataLine.Info info = new DataLine.Info(SourceDataLine.class, format);
      line = (SourceDataLine) AudioSystem.getLine(info);
      chunkFrames = Math.max(1, (int) (format.getFrameRate() * 0.02)); // ~20ms chunks
      int bufferBytes = chunkFrames * frameSize * 4; // ~80ms of line buffer — small and under our own control
      line.open(format, bufferBytes);
    }
    private static byte[] readAllStatic(InputStream stream) throws IOException {
      java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
      byte[] buffer = new byte[4096]; int count;
      while ((count = stream.read(buffer)) >= 0) output.write(buffer, 0, count);
      return output.toByteArray();
    }
    void start() {
      if (closed) return;
      playing = true;
      line.start();
      if (pumpThread == null || !pumpThread.isAlive()) {
        pumpThread = new Thread(this::pump, "cdplayer-stream-pump");
        pumpThread.setDaemon(true);
        pumpThread.start();
      }
    }
    void pause() { playing = false; line.stop(); }
    boolean isRunning() { return playing; }
    void setGain(float value) { gain = value; }
    void setMono(boolean value) { mono = value; }
    /** Rebuilds and publishes the filter coefficients from scratch — cheap (10 bands' worth of trig/pow calls), so recomputing the whole set on every slider tweak rather than patching one band is simplest and not worth optimizing. Null/all-flat gains bypass EQ processing entirely instead of running an identity filter chain. */
    void setEqGains(double[] gainsDb) {
      if (gainsDb == null) { eqCoefficients = null; return; }
      boolean allFlat = true;
      for (double g : gainsDb) if (Math.abs(g) > 0.05) { allFlat = false; break; }
      if (allFlat) { eqCoefficients = null; return; }
      double[] coeffs = new double[Equalizer.BANDS * 5];
      for (int i = 0; i < Equalizer.BANDS; i++) {
        double[] c = Equalizer.computeCoefficients(Equalizer.FREQUENCIES[i], gainsDb[i], format.getSampleRate());
        System.arraycopy(c, 0, coeffs, i * 5, 5);
      }
      eqCoefficients = coeffs;
    }
    /** Runs one sample through all 10 bands in series, each band's output feeding the next — state[bandOffset..+3] holds that band's own x1,x2,y1,y2 history (the running `y` local is what gets fed to each successive band, not the state array). */
    private static double applyEqChain(double x, double[] coeffs, double[] state) {
      double y = x;
      for (int band = 0; band < Equalizer.BANDS; band++) {
        int cOff = band * 5, sOff = band * 4;
        double b0 = coeffs[cOff], b1 = coeffs[cOff + 1], b2 = coeffs[cOff + 2], a1 = coeffs[cOff + 3], a2 = coeffs[cOff + 4];
        double x1 = state[sOff], x2 = state[sOff + 1], y1 = state[sOff + 2], y2 = state[sOff + 3];
        double out = b0 * y + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        state[sOff + 1] = x1; state[sOff] = y;
        state[sOff + 3] = y1; state[sOff + 2] = out;
        y = out;
      }
      return y;
    }
    long getMicrosecondPosition() { return (long) (framePosition / format.getFrameRate() * 1_000_000L); }
    long getMicrosecondLength() { return (long) (totalFrames / format.getFrameRate() * 1_000_000L); }
    long getFramePosition() { return framePosition; }
    /** The audio actually being played — may differ from what was passed to the constructor if normalization to 16-bit PCM occurred. */
    byte[] getAudioBytes() { return audioBytes; }
    AudioFormat getFormat() { return format; }
    void setMicrosecondPosition(long micros) {
      long targetFrame = (long) (micros / 1_000_000.0 * format.getFrameRate());
      framePosition = Math.max(0, Math.min(totalFrames, targetFrame));
      line.flush(); // drop anything already queued at the old position so playback jumps immediately, not after a lag
    }
    void close() {
      closed = true; playing = false;
      try { line.stop(); line.flush(); line.close(); } catch (Exception ignored) { }
      if (pumpThread != null) { try { pumpThread.join(200); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); } }
    }
    private void pump() {
      byte[] chunk = new byte[chunkFrames * frameSize];
      try {
        while (!closed) {
          if (!playing) { Thread.sleep(8); continue; }
          long pos = framePosition;
          if (pos >= totalFrames) {
            playing = false;
            Runnable callback = onFinished;
            if (callback != null) SwingUtilities.invokeLater(callback);
            continue;
          }
          int framesToCopy = (int) Math.min(chunkFrames, totalFrames - pos);
          int bytesToCopy = framesToCopy * frameSize;
          System.arraycopy(audioBytes, (int) (pos * frameSize), chunk, 0, bytesToCopy);
          applyGainAndMono(chunk, bytesToCopy);
          line.write(chunk, 0, bytesToCopy); // blocks until buffer space frees up, naturally pacing playback
          if (framePosition == pos) framePosition = pos + framesToCopy; // don't clobber a concurrent seek
        }
      } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
      catch (Exception ignored) { /* line closed underneath us during shutdown/track switch */ }
    }
    private void applyGainAndMono(byte[] chunk, int length) {
      float g = gain;
      boolean applyMono = mono && format.getChannels() == 2;
      double[] eqCoeffs = eqCoefficients; // one snapshot per chunk — a torn read across the chunk isn't a concern, same tolerance already accepted for gain changes mid-chunk
      boolean applyEq = eqCoeffs != null;
      if (g == 1f && !applyMono && !applyEq) return;
      int channels = format.getChannels();
      // Signal chain order: mono downmix (if any) first, then EQ shapes the (possibly-combined) signal, then gain
      // is the final stage — matches how a real hardware chain would be laid out.
      for (int off = 0; off + frameSize <= length; off += frameSize) {
        if (applyMono) {
          int left = readS16(chunk, off), right = readS16(chunk, off + 2);
          int avg = (left + right) / 2;
          writeS16(chunk, off, avg); writeS16(chunk, off + 2, avg);
        }
        if (applyEq) {
          int left = readS16(chunk, off);
          writeS16(chunk, off, Math.max(-32768, Math.min(32767, (int) Math.round(applyEqChain(left, eqCoeffs, eqStateL)))));
          if (channels == 2) {
            int right = readS16(chunk, off + 2);
            writeS16(chunk, off + 2, Math.max(-32768, Math.min(32767, (int) Math.round(applyEqChain(right, eqCoeffs, eqStateR)))));
          }
        }
        if (g != 1f) {
          for (int c = 0; c < channels; c++) {
            int s = readS16(chunk, off + c * 2);
            int scaled = Math.round(s * g);
            writeS16(chunk, off + c * 2, Math.max(-32768, Math.min(32767, scaled)));
          }
        }
      }
    }
    private static int readS16(byte[] data, int offset) { return (short) ((data[offset] & 0xFF) | (data[offset + 1] << 8)); } // little-endian
    private static void writeS16(byte[] data, int offset, int value) { data[offset] = (byte) (value & 0xFF); data[offset + 1] = (byte) ((value >> 8) & 0xFF); }
  }

  /**
   * A 10-band graphic EQ: cascaded RBJ "peaking" biquad filters (the standard Audio EQ Cookbook formula), one per
   * classic ISO octave-band frequency. Just the coefficient math lives here — each StreamPlayer owns its own
   * filter state (see StreamPlayer.eqStateL/R), since two can be running at once during a crossfade and must not
   * share filter history, while the gain values themselves are one shared, global EQ setting (CDPlayer.eqGains)
   * applied to whichever StreamPlayer(s) happen to be running.
   */
  private static final class Equalizer {
    static final int[] FREQUENCIES = { 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };
    static final int BANDS = FREQUENCIES.length;
    /** {b0,b1,b2,a1,a2}, already normalized by a0 — a fixed Q of 1.2 gives each band a reasonable, slightly-overlapping bandwidth for a graphic EQ (narrower would leave audible gaps between bands; wider would blur them together). */
    static double[] computeCoefficients(double freqHz, double gainDb, float sampleRate) {
      double a = Math.pow(10, gainDb / 40.0);
      double w0 = 2 * Math.PI * freqHz / sampleRate;
      double q = 1.2;
      double alpha = Math.sin(w0) / (2 * q);
      double cosw0 = Math.cos(w0);
      double b0 = 1 + alpha * a, b1 = -2 * cosw0, b2 = 1 - alpha * a;
      double a0 = 1 + alpha / a, a1 = -2 * cosw0, a2 = 1 - alpha / a;
      return new double[] { b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0 };
    }
  }

  private static final class Theme {
    final String name; final Color bg, card, accent, accent2, text, muted;
    Theme(String name, Color bg, Color card, Color accent, Color accent2, Color text, Color muted) {
      this.name = name; this.bg = bg; this.card = card; this.accent = accent; this.accent2 = accent2; this.text = text; this.muted = muted;
    }
  }

  private static final class SwatchIcon implements javax.swing.Icon {
    private final Color a, b;
    SwatchIcon(Color a, Color b) { this.a = a; this.b = b; }
    public int getIconWidth() { return 14; }
    public int getIconHeight() { return 14; }
    public void paintIcon(Component c, Graphics raw, int x, int y) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      g.setPaint(new GradientPaint(x, y, a, x + 14, y + 14, b)); g.fillOval(x, y, 14, 14);
      g.setColor(new Color(255, 255, 255, 60)); g.setStroke(new BasicStroke(1)); g.drawOval(x, y, 13, 13);
      g.dispose();
    }
  }

  private static final class VisualizerBars extends JPanel {
    enum Mode {
      BARS, TREE, CONSTELLATION, WAVES, MATRIX_RAIN, LEAVES;
      static Mode forTheme(String themeName) {
        switch (themeName) {
          case "SNOW": return TREE;
          case "GALAXY": return CONSTELLATION;
          case "OCEAN": return WAVES;
          case "MATRIX": return MATRIX_RAIN;
          case "AUTUMN": return LEAVES;
          default: return BARS;
        }
      }
    }
    private static final int BARS_COUNT = 5;
    private static final Color[] LIGHT_COLORS = { new Color(232, 64, 64), new Color(255, 205, 80), new Color(96, 190, 255), new Color(120, 220, 120), new Color(255, 150, 220) };
    private static final Color[] LEAF_COLORS = { new Color(224, 122, 40), new Color(200, 60, 46), new Color(230, 176, 60), new Color(180, 90, 40), new Color(214, 140, 70) };
    private static final Dimension BAR_SIZE = new Dimension(42, 16);
    private static final Dimension CUSTOM_SIZE = new Dimension(34, 32);
    private final double[] levels = new double[BARS_COUNT];
    private boolean active;
    private Mode mode = Mode.BARS;
    VisualizerBars() { setOpaque(false); setPreferredSize(BAR_SIZE); setMaximumSize(BAR_SIZE); }
    void setActive(boolean value) { active = value; if (!value) java.util.Arrays.fill(levels, 0); repaint(); }
    void setLevels(double[] fresh) { for (int i = 0; i < BARS_COUNT && i < fresh.length; i++) levels[i] = levels[i] * 0.35 + fresh[i] * 0.65; repaint(); }
    /** Swaps the bar meter for a theme-specific reactive shape, all driven by the same levels[] the plain bars use. */
    void setMode(Mode value) {
      if (mode == value) return;
      mode = value;
      Dimension size = mode == Mode.BARS ? BAR_SIZE : CUSTOM_SIZE;
      setPreferredSize(size); setMaximumSize(size);
      revalidate(); repaint();
    }
    private double level(int i) { double floor = mode == Mode.TREE || mode == Mode.LEAVES ? 0.12 : 0.1; return active ? Math.max(floor, levels[i]) : floor; }
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      switch (mode) {
        case TREE: paintTree(g); break;
        case CONSTELLATION: paintConstellation(g); break;
        case WAVES: paintWaves(g); break;
        case MATRIX_RAIN: paintMatrixRain(g); break;
        case LEAVES: paintLeaves(g); break;
        default: paintBars(g); break;
      }
      g.dispose();
    }
    private void paintBars(Graphics2D g) {
      int barWidth = 4, gap = 3, totalWidth = BARS_COUNT * barWidth + (BARS_COUNT - 1) * gap, startX = (getWidth() - totalWidth) / 2;
      for (int i = 0; i < BARS_COUNT; i++) {
        int barHeight = Math.max(2, (int) (level(i) * getHeight()));
        g.setColor(i % 2 == 0 ? ACCENT : ACCENT2);
        g.fillRoundRect(startX + i * (barWidth + gap), getHeight() - barHeight, barWidth, barHeight, 2, 2);
      }
    }
    private static final double[][] LIGHT_POSITIONS = { { 0.30, 0.42 }, { 0.68, 0.42 }, { 0.22, 0.64 }, { 0.78, 0.64 }, { 0.5, 0.82 } };
    private void paintTree(Graphics2D g) {
      int w = getWidth(), h = getHeight(), cx = w / 2;
      int trunkW = Math.max(3, w / 8), trunkH = Math.max(3, h / 7);
      g.setColor(new Color(96, 62, 40));
      g.fillRect(cx - trunkW / 2, h - trunkH, trunkW, trunkH);
      int tiers = 3, topY = 1, bottomY = h - trunkH + 1, tierHeight = (bottomY - topY) / tiers;
      g.setColor(ACCENT2.darker());
      for (int t = 0; t < tiers; t++) {
        int tierTop = topY + t * tierHeight * 3 / 5;
        int tierBottom = topY + (t + 1) * tierHeight + (t == tiers - 1 ? 2 : 0);
        int halfWidth = (w / 2) * (t + 2) / (tiers + 1);
        g.fillPolygon(new int[] { cx, cx - halfWidth, cx + halfWidth }, new int[] { tierTop, tierBottom, tierBottom }, 3);
      }
      g.setColor(new Color(255, 214, 90));
      g.fillOval(cx - 2, topY - 1, 4, 4);
      // ornament lights react to the same levels[] the bar meter uses, brightening/growing with the signal instead of growing taller
      for (int i = 0; i < BARS_COUNT; i++) {
        int lx = (int) (LIGHT_POSITIONS[i][0] * w), ly = (int) (LIGHT_POSITIONS[i][1] * h);
        paintGlow(g, lx, ly, level(i), LIGHT_COLORS[i % LIGHT_COLORS.length]);
      }
    }
    /** A small fixed constellation (5 stars, zigzag like Cassiopeia) whose stars brighten/grow with the levels[] and whose connecting lines glow brighter with the average level. */
    private static final double[][] STAR_POSITIONS = { { 0.10, 0.60 }, { 0.32, 0.30 }, { 0.54, 0.58 }, { 0.76, 0.28 }, { 0.94, 0.55 } };
    private void paintConstellation(Graphics2D g) {
      int w = getWidth(), h = getHeight();
      int[] xs = new int[BARS_COUNT], ys = new int[BARS_COUNT];
      double avg = 0;
      for (int i = 0; i < BARS_COUNT; i++) { xs[i] = (int) (STAR_POSITIONS[i][0] * w); ys[i] = (int) (STAR_POSITIONS[i][1] * h); avg += level(i); }
      avg /= BARS_COUNT;
      g.setStroke(new BasicStroke(1f));
      g.setColor(new Color(ACCENT2.getRed(), ACCENT2.getGreen(), ACCENT2.getBlue(), (int) (60 + avg * 140)));
      for (int i = 0; i < BARS_COUNT - 1; i++) g.drawLine(xs[i], ys[i], xs[i + 1], ys[i + 1]);
      for (int i = 0; i < BARS_COUNT; i++) paintGlow(g, xs[i], ys[i], level(i), i % 2 == 0 ? ACCENT : ACCENT2);
    }
    private void paintGlow(Graphics2D g, int cx, int cy, double level, Color base) {
      double glow = 1.4 + level * 3.2;
      int alpha = Math.min(255, (int) (110 + level * 145));
      g.setColor(new Color(base.getRed(), base.getGreen(), base.getBlue(), alpha));
      g.fillOval((int) (cx - glow), (int) (cy - glow), (int) (glow * 2), (int) (glow * 2));
    }
    /** Two stacked sine-wave "water" layers confined to the lower part of the canvas; each of the 5 x-segments' amplitude tracks one entry of levels[]. */
    private void paintWaves(Graphics2D g) {
      int w = getWidth(), h = getHeight();
      double t = System.nanoTime() / 4e8;
      paintWaveLayer(g, w, h, t, 0.80, ACCENT2, 110);
      paintWaveLayer(g, w, h, t + 1.7, 0.92, ACCENT, 170);
    }
    private void paintWaveLayer(Graphics2D g, int w, int h, double t, double baseline, Color color, int alpha) {
      int segments = BARS_COUNT;
      int pointsPerSegment = 6;
      int totalPoints = segments * pointsPerSegment + 1;
      int[] xs = new int[totalPoints + 2], ys = new int[totalPoints + 2];
      for (int p = 0; p <= totalPoints - 1; p++) {
        double frac = p / (double) (totalPoints - 1);
        // blend linearly between adjacent segments' levels instead of jumping discretely at each boundary,
        // so the amplitude flows smoothly across the width instead of reading as faceted mountain peaks
        double segPos = frac * segments - 0.5;
        int segA = Math.max(0, Math.min(segments - 1, (int) Math.floor(segPos)));
        int segB = Math.max(0, Math.min(segments - 1, segA + 1));
        double blend = Math.max(0, Math.min(1, segPos - Math.floor(segPos)));
        double lvl = level(segA) + (level(segB) - level(segA)) * blend;
        double amp = 0.6 + lvl * (h * 0.075);
        double x = frac * w;
        double y = h * baseline + Math.sin(frac * Math.PI * 1.6 + t) * amp;
        xs[p] = (int) x; ys[p] = (int) y;
      }
      xs[totalPoints] = w; ys[totalPoints] = h;
      xs[totalPoints + 1] = 0; ys[totalPoints + 1] = h;
      g.setColor(new Color(color.getRed(), color.getGreen(), color.getBlue(), alpha));
      g.fillPolygon(xs, ys, totalPoints + 2);
    }
    /** A miniature version of the falling-code overlay: a few columns whose height/brightness reacts to levels[]. */
    private void paintMatrixRain(Graphics2D g) {
      int w = getWidth(), h = getHeight();
      int columns = BARS_COUNT;
      int colWidth = w / columns;
      g.setFont(new Font(Font.MONOSPACED, Font.BOLD, Math.max(8, colWidth)));
      java.util.concurrent.ThreadLocalRandom random = ThreadLocalRandom.current();
      for (int i = 0; i < columns; i++) {
        double lvl = level(i);
        int glyphCount = 1 + (int) (lvl * 4);
        int cx = i * colWidth + colWidth / 2;
        for (int j = 0; j < glyphCount; j++) {
          int alpha = Math.max(40, 255 - j * 70);
          g.setColor(new Color(ACCENT.getRed(), ACCENT.getGreen(), ACCENT.getBlue(), Math.min(255, (int) (alpha * (0.5 + lvl * 0.6)))));
          char glyph = (char) ('0' + random.nextInt(10));
          int cy = h - j * (h / 6) - 3;
          java.awt.FontMetrics fm = g.getFontMetrics();
          g.drawString(String.valueOf(glyph), cx - fm.charWidth(glyph) / 2, cy);
        }
      }
    }
    /** A small swaying branch with a handful of leaves that brighten/grow with levels[], mirroring the Christmas-tree lights but for Autumn. */
    private void paintLeaves(Graphics2D g) {
      int w = getWidth(), h = getHeight(), cx = w / 2;
      g.setColor(new Color(96, 62, 40));
      g.setStroke(new BasicStroke(Math.max(1.5f, w * 0.05f)));
      g.drawLine(cx, h - 2, cx, (int) (h * 0.25));
      g.drawLine(cx, (int) (h * 0.55), (int) (w * 0.18), (int) (h * 0.35));
      g.drawLine(cx, (int) (h * 0.45), (int) (w * 0.82), (int) (h * 0.28));
      for (int i = 0; i < BARS_COUNT; i++) {
        int lx = (int) (LIGHT_POSITIONS[i][0] * w), ly = (int) (LIGHT_POSITIONS[i][1] * h);
        double lvl = level(i);
        double leafSize = 2.2 + lvl * 3.6;
        Color base = LEAF_COLORS[i % LEAF_COLORS.length];
        int alpha = Math.min(255, (int) (140 + lvl * 115));
        g.setColor(new Color(base.getRed(), base.getGreen(), base.getBlue(), alpha));
        g.fillOval((int) (lx - leafSize), (int) (ly - leafSize * 0.7), (int) (leafSize * 2), (int) (leafSize * 1.4));
      }
    }
  }

  /**
   * Full-window overlay (installed as the frame's glass pane) that animates a theme-specific particle effect:
   * falling snow, a twinkling starfield with shooting stars, rising ocean bubbles with a light shimmer, falling
   * code rain, or drifting autumn leaves. Mouse events pass through untouched because {@link #contains} always
   * reports false.
   */
  private static final class ThemeOverlay extends JPanel {
    enum Mode {
      NONE, SNOW, GALAXY, OCEAN, MATRIX, AUTUMN;
      static Mode forTheme(String themeName) { try { return valueOf(themeName); } catch (IllegalArgumentException notMatched) { return NONE; } }
    }
    private static final int PARTICLE_COUNT = 140;
    private static final int MATRIX_COLUMN_WIDTH = 16;
    private static final Color[] LEAF_PALETTE = { new Color(224, 122, 40), new Color(200, 60, 46), new Color(230, 176, 60), new Color(180, 90, 40), new Color(214, 140, 70) };
    private final double[] x = new double[PARTICLE_COUNT];
    private final double[] y = new double[PARTICLE_COUNT];
    private final double[] speed = new double[PARTICLE_COUNT];
    private final double[] phase = new double[PARTICLE_COUNT];
    private final double[] size = new double[PARTICLE_COUNT];
    private final double[] spin = new double[PARTICLE_COUNT]; // rotation angle (AUTUMN); unused otherwise
    private final List<double[]> shootingStars = new ArrayList<double[]>(); // each entry: {x, y, vx, vy, life}
    // Was a fixed 35ms (~28fps) — every particle motion constant below (fall speed, drift amplitude, spin rate,
    // shooting star velocity/spawn probability, clock's own increment) was tuned against that tick length.
    // TICK_MS tracks ANIMATION_TICK_MS (display refresh rate, capped at 60fps — see its own doc comment) instead
    // of a second hardcoded guess, and TIME_SCALE rescales every motion constant so particles cover the exact
    // same real-world distance per real-world second regardless of the tick rate. The 60fps cap matters here for
    // the same reason it does for the disc: particle themes run for as long as a track plays, and the visual
    // return on going past 60fps for ambient background particles isn't worth the CPU competing with the audio
    // pump thread for the whole time.
    private static final int TICK_MS = ANIMATION_TICK_MS;
    private static final double TIME_SCALE = TICK_MS / 35.0;
    private final Timer timer = new Timer(TICK_MS, null);
    private Mode mode = Mode.NONE;
    private double clock;
    private Component discRef; // set once from the constructor; lets particles avoid painting over the disc without needing to restructure z-order (see createContent()'s doc comment for why that costs more than it's worth)
    private Component settingsCardRef; // set once Settings is first opened; being the glass pane again means themeOverlay is unconditionally topmost, so without this particles would drift over the Settings card too
    private Component themeMenuRef; // set once the theme menu is first opened; same reasoning as settingsCardRef
    private Component lyricsCardRef; // set once the lyrics panel is first opened; same reasoning as settingsCardRef
    private Component eqCardRef; // set once the EQ panel is first opened; same reasoning as settingsCardRef
    private Component historyCardRef; // set once the History panel is first opened; same reasoning as settingsCardRef
    private Component searchCardRef; // set once the Search panel is first opened; same reasoning as settingsCardRef
    ThemeOverlay() {
      setOpaque(false);
      timer.addActionListener(e -> { advance(); repaint(); });
      // Particles otherwise only redistribute into newly-exposed space one at a time, as each happens to wrap
      // around during its own fall cycle (see advance()/fall(), which reseed a particle's x/y using the CURRENT
      // width/height only at that moment) — so any resize that grows the window, not just this app's own F
      // exclusive-fullscreen toggle (see toggleFullscreen()) but a plain OS-level maximize/native-fullscreen too,
      // visibly left the newly-exposed area bare for several seconds instead of the effect immediately covering
      // it. Reseeding synchronously on every actual size change fixes this at the source for either path.
      addComponentListener(new java.awt.event.ComponentAdapter() {
        public void componentResized(java.awt.event.ComponentEvent e) { reseedForCurrentSize(); }
      });
    }
    void setDiscReference(Component disc) { this.discRef = disc; }
    void setSettingsCardReference(Component card) { this.settingsCardRef = card; }
    void setThemeMenuReference(Component menu) { this.themeMenuRef = menu; }
    void setLyricsCardReference(Component card) { this.lyricsCardRef = card; }
    void setEqCardReference(Component card) { this.eqCardRef = card; }
    void setHistoryCardReference(Component card) { this.historyCardRef = card; }
    void setSearchCardReference(Component card) { this.searchCardRef = card; }
    private java.awt.Rectangle boundsIfShowing(Component c) {
      if (c == null || !c.isShowing()) return null;
      return SwingUtilities.convertRectangle(c.getParent(), c.getBounds(), this);
    }
    // Area boolean subtraction (used to punch the disc/open-card rectangles out of the particle paint clip below)
    // runs general polygon algebra internally and measured as meaningfully more expensive than the actual particle
    // drawing itself, especially on non-Mac Java2D backends — rebuilding it from scratch on every single paint
    // (up to ~30x/second while a theme's particles are animating) was pure waste on every frame where nothing
    // being excluded had actually moved, which is the overwhelming majority of frames during normal playback.
    // Cached here and only rebuilt when the window size or any tracked component's bounds has actually changed.
    private java.awt.geom.Area cachedClip;
    private int cachedClipW = -1, cachedClipH = -1;
    private final java.awt.Rectangle[] cachedExcluded = new java.awt.Rectangle[7];
    private java.awt.geom.Area buildClip() {
      int w = getWidth(), h = getHeight();
      java.awt.Rectangle[] current = {
        boundsIfShowing(discRef), boundsIfShowing(settingsCardRef), boundsIfShowing(themeMenuRef),
        boundsIfShowing(lyricsCardRef), boundsIfShowing(eqCardRef), boundsIfShowing(historyCardRef), boundsIfShowing(searchCardRef)
      };
      if (cachedClip != null && cachedClipW == w && cachedClipH == h && java.util.Arrays.equals(current, cachedExcluded)) return cachedClip;
      java.awt.geom.Area clip = new java.awt.geom.Area(new java.awt.Rectangle(0, 0, w, h));
      for (java.awt.Rectangle r : current) if (r != null) clip.subtract(new java.awt.geom.Area(r));
      cachedClip = clip; cachedClipW = w; cachedClipH = h;
      System.arraycopy(current, 0, cachedExcluded, 0, current.length);
      return clip;
    }
    void setMode(Mode value) {
      if (mode == value) return;
      mode = value;
      boolean active = mode != Mode.NONE;
      setVisible(active);
      if (active) { seed(); timer.start(); } else timer.stop();
    }
    /** Re-seeds every particle across the panel's current bounds — same reseed setMode() does on activation, just without requiring the mode to have actually changed. Used after toggleFullscreen() so particles fill the new screen size immediately instead of only the ones that happen to wrap around doing so, one at a time, over the next several fall cycles. */
    void reseedForCurrentSize() { if (mode != Mode.NONE) seed(); }
    private void seed() {
      int w = Math.max(1, getWidth()), h = Math.max(1, getHeight());
      ThreadLocalRandom r = ThreadLocalRandom.current();
      shootingStars.clear();
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        switch (mode) {
          case SNOW:
            x[i] = r.nextDouble() * w; y[i] = r.nextDouble() * h;
            speed[i] = 0.6 + r.nextDouble() * 1.6; phase[i] = r.nextDouble() * Math.PI * 2; size[i] = 1.2 + r.nextDouble() * 2.3;
            break;
          case OCEAN:
            x[i] = r.nextDouble() * w; y[i] = r.nextDouble() * h;
            speed[i] = 0.3 + r.nextDouble() * 0.9; phase[i] = r.nextDouble() * Math.PI * 2; size[i] = 1.4 + r.nextDouble() * 2.8;
            break;
          case AUTUMN:
            x[i] = r.nextDouble() * w; y[i] = r.nextDouble() * h;
            speed[i] = 0.4 + r.nextDouble() * 1.0; phase[i] = r.nextDouble() * Math.PI * 2; size[i] = 2.6 + r.nextDouble() * 2.6; spin[i] = r.nextDouble() * Math.PI * 2;
            break;
          case GALAXY:
            x[i] = r.nextDouble() * w; y[i] = r.nextDouble() * h;
            speed[i] = 0.4 + r.nextDouble() * 1.6; phase[i] = r.nextDouble() * Math.PI * 2; size[i] = 0.6 + r.nextDouble() * 1.6;
            break;
          case MATRIX:
            // fixed column positions (independent of current width) so a later resize doesn't leave gaps
            x[i] = i * MATRIX_COLUMN_WIDTH; y[i] = -r.nextDouble() * h - 20;
            speed[i] = 2 + r.nextDouble() * 4;
            break;
          default: break;
        }
      }
    }
    private void advance() {
      clock += TICK_MS / 1000.0;
      int w = Math.max(1, getWidth()), h = Math.max(1, getHeight());
      switch (mode) {
        case SNOW: fall(w, h, 1, true); break;
        case OCEAN: fall(w, h, -1, true); break;
        case AUTUMN: fall(w, h, 1, true); for (int i = 0; i < PARTICLE_COUNT; i++) spin[i] += (0.02 + speed[i] * 0.015) * TIME_SCALE; break;
        case GALAXY: advanceShootingStars(w, h); break;
        case MATRIX: advanceMatrix(h); break;
        default: break;
      }
    }
    private void fall(int w, int h, int direction, boolean drift) {
      ThreadLocalRandom r = ThreadLocalRandom.current();
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        y[i] += speed[i] * direction * TIME_SCALE;
        if (drift) x[i] += Math.sin((y[i] * 0.02) + phase[i]) * 0.6 * TIME_SCALE;
        if (direction > 0 && y[i] > h) { y[i] = -4; x[i] = r.nextDouble() * w; }
        else if (direction < 0 && y[i] < -4) { y[i] = h + 4; x[i] = r.nextDouble() * w; }
        if (x[i] < -6) x[i] = w + 6; else if (x[i] > w + 6) x[i] = -6;
      }
    }
    private void advanceMatrix(int h) {
      ThreadLocalRandom r = ThreadLocalRandom.current();
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        y[i] += speed[i] * TIME_SCALE;
        if (y[i] > h + 160) y[i] = -r.nextDouble() * h * 0.6 - 20;
      }
    }
    private void advanceShootingStars(int w, int h) {
      if (shootingStars.size() < 2 && ThreadLocalRandom.current().nextDouble() < 0.012 * TIME_SCALE) {
        ThreadLocalRandom r = ThreadLocalRandom.current();
        double vx = 6 + r.nextDouble() * 5, vy = 3 + r.nextDouble() * 2.5;
        shootingStars.add(new double[] { r.nextDouble() * w * 0.5, r.nextDouble() * h * 0.4, vx, vy, 1.0 });
      }
      for (double[] s : shootingStars) { s[0] += s[2] * TIME_SCALE; s[1] += s[3] * TIME_SCALE; s[4] -= 0.02 * TIME_SCALE; }
      shootingStars.removeIf(s -> s[4] <= 0 || s[0] > w + 40 || s[1] > h + 40);
    }
    // Particles are always drawn directly at native resolution — no capped-size offscreen buffer scaled back up
    // to the real window size, unlike an earlier version of this method. That approach was built to avoid a
    // theorized cost "that scales with total pixel count" at large/fullscreen resolutions, but measured directly
    // (both end-to-end in real macOS exclusive fullscreen, and in isolation across resolutions from 1280x800 up
    // through a real 6K display's 6016x3384) that theorized cost never actually showed up: this method's own
    // draw cost is bound by PARTICLE_COUNT (a fixed 140 regardless of window size — the same shapes just span a
    // wider area), so it stayed under 1ms at every resolution tested, 6K included. What the capped-buffer
    // version WAS measurably expensive at — 38-46ms per frame under real fullscreen, confirmed by isolating each
    // step — was blitting that offscreen buffer back onto the window with bilinear interpolation, a self-
    // inflicted cost from the buffer/blit approach itself, not from painting particles at native size.
    protected void paintComponent(Graphics raw) {
      if (mode == Mode.NONE) return;
      int w = getWidth(), h = getHeight();
      if (w <= 0 || h <= 0) return;
      // AA on for every mode except MATRIX: the other four modes draw filled ovals/lines, where antialiasing is
      // both cheap and visibly worth it, but MATRIX draws up to ~800 individual glyphs a frame (140 columns x a
      // 10-glyph trail), and antialiased text rasterization is a comparatively expensive Java2D path — measured
      // as the single largest cost in this whole overlay on a Windows box (non-Mac Java2D text rendering doesn't
      // get the same hardware-accelerated glyph path Quartz gives it on macOS). Skipping AA here isn't just
      // faster, it's arguably more authentic too — the blocky, unsmoothed digits read closer to the actual
      // "Matrix" credits effect than a softened one would.
      Object aaHint = mode == Mode.MATRIX ? RenderingHints.VALUE_ANTIALIAS_OFF : RenderingHints.VALUE_ANTIALIAS_ON;
      Graphics2D g = (Graphics2D) raw.create();
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, aaHint);
      // Punches the disc's (and any open card's) current on-screen rectangle out of this layer's paint clip, so
      // particles/the OCEAN band never render over them — without needing either to actually sit in a higher
      // paint layer than this glass pane (which nothing can, short of another glass-pane-like mechanism). See
      // buildClip() for why this is cached rather than rebuilt from scratch on every single paint.
      g.setClip(buildClip());
      paintParticles(g);
      g.dispose();
    }
    private void paintParticles(Graphics2D g) {
      switch (mode) {
        case SNOW: paintSnow(g); break;
        case OCEAN: paintOcean(g); break;
        case AUTUMN: paintAutumn(g); break;
        case GALAXY: paintGalaxy(g); break;
        case MATRIX: paintMatrix(g); break;
        default: break;
      }
    }
    private void paintSnow(Graphics2D g) {
      g.setColor(new Color(255, 255, 255, 220));
      for (int i = 0; i < PARTICLE_COUNT; i++) { double r = size[i]; g.fillOval((int) (x[i] - r), (int) (y[i] - r), (int) (r * 2), (int) (r * 2)); }
    }
    // Pre-baked at 210 alpha (the constant leaf opacity), so paintAutumn never allocates a Color per particle per frame.
    private static final Color[] LEAF_PALETTE_ALPHA = buildLeafPaletteAlpha();
    private static Color[] buildLeafPaletteAlpha() {
      Color[] out = new Color[LEAF_PALETTE.length];
      for (int i = 0; i < LEAF_PALETTE.length; i++) { Color c = LEAF_PALETTE[i]; out[i] = new Color(c.getRed(), c.getGreen(), c.getBlue(), 210); }
      return out;
    }
    // A single constant fill, no outline stroke and no light-band sweep — the previous version's per-bubble
    // fillOval+drawOval pair (two draw calls, two color switches per particle) plus a full-height gradient blit
    // that scaled with window size (measured up to 2.35ms at 5K fullscreen) made OCEAN 3-4x more expensive than
    // every other theme even after that blit was cached as an image. This trades the light-sweep and bubble rim
    // for the same one-draw-call-per-particle shape SNOW uses, bringing its cost down to the same baseline.
    private static final Color OCEAN_BUBBLE_FILL = new Color(210, 245, 250, 130);
    private void paintOcean(Graphics2D g) {
      g.setColor(OCEAN_BUBBLE_FILL);
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        double r = size[i];
        g.fillOval((int) (x[i] - r), (int) (y[i] - r), (int) (r * 2), (int) (r * 2));
      }
    }
    /**
     * Reuses one Graphics2D for all 140 leaves via translate/rotate + restoring the transform afterward, instead
     * of calling g.create() per particle. Graphics2D.create() was showing up as the main cost behind AUTUMN's
     * frame time — each call allocates and copies a full graphics context, 140 times every 35ms — and since that
     * paint competes with DiscView's own repaint on the EDT, a slow overlay frame directly stalled the disc's
     * rotation. Translate/rotate + setTransform(original) does the same visual job for a fraction of the cost.
     */
    private void paintAutumn(Graphics2D g) {
      java.awt.geom.AffineTransform original = g.getTransform();
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        double r = size[i];
        g.setColor(LEAF_PALETTE_ALPHA[i % LEAF_PALETTE_ALPHA.length]);
        g.translate(x[i], y[i]);
        g.rotate(spin[i]);
        g.fillOval((int) -r, (int) (-r * 0.6), (int) (r * 2), (int) (r * 1.2));
        g.setTransform(original);
      }
    }
    private void paintGalaxy(Graphics2D g) {
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        double twinkle = 0.5 + 0.5 * Math.sin(clock * (0.6 + speed[i]) + phase[i]);
        double r = size[i] * (0.7 + twinkle * 0.5);
        g.setColor(new Color(255, 255, 255, Math.min(255, (int) (80 + twinkle * 175))));
        g.fillOval((int) (x[i] - r), (int) (y[i] - r), (int) (r * 2), (int) (r * 2));
      }
      g.setStroke(new BasicStroke(1.4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
      for (double[] s : shootingStars) {
        double sx = s[0], sy = s[1], vx = s[2], vy = s[3], life = s[4];
        double norm = Math.hypot(vx, vy), len = 26;
        g.setColor(new Color(255, 255, 255, Math.max(0, Math.min(255, (int) (life * 230)))));
        g.drawLine((int) sx, (int) sy, (int) (sx - vx / norm * len), (int) (sy - vy / norm * len));
      }
    }
    private static final Font MATRIX_FONT = new Font(Font.MONOSPACED, Font.BOLD, 14);
    private static final Color MATRIX_HEAD_COLOR = new Color(224, 255, 224, 255);
    private static final int MATRIX_TRAIL_LENGTH = 10;
    private void paintMatrix(Graphics2D g) {
      int w = getWidth(), h = getHeight(), lineHeight = 16;
      g.setFont(MATRIX_FONT);
      ThreadLocalRandom r = ThreadLocalRandom.current();
      // ACCENT can change mid-frame during a theme transition, so this can't be a static cache, but it only needs
      // recomputing once per paint call — precomputing here turns what was up to 140*10 Color allocations per
      // frame into just 10, since every particle's trail reuses the same 10 alpha steps.
      Color[] trailColors = new Color[MATRIX_TRAIL_LENGTH];
      for (int j = 1; j < MATRIX_TRAIL_LENGTH; j++) trailColors[j] = new Color(ACCENT.getRed(), ACCENT.getGreen(), ACCENT.getBlue(), Math.max(0, 200 - j * 22));
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        if (x[i] > w) continue;
        for (int j = 0; j < MATRIX_TRAIL_LENGTH; j++) {
          double gy = y[i] - j * lineHeight;
          if (gy < -lineHeight || gy > h + lineHeight) continue;
          g.setColor(j == 0 ? MATRIX_HEAD_COLOR : trailColors[j]);
          g.drawString(String.valueOf((char) ('0' + r.nextInt(10))), (float) x[i], (float) gy);
        }
      }
    }
    public boolean contains(int px, int py) { return false; }
  }

  private static final class DiscView extends JPanel {
    // Paced to ANIMATION_TICK_MS (display refresh rate, capped at 60fps — see its own doc comment for why the cap
    // matters specifically here: the disc spins for as long as a track plays, competing with the real-time audio
    // pump thread for the whole time). .045 rad was tuned per 16ms tick (2.8125 rad/s); ROTATION_RAD_PER_MS
    // expresses that as a rate so the per-tick step scales with whatever interval actually runs, keeping
    // real-world spin speed identical regardless.
    private static final double ROTATION_RAD_PER_MS = .045 / 16.0;
    private double angle; private boolean spinning; private boolean lookingUp; private BufferedImage cover;
    private final Timer motion = new Timer(ANIMATION_TICK_MS, e -> { angle += ROTATION_RAD_PER_MS * ANIMATION_TICK_MS; repaint(); });
    private Runnable onCoverChanged; // notifies the AUTO theme (see CDPlayer.onCoverChanged) to re-derive its palette; null everywhere else
    // maximumSize matters here, not just preferredSize: the drawn disc itself is capped at 300px (see side=
    // Math.min(300, ...) in paintComponent below), but GridBagLayout's fill=BOTH + weightx/weighty=1 on this
    // column otherwise stretches the *component's actual bounds* to fill all available space in its cell —
    // measured growing from 231x611 in a windowed layout to 1923x2671 at a 5K fullscreen resolution. Since the
    // disc spins on a 16ms Timer while playing, every repaint() marks that entire (non-opaque) component's
    // bounds dirty, forcing the opaque background panel beneath it to redraw across that whole area each tick —
    // over 5 million pixels/frame at 5K vs ~140K windowed, a ~36x increase, regardless of which theme is active.
    // Capping maximumSize keeps the dirty rectangle bounded to roughly what's actually drawn.
    // minimumSize matters as much as maximumSize now that the disc's grid cell uses fill=NONE (see createContent):
    // GridBagLayout will compress even a fill=NONE component below its preferred size when the container is
    // tighter than the sum of every column's preferred size, and with no floor that shrank the disc to as little
    // as 10x10 at the app's default 1120x820 window — a visual regression, not just wasted layout space.
    private static final int NORMAL_COMPONENT_SIDE = 480, NORMAL_DISC_CAP = 300;
    private static final int ENLARGED_COMPONENT_SIDE = 760, ENLARGED_DISC_CAP = 640; // CD view (see CDPlayer.toggleCdView) — a deliberate, bounded size increase, not the unbounded fill=BOTH stretch the maximumSize cap above exists to prevent
    private static final int MINI_COMPONENT_SIDE = 92, MINI_DISC_CAP = 84; // Mini Mode (see CDPlayer.setMiniModeEnabled) — smaller than the 260 floor below, so setMini() also shrinks minimumSize, unlike setEnlarged() which never needs to
    private int discCapPx = NORMAL_DISC_CAP;
    private boolean miniMode;
    private Runnable onMiniClick; // fires on any click while miniMode is on, in place of the double-click-to-eject gesture below — see setMini()'s doc comment for why the two don't coexist
    DiscView() {
      setOpaque(false); setMinimumSize(new Dimension(260, 260)); setPreferredSize(new Dimension(NORMAL_COMPONENT_SIDE, NORMAL_COMPONENT_SIDE)); setMaximumSize(new Dimension(NORMAL_COMPONENT_SIDE, NORMAL_COMPONENT_SIDE));
      addMouseListener(new java.awt.event.MouseAdapter() {
        public void mouseClicked(java.awt.event.MouseEvent e) {
          if (miniMode) { if (onMiniClick != null) onMiniClick.run(); }
          else if (e.getClickCount() == 2) startEject();
        }
      });
    }
    /** CD view: a bigger, fixed size for both the component and the drawn disc's own cap (see side= below) — still bounded, so the same repaint-cost reasoning above still holds, just at a deliberately larger fixed number instead of an accidental unbounded one. */
    void setEnlarged(boolean enlarged) {
      int side = enlarged ? ENLARGED_COMPONENT_SIDE : NORMAL_COMPONENT_SIDE;
      discCapPx = enlarged ? ENLARGED_DISC_CAP : NORMAL_DISC_CAP;
      setPreferredSize(new Dimension(side, side)); setMaximumSize(new Dimension(side, side));
      revalidate(); repaint();
    }
    /**
     * Mini Mode: a small fixed size, well below the 260 floor set in the constructor for the normal/enlarged
     * tiers — that floor exists so GridBagLayout can't compress the disc past it in the main window, but Mini
     * Mode's whole window is smaller than that floor, so minimumSize has to come down too here or the disc alone
     * would force the tiny window wider than intended. Also swaps the double-click-to-eject gesture for a plain
     * single-click play/pause toggle (see onMiniClick): eject's own animation needs real room to read as "the CD
     * lifting up," which a ~90px disc in a widget-sized window doesn't have, and a glanceable mini player is
     * exactly the place a quick single-click play/pause is actually useful.
     */
    void setMini(boolean mini) {
      miniMode = mini;
      int side = mini ? MINI_COMPONENT_SIDE : NORMAL_COMPONENT_SIDE;
      discCapPx = mini ? MINI_DISC_CAP : NORMAL_DISC_CAP;
      setMinimumSize(new Dimension(mini ? MINI_COMPONENT_SIDE : 260, mini ? MINI_COMPONENT_SIDE : 260));
      setPreferredSize(new Dimension(side, side)); setMaximumSize(new Dimension(side, side));
      setCursor(mini ? Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) : Cursor.getDefaultCursor());
      revalidate(); repaint();
    }
    void setOnMiniClick(Runnable callback) { this.onMiniClick = callback; }
    void setSpinning(boolean value) { spinning = value; if (value) motion.start(); else motion.stop(); repaint(); }
    // flush() releases the native/GPU-accelerated surface Java2D caches behind an image the moment it's drawn
    // (macOS's Metal-backed pipeline keeps this off-heap, so it's invisible to the Java heap and to GC directly —
    // it's only reclaimed once the BufferedImage itself is collected and Java2D's own Disposer gets around to it,
    // which measured as never keeping up with a track changing every few seconds: ~600MB of IOAccelerator-backed
    // surfaces accumulated, unbounded, over a stress run that swapped cover art on every track change). Flushing
    // the old cover explicitly here, right before dropping the reference, releases it immediately instead.
    void setCover(BufferedImage image) { if (cover != null && cover != image) cover.flush(); cover = image; repaint(); if (onCoverChanged != null) onCoverChanged.run(); }
    BufferedImage getCover() { return cover; }
    void setOnCoverChanged(Runnable callback) { this.onCoverChanged = callback; }
    void setLookingUp(boolean value) { lookingUp = value; repaint(); }
    void setColorAnimationInProgress(boolean value) { colorAnimationInProgress = value; if (!value) repaint(); } // repaint once more so the final-color rebuild actually happens right away instead of waiting for the next unrelated repaint

    // Raw cover art (embedded tags, or an iTunes/Deezer lookup result) can be a few thousand pixels across, and
    // scaling that down to a ~100px label/thumbnail via drawImage's own interpolation is a genuinely expensive
    // Java2D path — the disc repaints on a 16ms timer while playing, so redoing that scale unconditionally on
    // every single frame (up to 120 scale operations/sec across the two spots below) was pure waste on every
    // frame where the cover and target size hadn't actually changed since the last one, which is the
    // overwhelming majority of frames. Each spot caches its own pre-scaled bitmap, keyed by (source image,
    // target size), and just blits it 1:1 (a plain, cheap texture copy) the rest of the time.
    private BufferedImage labelCoverCache; private int labelCoverCacheSize = -1; private double labelCoverCacheScale = -1; private BufferedImage labelCoverCacheSource;
    private BufferedImage thumbCoverCache; private int thumbCoverCacheSize = -1; private double thumbCoverCacheScale = -1; private BufferedImage thumbCoverCacheSource;
    /**
     * size is in logical (Swing) pixels; scale is the display's backing scale factor (2.0 on Retina, 1.0
     * otherwise) — the cached bitmap is rasterized at size*scale real pixels, not just size, and the caller
     * scales it back down to the logical size when drawing (via the destWidth/destHeight drawImage overload,
     * not the plain x/y one). Skipping the scale factor (rasterizing at exactly `size` regardless of display)
     * was the actual cause of a real, reported quality regression: on a Retina display, a `size`x`size` bitmap
     * drawn 1:1 in logical coordinates only has half the real pixel data the physical framebuffer needs, so the
     * OS upscales the already-small bitmap to fill the other half — soft/blurry, most visible on fine detail
     * (confirmed directly: the jewel-case thumbnail, which is smaller and had less room for detail to survive
     * that upscale, looked noticeably worse than the larger disc label rendered from the very same source cover
     * at the very same (missing) scale awareness).
     */
    private static BufferedImage rescaleCover(BufferedImage source, int size, double scale) {
      int pixelSize = Math.max(1, Math.round(size * (float) scale));
      BufferedImage scaled = new BufferedImage(pixelSize, pixelSize, BufferedImage.TYPE_INT_ARGB);
      Graphics2D sg = scaled.createGraphics();
      sg.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
      sg.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
      sg.drawImage(source, 0, 0, pixelSize, pixelSize, null);
      sg.dispose();
      return scaled;
    }

    // The disc's own rotating face (gradient body, grooves, highlight arc, center label, spindle hole) doesn't
    // actually change shape from one frame to the next while spinning — only the rotation ANGLE does — so
    // redrawing all of it from scratch on every 16ms tick (a gradient fill plus several antialiased stroked
    // ovals plus a clipped image draw) was pure waste on every frame where the disc's size/colors/cover hadn't
    // actually changed since the last one, which is the overwhelming majority of frames during ordinary playback
    // (measured as the single largest share of this component's own per-frame cost). Rendered once into this
    // cache at the disc's own local (0,0)-(side,side) origin — paintComponent just blits-and-rotates it instead
    // of redrawing — and only rebuilt when size, display scale, the live theme colors it's drawn with, the cover
    // art, or the "looking up cover art" placeholder state actually changes. During a theme color transition,
    // ACCENT/ACCENT2/BG genuinely differ tick to tick, which used to force a full rebuild — a supersampled
    // gradient fill plus several antialiased stroked ovals plus a clipped image draw — on every single one of
    // those ticks. Measured directly as the largest single contributor to a ~150ms theme transition costing
    // 20-25ms per tick against an 8ms budget, which made the fade visibly skip straight from frame 1 to frame 3
    // instead of interpolating smoothly. colorAnimationInProgress (see setColorAnimationInProgress) suppresses
    // just the color part of that invalidation check while a transition is running — the disc's own gradient
    // holds its pre-transition colors for that brief window instead of animating through every intermediate
    // step, barely noticeable on its own against everything else genuinely fading, and rebuilds once for real
    // the moment the transition ends and colors settle at their final value.
    private boolean colorAnimationInProgress;
    private BufferedImage discFaceCache;
    private int discFaceCacheSide = -1; private double discFaceCacheScale = -1;
    private Color discFaceCacheAccent, discFaceCacheAccent2, discFaceCacheBg;
    private BufferedImage discFaceCacheCoverSource; private boolean discFaceCacheLookingUp;
    // Rendered at 2x the strictly-needed pixel size, then always drawn back down to `side` at draw time (see
    // paintComponent's KEY_INTERPOLATION hint) — the disc spins, so this bitmap is constantly redrawn through a
    // rotation transform, and a plain 1:1 cache only has a single pixel's worth of edge data to resample from at
    // most rotation angles, which read as a jagged/stair-stepped border no matter what interpolation hint the
    // draw uses. Supersampling gives that resample real antialiased edge data to blend from instead. Cheap here
    // since this is a cache rebuilt only on an actual size/color/cover change, not per frame.
    private static final int DISC_FACE_SUPERSAMPLE = 2;
    private BufferedImage renderDiscFace(int side, double displayScale) {
      double renderScale = displayScale * DISC_FACE_SUPERSAMPLE;
      int pixelSide = Math.max(1, (int) Math.round(side * renderScale));
      BufferedImage face = new BufferedImage(pixelSide, pixelSide, BufferedImage.TYPE_INT_ARGB);
      Graphics2D g = face.createGraphics();
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      g.scale(renderScale, renderScale);
      int centerX = side / 2, centerY = side / 2;
      g.setPaint(new GradientPaint(0, 0, ACCENT, side, side, ACCENT2));
      g.fillOval(0, 0, side, side);

      // subtle concentric grooves
      g.setColor(new Color(255, 255, 255, 22));
      g.setStroke(new BasicStroke(1f));
      for (int r = side / 2 - 16; r > side / 6; r -= 18) g.drawOval(centerX - r, centerY - r, r * 2, r * 2);

      // reflective highlight arc
      g.setColor(new Color(255, 255, 255, 55));
      g.setStroke(new BasicStroke(Math.max(2, side / 110)));
      g.drawArc(side / 12, side / 12, side * 5 / 6, side * 5 / 6, 200, 80);

      // center label — the full disc face (same in every size tier, not just Mini Mode) rather than the old
      // side/3, so the cover art IS the disc rather than a small chip in the middle. At 100% this fully covers
      // the grooves and reflective highlight arc drawn above whenever a cover exists — expected: those are only
      // ever seen now on the "no cover" fallback states below (the loading "…" / plain "♪" note), where nothing
      // gets drawn over them.
      int labelSize = side, labelX = centerX - labelSize / 2, labelY = centerY - labelSize / 2;
      g.setColor(new Color(20, 21, 28));
      g.fillOval(labelX, labelY, labelSize, labelSize);
      if (cover != null && labelSize > 0) {
        java.awt.Shape oldClip = g.getClip();
        g.setClip(new Ellipse2D.Double(labelX, labelY, labelSize, labelSize));
        if (labelCoverCache == null || labelCoverCacheSize != labelSize || labelCoverCacheScale != displayScale || labelCoverCacheSource != cover) {
          if (labelCoverCache != null) labelCoverCache.flush();
          labelCoverCache = rescaleCover(cover, labelSize, displayScale); labelCoverCacheSize = labelSize; labelCoverCacheScale = displayScale; labelCoverCacheSource = cover;
        }
        g.drawImage(labelCoverCache, labelX, labelY, labelSize, labelSize, null);
        g.setClip(oldClip);
      } else if (lookingUp) {
        g.setColor(new Color(255, 255, 255, 130)); g.setFont(new Font("SansSerif", Font.BOLD, Math.max(8, side / 32)));
        String loading = "…"; java.awt.FontMetrics fm = g.getFontMetrics();
        g.drawString(loading, centerX - fm.stringWidth(loading) / 2, centerY + side / 42);
      } else {
        g.setColor(new Color(255, 255, 255, 55)); g.setFont(new Font("SansSerif", Font.PLAIN, labelSize / 3));
        String note = "♪"; java.awt.FontMetrics fm = g.getFontMetrics();
        g.drawString(note, centerX - fm.stringWidth(note) / 2, centerY + fm.getAscent() / 3);
      }
      // Two concentric strokes, not one: with the cover art now filling the entire disc face (see this method's
      // own "100% fill" note above), the disc's true edge sits directly against whatever the cover art itself
      // looks like there — a dark, low-contrast region of the cover (a shadowed area, a black background) can
      // make a single pale ring alone hard to see, reading as if the disc simply stops short of its actual edge
      // rather than the cover just being dark there. A darker ring just outside the lighter one keeps the
      // boundary legible against bright cover content too, without needing to know the cover's colors up front.
      // Light ring drawn first, centered exactly on the disc's true edge — this defines where the boundary
      // actually sits. The dark ring is drawn second but on a smaller, inset bounding box (not the same one) so
      // its stroke stays entirely inside the light ring's inner edge, instead of straddling the same path: two
      // strokes of different widths centered on the *same* circle both extend past it by half their own width,
      // so the wider dark stroke used to poke a sliver of black out past the light ring into the space just
      // outside the disc — visible as a thin black line running just outside the CD's actual outline.
      g.setColor(new Color(255, 255, 255, 160)); g.setStroke(new BasicStroke(1.6f)); g.drawOval(labelX, labelY, labelSize, labelSize);
      int ringInset = 2;
      g.setColor(new Color(0, 0, 0, 120)); g.setStroke(new BasicStroke(2f));
      g.drawOval(labelX + ringInset, labelY + ringInset, labelSize - ringInset * 2, labelSize - ringInset * 2);

      // spindle hole
      int holeSize = side / 11;
      g.setColor(BG); g.fillOval(centerX - holeSize / 2, centerY - holeSize / 2, holeSize, holeSize);
      g.setColor(new Color(255, 255, 255, 60)); g.drawOval(centerX - holeSize / 2, centerY - holeSize / 2, holeSize, holeSize);

      g.dispose();
      return face;
    }

    // Easter egg: double-click the disc and it lifts partway out of the case, tilts, holds briefly, then settles
    // back — like swapping it for a different CD. onEjectPeak (if set) fires once per cycle, right as it reaches
    // full lift (the start of the hold phase, before it starts coming back down), so the caller can swap the
    // track while the disc is elevated — by the time it settles back into the case, it's already showing the new
    // one, same as physically holding a CD up while you switch it out. ejectElapsedMs is -1 when idle so
    // startEject() can cheaply no-op while an animation is already running instead of restarting/stacking on top
    // of itself.
    private double ejectElapsedMs = -1;
    private boolean ejectPeakFired;
    private Runnable onEjectPeak;
    private static final double EJECT_OUT_MS = 300, EJECT_HOLD_MS = 180, EJECT_BACK_MS = 320;
    private static final double EJECT_TOTAL_MS = EJECT_OUT_MS + EJECT_HOLD_MS + EJECT_BACK_MS;
    // Paced to ANIMATION_TICK_MS (see its own doc comment) rather than a fixed 16ms, same reasoning as the disc's
    // own spin timer just above. ejectElapsedMs is a plain elapsed-milliseconds accumulator, so it stays correct
    // at any interval simply by adding that same interval each tick — no rate constant to rescale here.
    private final Timer ejectTimer = new Timer(ANIMATION_TICK_MS, e -> {
      ejectElapsedMs += ANIMATION_TICK_MS;
      if (!ejectPeakFired && ejectElapsedMs >= EJECT_OUT_MS) { ejectPeakFired = true; if (onEjectPeak != null) onEjectPeak.run(); }
      if (ejectElapsedMs >= EJECT_TOTAL_MS) { ejectElapsedMs = -1; ((Timer) e.getSource()).stop(); }
      repaint();
    });
    void setOnEjectPeak(Runnable callback) { this.onEjectPeak = callback; }
    private void startEject() { if (ejectElapsedMs < 0) { ejectElapsedMs = 0; ejectPeakFired = false; ejectTimer.start(); } }
    private static double easeOutCubic(double t) { return 1 - Math.pow(1 - t, 3); }
    /** 0 = resting in the case, 1 = fully lifted out. Ramps up, holds, then ramps back down. */
    private double ejectProgress() {
      if (ejectElapsedMs < 0) return 0;
      if (ejectElapsedMs < EJECT_OUT_MS) return easeOutCubic(ejectElapsedMs / EJECT_OUT_MS);
      if (ejectElapsedMs < EJECT_OUT_MS + EJECT_HOLD_MS) return 1;
      return 1 - easeOutCubic((ejectElapsedMs - EJECT_OUT_MS - EJECT_HOLD_MS) / EJECT_BACK_MS);
    }
    protected void paintComponent(Graphics raw) {
      super.paintComponent(raw); Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      // The Graphics2D's own current transform, not a separately-queried GraphicsConfiguration: this is the
      // scale factor actually in effect for this specific paint call (2.0 on a Retina display, 1.0 otherwise —
      // and reliably 1.0 for the off-screen BufferedImage-backed Graphics2D this app's own verification tests
      // paint into, so no artificial upscale/blur there either).
      double displayScale = g.getTransform().getScaleX(); if (displayScale <= 0) displayScale = 1.0;
      // Mini Mode's own component is far too small (~92px) to spare the normal/enlarged tiers' 40px margin the
      // same way — that margin alone would eat nearly half its width, leaving a barely-visible disc. 8px keeps a
      // small breathing gap without giving up real size the tiny widget can't afford to lose.
      int margin = miniMode ? 8 : 40;
      int side = Math.min(discCapPx, Math.min(getWidth(), getHeight()) - margin);
      int x = (getWidth() - side) / 2, y = (getHeight() - side) / 2, centerX = x + side / 2, centerY = y + side / 2;

      // jewel case backdrop behind the disc — skipped in Mini Mode: it's sized for the normal/enlarged disc (adds
      // another +60px around an already-small side), and Mini Mode's own reference design is just the disc alone
      // with the cover art filling most of its face (see renderDiscFace's miniMode branch) rather than a second,
      // separate small thumbnail squeezed in beside it.
      if (!miniMode) {
        int caseSide = side + 60, caseX = centerX - caseSide / 2, caseY = centerY - caseSide / 2;
        g.setColor(new Color(255, 255, 255, 14)); g.fillRoundRect(caseX, caseY, caseSide, caseSide, 12, 12);
        g.setColor(new Color(ACCENT.getRed(), ACCENT.getGreen(), ACCENT.getBlue(), 95)); g.setStroke(new BasicStroke(1.6f)); g.drawRoundRect(caseX, caseY, caseSide, caseSide, 12, 12);
        g.setColor(new Color(255, 255, 255, 26)); g.setStroke(new BasicStroke(1));
        g.drawLine(caseX + 10, caseY + 10, caseX + caseSide - 10, caseY + 10);
        g.drawLine(caseX + 10, caseY + caseSide - 10, caseX + caseSide - 10, caseY + caseSide - 10);
        if (cover != null) {
          int thumb = Math.round(side * 0.193f); // proportional to the disc, not a flat 58px — otherwise the thumbnail stayed tiny next to the much bigger disc in CD view (see setEnlarged)
          g.setColor(new Color(0, 0, 0, 120)); g.fillRoundRect(caseX + 14, caseY + 14, thumb, thumb, 6, 6);
          int thumbImgSize = thumb - 6;
          if (thumbImgSize > 0) {
            if (thumbCoverCache == null || thumbCoverCacheSize != thumbImgSize || thumbCoverCacheScale != displayScale || thumbCoverCacheSource != cover) {
              if (thumbCoverCache != null) thumbCoverCache.flush();
              thumbCoverCache = rescaleCover(cover, thumbImgSize, displayScale); thumbCoverCacheSize = thumbImgSize; thumbCoverCacheScale = displayScale; thumbCoverCacheSource = cover;
            }
            g.drawImage(thumbCoverCache, caseX + 17, caseY + 17, thumbImgSize, thumbImgSize, null);
          }
          g.setColor(ACCENT2); g.setStroke(new BasicStroke(1.2f)); g.drawRoundRect(caseX + 16, caseY + 16, thumb - 4, thumb - 4, 5, 5);
        }
      }

      // Everything below is the disc itself (not the case, which stays put above): shifted up/sideways and
      // squished vertically around its own center to read as "lifting up and tilting out of the case" for the
      // eject easter egg. squish=1/offset=0 at rest, so this is a no-op transform (translate by 0, scale by 1)
      // when ejectProgress() is 0 — cheap enough not to bother skipping it entirely.
      AffineTransform preEject = g.getTransform();
      double eject = ejectProgress();
      int ejectOffsetX = (int) Math.round(side * 0.14 * eject), ejectOffsetY = (int) Math.round(-side * 0.42 * eject);
      double ejectSquish = 1.0 - 0.22 * eject;
      g.translate(centerX + ejectOffsetX, centerY + ejectOffsetY);
      g.scale(1.0, ejectSquish);
      g.translate(-centerX, -centerY);

      // Soft shadow all around the disc, not just beneath it: the old version offset the shadow oval down by
      // 12px with no size change, meaning it only ever peeked out past the disc's own edge along the bottom arc
      // (the disc's higher top edge always fully covered the shadow up there) — a real-world-lighting-style
      // directional shadow in isolation, but combined with the disc's already-subtle boundary ring, that one-
      // sided dark sliver read as the disc looking cut off / missing content at the bottom rather than a
      // deliberate shadow, especially against darker cover art. A symmetric halo — same center, just a few
      // pixels larger — peeks out evenly on every side instead, reading as an intentional soft elevation effect.
      int shadowPad = Math.max(4, side / 90);
      g.setColor(new Color(0, 0, 0, 90));
      g.fillOval(x - shadowPad, y - shadowPad, side + shadowPad * 2, side + shadowPad * 2);

      AffineTransform old = g.getTransform();
      g.rotate(angle, centerX, centerY);
      boolean colorChanged = !colorAnimationInProgress
          && (!java.util.Objects.equals(discFaceCacheAccent, ACCENT) || !java.util.Objects.equals(discFaceCacheAccent2, ACCENT2) || !java.util.Objects.equals(discFaceCacheBg, BG));
      if (discFaceCache == null || discFaceCacheSide != side || discFaceCacheScale != displayScale
          || colorChanged || discFaceCacheCoverSource != cover || discFaceCacheLookingUp != lookingUp) {
        if (discFaceCache != null) discFaceCache.flush();
        discFaceCache = renderDiscFace(side, displayScale);
        discFaceCacheSide = side; discFaceCacheScale = displayScale;
        discFaceCacheAccent = ACCENT; discFaceCacheAccent2 = ACCENT2; discFaceCacheBg = BG;
        discFaceCacheCoverSource = cover; discFaceCacheLookingUp = lookingUp;
      }
      // Bilinear, not the Java2D default nearest-neighbor: this bitmap is being drawn through a rotation
      // transform (this whole block runs after g.rotate() above) on every spinning frame, and nearest-neighbor
      // resampling under rotation is exactly what reads as a jagged/scratched-looking circular edge.
      g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
      g.drawImage(discFaceCache, x, y, side, side, null);

      g.setTransform(old);
      if (!spinning) { g.setColor(new Color(10, 11, 16, 90)); g.fillOval(x, y, side, side); }
      g.setTransform(preEject);
      g.dispose();
    }
  }
}
