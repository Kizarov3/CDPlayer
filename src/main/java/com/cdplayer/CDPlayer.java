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
import javax.swing.JScrollPane;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.UIManager;
import javax.swing.plaf.basic.BasicSliderUI;
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
  private final JLabel status = label("●  READY TO PLAY", 11, ACCENT);
  private final JLabel track = new JLabel("Pick a track to get started.");
  private final JLabel source = label("YOUR MUSIC LIBRARY", 11, MUTED);
  private final JLabel elapsed = label("0:00", 10, MUTED);
  private final JLabel length = label("0:00", 10, MUTED);
  private final JSlider progress = new JSlider(0, 1000, 0);
  private final TransportButton play = new TransportButton(Glyph.PLAY, 68, true);
  private final ModeIconButton shuffleButton = new ModeIconButton(Glyph.SHUFFLE, "Shuffle");
  private final ModeIconButton repeatButton = new ModeIconButton(Glyph.REPEAT, "Repeat");
  private final JButton clearQueueButton = textButton("CLEAR QUEUE");
  private final JButton themeButton = textButton(THEMES[0].name);
  private final JLabel nowPlayingLabel = new JLabel("NOW PLAYING");
  private final JLabel queueInfo = label("QUEUE EMPTY", 10, MUTED);
  private final JLabel queueNext = label("DROP SONGS OR A FOLDER TO BUILD A QUEUE", 9, MUTED);
  private final JLabel crossfadeTitle = new JLabel("CROSSFADE");
  private final JSlider crossfadeSlider = new JSlider(0, 15, 0);
  private final JLabel crossfadeValueLabel = new JLabel("OFF");
  private final JLabel volumeTitle = new JLabel("VOLUME");
  private final JSlider volumeSlider = new JSlider(0, 100, 100);
  private final JLabel volumeValueLabel = new JLabel("100%");
  private final VisualizerBars visualizer = new VisualizerBars();
  private final ThemeOverlay themeOverlay = new ThemeOverlay();
  private final List<File> queue = new ArrayList<File>();
  private int queueIndex = -1;
  private final Map<File, SongDetails> metadataCache = new HashMap<File, SongDetails>();
  private final Map<File, Long> durationCache = new HashMap<File, Long>();
  // Panel that lists all queued songs; displayed under queue headers.
  private final JPanel queueList = new JPanel();
  private final List<QueueRowUI> queueRows = new ArrayList<QueueRowUI>();
  private int hoveredQueueIndex = -1;
  private boolean shuffle;
  private boolean repeat;
  private StreamPlayer player;
  private File loadedFile;
  private File temporaryAudio;
  private boolean adjusting;
  private boolean crossfadeStarted;
  private boolean crossfading;
  private float volume = 1f;
  private boolean monoAudio;
  private byte[] rawAudio;
  private AudioFormat audioFormat;
  private final Timer clock = new Timer(70, this::tick);
  private static final Pattern ITUNES_COVER = Pattern.compile("\\\"artworkUrl100\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern DEEZER_COVER = Pattern.compile("\\\"cover_xl\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final File QUEUE_STATE_FILE = new File(System.getProperty("user.home"), ".cdplayer/queue.txt");
  private static final File ONBOARDING_FLAG_FILE = new File(System.getProperty("user.home"), ".cdplayer/onboarded");
  private static final File LAST_PATH_FILE = new File(System.getProperty("user.home"), ".cdplayer/lastpath.txt");
  private static final File SETTINGS_FILE = new File(System.getProperty("user.home"), ".cdplayer/settings.txt");
  private final JButton settingsButton = textButton("SETTINGS");
  private final JButton monoButton = textButton("OFF");
  private final JButton animationsButton = textButton("ON");
  private SettingsOverlay settingsOverlay;
  private ThemeMenuOverlay themeMenuOverlay;
  private JPanel contentStack; // the OverlayLayout stack: themeMenuOverlay / settingsOverlay (topmost, added lazily) > foreground > themeOverlay > background
  private java.awt.Rectangle preFullscreenBounds;
  private boolean fullscreen;

  public static void main(String[] args) {
    // The theme dropdown (showThemeMenu) uses a JPopupMenu; Swing normally decides per-popup whether to use a
    // lightweight (in-window) or heavyweight (separate native window) implementation. Forcing lightweight avoids
    // the same class of bug that motivated moving Settings off JDialog: a heavyweight popup is a real top-level
    // window, and those don't reliably layer above this app's own exclusive GraphicsDevice fullscreen.
    javax.swing.JPopupMenu.setDefaultLightWeightPopupEnabled(true);
    SwingUtilities.invokeLater(() -> {
      try { UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName()); }
      catch (Exception ignored) { }
      CDPlayer player = new CDPlayer();
      player.setVisible(true);
      player.showOnboardingIfNeeded();
    });
  }

  public CDPlayer() {
    super("CDPlayer");
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
    setDropTarget(new DropTarget(this, new DropTargetAdapter() {
      @SuppressWarnings("unchecked") public void drop(DropTargetDropEvent event) {
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
    Runtime.getRuntime().addShutdownHook(new Thread(this::saveQueueState, "cdplayer-save-queue"));
    Runtime.getRuntime().addShutdownHook(new Thread(this::saveSettingsState, "cdplayer-save-settings"));
    restoreSettingsState();
    restoreQueueState();
  }

  private void bindKeys() {
    javax.swing.JRootPane root = getRootPane();
    javax.swing.InputMap inputMap = root.getInputMap(javax.swing.JComponent.WHEN_IN_FOCUSED_WINDOW);
    javax.swing.ActionMap actionMap = root.getActionMap();
    bindKey(inputMap, actionMap, "LEFT", "skipBack15", e -> seek(-15));
    bindKey(inputMap, actionMap, "RIGHT", "skipForward15", e -> seek(15));
    bindKey(inputMap, actionMap, "SPACE", "togglePlaySpace", e -> toggle());
    bindKey(inputMap, actionMap, "K", "togglePlayK", e -> toggle());
    bindKey(inputMap, actionMap, "J", "previousTrackJ", e -> previousTrack());
    bindKey(inputMap, actionMap, "L", "nextTrackL", e -> nextTrack());
    bindKey(inputMap, actionMap, "F", "toggleFullscreen", e -> toggleFullscreen());
    // Closest-thing-open takes priority: the theme menu, then Settings, then fullscreen. Both overlays are plain
    // in-window components (not separate JDialog/JPopupMenu windows — see showSettingsDialog/showThemeMenu), so
    // this single WHEN_IN_FOCUSED_WINDOW binding on the main frame handles all three; there's no separate window
    // with its own key bindings to manage.
    bindKey(inputMap, actionMap, "ESCAPE", "escapeAction", e -> {
      if (themeMenuOverlay != null && themeMenuOverlay.isVisible()) hideThemeMenu();
      else if (settingsOverlay != null && settingsOverlay.isVisible()) closeSettingsDialog();
      else if (fullscreen) toggleFullscreen();
    });
  }
  /**
   * True OS-level exclusive fullscreen via GraphicsDevice, not just resizing to the screen's bounds. Simply
   * matching the screen's bounds (the earlier approach) leaves a borderless window that's still just a regular
   * window as far as the OS is concerned — on macOS the menu bar is a system-level overlay that stays on top of
   * any regular window regardless of its size, so that approach never actually covered it. setFullScreenWindow()
   * is the real "hide the menu bar/dock (or Windows taskbar) and take over the display" API.
   * Swing requires a Frame to not be displayable to change setUndecorated(), so this disposes and recreates the
   * native peer — the Java component tree (and all its listeners) survives that untouched, only the OS window
   * itself is torn down and rebuilt.
   */
  private void toggleFullscreen() {
    java.awt.GraphicsDevice device = getGraphicsConfiguration().getDevice();
    if (!fullscreen) {
      preFullscreenBounds = getBounds();
      dispose();
      setUndecorated(true);
      device.setFullScreenWindow(this);
      fullscreen = true;
    } else {
      device.setFullScreenWindow(null);
      dispose();
      setUndecorated(false);
      if (preFullscreenBounds != null) setBounds(preFullscreenBounds);
      setVisible(true);
      fullscreen = false;
    }
    getRootPane().requestFocusInWindow(); // keyboard shortcuts live on the root pane's WHEN_IN_FOCUSED_WINDOW map
  }

  private static void bindKey(javax.swing.InputMap inputMap, javax.swing.ActionMap actionMap, String key, String name, java.util.function.Consumer<ActionEvent> action) {
    inputMap.put(javax.swing.KeyStroke.getKeyStroke(key), name);
    actionMap.put(name, new javax.swing.AbstractAction() { public void actionPerformed(ActionEvent e) { action.accept(e); } });
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

  /**
   * Opens (or refocuses) Settings. This is a plain in-window overlay panel (added to contentStack, the topmost
   * layer), not a separate JDialog/Window — a separate top-level window doesn't reliably layer correctly above
   * either the OS's own native fullscreen (opens on a different Space entirely) or this app's own exclusive
   * GraphicsDevice fullscreen (didn't show up at all — exclusive fullscreen generally can't host a second
   * top-level window above it). Being a component within the same window sidesteps both failure modes: it's
   * always positioned and painted correctly relative to whatever the main window's current bounds actually are.
   * Rebuilds its content each time rather than caching the panel, so labels/colors stay current across theme changes.
   */
  private void showSettingsDialog() {
    if (settingsOverlay == null) {
      settingsOverlay = new SettingsOverlay();
      settingsOverlay.setVisible(false);
      contentStack.add(settingsOverlay, 0); // index 0 = topmost in the OverlayLayout stack, above the disc/theme particles/background
      themeOverlay.setSettingsCardReference(settingsOverlay.card); // themeOverlay is the glass pane (always topmost) — without this, particles would drift over the open Settings card too
    }
    settingsOverlay.card.removeAll();
    settingsOverlay.card.add(buildSettingsPanel(), BorderLayout.CENTER);
    // validate() (immediate, synchronous), not revalidate() (deferred to the next natural repaint cycle) — and
    // done here, after the card's content is populated, not right after contentStack.add() above: the card's own
    // size comes from its content, so validating before that content exists would (and did) lock its bounds at
    // zero permanently, since this whole block only runs once per settingsOverlay lifetime.
    contentStack.validate();
    settingsOverlay.setVisible(true);
    animateSettingsIn();
  }
  private void closeSettingsDialog() { hideThemeMenu(); if (settingsOverlay != null) animateSettingsOut(); }
  private Timer settingsAnimTimer;
  /** Grows the settings card from 90% to 100% size (eased) with a fade-in, instead of it just popping into existence. Implemented as a component-level scale/alpha transform in FadeableCard.paint() rather than Window.setOpacity(), since this is no longer a separate Window. */
  private void animateSettingsIn() {
    if (settingsAnimTimer != null && settingsAnimTimer.isRunning()) settingsAnimTimer.stop();
    FadeableCard card = settingsOverlay.card;
    if (!animationsEnabled) { card.opacity = 1f; card.scale = 1f; settingsOverlay.repaint(); return; }
    card.beginTransformAnimation();
    card.opacity = 0f; card.scale = 0.9f;
    final int steps = 10;
    final int[] step = { 0 };
    settingsAnimTimer = new Timer(12, null);
    settingsAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      float eased = 1f - (float) Math.pow(1f - t, 3); // ease-out cubic
      card.opacity = eased;
      card.scale = 0.9f + 0.1f * eased;
      settingsOverlay.repaint();
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
    final int steps = 8;
    final int[] step = { 0 };
    settingsAnimTimer = new Timer(12, null);
    settingsAnimTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      card.opacity = 1f - t;
      card.scale = 1f - 0.1f * t;
      settingsOverlay.repaint();
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
  /** Flips the global animations flag before updating the button's own text, so turning animations on still gets an animated flourish on the button itself, and turning them off snaps the button (and everything else) instantly. */
  private void setAnimationsEnabled(boolean value) {
    animationsEnabled = value;
    animationsButton.setText(value ? "ON" : "OFF");
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
  private void hideThemeMenu() { if (themeMenuOverlay != null) themeMenuOverlay.setVisible(false); }

  /** Applies a theme immediately, without switchToTheme()'s color-lerp animation — used only by restoreSettingsState() at startup, before the window is first shown, where an instant application is correct (no from-color transition makes sense yet, and an animated one risks a brief flash from the default theme to the restored one right as the app opens). */
  private void applyThemeInstant(int index) {
    currentThemeIndex = index;
    Theme to = THEMES[index];
    themeButton.setText(to.name);
    themeOverlay.setMode(ThemeOverlay.Mode.forTheme(to.name));
    visualizer.setMode(VisualizerBars.Mode.forTheme(to.name));
    BG = to.bg; CARD = to.card; ACCENT = to.accent; ACCENT2 = to.accent2; TEXT = to.text; MUTED = to.muted;
    applyThemeColors();
  }
  private void switchToTheme(int index) {
    if (index == currentThemeIndex) return;
    Theme from = THEMES[currentThemeIndex];
    Theme to = THEMES[index];
    currentThemeIndex = index;
    themeButton.setText(to.name); // the settings row's own "THEME" label already gives context
    themeOverlay.setMode(ThemeOverlay.Mode.forTheme(to.name));
    visualizer.setMode(VisualizerBars.Mode.forTheme(to.name));
    Color[] fromColors = { BG, CARD, ACCENT, ACCENT2, TEXT, MUTED };
    Color[] toColors = { to.bg, to.card, to.accent, to.accent2, to.text, to.muted };
    if (themeAnim != null && themeAnim.isRunning()) themeAnim.stop();
    if (!animationsEnabled) {
      BG = to.bg; CARD = to.card; ACCENT = to.accent; ACCENT2 = to.accent2; TEXT = to.text; MUTED = to.muted;
      applyThemeColors(); getContentPane().repaint(); refreshSettingsIfOpen(); updateQueueUI();
      return;
    }
    int steps = 18;
    int[] step = { 0 };
    themeAnim = new Timer(16, e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      BG = lerp(fromColors[0], toColors[0], t); CARD = lerp(fromColors[1], toColors[1], t); ACCENT = lerp(fromColors[2], toColors[2], t);
      ACCENT2 = lerp(fromColors[3], toColors[3], t); TEXT = lerp(fromColors[4], toColors[4], t); MUTED = lerp(fromColors[5], toColors[5], t);
      applyThemeColors();
      getContentPane().repaint();
      refreshSettingsIfOpen(); // so an already-open Settings dialog fades along with the main window, not just on next open
      if (t >= 1f) { ((Timer) e.getSource()).stop(); updateQueueUI(); }
    });
    themeAnim.start();
  }
  /** Rebuilds the Settings card's content in place if it's currently open, so it tracks the live BG/CARD/ACCENT/etc. colors during a theme transition instead of sitting frozen on whatever they were when it was opened. */
  private void refreshSettingsIfOpen() {
    if (settingsOverlay == null || !settingsOverlay.isVisible()) return;
    settingsOverlay.card.removeAll();
    settingsOverlay.card.add(buildSettingsPanel(), BorderLayout.CENTER);
    contentStack.validate(); // immediate, not deferred — see showSettingsDialog()'s note on why validate() over revalidate() here
    settingsOverlay.card.repaint();
  }

  private void applyThemeColors() {
    status.setForeground(ACCENT); track.setForeground(TEXT); source.setForeground(MUTED);
    elapsed.setForeground(MUTED); length.setForeground(MUTED); queueInfo.setForeground(MUTED); queueNext.setForeground(MUTED);
    nowPlayingLabel.setForeground(ACCENT2); crossfadeTitle.setForeground(MUTED); crossfadeValueLabel.setForeground(MUTED);
    volumeTitle.setForeground(MUTED); volumeValueLabel.setForeground(MUTED);
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
    headerBlock.add(header(), BorderLayout.NORTH); headerBlock.add(new BarbedDivider(), BorderLayout.SOUTH);
    root.add(headerBlock, BorderLayout.NORTH);
    JPanel body = new JPanel(new GridBagLayout()); body.setOpaque(false);
    GridBagConstraints constraints = new GridBagConstraints();
    constraints.gridy = 0; constraints.weighty = 1;
    // NONE (not BOTH) for the disc specifically: its cell still claims its weightx share of the row so the
    // overall layout is unaffected, but the component itself is centered at its natural size instead of being
    // stretched to fill the cell. GridBagLayout doesn't reliably honor a component's maximumSize when fill=BOTH
    // — measured DiscView's actual bounds growing from 231x611 windowed to 1923x2671 at a 5K fullscreen
    // resolution even with maximumSize(480, 480) set, because the disc spins on a 16ms Timer while playing and
    // (being non-opaque) forces the opaque background panel beneath it to redraw its full dirty rectangle on
    // every tick — over 5 million pixels/frame at that stretched size vs ~140K windowed, regardless of theme.
    constraints.fill = GridBagConstraints.NONE;
    constraints.gridx = 0; constraints.weightx = 1; constraints.insets = new Insets(10, 0, 10, 44); body.add(disc, constraints);
    constraints.fill = GridBagConstraints.BOTH;
    constraints.gridx = 1; constraints.weightx = 1.05; constraints.insets = new Insets(36, 0, 20, 0); body.add(playerPanel(), constraints);
    root.add(body, BorderLayout.CENTER);
    JLabel hint = label("DROP WAV · AIFF · AU · FLAC · M4A · MP3 — SPACE/K PLAY · J/L PREV/NEXT · ←/→ SKIP 15S · F FULLSCREEN · ESC EXIT", 10, new Color(120, 122, 126));
    hint.setHorizontalAlignment(SwingConstants.CENTER); hint.setBorder(BorderFactory.createEmptyBorder(18, 0, 0, 0)); root.add(hint, BorderLayout.SOUTH);

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
    JPanel bar = new JPanel(new BorderLayout()); bar.setOpaque(false); bar.setPreferredSize(new Dimension(0, 56));
    JPanel statusPill = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 0, 0)) {
      protected void paintComponent(Graphics raw) { Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON); g.setColor(new Color(0,0,0,90)); g.fillRoundRect(0, 0, getWidth(), getHeight(), 4, 4); g.setColor(new Color(255,255,255,30)); g.setStroke(new BasicStroke(1)); g.drawRoundRect(0, 0, getWidth()-1, getHeight()-1, 4, 4); g.dispose(); super.paintComponent(raw); }
    };
    statusPill.setOpaque(false); statusPill.setBorder(BorderFactory.createEmptyBorder(6, 16, 6, 16)); statusPill.add(status);
    JPanel center = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 0, 0)); center.setOpaque(false); center.add(statusPill);
    bar.add(center, BorderLayout.CENTER);
    settingsButton.addActionListener(e -> showSettingsDialog());
    JPanel east = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 8, 0)); east.setOpaque(false); east.add(settingsButton);
    bar.add(east, BorderLayout.EAST);
    return bar;
  }

  private JPanel playerPanel() {
    JPanel panel = new JPanel(); panel.setOpaque(false); panel.setLayout(new javax.swing.BoxLayout(panel, javax.swing.BoxLayout.Y_AXIS));
    JPanel nowRow = new JPanel(); nowRow.setOpaque(false); nowRow.setAlignmentX(Component.LEFT_ALIGNMENT); nowRow.setLayout(new javax.swing.BoxLayout(nowRow, javax.swing.BoxLayout.X_AXIS));
    JLabel now = nowPlayingLabel; now.setText("NOW PLAYING"); now.setForeground(ACCENT2); now.setFont(new Font("SansSerif", Font.BOLD, 11)); nowRow.add(now); nowRow.add(javax.swing.Box.createHorizontalStrut(12)); nowRow.add(visualizer); panel.add(nowRow);
    panel.add(javax.swing.Box.createVerticalStrut(14));
    track.setForeground(TEXT); track.setFont(new Font("SansSerif", Font.BOLD, 34)); track.setAlignmentX(Component.LEFT_ALIGNMENT); track.setPreferredSize(new Dimension(460, 44)); track.setMaximumSize(new Dimension(460, 44)); track.setMinimumSize(new Dimension(460, 44)); panel.add(track);
    panel.add(javax.swing.Box.createVerticalStrut(10)); source.setAlignmentX(Component.LEFT_ALIGNMENT); source.setFont(new Font("SansSerif", Font.PLAIN, 12)); source.setPreferredSize(new Dimension(460, 16)); source.setMaximumSize(new Dimension(460, 16)); source.setMinimumSize(new Dimension(460, 16)); panel.add(source);
    panel.add(javax.swing.Box.createVerticalStrut(38));
    progress.setOpaque(false); progress.setUI(new AccentSliderUI(progress)); progress.setAlignmentX(Component.LEFT_ALIGNMENT); progress.setMaximumSize(new Dimension(Integer.MAX_VALUE, 20)); progress.setFocusable(false);
    progress.addChangeListener(e -> { if (player != null && progress.getValueIsAdjusting()) adjusting = true; else if (player != null && adjusting) { player.setMicrosecondPosition((long) (player.getMicrosecondLength() * progress.getValue() / 1000.0)); adjusting = false; } });
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
    // Both trailing buttons (load / clear queue) reserve the same width, so the transport cluster and the
    // shuffle/repeat cluster below — each centered in the space left of its own trailing button — land on the
    // exact same x position instead of merely looking "roughly centered" and drifting apart on resize.
    int trailingWidth = Math.max(load.getPreferredSize().width, clearQueueButton.getPreferredSize().width);
    JPanel controls = new JPanel(new BorderLayout()); controls.setOpaque(false); controls.setAlignmentX(Component.LEFT_ALIGNMENT);
    controls.setMaximumSize(new Dimension(Integer.MAX_VALUE, 68)); // BorderLayout reports an unbounded max size otherwise, letting this row swallow vertical space meant for the rows below
    controls.add(transportCluster, BorderLayout.CENTER);
    JPanel loadWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); loadWrap.setOpaque(false);
    loadWrap.setPreferredSize(new Dimension(trailingWidth, 1)); loadWrap.add(load);
    controls.add(loadWrap, BorderLayout.EAST);
    panel.add(controls);
    panel.add(javax.swing.Box.createVerticalStrut(26));
    JPanel modesCluster = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, 0, 0)); modesCluster.setOpaque(false);
    shuffleButton.addActionListener(e -> { shuffle = !shuffle; shuffleButton.setOn(shuffle); shuffleNextCacheIndex = Integer.MIN_VALUE; updateQueueUI(); }); modesCluster.add(shuffleButton); modesCluster.add(javax.swing.Box.createHorizontalStrut(20));
    repeatButton.addActionListener(e -> { repeat = !repeat; repeatButton.setOn(repeat); updateQueueUI(); }); modesCluster.add(repeatButton);
    clearQueueButton.addActionListener(e -> clearQueue());
    JPanel modes = new JPanel(new BorderLayout()); modes.setOpaque(false); modes.setAlignmentX(Component.LEFT_ALIGNMENT);
    modes.setMaximumSize(new Dimension(Integer.MAX_VALUE, 40)); // see controls' setMaximumSize above
    modes.add(modesCluster, BorderLayout.CENTER);
    JPanel clearWrap = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); clearWrap.setOpaque(false);
    clearWrap.setPreferredSize(new Dimension(trailingWidth, 1)); clearWrap.add(clearQueueButton);
    modes.add(clearWrap, BorderLayout.EAST);
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
    // trackFinished() loops the current track whenever repeat is on, regardless of queue position — so that (not
    // whatever nextIndex() would return) is what actually plays next, and must take priority in this label.
    int next = nextIndex();
    queueNext.setText(repeat ? "REPEATING THIS TRACK" : (next >= 0 && next != queueIndex ? "UP NEXT · " + queueDisplay(queue.get(next)) : "END OF QUEUE"));
    // rebuild the full queue list UI
    queueList.removeAll();
    for (int i = 0; i < queue.size(); i++) {
      File f = queue.get(i);
      int index = i;
      boolean active = i == queueIndex;
      JPanel row = new JPanel(new BorderLayout(8, 0)); row.setOpaque(false); row.setAlignmentX(Component.LEFT_ALIGNMENT); row.setMaximumSize(new Dimension(Integer.MAX_VALUE, 18));
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
      queueRows.add(new QueueRowUI(entry, eastCards, eastPanel, index));
      row.addMouseListener(new java.awt.event.MouseAdapter() {
        public void mouseClicked(java.awt.event.MouseEvent e) { queueIndex = index; load(f); }
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
      });
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
      opened.setMono(monoAudio);
      opened.onFinished = () -> trackFinished(opened);
      // getSongDetails() (not inspectSong() directly) so a replayed track — common with shuffle/repeat over a
      // long session — reuses the cached result instead of re-spawning ffprobe + an ffmpeg cover extraction on
      // every single play.
      SongDetails details = getSongDetails(file);
      String name = details.title;
      setTrackTitle(name); source.setText("LOCAL AUDIO FILE · " + file.getName().substring(file.getName().lastIndexOf('.') + 1).toUpperCase());
      fadeInNowPlaying();
      length.setText(format(opened.getMicrosecondLength())); elapsed.setText("0:00"); progress.setValue(0); status.setText("●  TRACK LOADED");
      boolean canLookUp = details.embeddedCover == null && details.title != null && !details.title.trim().isEmpty();
      disc.setCover(details.embeddedCover); disc.setLookingUp(canLookUp);
      if (details.embeddedCover != null) source.setText("EMBEDDED ALBUM ART · " + extension(file).toUpperCase());
      else if (canLookUp) findCover(details.lookupQuery(), file);
      else source.setText("NO EMBEDDED COVER · ADD SONG METADATA");
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
   * This matters because a packaged macOS .app launched from Finder/LaunchServices does NOT
   * inherit the PATH set up in the user's shell profile (.zshrc/.bash_profile) — it only gets a
   * minimal default PATH. Since Homebrew installs to /opt/homebrew/bin (Apple Silicon) or
   * /usr/local/bin (Intel), a plain "ffmpeg" ProcessBuilder call that works fine from a terminal
   * or from `java CDPlayer` can silently fail to find the binary once bundled into a .app.
   */
  private static String resolveBinary(String name) {
    String cached = BINARY_PATH_CACHE.get(name);
    if (cached != null) return cached;
    String[] candidates = {
      "/opt/homebrew/bin/" + name,   // Homebrew on Apple Silicon
      "/usr/local/bin/" + name,      // Homebrew on Intel Macs
      "/opt/local/bin/" + name,      // MacPorts
      "/usr/bin/" + name,
      "/bin/" + name,
    };
    for (String candidate : candidates) { if (new File(candidate).canExecute()) { BINARY_PATH_CACHE.put(name, candidate); return candidate; } }
    BINARY_PATH_CACHE.put(name, name); // fall back to relying on PATH (e.g. on Linux/Windows or a terminal launch)
    return name;
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
    return new SongDetails(title == null || title.isEmpty() ? fallbackTitle : title, artist, album, embeddedCover);
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
  private static final class SongDetails {
    final String title, artist, album; final BufferedImage embeddedCover;
    SongDetails(String title, String artist, String album, BufferedImage embeddedCover) { this.title = title; this.artist = artist; this.album = album; this.embeddedCover = embeddedCover; }
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
  private void trackFinished(StreamPlayer finishedPlayer) { if (player != finishedPlayer) return; if (repeat) { player.setMicrosecondPosition(0); player.start(); setPlaying(true); } else if (!nextTrack()) setPlaying(false); }
  private boolean nextTrack() { int next = nextIndex(); if (next < 0) return false; queueIndex = next; load(queue.get(queueIndex)); return true; }
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
    track.setFont(new Font("SansSerif", Font.BOLD, 34)); track.setText("Pick a track to get started."); source.setText("YOUR MUSIC LIBRARY");
    elapsed.setText("0:00"); length.setText("0:00"); progress.setValue(0);
    disc.setCover(null); disc.setLookingUp(false); loadedFile = null; setPlaying(false);
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
      }
    } catch (Exception ignored) { /* corrupt or unreadable state file; just start with an empty queue */ }
  }
  /** Persists volume, crossfade, mono audio, the animations toggle, and the current theme so they carry over to the next launch instead of resetting to defaults. Runs on the same shutdown hook as {@link #saveQueueState()}, same EDT-quiescence rationale. Theme is stored by name (not index) so it survives THEMES being reordered later. */
  private void saveSettingsState() {
    try {
      File parent = SETTINGS_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      String content = volumeSlider.getValue() + "\n" + crossfadeSlider.getValue() + "\n" + (monoAudio ? "1" : "0") + "\n" + (animationsEnabled ? "1" : "0") + "\n" + THEMES[currentThemeIndex].name + "\n";
      java.nio.file.Files.write(SETTINGS_FILE.toPath(), content.getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) { /* best-effort persistence; a failed save just means defaults next launch */ }
  }
  /** Restores settings saved by {@link #saveSettingsState()}. Must run after createContent() has wired up the sliders' change listeners, so setting each value here also updates its label/live state the same way a manual drag would. The animations and theme lines are optional (absent in files saved before those existed), defaulting to enabled / RED. */
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
      volumeSlider.setValue(Math.max(0, Math.min(100, savedVolume)));
      crossfadeSlider.setValue(Math.max(0, Math.min(15, savedCrossfade)));
      setMonoAudio(savedMono);
      setAnimationsEnabled(savedAnimations);
      if (savedThemeName != null) {
        for (int i = 0; i < THEMES.length; i++) {
          if (THEMES[i].name.equals(savedThemeName)) { applyThemeInstant(i); break; }
        }
      }
    } catch (Exception ignored) { /* corrupt or unreadable state file; just start with defaults */ }
  }
  private void seek(int seconds) { if (player == null) return; long target = Math.max(0, Math.min(player.getMicrosecondLength(), player.getMicrosecondPosition() + seconds * 1_000_000L)); player.setMicrosecondPosition(target); long duration = player.getMicrosecondLength(); progress.setValue(duration == 0 ? 0 : (int) (target * 1000 / duration)); elapsed.setText(format(target)); }
  private void tick(ActionEvent event) {
    if (player == null || adjusting) return;
    long duration = player.getMicrosecondLength(); long position = player.getMicrosecondPosition();
    progress.setValue(duration == 0 ? 0 : (int) (position * 1000 / duration)); elapsed.setText(format(position));
    double[] levels = computeLevels(5, 90); visualizer.setLevels(levels != null ? levels : fallbackLevels());
    int fadeSeconds = crossfadeSlider.getValue();
    // allowCrossfade=true only here: this is the one path where the queue is naturally advancing on its own,
    // not the user actively choosing a different track (see load()'s allowCrossfade doc for the full rationale).
    // repeat is checked first, unconditionally — matching trackFinished()'s priority — since with repeat on the
    // track always loops regardless of queue position; checking nextIndex() first here would crossfade into the
    // next queue track instead of looping whenever repeat was on but the current track wasn't the last one.
    if (!crossfadeStarted && fadeSeconds > 0 && duration > 0 && duration - position <= fadeSeconds * 1_000_000L) {
      if (repeat && loadedFile != null) { crossfadeStarted = true; load(loadedFile, true, true); } // seamless loop crossfade back into the same track
      else {
        int next = nextIndex();
        if (next >= 0) { crossfadeStarted = true; queueIndex = next; load(queue.get(queueIndex), true, true); }
      }
    }
  }
  private void setPlaying(boolean playing) { disc.setSpinning(playing); play.setGlyph(playing ? Glyph.PAUSE : Glyph.PLAY); play.pulse(); status.setText(playing ? "●  NOW SPINNING" : (loadedFile == null ? "●  READY TO PLAY" : "●  PAUSED")); visualizer.setActive(playing); if (playing) clock.start(); else clock.stop(); }
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
  /** Sets the now-playing title, shrinking the font (34pt down to 20pt) to fit long names in the fixed-width label before falling back to an ellipsis, so the box's size never has to change. */
  private void setTrackTitle(String name) {
    int maxWidth = 456;
    int size = 34;
    Font font = new Font("SansSerif", Font.BOLD, size);
    java.awt.FontMetrics metrics = track.getFontMetrics(font);
    while (metrics.stringWidth(name) > maxWidth && size > 20) {
      size--;
      font = new Font("SansSerif", Font.BOLD, size);
      metrics = track.getFontMetrics(font);
    }
    track.setFont(font);
    track.setText("<html>" + escape(ellipsize(track, name, maxWidth)) + "</html>");
  }
  /** Fades the track title and source labels in from transparent to their current (already-themed) color, so a new track's info eases into view instead of just snapping into place. Captures each label's own foreground as the fade target, so it stays correct under whatever theme is active. */
  private void fadeInNowPlaying() {
    if (nowPlayingFadeTimer != null && nowPlayingFadeTimer.isRunning()) nowPlayingFadeTimer.stop();
    final Color trackColor = track.getForeground(), sourceColor = source.getForeground();
    // Force full opacity rather than reusing trackColor/sourceColor as-is: if a previous fade was still mid-flight
    // when animations got disabled, the label's current color could itself be partially transparent, and simply
    // reapplying it would "snap" to that same partial state instead of actually becoming fully visible.
    if (!animationsEnabled) {
      track.setForeground(new Color(trackColor.getRed(), trackColor.getGreen(), trackColor.getBlue(), 255));
      source.setForeground(new Color(sourceColor.getRed(), sourceColor.getGreen(), sourceColor.getBlue(), 255));
      return;
    }
    final int steps = 10;
    final int[] step = { 0 };
    nowPlayingFadeTimer = new Timer(16, null);
    nowPlayingFadeTimer.addActionListener(e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      int alpha = (int) (255 * t);
      track.setForeground(new Color(trackColor.getRed(), trackColor.getGreen(), trackColor.getBlue(), alpha));
      source.setForeground(new Color(sourceColor.getRed(), sourceColor.getGreen(), sourceColor.getBlue(), alpha));
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
      final int steps = 6; // hover fades are subtle and frequent, so keep them quick and cheap
      final int[] step = { 0 };
      timer = new Timer(14, null);
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
      final int steps = 10;
      final int[] step = { 0 };
      transitionTimer = new Timer(12, null);
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
      final int steps = 8;
      final int[] step = { 0 };
      pulseTimer = new Timer(12, null);
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
      final int steps = 8;
      final int[] step = { 0 };
      pulseTimer = new Timer(12, null);
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
    private Timer transitionTimer, pulseTimer;
    ModeIconButton(Glyph glyph, String tooltip) {
      this.glyph = glyph;
      setToolTipText(tooltip);
      setFocusPainted(false); setFocusable(false); setBorderPainted(false); setContentAreaFilled(false); setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
      setAlignmentY(Component.CENTER_ALIGNMENT);
      Dimension fixed = new Dimension(40, 40);
      setMinimumSize(fixed); setPreferredSize(fixed); setMaximumSize(fixed);
    }
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
      final int steps = 10;
      final int[] step = { 0 };
      transitionTimer = new Timer(12, null);
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
      final int steps = 8;
      final int[] step = { 0 };
      pulseTimer = new Timer(12, null);
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

  private static final class AccentSliderUI extends BasicSliderUI {
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
   * Hosts the Settings card as a full-window overlay layer (added to contentStack, see createContent) instead of
   * a separate JDialog. A separate top-level window doesn't reliably layer above either the OS's native
   * fullscreen (opens on an entirely different Space) or this app's own exclusive GraphicsDevice fullscreen
   * (didn't appear at all). Being a plain component in the same window sidesteps both: it's always positioned
   * and painted correctly relative to the main window's current bounds, fullscreen or not.
   * Non-modal by design (matching the previous JDialog's own non-modal flag): contains() only reports true over
   * the card's own bounds, so clicks anywhere else on the overlay pass through to whatever's beneath it, exactly
   * like the original dialog let the main window stay interactive while open.
   */
  private static final class SettingsOverlay extends JPanel {
    final FadeableCard card = new FadeableCard();
    SettingsOverlay() { setOpaque(false); setLayout(new GridBagLayout()); add(card); }
    public boolean contains(int x, int y) {
      java.awt.Point p = SwingUtilities.convertPoint(this, x, y, card);
      return card.contains(p);
    }
  }

  /**
   * The theme picker (see showThemeMenu). Unlike SettingsOverlay, this one is NOT pass-through outside its menu:
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
      if (g == 1f && !applyMono) return;
      int channels = format.getChannels();
      for (int off = 0; off + frameSize <= length; off += frameSize) {
        if (applyMono) {
          int left = readS16(chunk, off), right = readS16(chunk, off + 2);
          int avg = (left + right) / 2;
          writeS16(chunk, off, avg); writeS16(chunk, off + 2, avg);
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
    private final Timer timer = new Timer(35, null);
    private Mode mode = Mode.NONE;
    private double clock;
    private Component discRef; // set once from the constructor; lets particles avoid painting over the disc without needing to restructure z-order (see createContent()'s doc comment for why that costs more than it's worth)
    private Component settingsCardRef; // set once Settings is first opened; being the glass pane again means themeOverlay is unconditionally topmost, so without this particles would drift over the Settings card too
    private Component themeMenuRef; // set once the theme menu is first opened; same reasoning as settingsCardRef
    ThemeOverlay() { setOpaque(false); timer.addActionListener(e -> { advance(); repaint(); }); }
    void setDiscReference(Component disc) { this.discRef = disc; }
    void setSettingsCardReference(Component card) { this.settingsCardRef = card; }
    void setThemeMenuReference(Component menu) { this.themeMenuRef = menu; }
    private void excludeIfShowing(java.awt.geom.Area clip, Component c) {
      if (c == null || !c.isShowing()) return;
      java.awt.Rectangle bounds = SwingUtilities.convertRectangle(c.getParent(), c.getBounds(), this);
      clip.subtract(new java.awt.geom.Area(bounds));
    }
    void setMode(Mode value) {
      if (mode == value) return;
      mode = value;
      boolean active = mode != Mode.NONE;
      setVisible(active);
      if (active) { seed(); timer.start(); } else timer.stop();
    }
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
      clock += 0.035;
      int w = Math.max(1, getWidth()), h = Math.max(1, getHeight());
      switch (mode) {
        case SNOW: fall(w, h, 1, true); break;
        case OCEAN: fall(w, h, -1, true); break;
        case AUTUMN: fall(w, h, 1, true); for (int i = 0; i < PARTICLE_COUNT; i++) spin[i] += 0.02 + speed[i] * 0.015; break;
        case GALAXY: advanceShootingStars(w, h); break;
        case MATRIX: advanceMatrix(h); break;
        default: break;
      }
    }
    private void fall(int w, int h, int direction, boolean drift) {
      ThreadLocalRandom r = ThreadLocalRandom.current();
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        y[i] += speed[i] * direction;
        if (drift) x[i] += Math.sin((y[i] * 0.02) + phase[i]) * 0.6;
        if (direction > 0 && y[i] > h) { y[i] = -4; x[i] = r.nextDouble() * w; }
        else if (direction < 0 && y[i] < -4) { y[i] = h + 4; x[i] = r.nextDouble() * w; }
        if (x[i] < -6) x[i] = w + 6; else if (x[i] > w + 6) x[i] = -6;
      }
    }
    private void advanceMatrix(int h) {
      ThreadLocalRandom r = ThreadLocalRandom.current();
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        y[i] += speed[i];
        if (y[i] > h + 160) y[i] = -r.nextDouble() * h * 0.6 - 20;
      }
    }
    private void advanceShootingStars(int w, int h) {
      if (shootingStars.size() < 2 && ThreadLocalRandom.current().nextDouble() < 0.012) {
        ThreadLocalRandom r = ThreadLocalRandom.current();
        double vx = 6 + r.nextDouble() * 5, vy = 3 + r.nextDouble() * 2.5;
        shootingStars.add(new double[] { r.nextDouble() * w * 0.5, r.nextDouble() * h * 0.4, vx, vy, 1.0 });
      }
      for (double[] s : shootingStars) { s[0] += s[2]; s[1] += s[3]; s[4] -= 0.02; }
      shootingStars.removeIf(s -> s[4] <= 0 || s[0] > w + 40 || s[1] > h + 40);
    }
    protected void paintComponent(Graphics raw) {
      if (mode == Mode.NONE) return;
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      // Subtracts the disc's (and, if open, the Settings card's) current on-screen rectangle from this layer's
      // paint clip, so particles/the OCEAN band never render over them — without needing either to actually sit
      // in a higher paint layer than this glass pane (which nothing can, short of another glass-pane-like
      // mechanism). Recomputed fresh each paint rather than cached: it's cheap arithmetic, and correctly tracks
      // both across window resizes for free.
      java.awt.geom.Area clip = new java.awt.geom.Area(new java.awt.Rectangle(0, 0, getWidth(), getHeight()));
      excludeIfShowing(clip, discRef);
      excludeIfShowing(clip, settingsCardRef);
      excludeIfShowing(clip, themeMenuRef);
      g.setClip(clip);
      switch (mode) {
        case SNOW: paintSnow(g); break;
        case OCEAN: paintOcean(g); break;
        case AUTUMN: paintAutumn(g); break;
        case GALAXY: paintGalaxy(g); break;
        case MATRIX: paintMatrix(g); break;
        default: break;
      }
      g.dispose();
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
    private double angle; private boolean spinning; private boolean lookingUp; private BufferedImage cover; private final Timer motion = new Timer(16, e -> { angle += .045; repaint(); });
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
    DiscView() {
      setOpaque(false); setMinimumSize(new Dimension(260, 260)); setPreferredSize(new Dimension(480, 480)); setMaximumSize(new Dimension(480, 480));
      addMouseListener(new java.awt.event.MouseAdapter() {
        public void mouseClicked(java.awt.event.MouseEvent e) { if (e.getClickCount() == 2) startEject(); }
      });
    }
    void setSpinning(boolean value) { spinning = value; if (value) motion.start(); else motion.stop(); repaint(); }
    // flush() releases the native/GPU-accelerated surface Java2D caches behind an image the moment it's drawn
    // (macOS's Metal-backed pipeline keeps this off-heap, so it's invisible to the Java heap and to GC directly —
    // it's only reclaimed once the BufferedImage itself is collected and Java2D's own Disposer gets around to it,
    // which measured as never keeping up with a track changing every few seconds: ~600MB of IOAccelerator-backed
    // surfaces accumulated, unbounded, over a stress run that swapped cover art on every track change). Flushing
    // the old cover explicitly here, right before dropping the reference, releases it immediately instead.
    void setCover(BufferedImage image) { if (cover != null && cover != image) cover.flush(); cover = image; repaint(); }
    void setLookingUp(boolean value) { lookingUp = value; repaint(); }

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
    private final Timer ejectTimer = new Timer(16, e -> {
      ejectElapsedMs += 16;
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
      int side = Math.min(300, Math.min(getWidth(), getHeight()) - 40);
      int x = (getWidth() - side) / 2, y = (getHeight() - side) / 2, centerX = x + side / 2, centerY = y + side / 2;

      // jewel case backdrop behind the disc
      int caseSide = side + 60, caseX = centerX - caseSide / 2, caseY = centerY - caseSide / 2;
      g.setColor(new Color(255, 255, 255, 14)); g.fillRoundRect(caseX, caseY, caseSide, caseSide, 12, 12);
      g.setColor(new Color(ACCENT.getRed(), ACCENT.getGreen(), ACCENT.getBlue(), 95)); g.setStroke(new BasicStroke(1.6f)); g.drawRoundRect(caseX, caseY, caseSide, caseSide, 12, 12);
      g.setColor(new Color(255, 255, 255, 26)); g.setStroke(new BasicStroke(1));
      g.drawLine(caseX + 10, caseY + 10, caseX + caseSide - 10, caseY + 10);
      g.drawLine(caseX + 10, caseY + caseSide - 10, caseX + caseSide - 10, caseY + caseSide - 10);
      if (cover != null) {
        int thumb = 58;
        g.setColor(new Color(0, 0, 0, 120)); g.fillRoundRect(caseX + 14, caseY + 14, thumb, thumb, 6, 6);
        g.drawImage(cover, caseX + 17, caseY + 17, thumb - 6, thumb - 6, null);
        g.setColor(ACCENT2); g.setStroke(new BasicStroke(1.2f)); g.drawRoundRect(caseX + 16, caseY + 16, thumb - 4, thumb - 4, 5, 5);
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

      // ambient glow ring, pulses while playing
      if (spinning) {
        double pulse = (Math.sin(angle * 3) + 1) / 2;
        int glow = (int) (8 + pulse * 10);
        g.setStroke(new BasicStroke(2f));
        g.setColor(new Color(ACCENT2.getRed(), ACCENT2.getGreen(), ACCENT2.getBlue(), (int) (30 + pulse * 55)));
        g.drawOval(x - glow, y - glow, side + glow * 2, side + glow * 2);
      }

      // soft drop shadow beneath the disc
      g.setColor(new Color(0, 0, 0, 110));
      g.fillOval(x, y + 12, side, side);

      AffineTransform old = g.getTransform();
      g.rotate(angle, centerX, centerY);
      g.setPaint(new GradientPaint(x, y, ACCENT, x + side, y + side, ACCENT2));
      g.fillOval(x, y, side, side);

      // subtle concentric grooves
      g.setColor(new Color(255, 255, 255, 22));
      g.setStroke(new BasicStroke(1f));
      for (int r = side / 2 - 16; r > side / 6; r -= 18) g.drawOval(centerX - r, centerY - r, r * 2, r * 2);

      // reflective highlight arc
      g.setColor(new Color(255, 255, 255, 55));
      g.setStroke(new BasicStroke(Math.max(2, side / 110)));
      g.drawArc(x + side / 12, y + side / 12, side * 5 / 6, side * 5 / 6, 200, 80);

      // center label
      int labelSize = side / 3, labelX = centerX - labelSize / 2, labelY = centerY - labelSize / 2;
      g.setColor(new Color(20, 21, 28));
      g.fillOval(labelX, labelY, labelSize, labelSize);
      if (cover != null) {
        java.awt.Shape oldClip = g.getClip();
        g.setClip(new Ellipse2D.Double(labelX, labelY, labelSize, labelSize));
        g.drawImage(cover, labelX, labelY, labelSize, labelSize, null);
        g.setClip(oldClip);
      } else if (lookingUp) {
        g.setColor(new Color(255, 255, 255, 130)); g.setFont(new Font("SansSerif", Font.BOLD, Math.max(8, side / 32)));
        String loading = "…"; java.awt.FontMetrics fm = g.getFontMetrics();
        g.drawString(loading, centerX - fm.stringWidth(loading) / 2, centerY + side / 42);
      } else {
        g.setColor(new Color(255, 255, 255, 55)); g.setFont(new Font("SansSerif", Font.PLAIN, labelSize / 3));
        String note = "\u266A"; java.awt.FontMetrics fm = g.getFontMetrics();
        g.drawString(note, centerX - fm.stringWidth(note) / 2, centerY + fm.getAscent() / 3);
      }
      g.setColor(new Color(255, 255, 255, 45)); g.setStroke(new BasicStroke(1f)); g.drawOval(labelX, labelY, labelSize, labelSize);

      // spindle hole
      int holeSize = side / 11;
      g.setColor(BG); g.fillOval(centerX - holeSize / 2, centerY - holeSize / 2, holeSize, holeSize);
      g.setColor(new Color(255, 255, 255, 60)); g.drawOval(centerX - holeSize / 2, centerY - holeSize / 2, holeSize, holeSize);

      g.setTransform(old);
      if (!spinning) { g.setColor(new Color(10, 11, 16, 90)); g.fillOval(x, y, side, side); }
      g.setTransform(preEject);
      g.dispose();
    }
  }
}