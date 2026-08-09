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
import javax.sound.sampled.Clip;
import javax.sound.sampled.LineEvent;
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
    new Theme("VAPOR", new Color(13, 11, 22), new Color(24, 20, 38), new Color(56, 220, 232), new Color(190, 90, 232), new Color(238, 236, 250), new Color(150, 142, 172)),
    new Theme("SNOW", new Color(8, 12, 24), new Color(16, 22, 38), new Color(214, 44, 54), new Color(38, 150, 84), new Color(245, 247, 250), new Color(140, 150, 172)),
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
  private final JButton play = roundButton("▶", 68, true);
  private final JButton shuffleButton = textButton("SHUFFLE OFF");
  private final JButton repeatButton = textButton("REPEAT OFF");
  private final JButton themeButton = textButton("THEME: " + THEMES[0].name);
  private final JLabel brandLabel = new JLabel("by kizarka");
  private final JLabel nowPlayingLabel = new JLabel("NOW PLAYING");
  private final JLabel queueInfo = label("QUEUE EMPTY", 10, MUTED);
  private final JLabel queueNext = label("DROP SONGS OR A FOLDER TO BUILD A QUEUE", 9, MUTED);
  private final JLabel crossfadeTitle = new JLabel("CROSSFADE");
  private final JSlider crossfadeSlider = new JSlider(0, 15, 0);
  private final JLabel crossfadeValueLabel = new JLabel("OFF");
  private final VisualizerBars visualizer = new VisualizerBars();
  private final SnowOverlay snowOverlay = new SnowOverlay();
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
  private Clip clip;
  private File loadedFile;
  private File temporaryAudio;
  private boolean adjusting;
  private boolean crossfadeStarted;
  private byte[] rawAudio;
  private AudioFormat audioFormat;
  private final Timer clock = new Timer(70, this::tick);
  private static final Pattern ITUNES_COVER = Pattern.compile("\\\"artworkUrl100\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern DEEZER_COVER = Pattern.compile("\\\"cover_xl\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");

  public static void main(String[] args) {
    SwingUtilities.invokeLater(() -> {
      try { UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName()); }
      catch (Exception ignored) { }
      new CDPlayer().setVisible(true);
    });
  }

  public CDPlayer() {
    super("CDPlayer");
    setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
    setMinimumSize(new Dimension(760, 560));
    setSize(1120, 700);
    setLocationByPlatform(true);
    setContentPane(createContent());
    getRootPane().setGlassPane(snowOverlay);
    snowOverlay.setVisible(false);
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
  }

  private static void bindKey(javax.swing.InputMap inputMap, javax.swing.ActionMap actionMap, String key, String name, java.util.function.Consumer<ActionEvent> action) {
    inputMap.put(javax.swing.KeyStroke.getKeyStroke(key), name);
    actionMap.put(name, new javax.swing.AbstractAction() { public void actionPerformed(ActionEvent e) { action.accept(e); } });
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
    themeButton.setText("THEME: " + to.name);
    boolean holiday = "SNOW".equals(to.name);
    snowOverlay.setActive(holiday);
    visualizer.setTreeMode(holiday);
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
      if (t >= 1f) { ((Timer) e.getSource()).stop(); updateQueueUI(); }
    });
    themeAnim.start();
  }

  private void applyThemeColors() {
    status.setForeground(ACCENT); track.setForeground(TEXT); source.setForeground(MUTED);
    elapsed.setForeground(MUTED); length.setForeground(MUTED); queueInfo.setForeground(MUTED); queueNext.setForeground(MUTED);
    brandLabel.setForeground(TEXT); nowPlayingLabel.setForeground(ACCENT2); crossfadeTitle.setForeground(MUTED); crossfadeValueLabel.setForeground(MUTED);
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
    JLabel hint = label("DROP WAV · AIFF · AU · FLAC · M4A · MP3 — SPACE/K PLAY · J/L PREV/NEXT · ←/→ SKIP 15S", 10, new Color(120, 122, 126));
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
    themeButton.addActionListener(e -> showThemeMenu());
    JPanel east = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 0, 0)); east.setOpaque(false); east.add(themeButton);
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
    progress.addChangeListener(e -> { if (clip != null && progress.getValueIsAdjusting()) adjusting = true; else if (clip != null && adjusting) { clip.setMicrosecondPosition((long) (clip.getMicrosecondLength() * progress.getValue() / 1000.0)); adjusting = false; } });
    panel.add(progress);
    JPanel times = new JPanel(new BorderLayout()); times.setOpaque(false); times.setMaximumSize(new Dimension(Integer.MAX_VALUE, 16)); elapsed.setFont(new Font("SansSerif", Font.PLAIN, 11)); length.setFont(new Font("SansSerif", Font.PLAIN, 11)); times.add(elapsed, BorderLayout.WEST); times.add(length, BorderLayout.EAST); panel.add(times);
    panel.add(javax.swing.Box.createVerticalStrut(28));
    JPanel controls = new JPanel(); controls.setOpaque(false); controls.setLayout(new javax.swing.BoxLayout(controls, javax.swing.BoxLayout.X_AXIS)); controls.setAlignmentX(Component.LEFT_ALIGNMENT);
    JButton skipBack = roundButton("-15", 36, false); skipBack.setFont(new Font("SansSerif", Font.BOLD, 10)); skipBack.setToolTipText("Back 15 seconds"); skipBack.addActionListener(e -> seek(-15)); controls.add(skipBack); controls.add(javax.swing.Box.createHorizontalStrut(10));
    JButton back = roundButton("↶", 44, false); back.setToolTipText("Previous track"); back.addActionListener(e -> previousTrack()); controls.add(back); controls.add(javax.swing.Box.createHorizontalStrut(16));
    play.addActionListener(e -> toggle()); controls.add(play); controls.add(javax.swing.Box.createHorizontalStrut(16));
    JButton forward = roundButton("↷", 44, false); forward.setToolTipText("Next track"); forward.addActionListener(e -> nextTrack()); controls.add(forward); controls.add(javax.swing.Box.createHorizontalStrut(10));
    JButton skipForward = roundButton("+15", 36, false); skipForward.setFont(new Font("SansSerif", Font.BOLD, 10)); skipForward.setToolTipText("Forward 15 seconds"); skipForward.addActionListener(e -> seek(15)); controls.add(skipForward); controls.add(javax.swing.Box.createHorizontalGlue());
    JButton load = textButton("LOAD A TRACK  +"); load.addActionListener(e -> choose()); controls.add(load); panel.add(controls);
    panel.add(javax.swing.Box.createVerticalStrut(26));
    JPanel modes = new JPanel(); modes.setOpaque(false); modes.setAlignmentX(Component.LEFT_ALIGNMENT); modes.setLayout(new javax.swing.BoxLayout(modes, javax.swing.BoxLayout.X_AXIS));
    shuffleButton.addActionListener(e -> { shuffle = !shuffle; shuffleButton.setText(shuffle ? "SHUFFLE ON" : "SHUFFLE OFF"); updateQueueUI(); }); modes.add(shuffleButton); modes.add(javax.swing.Box.createHorizontalStrut(10));
    repeatButton.addActionListener(e -> { repeat = !repeat; repeatButton.setText(repeat ? "REPEAT ON" : "REPEAT OFF"); updateQueueUI(); }); modes.add(repeatButton); panel.add(modes);
    panel.add(javax.swing.Box.createVerticalStrut(18));
    JPanel crossfadeRow = new JPanel(); crossfadeRow.setOpaque(false); crossfadeRow.setAlignmentX(Component.LEFT_ALIGNMENT); crossfadeRow.setLayout(new javax.swing.BoxLayout(crossfadeRow, javax.swing.BoxLayout.X_AXIS));
    crossfadeTitle.setFont(new Font("SansSerif", Font.BOLD, 10)); crossfadeTitle.setForeground(MUTED);
    crossfadeSlider.setOpaque(false); crossfadeSlider.setUI(new AccentSliderUI(crossfadeSlider)); crossfadeSlider.setFocusable(false);
    crossfadeSlider.setPreferredSize(new Dimension(120, 20)); crossfadeSlider.setMaximumSize(new Dimension(120, 20));
    crossfadeValueLabel.setFont(new Font("SansSerif", Font.BOLD, 10)); crossfadeValueLabel.setForeground(MUTED); crossfadeValueLabel.setPreferredSize(new Dimension(28, 16));
    crossfadeSlider.addChangeListener(e -> { int v = crossfadeSlider.getValue(); crossfadeValueLabel.setText(v == 0 ? "OFF" : v + "S"); });
    crossfadeSlider.setToolTipText("Crossfade between tracks (0 = off, up to 15s)");
    crossfadeRow.add(crossfadeTitle); crossfadeRow.add(javax.swing.Box.createHorizontalStrut(10)); crossfadeRow.add(crossfadeSlider); crossfadeRow.add(javax.swing.Box.createHorizontalStrut(8)); crossfadeRow.add(crossfadeValueLabel); crossfadeRow.add(javax.swing.Box.createHorizontalGlue());
    panel.add(crossfadeRow);
    panel.add(javax.swing.Box.createVerticalStrut(22));
    JPanel queueCard = new JPanel(); queueCard.setOpaque(false); queueCard.setAlignmentX(Component.LEFT_ALIGNMENT); queueCard.setLayout(new javax.swing.BoxLayout(queueCard, javax.swing.BoxLayout.Y_AXIS)); queueCard.setBorder(BorderFactory.createMatteBorder(1, 0, 0, 0, new Color(255, 255, 255, 22)));
    queueInfo.setAlignmentX(Component.LEFT_ALIGNMENT); queueNext.setAlignmentX(Component.LEFT_ALIGNMENT); queueCard.add(javax.swing.Box.createVerticalStrut(9)); queueCard.add(queueInfo); queueCard.add(javax.swing.Box.createVerticalStrut(5)); queueCard.add(queueNext);
    // prepare the queue list container (scrollable)
    queueList.setOpaque(false); queueList.setLayout(new javax.swing.BoxLayout(queueList, javax.swing.BoxLayout.Y_AXIS));
    JScrollPane queueScroll = new JScrollPane(queueList); queueScroll.setOpaque(false); queueScroll.getViewport().setOpaque(false); queueScroll.setBorder(null); queueScroll.setAlignmentX(Component.LEFT_ALIGNMENT); queueScroll.setMaximumSize(new Dimension(Integer.MAX_VALUE, 150));
    // queueList isn't a Scrollable, so the default per-notch unit increment is a sluggish 1px; scale it to roughly one row (18px row + 3px gap) per notch.
    queueScroll.getVerticalScrollBar().setUnitIncrement(21);
    queueScroll.getVerticalScrollBar().setBlockIncrement(126);
    queueCard.add(javax.swing.Box.createVerticalStrut(8)); queueCard.add(queueScroll);
    panel.add(queueCard);
    return panel;
  }

  private void choose() { JFileChooser chooser = new JFileChooser(); chooser.setMultiSelectionEnabled(true); chooser.setFileSelectionMode(JFileChooser.FILES_AND_DIRECTORIES); chooser.setFileFilter(new FileNameExtensionFilter("Audio files (WAV, AIFF, AU, FLAC, M4A, MP3)", "wav", "wave", "aif", "aiff", "au", "flac", "m4a", "mp3")); if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) { File[] selected = chooser.getSelectedFiles(); if (selected.length == 0) selected = new File[] { chooser.getSelectedFile() }; addToQueue(java.util.Arrays.asList(selected)); } }
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
  private void load(File file) {
    try {
      Clip outgoing = clip;
      int fadeSeconds = crossfadeSlider.getValue();
      boolean doCrossfade = outgoing != null && outgoing.isRunning() && fadeSeconds > 0;
      if (!doCrossfade && outgoing != null) { clip = null; outgoing.stop(); outgoing.close(); }
      deleteTemporaryAudio();
      File playable = prepareAudio(file);
      AudioInputStream decodedStream = AudioSystem.getAudioInputStream(playable);
      byte[] audioBytes = readAll(decodedStream);
      AudioFormat format = decodedStream.getFormat();
      decodedStream.close();
      AudioInputStream clipStream = new AudioInputStream(new java.io.ByteArrayInputStream(audioBytes), format, audioBytes.length / Math.max(1, format.getFrameSize()));
      Clip openedClip = AudioSystem.getClip(); openedClip.open(clipStream); clip = openedClip; loadedFile = file; rawAudio = audioBytes; audioFormat = format; crossfadeStarted = false;
      openedClip.addLineListener(event -> { if (event.getType() == LineEvent.Type.STOP && openedClip.getMicrosecondPosition() >= openedClip.getMicrosecondLength()) SwingUtilities.invokeLater(() -> trackFinished(openedClip)); });
      SongDetails details = inspectSong(file);
      metadataCache.put(file, details);
      String name = details.title;
      track.setText("<html>" + escape(ellipsize(track, name, 456)) + "</html>"); source.setText("LOCAL AUDIO FILE · " + file.getName().substring(file.getName().lastIndexOf('.') + 1).toUpperCase());
      length.setText(format(clip.getMicrosecondLength())); elapsed.setText("0:00"); progress.setValue(0); status.setText("●  TRACK LOADED");
      boolean canLookUp = details.embeddedCover == null && details.title != null && !details.title.trim().isEmpty();
      disc.setCover(details.embeddedCover); disc.setLookingUp(canLookUp);
      if (details.embeddedCover != null) source.setText("EMBEDDED ALBUM ART · " + extension(file).toUpperCase());
      else if (canLookUp) findCover(details.lookupQuery(), file);
      else source.setText("NO EMBEDDED COVER · ADD SONG METADATA");
      updateQueueUI();
      setLinearGain(openedClip, doCrossfade ? 0f : 1f);
      openedClip.start(); setPlaying(true);
      if (doCrossfade) { status.setText("●  CROSSFADING"); startCrossfade(outgoing, openedClip, fadeSeconds); }
    } catch (Exception error) { status.setText("●  INSTALL FFMPEG FOR FLAC / M4A"); }
  }
  /** Sets a Clip's volume (0..1, linear) via its MASTER_GAIN control, converting to decibels. Silently no-ops if the control isn't available on this line. */
  private static void setLinearGain(Clip target, float volume) {
    try {
      if (!target.isControlSupported(javax.sound.sampled.FloatControl.Type.MASTER_GAIN)) return;
      javax.sound.sampled.FloatControl gainControl = (javax.sound.sampled.FloatControl) target.getControl(javax.sound.sampled.FloatControl.Type.MASTER_GAIN);
      float clamped = Math.max(0.0001f, Math.min(1f, volume));
      float decibels = (float) (20 * Math.log10(clamped));
      decibels = Math.max(gainControl.getMinimum(), Math.min(gainControl.getMaximum(), decibels));
      gainControl.setValue(decibels);
    } catch (Exception ignored) { /* gain control unsupported on this line/platform */ }
  }
  /** Fades `outgoing` out and `incoming` in over `seconds` using an equal-power curve, then stops/closes the outgoing clip. Equal-power (cos/sin, not linear 1-t/t) keeps the combined perceived loudness roughly constant through the transition, instead of dipping in the middle — this is the same principle Spotify's crossfade (and most professional DJ mixers) use. */
  private void startCrossfade(final Clip outgoing, final Clip incoming, int seconds) {
    final long durationMillis = seconds * 1000L;
    final long startTime = System.currentTimeMillis();
    setLinearGain(outgoing, 1f); setLinearGain(incoming, 0f);
    Timer fade = new Timer(30, null);
    fade.addActionListener(e -> {
      long elapsedMillis = System.currentTimeMillis() - startTime;
      float t = Math.min(1f, elapsedMillis / (float) durationMillis);
      double angle = t * (Math.PI / 2.0);
      float outGain = (float) Math.cos(angle);   // 1 -> 0, equal-power taper
      float inGain = (float) Math.sin(angle);    // 0 -> 1, equal-power taper
      setLinearGain(outgoing, outGain); setLinearGain(incoming, inGain);
      if (t >= 1f) {
        ((Timer) e.getSource()).stop();
        try { outgoing.stop(); outgoing.close(); } catch (Exception ignored) { }
        if (clip == incoming) { setLinearGain(incoming, 1f); status.setText("●  NOW SPINNING"); }
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
  private void toggle() { if (clip == null) { choose(); return; } if (clip.isRunning()) { clip.stop(); setPlaying(false); } else { clip.start(); setPlaying(true); } }
  private void trackFinished(Clip finishedClip) { if (clip != finishedClip) return; if (repeat) { clip.setMicrosecondPosition(0); clip.start(); setPlaying(true); } else if (!nextTrack()) setPlaying(false); }
  private boolean nextTrack() { int next = nextIndex(); if (next < 0) return false; queueIndex = next; load(queue.get(queueIndex)); return true; }
  private void previousTrack() { if (clip != null && clip.getMicrosecondPosition() > 5_000_000L) { clip.setMicrosecondPosition(0); return; } if (queueIndex > 0) { queueIndex--; load(queue.get(queueIndex)); } else if (clip != null) clip.setMicrosecondPosition(0); }
  private void removeFromQueue(int index) {
    if (index < 0 || index >= queue.size()) return;
    queue.remove(index);
    if (queue.isEmpty()) {
      queueIndex = -1;
      if (clip != null) { Clip closingClip = clip; clip = null; closingClip.stop(); closingClip.close(); }
      track.setText("Pick a track to get started."); source.setText("YOUR MUSIC LIBRARY");
      elapsed.setText("0:00"); length.setText("0:00"); progress.setValue(0);
      disc.setCover(null); disc.setLookingUp(false); loadedFile = null; setPlaying(false);
      status.setText("●  QUEUE EMPTY");
      updateQueueUI();
    } else if (index == queueIndex) {
      queueIndex = Math.min(index, queue.size() - 1);
      load(queue.get(queueIndex)); // load() also refreshes the queue UI
    } else {
      if (index < queueIndex) queueIndex--;
      updateQueueUI();
    }
  }
  private void seek(int seconds) { if (clip == null) return; long target = Math.max(0, Math.min(clip.getMicrosecondLength(), clip.getMicrosecondPosition() + seconds * 1_000_000L)); clip.setMicrosecondPosition(target); long duration = clip.getMicrosecondLength(); progress.setValue(duration == 0 ? 0 : (int) (target * 1000 / duration)); elapsed.setText(format(target)); }
  private void tick(ActionEvent event) {
    if (clip == null || adjusting) return;
    long duration = clip.getMicrosecondLength(); long position = clip.getMicrosecondPosition();
    progress.setValue(duration == 0 ? 0 : (int) (position * 1000 / duration)); elapsed.setText(format(position));
    double[] levels = computeLevels(5, 90); visualizer.setLevels(levels != null ? levels : fallbackLevels());
    int fadeSeconds = crossfadeSlider.getValue();
    if (!crossfadeStarted && fadeSeconds > 0 && duration > 0 && duration - position <= fadeSeconds * 1_000_000L) {
      int next = nextIndex();
      if (next >= 0) { crossfadeStarted = true; queueIndex = next; load(queue.get(queueIndex)); }
      else if (repeat && loadedFile != null) { crossfadeStarted = true; load(loadedFile); } // seamless loop crossfade back into the same track
    }
  }
  private void setPlaying(boolean playing) { disc.setSpinning(playing); play.setText(playing ? "Ⅱ" : "▶"); status.setText(playing ? "●  NOW SPINNING" : (loadedFile == null ? "●  READY TO PLAY" : "●  PAUSED")); visualizer.setActive(playing); if (playing) clock.start(); else clock.stop(); }
  private double[] computeLevels(int bars, int windowMillis) {
    try {
      if (rawAudio == null || audioFormat == null || clip == null) return null;
      AudioFormat.Encoding encoding = audioFormat.getEncoding();
      if (encoding != AudioFormat.Encoding.PCM_SIGNED && encoding != AudioFormat.Encoding.PCM_UNSIGNED) return null;
      int frameSize = audioFormat.getFrameSize();
      int bytesPerSample = audioFormat.getSampleSizeInBits() / 8;
      if (frameSize <= 0 || bytesPerSample <= 0) return null;
      boolean bigEndian = audioFormat.isBigEndian();
      boolean unsigned = encoding == AudioFormat.Encoding.PCM_UNSIGNED;
      int totalFrames = rawAudio.length / frameSize;
      int windowFrames = Math.max(bars, (int) (audioFormat.getFrameRate() * windowMillis / 1000.0));
      long framePos = clip.getFramePosition();
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
  private static JButton roundButton(String caption, int size, boolean primary) { return new TransportButton(caption, size, primary); }
  private static JButton textButton(String caption) { return new PillButton(caption); }

  private static final class PillButton extends JButton {
    PillButton(String caption) { super(caption); setFont(new Font("SansSerif", Font.BOLD, 11)); setForeground(TEXT); setFocusPainted(false); setFocusable(false); setBorderPainted(false); setContentAreaFilled(false); setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); setBorder(BorderFactory.createEmptyBorder(8, 16, 8, 16)); setAlignmentY(Component.CENTER_ALIGNMENT); }
    protected void paintComponent(Graphics raw) { Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON); boolean on = getText().endsWith("ON"); int arc = getHeight(); if (on) { g.setPaint(new GradientPaint(0, 0, ACCENT, getWidth(), getHeight(), ACCENT2)); g.fillRoundRect(0, 0, getWidth(), getHeight(), arc, arc); } else { g.setColor(new Color(255,255,255, getModel().isRollover() ? 20 : 12)); g.fillRoundRect(0, 0, getWidth(), getHeight(), arc, arc); g.setColor(new Color(255,255,255,26)); g.setStroke(new BasicStroke(1)); g.drawRoundRect(0, 0, getWidth() - 1, getHeight() - 1, arc, arc); } g.dispose(); setForeground(on ? BG : MUTED); super.paintComponent(raw); }
  }

  private static final class TransportButton extends JButton {
    private final boolean primary;
    TransportButton(String caption, int size, boolean primary) { super(caption); this.primary = primary; setFont(new Font("SansSerif", Font.PLAIN, primary ? 24 : 18)); setForeground(primary ? BG : TEXT); setFocusPainted(false); setFocusable(false); setBorderPainted(false); setContentAreaFilled(false); setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); setPreferredSize(new Dimension(size, size)); setMaximumSize(new Dimension(size, size)); }
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
      String text = getText(); g.setFont(getFont()); java.awt.FontMetrics metrics = g.getFontMetrics(); g.setColor(getForeground()); g.drawString(text, (getWidth() - metrics.stringWidth(text)) / 2, (getHeight() - metrics.getHeight()) / 2 + metrics.getAscent()); g.dispose();
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
    private static final int BARS = 5;
    private static final Color[] LIGHT_COLORS = { new Color(232, 64, 64), new Color(255, 205, 80), new Color(96, 190, 255), new Color(120, 220, 120), new Color(255, 150, 220) };
    private static final Dimension BAR_SIZE = new Dimension(42, 16);
    private static final Dimension TREE_SIZE = new Dimension(34, 32);
    private final double[] levels = new double[BARS];
    private boolean active;
    private boolean treeMode;
    VisualizerBars() { setOpaque(false); setPreferredSize(BAR_SIZE); setMaximumSize(BAR_SIZE); }
    void setActive(boolean value) { active = value; if (!value) java.util.Arrays.fill(levels, 0); repaint(); }
    void setLevels(double[] fresh) { for (int i = 0; i < BARS && i < fresh.length; i++) levels[i] = levels[i] * 0.35 + fresh[i] * 0.65; repaint(); }
    /** Swaps the bar meter for a small pine-tree meter whose ornament lights react to the same audio levels the bars use. */
    void setTreeMode(boolean value) {
      if (treeMode == value) return;
      treeMode = value;
      Dimension size = treeMode ? TREE_SIZE : BAR_SIZE;
      setPreferredSize(size); setMaximumSize(size);
      revalidate(); repaint();
    }
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      if (treeMode) paintTree(g); else paintBars(g);
      g.dispose();
    }
    private void paintBars(Graphics2D g) {
      int barWidth = 4, gap = 3, totalWidth = BARS * barWidth + (BARS - 1) * gap, startX = (getWidth() - totalWidth) / 2;
      for (int i = 0; i < BARS; i++) {
        double level = active ? Math.max(0.1, levels[i]) : 0.1;
        int barHeight = Math.max(2, (int) (level * getHeight()));
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
      for (int i = 0; i < BARS; i++) {
        double level = active ? Math.max(0.12, levels[i]) : 0.12;
        int lx = (int) (LIGHT_POSITIONS[i][0] * w), ly = (int) (LIGHT_POSITIONS[i][1] * h);
        double glow = 1.4 + level * 3.2;
        Color base = LIGHT_COLORS[i % LIGHT_COLORS.length];
        int alpha = Math.min(255, (int) (110 + level * 145));
        g.setColor(new Color(base.getRed(), base.getGreen(), base.getBlue(), alpha));
        g.fillOval((int) (lx - glow), (int) (ly - glow), (int) (glow * 2), (int) (glow * 2));
      }
    }
  }

  /** Full-window overlay (installed as the frame's glass pane) that animates gently falling snow for the SNOW theme. Mouse events pass through untouched because {@link #contains} always reports false. */
  private static final class SnowOverlay extends JPanel {
    private static final int FLAKE_COUNT = 90;
    private final double[] x = new double[FLAKE_COUNT];
    private final double[] y = new double[FLAKE_COUNT];
    private final double[] fallSpeed = new double[FLAKE_COUNT];
    private final double[] driftPhase = new double[FLAKE_COUNT];
    private final double[] radius = new double[FLAKE_COUNT];
    private final Timer timer = new Timer(35, null);
    private boolean seeded;
    SnowOverlay() { setOpaque(false); timer.addActionListener(e -> { advance(); repaint(); }); }
    void setActive(boolean value) {
      setVisible(value);
      if (value) { if (!seeded) seed(); timer.start(); } else timer.stop();
    }
    private void seed() {
      seeded = true;
      int w = Math.max(1, getWidth()), h = Math.max(1, getHeight());
      for (int i = 0; i < FLAKE_COUNT; i++) {
        x[i] = ThreadLocalRandom.current().nextDouble() * w;
        y[i] = ThreadLocalRandom.current().nextDouble() * h;
        fallSpeed[i] = 0.6 + ThreadLocalRandom.current().nextDouble() * 1.6;
        driftPhase[i] = ThreadLocalRandom.current().nextDouble() * Math.PI * 2;
        radius[i] = 1.2 + ThreadLocalRandom.current().nextDouble() * 2.3;
      }
    }
    private void advance() {
      int w = Math.max(1, getWidth()), h = Math.max(1, getHeight());
      for (int i = 0; i < FLAKE_COUNT; i++) {
        y[i] += fallSpeed[i];
        x[i] += Math.sin((y[i] * 0.02) + driftPhase[i]) * 0.6;
        if (y[i] > h) { y[i] = -4; x[i] = ThreadLocalRandom.current().nextDouble() * w; }
        if (x[i] < -4) x[i] = w + 4; else if (x[i] > w + 4) x[i] = -4;
      }
    }
    protected void paintComponent(Graphics raw) {
      Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      g.setColor(new Color(255, 255, 255, 220));
      for (int i = 0; i < FLAKE_COUNT; i++) {
        double r = radius[i];
        g.fillOval((int) (x[i] - r), (int) (y[i] - r), (int) (r * 2), (int) (r * 2));
      }
      g.dispose();
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