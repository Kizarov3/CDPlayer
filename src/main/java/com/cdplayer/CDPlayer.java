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
  private int currentThemeIndex = 0;
  private Timer themeAnim;
  private final DiscView disc = new DiscView();
  private final JLabel status = label("●  READY TO PLAY", 11, ACCENT);
  private final JLabel track = new JLabel("Pick a track to get started.");
  private final JLabel source = label("YOUR MUSIC LIBRARY", 11, MUTED);
  private final JLabel elapsed = label("0:00", 10, MUTED);
  private final JLabel length = label("0:00", 10, MUTED);
  private final JSlider progress = new JSlider(0, 1000, 0);
  private final TransportButton play = new TransportButton(Glyph.PLAY, 68, true);
  private final JButton shuffleButton = textButton("SHUFFLE OFF");
  private final JButton repeatButton = textButton("REPEAT OFF");
  private final JButton clearQueueButton = textButton("CLEAR QUEUE");
  private final JButton themeButton = textButton(THEMES[0].name);
  private final JLabel brandLabel = new JLabel("by kizarka");
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
  private final JButton settingsButton = textButton("SETTINGS");
  private final JButton monoButton = textButton("OFF");
  private javax.swing.JDialog settingsDialog;
  private java.awt.Rectangle preFullscreenBounds;
  private boolean fullscreen;

  public static void main(String[] args) {
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
    getRootPane().setGlassPane(themeOverlay);
    themeOverlay.setVisible(false);
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
    bindKey(inputMap, actionMap, "ESCAPE", "exitFullscreen", e -> { if (fullscreen) toggleFullscreen(); });
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

  /** Opens (or refocuses) the Settings dialog. Rebuilds its content each time rather than caching the panel, so labels/colors stay current across theme changes even though the JDialog window itself is reused. */
  private void showSettingsDialog() {
    if (settingsDialog == null) {
      settingsDialog = new javax.swing.JDialog(this, "Settings", false);
      settingsDialog.setUndecorated(true);
      javax.swing.JRootPane root = settingsDialog.getRootPane();
      root.getInputMap(javax.swing.JComponent.WHEN_IN_FOCUSED_WINDOW).put(javax.swing.KeyStroke.getKeyStroke("ESCAPE"), "closeSettings");
      root.getActionMap().put("closeSettings", new javax.swing.AbstractAction() { public void actionPerformed(ActionEvent e) { settingsDialog.setVisible(false); } });
    }
    settingsDialog.setContentPane(buildSettingsPanel(settingsDialog));
    settingsDialog.getRootPane().setBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 40), 1));
    settingsDialog.pack();
    settingsDialog.setLocationRelativeTo(this);
    settingsDialog.setVisible(true);
    settingsDialog.toFront();
  }
  private JPanel buildSettingsPanel(javax.swing.JDialog dialog) {
    JPanel card = new JPanel();
    card.setLayout(new javax.swing.BoxLayout(card, javax.swing.BoxLayout.Y_AXIS));
    card.setBackground(CARD);
    card.setOpaque(true);
    card.setBorder(BorderFactory.createEmptyBorder(26, 30, 22, 30));

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
    crossfadeSlider.addChangeListener(e -> { int v = crossfadeSlider.getValue(); crossfadeValueLabel.setText(v == 0 ? "OFF" : v + "S"); });
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

    JButton close = textButton("CLOSE");
    close.addActionListener(e -> dialog.setVisible(false));
    JPanel buttonRow = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0));
    buttonRow.setOpaque(false); buttonRow.setAlignmentX(Component.LEFT_ALIGNMENT); buttonRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 40));
    buttonRow.add(close);
    card.add(buttonRow);
    return card;
  }
  /** Applies the mono toggle to the live player (takes effect within ~20ms, on the pump thread's next chunk) and persists the choice for the next track load. */
  private void setMonoAudio(boolean value) {
    monoAudio = value;
    monoButton.setText(value ? "ON" : "OFF"); // the row's own "MONO AUDIO" label already gives context, so the button itself is just a plain on/off toggle
    if (player != null) player.setMono(value);
  }

  private void showThemeMenu() {
    javax.swing.JPopupMenu menu = new javax.swing.JPopupMenu();
    menu.setBackground(CARD); menu.setBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 30)));
    for (int i = 0; i < THEMES.length; i++) {
      Theme theme = THEMES[i]; int index = i;
      javax.swing.JMenuItem item = new javax.swing.JMenuItem(theme.name, new SwatchIcon(theme.accent, theme.accent2));
      item.setFont(new Font("SansSerif", Font.BOLD, 11));
      item.setForeground(index == currentThemeIndex ? ACCENT : TEXT);
      item.setBackground(CARD); item.setOpaque(true);
      item.setIconTextGap(10); item.setBorder(BorderFactory.createEmptyBorder(8, 12, 8, 16));
      item.addActionListener(e -> switchToTheme(index));
      menu.add(item);
    }
    menu.show(themeButton, 0, themeButton.getHeight() + 6);
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
    int steps = 18;
    int[] step = { 0 };
    themeAnim = new Timer(16, e -> {
      step[0]++;
      float t = Math.min(1f, step[0] / (float) steps);
      BG = lerp(fromColors[0], toColors[0], t); CARD = lerp(fromColors[1], toColors[1], t); ACCENT = lerp(fromColors[2], toColors[2], t);
      ACCENT2 = lerp(fromColors[3], toColors[3], t); TEXT = lerp(fromColors[4], toColors[4], t); MUTED = lerp(fromColors[5], toColors[5], t);
      applyThemeColors();
      getContentPane().repaint();
      refreshSettingsDialogIfOpen(); // so an already-open Settings dialog fades along with the main window, not just on next open
      if (t >= 1f) { ((Timer) e.getSource()).stop(); updateQueueUI(); }
    });
    themeAnim.start();
  }
  /** Rebuilds the Settings dialog's content in place if it's currently open, so it tracks the live BG/CARD/ACCENT/etc. colors during a theme transition instead of sitting frozen on whatever they were when it was opened. */
  private void refreshSettingsDialogIfOpen() {
    if (settingsDialog == null || !settingsDialog.isVisible()) return;
    settingsDialog.setContentPane(buildSettingsPanel(settingsDialog));
    settingsDialog.getRootPane().setBorder(BorderFactory.createLineBorder(new Color(255, 255, 255, 40), 1));
    settingsDialog.revalidate();
    settingsDialog.repaint();
  }

  private void applyThemeColors() {
    status.setForeground(ACCENT); track.setForeground(TEXT); source.setForeground(MUTED);
    elapsed.setForeground(MUTED); length.setForeground(MUTED); queueInfo.setForeground(MUTED); queueNext.setForeground(MUTED);
    brandLabel.setForeground(TEXT); nowPlayingLabel.setForeground(ACCENT2); crossfadeTitle.setForeground(MUTED); crossfadeValueLabel.setForeground(MUTED);
    volumeTitle.setForeground(MUTED); volumeValueLabel.setForeground(MUTED);
  }

  private static Color lerp(Color a, Color b, float t) {
    int r = Math.round(a.getRed() + (b.getRed() - a.getRed()) * t);
    int g = Math.round(a.getGreen() + (b.getGreen() - a.getGreen()) * t);
    int bl = Math.round(a.getBlue() + (b.getBlue() - a.getBlue()) * t);
    return new Color(r, g, bl);
  }

  private JPanel createContent() {
    JPanel root = new BrushedMetalPanel();
    root.setBorder(BorderFactory.createEmptyBorder(32, 64, 28, 64));
    JPanel headerBlock = new JPanel(new BorderLayout()); headerBlock.setOpaque(false);
    headerBlock.add(header(), BorderLayout.NORTH); headerBlock.add(new BarbedDivider(), BorderLayout.SOUTH);
    root.add(headerBlock, BorderLayout.NORTH);
    JPanel body = new JPanel(new GridBagLayout()); body.setOpaque(false);
    GridBagConstraints constraints = new GridBagConstraints();
    constraints.gridy = 0; constraints.weighty = 1; constraints.fill = GridBagConstraints.BOTH;
    constraints.gridx = 0; constraints.weightx = 1; constraints.insets = new Insets(10, 0, 10, 44); body.add(disc, constraints);
    constraints.gridx = 1; constraints.weightx = 1.05; constraints.insets = new Insets(36, 0, 20, 0); body.add(playerPanel(), constraints);
    root.add(body, BorderLayout.CENTER);
    JLabel hint = label("DROP WAV · AIFF · AU · FLAC · M4A · MP3 — SPACE/K PLAY · J/L PREV/NEXT · ←/→ SKIP 15S · F FULLSCREEN · ESC EXIT", 10, new Color(120, 122, 126));
    hint.setHorizontalAlignment(SwingConstants.CENTER); hint.setBorder(BorderFactory.createEmptyBorder(18, 0, 0, 0)); root.add(hint, BorderLayout.SOUTH);
    return root;
  }

  private JPanel header() {
    JPanel bar = new JPanel(new BorderLayout()); bar.setOpaque(false); bar.setPreferredSize(new Dimension(0, 56));
    brandLabel.setFont(new Font("SansSerif", Font.BOLD | Font.ITALIC, 20)); brandLabel.setForeground(TEXT);
    bar.add(brandLabel, BorderLayout.WEST);
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
    JPanel controls = new JPanel(); controls.setOpaque(false); controls.setLayout(new javax.swing.BoxLayout(controls, javax.swing.BoxLayout.X_AXIS)); controls.setAlignmentX(Component.LEFT_ALIGNMENT);
    JButton skipBack = roundButton(Glyph.SKIP_BACK_15, 36, false); skipBack.setToolTipText("Back 15 seconds"); skipBack.addActionListener(e -> seek(-15)); controls.add(skipBack); controls.add(javax.swing.Box.createHorizontalStrut(10));
    JButton back = roundButton(Glyph.PREVIOUS_TRACK, 44, false); back.setToolTipText("Previous track"); back.addActionListener(e -> previousTrack()); controls.add(back); controls.add(javax.swing.Box.createHorizontalStrut(16));
    play.addActionListener(e -> toggle()); controls.add(play); controls.add(javax.swing.Box.createHorizontalStrut(16));
    JButton forward = roundButton(Glyph.NEXT_TRACK, 44, false); forward.setToolTipText("Next track"); forward.addActionListener(e -> nextTrack()); controls.add(forward); controls.add(javax.swing.Box.createHorizontalStrut(10));
    JButton skipForward = roundButton(Glyph.SKIP_FORWARD_15, 36, false); skipForward.setToolTipText("Forward 15 seconds"); skipForward.addActionListener(e -> seek(15)); controls.add(skipForward); controls.add(javax.swing.Box.createHorizontalGlue());
    JButton load = textButton("LOAD A TRACK  +"); load.addActionListener(e -> choose()); controls.add(load); panel.add(controls);
    panel.add(javax.swing.Box.createVerticalStrut(26));
    JPanel modes = new JPanel(); modes.setOpaque(false); modes.setAlignmentX(Component.LEFT_ALIGNMENT); modes.setLayout(new javax.swing.BoxLayout(modes, javax.swing.BoxLayout.X_AXIS));
    shuffleButton.addActionListener(e -> { shuffle = !shuffle; shuffleButton.setText(shuffle ? "SHUFFLE ON" : "SHUFFLE OFF"); updateQueueUI(); }); modes.add(shuffleButton); modes.add(javax.swing.Box.createHorizontalStrut(10));
    repeatButton.addActionListener(e -> { repeat = !repeat; repeatButton.setText(repeat ? "REPEAT ON" : "REPEAT OFF"); updateQueueUI(); }); modes.add(repeatButton); modes.add(javax.swing.Box.createHorizontalStrut(10));
    clearQueueButton.addActionListener(e -> clearQueue()); modes.add(clearQueueButton); panel.add(modes);
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
    int next = nextIndex();
    queueNext.setText(next >= 0 && next != queueIndex ? "UP NEXT · " + queueDisplay(queue.get(next)) : (repeat ? "REPEATING THIS TRACK" : "END OF QUEUE"));
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
  private int nextIndex() { if (queue.isEmpty()) return -1; if (shuffle && queue.size() > 1) { int next; do { next = ThreadLocalRandom.current().nextInt(queue.size()); } while (next == queueIndex); return next; } return queueIndex + 1 < queue.size() ? queueIndex + 1 : -1; }
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
      SongDetails details = inspectSong(file);
      metadataCache.put(file, details);
      String name = details.title;
      track.setText("<html>" + escape(ellipsize(track, name, 456)) + "</html>"); source.setText("LOCAL AUDIO FILE · " + file.getName().substring(file.getName().lastIndexOf('.') + 1).toUpperCase());
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
    try {
      Process probe = new ProcessBuilder(resolveBinary("ffprobe"), "-v", "error", "-show_entries", "format_tags=title,artist,album", "-of", "default=noprint_wrappers=1", file.getAbsolutePath()).redirectErrorStream(true).start();
      String tags = new String(readAll(probe.getInputStream()), StandardCharsets.UTF_8); probe.waitFor();
      for (String line : tags.split("\\R")) { int equals = line.indexOf('='); if (equals < 1) continue; String key = line.substring(0, equals).toLowerCase(); String value = line.substring(equals + 1).trim(); if ("tag:title".equals(key)) title = value; else if ("tag:artist".equals(key)) artist = value; else if ("tag:album".equals(key)) album = value; }
    } catch (Exception ignored) { /* FFmpeg metadata is optional. */ }
    BufferedImage embeddedCover = extractEmbeddedCover(file);
    return new SongDetails(title == null || title.isEmpty() ? fallbackTitle : title, artist, album, embeddedCover);
  }
  private static BufferedImage extractEmbeddedCover(File file) {
    File image = null;
    try {
      image = File.createTempFile("cdplayer-art-", ".jpg");
      Process extract = new ProcessBuilder(resolveBinary("ffmpeg"), "-nostdin", "-y", "-v", "error", "-i", file.getAbsolutePath(), "-map", "0:v:0", "-frames:v", "1", "-pix_fmt", "yuvj420p", image.getAbsolutePath()).redirectErrorStream(true).start();
      readAll(extract.getInputStream()); if (extract.waitFor() == 0 && image.length() > 0) { BufferedImage decoded = ImageIO.read(image); if (decoded != null) return decoded; }
    } catch (Exception ignored) { /* No embedded artwork is normal. */ }
    finally { if (image != null) image.delete(); }
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
    track.setText("Pick a track to get started."); source.setText("YOUR MUSIC LIBRARY");
    elapsed.setText("0:00"); length.setText("0:00"); progress.setValue(0);
    disc.setCover(null); disc.setLookingUp(false); loadedFile = null; setPlaying(false);
    status.setText(statusMessage);
  }
  /** Persists the queue (as absolute file paths) and current track index so the session can resume next launch. Runs on a JVM shutdown hook, so it must not touch anything the EDT might still be mutating concurrently — by the time shutdown hooks run for EXIT_ON_CLOSE, the EDT thread is the one blocked inside System.exit(), so nothing else is mutating `queue`/`queueIndex` at this point. */
  private void saveQueueState() {
    try {
      File parent = QUEUE_STATE_FILE.getParentFile();
      if (parent != null) parent.mkdirs();
      StringBuilder content = new StringBuilder();
      content.append(queueIndex).append('\n');
      for (File file : queue) content.append(file.getAbsolutePath()).append('\n');
      java.nio.file.Files.write(QUEUE_STATE_FILE.toPath(), content.toString().getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) { /* best-effort persistence; a failed save just means an empty queue next launch */ }
  }
  /** Restores a queue saved by {@link #saveQueueState()}. Tracks that were moved or deleted since the last session are silently skipped rather than failing the whole restore. */
  private void restoreQueueState() {
    try {
      if (!QUEUE_STATE_FILE.isFile()) return;
      List<String> lines = java.nio.file.Files.readAllLines(QUEUE_STATE_FILE.toPath(), StandardCharsets.UTF_8);
      if (lines.isEmpty()) return;
      int savedIndex = Integer.parseInt(lines.get(0).trim());
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
    } catch (Exception ignored) { /* corrupt or unreadable state file; just start with an empty queue */ }
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
    if (!crossfadeStarted && fadeSeconds > 0 && duration > 0 && duration - position <= fadeSeconds * 1_000_000L) {
      int next = nextIndex();
      if (next >= 0) { crossfadeStarted = true; queueIndex = next; load(queue.get(queueIndex), true, true); }
      else if (repeat && loadedFile != null) { crossfadeStarted = true; load(loadedFile, true, true); } // seamless loop crossfade back into the same track
    }
  }
  private void setPlaying(boolean playing) { disc.setSpinning(playing); play.setGlyph(playing ? Glyph.PAUSE : Glyph.PLAY); status.setText(playing ? "●  NOW SPINNING" : (loadedFile == null ? "●  READY TO PLAY" : "●  PAUSED")); visualizer.setActive(playing); if (playing) clock.start(); else clock.stop(); }
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
    try {
      Process probe = new ProcessBuilder(resolveBinary("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file.getAbsolutePath()).redirectErrorStream(true).start();
      String output = new String(readAll(probe.getInputStream()), StandardCharsets.UTF_8).trim();
      probe.waitFor();
      return (long) (Double.parseDouble(output) * 1_000_000L);
    } catch (Exception ignored) { return 0L; }
  }
  private static String escape(String value) { return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); }
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
  private enum Glyph { PLAY, PAUSE, PREVIOUS_TRACK, NEXT_TRACK, SKIP_BACK_15, SKIP_FORWARD_15 }
  private static JButton textButton(String caption) { return new PillButton(caption); }

  private static final class PillButton extends JButton {
    PillButton(String caption) { super(caption); setFont(new Font("SansSerif", Font.BOLD, 11)); setForeground(TEXT); setFocusPainted(false); setFocusable(false); setBorderPainted(false); setContentAreaFilled(false); setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); setBorder(BorderFactory.createEmptyBorder(8, 16, 8, 16)); setAlignmentY(Component.CENTER_ALIGNMENT); }
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      boolean on = getText().endsWith("ON"); int arc = getHeight();
      if (on) { g.setPaint(new GradientPaint(0, 0, ACCENT, getWidth(), getHeight(), ACCENT2)); g.fillRoundRect(0, 0, getWidth(), getHeight(), arc, arc); }
      else { g.setColor(new Color(255,255,255, getModel().isRollover() ? 20 : 12)); g.fillRoundRect(0, 0, getWidth(), getHeight(), arc, arc); g.setColor(new Color(255,255,255,26)); g.setStroke(new BasicStroke(1)); g.drawRoundRect(0, 0, getWidth() - 1, getHeight() - 1, arc, arc); }
      g.dispose();
      Color base = on ? BG : MUTED;
      setForeground(isEnabled() ? base : new Color(base.getRed(), base.getGreen(), base.getBlue(), 100));
      super.paintComponent(raw);
    }
  }

  private static final class TransportButton extends JButton {
    private final boolean primary;
    private Glyph glyph;
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
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      int width = getWidth(), height = getHeight();
      if (primary) {
        if (getModel().isPressed()) g.setPaint(new GradientPaint(0, 0, ACCENT.darker(), width, height, ACCENT2.darker()));
        else g.setPaint(new GradientPaint(0, 0, ACCENT, width, height, ACCENT2));
        g.fillOval(0, 0, width, height);
      } else {
        g.setColor(new Color(255,255,255, getModel().isRollover() ? 22 : 12)); g.fillOval(0, 0, width, height);
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
      for (int lineY = 0; lineY < h; lineY += 3) g.drawLine(0, lineY, w, lineY);
      g.setPaint(new GradientPaint(0, 0, new Color(0, 0, 0, 130), 0, h * 0.18f, new Color(0, 0, 0, 0)));
      g.fillRect(0, 0, w, (int) (h * 0.18f));
      g.dispose();
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
    ThemeOverlay() { setOpaque(false); timer.addActionListener(e -> { advance(); repaint(); }); }
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
    private static final Color OCEAN_BUBBLE_FILL = new Color(210, 245, 250, 60);
    private static final Color OCEAN_BUBBLE_STROKE = new Color(255, 255, 255, 140);
    private static final BasicStroke OCEAN_STROKE = new BasicStroke(1f);
    private void paintOcean(Graphics2D g) {
      int w = Math.max(1, getWidth()), h = Math.max(1, getHeight());
      // a soft light band sweeps across the water periodically, built from two abutting gradients (fade-in then fade-out)
      double period = 6.0;
      double t = (clock % period) / period;
      float bandCenter = (float) (t * (w + 300) - 150);
      Graphics2D sg = (Graphics2D) g.create();
      sg.setPaint(new GradientPaint(bandCenter - 90, 0, new Color(255, 255, 255, 0), bandCenter, 0, new Color(255, 255, 255, 35)));
      sg.fillRect((int) (bandCenter - 90), 0, 90, h);
      sg.setPaint(new GradientPaint(bandCenter, 0, new Color(255, 255, 255, 35), bandCenter + 90, 0, new Color(255, 255, 255, 0)));
      sg.fillRect((int) bandCenter, 0, 90, h);
      sg.dispose();
      // fill and stroke colors are constant across every bubble, so set them once instead of per-particle
      g.setStroke(OCEAN_STROKE);
      for (int i = 0; i < PARTICLE_COUNT; i++) {
        double r = size[i];
        int ix = (int) (x[i] - r), iy = (int) (y[i] - r), d = (int) (r * 2);
        g.setColor(OCEAN_BUBBLE_FILL);
        g.fillOval(ix, iy, d, d);
        g.setColor(OCEAN_BUBBLE_STROKE);
        g.drawOval(ix, iy, d, d);
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
    DiscView() { setOpaque(false); setPreferredSize(new Dimension(480, 480)); }
    void setSpinning(boolean value) { spinning = value; if (value) motion.start(); else motion.stop(); repaint(); }
    void setCover(BufferedImage image) { cover = image; repaint(); }
    void setLookingUp(boolean value) { lookingUp = value; repaint(); }
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
      g.dispose();
    }
  }
}