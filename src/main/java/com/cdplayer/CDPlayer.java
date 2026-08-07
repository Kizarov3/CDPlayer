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
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.UIManager;
import javax.swing.plaf.basic.BasicSliderUI;
import javax.swing.filechooser.FileNameExtensionFilter;

/** A standalone, dependency-free Java desktop music player. */
public final class CDPlayer extends JFrame {
  private static final Color INK = new Color(9, 11, 11);
  private static final Color LIME = new Color(216, 255, 66);
  private static final Color TEXT = new Color(244, 245, 237);
  private static final Color MUTED = new Color(145, 156, 147);
  private final DiscView disc = new DiscView();
  private final JLabel status = label("●  READY TO PLAY", 11, LIME);
  private final JLabel track = new JLabel("Pick a track to get started.");
  private final JLabel source = label("YOUR MUSIC LIBRARY", 11, MUTED);
  private final JLabel elapsed = label("0:00", 10, MUTED);
  private final JLabel length = label("0:00", 10, MUTED);
  private final JSlider progress = new JSlider(0, 1000, 0);
  private final JButton play = roundButton("▶", 68, true);
  private final JButton shuffleButton = textButton("SHUFFLE OFF");
  private final JButton repeatButton = textButton("REPEAT OFF");
  private final JLabel queueInfo = label("QUEUE EMPTY", 10, MUTED);
  private final JLabel queueNext = label("DROP SONGS OR A FOLDER TO BUILD A QUEUE", 9, new Color(97, 110, 95));
  private final List<File> queue = new ArrayList<File>();
  private int queueIndex = -1;
  private final Map<File, SongDetails> metadataCache = new HashMap<File, SongDetails>();
  private boolean shuffle;
  private boolean repeat;
  private Clip clip;
  private File loadedFile;
  private File temporaryAudio;
  private boolean adjusting;
  private final Timer clock = new Timer(70, this::tick);
  private static final Pattern ITUNES_COVER = Pattern.compile("\\\"artworkUrl100\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");

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
    setDropTarget(new DropTarget(this, new DropTargetAdapter() {
      @SuppressWarnings("unchecked") public void drop(DropTargetDropEvent event) {
        try {
          event.acceptDrop(event.getDropAction());
          List<File> files = (List<File>) event.getTransferable().getTransferData(DataFlavor.javaFileListFlavor);
          if (!files.isEmpty()) addToQueue(files);
        } catch (Exception ignored) { status.setText("●  COULDN'T LOAD THAT FILE"); }
      }
    }));
  }

  private JPanel createContent() {
    JPanel root = new JPanel(new BorderLayout());
    root.setBackground(INK); root.setBorder(BorderFactory.createEmptyBorder(23, 55, 23, 55));
    root.add(header(), BorderLayout.NORTH);
    JPanel body = new JPanel(new GridBagLayout()); body.setOpaque(false);
    GridBagConstraints constraints = new GridBagConstraints();
    constraints.gridy = 0; constraints.weighty = 1; constraints.fill = GridBagConstraints.BOTH;
    constraints.gridx = 0; constraints.weightx = 1.1; body.add(disc, constraints);
    constraints.gridx = 1; constraints.weightx = .9; constraints.insets = new Insets(40, 25, 30, 10); body.add(playerPanel(), constraints);
    root.add(body, BorderLayout.CENTER);
    JLabel hint = label("DROP WAV, AIFF, AU, FLAC OR M4A · IT STAYS ON YOUR DEVICE", 10, new Color(97, 110, 95));
    hint.setHorizontalAlignment(SwingConstants.CENTER); root.add(hint, BorderLayout.SOUTH);
    return root;
  }

  private JPanel header() {
    JPanel bar = new JPanel(new BorderLayout()); bar.setOpaque(false); bar.setPreferredSize(new Dimension(0, 53));
    JLabel brand = label("CD\n    PLAYER", 11, TEXT); brand.setFont(new Font(Font.MONOSPACED, Font.BOLD, 11));
    bar.add(brand, BorderLayout.WEST); status.setHorizontalAlignment(SwingConstants.CENTER); bar.add(status, BorderLayout.CENTER);
    return bar;
  }

  private JPanel playerPanel() {
    JPanel panel = new JPanel(); panel.setOpaque(false); panel.setLayout(new javax.swing.BoxLayout(panel, javax.swing.BoxLayout.Y_AXIS));
    JPanel nowRow = new JPanel(); nowRow.setOpaque(false); nowRow.setAlignmentX(Component.LEFT_ALIGNMENT); nowRow.setLayout(new javax.swing.BoxLayout(nowRow, javax.swing.BoxLayout.X_AXIS));
    JLabel now = label("NOW PLAYING", 11, LIME); nowRow.add(now); nowRow.add(javax.swing.Box.createHorizontalStrut(10)); nowRow.add(new SignalMeter()); panel.add(nowRow);
    panel.add(javax.swing.Box.createVerticalStrut(16));
    track.setForeground(TEXT); track.setFont(new Font("SansSerif", Font.BOLD, 32)); track.setAlignmentX(Component.LEFT_ALIGNMENT); panel.add(track);
    panel.add(javax.swing.Box.createVerticalStrut(16)); source.setAlignmentX(Component.LEFT_ALIGNMENT); panel.add(source);
    panel.add(javax.swing.Box.createVerticalStrut(45));
    progress.setOpaque(false); progress.setUI(new LimeSliderUI(progress)); progress.setAlignmentX(Component.LEFT_ALIGNMENT); progress.setMaximumSize(new Dimension(Integer.MAX_VALUE, 24));
    progress.addChangeListener(e -> { if (clip != null && progress.getValueIsAdjusting()) adjusting = true; else if (clip != null && adjusting) { clip.setMicrosecondPosition((long) (clip.getMicrosecondLength() * progress.getValue() / 1000.0)); adjusting = false; } });
    panel.add(progress);
    JPanel times = new JPanel(new BorderLayout()); times.setOpaque(false); times.setMaximumSize(new Dimension(Integer.MAX_VALUE, 18)); times.add(elapsed, BorderLayout.WEST); times.add(length, BorderLayout.EAST); panel.add(times);
    panel.add(javax.swing.Box.createVerticalStrut(22));
    JPanel controls = new JPanel(); controls.setOpaque(false); controls.setLayout(new javax.swing.BoxLayout(controls, javax.swing.BoxLayout.X_AXIS)); controls.setAlignmentX(Component.LEFT_ALIGNMENT);
    JButton back = roundButton("↶", 42, false); back.setToolTipText("Previous track"); back.addActionListener(e -> previousTrack()); controls.add(back); controls.add(javax.swing.Box.createHorizontalStrut(13));
    play.addActionListener(e -> toggle()); controls.add(play); controls.add(javax.swing.Box.createHorizontalStrut(13));
    JButton forward = roundButton("↷", 42, false); forward.setToolTipText("Next track"); forward.addActionListener(e -> nextTrack()); controls.add(forward); controls.add(javax.swing.Box.createHorizontalGlue());
    JButton load = textButton("LOAD A TRACK  +"); load.addActionListener(e -> choose()); controls.add(load); panel.add(controls);
    panel.add(javax.swing.Box.createVerticalStrut(21));
    JPanel modes = new JPanel(); modes.setOpaque(false); modes.setAlignmentX(Component.LEFT_ALIGNMENT); modes.setLayout(new javax.swing.BoxLayout(modes, javax.swing.BoxLayout.X_AXIS));
    shuffleButton.addActionListener(e -> { shuffle = !shuffle; shuffleButton.setText(shuffle ? "SHUFFLE ON" : "SHUFFLE OFF"); updateQueueUI(); }); modes.add(shuffleButton); modes.add(javax.swing.Box.createHorizontalStrut(18));
    repeatButton.addActionListener(e -> { repeat = !repeat; repeatButton.setText(repeat ? "REPEAT ON" : "REPEAT OFF"); updateQueueUI(); }); modes.add(repeatButton); panel.add(modes);
    panel.add(javax.swing.Box.createVerticalStrut(18));
    JPanel queueCard = new JPanel(); queueCard.setOpaque(false); queueCard.setAlignmentX(Component.LEFT_ALIGNMENT); queueCard.setLayout(new javax.swing.BoxLayout(queueCard, javax.swing.BoxLayout.Y_AXIS)); queueCard.setBorder(BorderFactory.createMatteBorder(1, 0, 0, 0, new Color(216, 255, 66, 50)));
    queueInfo.setAlignmentX(Component.LEFT_ALIGNMENT); queueNext.setAlignmentX(Component.LEFT_ALIGNMENT); queueCard.add(javax.swing.Box.createVerticalStrut(9)); queueCard.add(queueInfo); queueCard.add(javax.swing.Box.createVerticalStrut(5)); queueCard.add(queueNext); panel.add(queueCard);
    return panel;
  }

  private void choose() { JFileChooser chooser = new JFileChooser(); chooser.setMultiSelectionEnabled(true); chooser.setFileSelectionMode(JFileChooser.FILES_AND_DIRECTORIES); chooser.setFileFilter(new FileNameExtensionFilter("Audio files (WAV, AIFF, AU, FLAC, M4A)", "wav", "wave", "aif", "aiff", "au", "flac", "m4a")); if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) { File[] selected = chooser.getSelectedFiles(); if (selected.length == 0) selected = new File[] { chooser.getSelectedFile() }; addToQueue(java.util.Arrays.asList(selected)); } }
  private void addToQueue(List<File> dropped) {
    List<File> songs = new ArrayList<File>(); for (File item : dropped) collectAudio(item, songs); Collections.sort(songs, (left, right) -> left.getName().compareToIgnoreCase(right.getName()));
    if (songs.isEmpty()) { status.setText("●  NO SUPPORTED AUDIO FOUND"); return; }
    queue.addAll(songs); status.setText("●  ADDED " + songs.size() + " TO QUEUE"); updateQueueUI();
    if (queueIndex < 0) { queueIndex = 0; load(queue.get(queueIndex)); }
  }
  private void collectAudio(File item, List<File> songs) { if (item.isDirectory()) { File[] children = item.listFiles(); if (children != null) for (File child : children) collectAudio(child, songs); } else if (isSupportedAudio(item)) songs.add(item); }
  private static boolean isSupportedAudio(File item) { String type = extension(item); return "wav".equals(type) || "wave".equals(type) || "aif".equals(type) || "aiff".equals(type) || "au".equals(type) || "flac".equals(type) || "m4a".equals(type); }
  private void updateQueueUI() {
    if (queue.isEmpty() || queueIndex < 0) { queueInfo.setText("QUEUE EMPTY"); queueNext.setText("DROP SONGS OR A FOLDER TO BUILD A QUEUE"); return; }
    queueInfo.setText("QUEUE " + (queueIndex + 1) + " / " + queue.size() + (shuffle ? " · SHUFFLED" : ""));
    int next = nextIndex();
    queueNext.setText(next >= 0 && next != queueIndex ? "UP NEXT · " + queueDisplay(queue.get(next)) : (repeat ? "REPEATING THIS TRACK" : "END OF QUEUE"));
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
      if (clip != null) { Clip previousClip = clip; clip = null; previousClip.stop(); previousClip.close(); }
      deleteTemporaryAudio();
      File playable = prepareAudio(file);
      AudioInputStream stream = AudioSystem.getAudioInputStream(playable); Clip openedClip = AudioSystem.getClip(); openedClip.open(stream); clip = openedClip; loadedFile = file;
      openedClip.addLineListener(event -> { if (event.getType() == LineEvent.Type.STOP && openedClip.getMicrosecondPosition() >= openedClip.getMicrosecondLength()) SwingUtilities.invokeLater(() -> trackFinished(openedClip)); });
      SongDetails details = inspectSong(file);
      metadataCache.put(file, details);
      String name = details.title;
      track.setText("<html>" + escape(name) + "</html>"); source.setText("LOCAL AUDIO FILE · " + file.getName().substring(file.getName().lastIndexOf('.') + 1).toUpperCase());
      length.setText(format(clip.getMicrosecondLength())); elapsed.setText("0:00"); progress.setValue(0); status.setText("●  TRACK LOADED");
      disc.setCover(details.embeddedCover); disc.setLookingUp(details.embeddedCover == null && details.hasArtist());
      if (details.embeddedCover != null) source.setText("EMBEDDED ALBUM ART · " + extension(file).toUpperCase());
      else if (details.hasArtist()) findCover(details.lookupQuery(), file);
      else source.setText("NO EMBEDDED COVER · ADD SONG METADATA");
      updateQueueUI();
      clip.start(); setPlaying(true);
    } catch (Exception error) { status.setText("●  INSTALL FFMPEG FOR FLAC / M4A"); }
  }
  private File prepareAudio(File sourceFile) throws Exception {
    String extension = extension(sourceFile);
    if (!"flac".equals(extension) && !"m4a".equals(extension)) return sourceFile;
    temporaryAudio = File.createTempFile("cdplayer-", ".wav"); temporaryAudio.deleteOnExit();
    Process process;
    try {
      process = new ProcessBuilder("ffmpeg", "-nostdin", "-y", "-v", "error", "-i", sourceFile.getAbsolutePath(), "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", temporaryAudio.getAbsolutePath()).inheritIO().start();
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
      Process probe = new ProcessBuilder("ffprobe", "-v", "error", "-show_entries", "format_tags=title,artist,album", "-of", "default=noprint_wrappers=1", file.getAbsolutePath()).redirectErrorStream(true).start();
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
      Process extract = new ProcessBuilder("ffmpeg", "-nostdin", "-y", "-v", "error", "-i", file.getAbsolutePath(), "-map", "0:v:0", "-frames:v", "1", image.getAbsolutePath()).redirectErrorStream(true).start();
      readAll(extract.getInputStream()); if (extract.waitFor() == 0 && image.length() > 0) return ImageIO.read(image);
    } catch (Exception ignored) { /* No embedded artwork is normal. */ }
    finally { if (image != null) image.delete(); }
    return null;
  }
  private static final class SongDetails {
    final String title, artist, album; final BufferedImage embeddedCover;
    SongDetails(String title, String artist, String album, BufferedImage embeddedCover) { this.title = title; this.artist = artist; this.album = album; this.embeddedCover = embeddedCover; }
    boolean hasArtist() { return artist != null && !artist.trim().isEmpty(); }
    String lookupQuery() { return artist + " " + title + (album == null || album.trim().isEmpty() ? "" : " " + album); }
  }
  private void findCover(final String query, final File requestedFile) {
    Thread lookup = new Thread(() -> {
      try {
        String encoded = URLEncoder.encode(query, "UTF-8");
        String json = fetchText("https://itunes.apple.com/search?term=" + encoded + "&entity=song&limit=1");
        Matcher match = ITUNES_COVER.matcher(json); BufferedImage image = match.find() ? fetchImage(match.group(1).replace("\\/", "/").replace("100x100bb", "600x600bb")) : null;
        final BufferedImage foundCover = image;
        SwingUtilities.invokeLater(() -> { if (requestedFile.equals(loadedFile)) { disc.setLookingUp(false); if (foundCover != null) { disc.setCover(foundCover); source.setText("ITUNES COVER ART · " + extension(requestedFile).toUpperCase()); } else source.setText("COVER NOT FOUND · " + extension(requestedFile).toUpperCase()); } });
      } catch (Exception ignored) { SwingUtilities.invokeLater(() -> { if (requestedFile.equals(loadedFile)) { disc.setLookingUp(false); source.setText("COVER LOOKUP UNAVAILABLE · " + extension(requestedFile).toUpperCase()); } }); }
    }, "cdplayer-cover-lookup");
    lookup.setDaemon(true); lookup.start();
  }
  private static String fetchText(String location) throws IOException { HttpURLConnection connection = open(location); try (InputStream stream = connection.getInputStream()) { return new String(readAll(stream), StandardCharsets.UTF_8); } finally { connection.disconnect(); } }
  private static BufferedImage fetchImage(String location) throws IOException { HttpURLConnection connection = open(location); try (InputStream stream = connection.getInputStream()) { return ImageIO.read(stream); } finally { connection.disconnect(); } }
  private static HttpURLConnection open(String location) throws IOException { HttpURLConnection connection = (HttpURLConnection) new URL(location).openConnection(); connection.setRequestProperty("User-Agent", "CDPlayer/1.0 (open cover lookup)"); connection.setConnectTimeout(5000); connection.setReadTimeout(8000); return connection; }
  private static byte[] readAll(InputStream stream) throws IOException { java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count; while ((count = stream.read(buffer)) >= 0) output.write(buffer, 0, count); return output.toByteArray(); }
  private void toggle() { if (clip == null) { choose(); return; } if (clip.isRunning()) { clip.stop(); setPlaying(false); } else { clip.start(); setPlaying(true); } }
  private void trackFinished(Clip finishedClip) { if (clip != finishedClip) return; if (repeat) { clip.setMicrosecondPosition(0); clip.start(); setPlaying(true); } else if (!nextTrack()) setPlaying(false); }
  private boolean nextTrack() { int next = nextIndex(); if (next < 0) return false; queueIndex = next; load(queue.get(queueIndex)); return true; }
  private void previousTrack() { if (clip != null && clip.getMicrosecondPosition() > 5_000_000L) { clip.setMicrosecondPosition(0); return; } if (queueIndex > 0) { queueIndex--; load(queue.get(queueIndex)); } else if (clip != null) clip.setMicrosecondPosition(0); }
  private void seek(int seconds) { if (clip == null) return; long target = Math.max(0, Math.min(clip.getMicrosecondLength(), clip.getMicrosecondPosition() + seconds * 1_000_000L)); clip.setMicrosecondPosition(target); }
  private void tick(ActionEvent event) { if (clip == null || adjusting) return; long duration = clip.getMicrosecondLength(); long position = clip.getMicrosecondPosition(); progress.setValue(duration == 0 ? 0 : (int) (position * 1000 / duration)); elapsed.setText(format(position)); }
  private void setPlaying(boolean playing) { disc.setSpinning(playing); play.setText(playing ? "Ⅱ" : "▶"); status.setText(playing ? "●  NOW SPINNING" : (loadedFile == null ? "●  READY TO PLAY" : "●  PAUSED")); if (playing) clock.start(); else clock.stop(); }
  private static String format(long micros) { long seconds = micros / 1_000_000L; return String.format("%d:%02d", seconds / 60, seconds % 60); }
  private static String escape(String value) { return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); }
  private static JLabel label(String value, int size, Color color) { JLabel result = new JLabel("<html>" + value.replace("\n", "<br>") + "</html>"); result.setForeground(color); result.setFont(new Font(Font.MONOSPACED, Font.PLAIN, size)); return result; }
  private static JButton roundButton(String caption, int size, boolean primary) { return new TransportButton(caption, size, primary); }
  private static JButton textButton(String caption) { JButton button = new JButton(caption); button.setFont(new Font(Font.MONOSPACED, Font.BOLD, 10)); button.setForeground(LIME); button.setOpaque(false); button.setContentAreaFilled(false); button.setBorder(BorderFactory.createMatteBorder(0, 0, 1, 0, LIME)); button.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); return button; }

  private static final class TransportButton extends JButton {
    private final boolean primary;
    TransportButton(String caption, int size, boolean primary) { super(caption); this.primary = primary; setFont(new Font("SansSerif", Font.PLAIN, primary ? 24 : 19)); setForeground(primary ? INK : LIME); setFocusPainted(false); setBorderPainted(false); setContentAreaFilled(false); setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); setPreferredSize(new Dimension(size, size)); setMaximumSize(new Dimension(size, size)); }
    protected void paintComponent(Graphics raw) { Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON); int pad = primary ? 1 : 3, width = getWidth() - pad * 2, height = getHeight() - pad * 2; if (primary) { g.setColor(getModel().isPressed() ? new Color(188,226,48) : LIME); g.fillOval(pad, pad, width, height); g.setColor(new Color(255,255,255,95)); g.setStroke(new BasicStroke(1)); g.drawOval(pad + 2, pad + 2, width - 4, height - 4); } else { g.setColor(new Color(216,255,66, getModel().isRollover() ? 80 : 38)); g.fillOval(pad, pad, width, height); g.setColor(new Color(216,255,66, 175)); g.setStroke(new BasicStroke(1)); g.drawOval(pad, pad, width - 1, height - 1); } String text = getText(); g.setFont(getFont()); java.awt.FontMetrics metrics = g.getFontMetrics(); g.setColor(getForeground()); g.drawString(text, (getWidth() - metrics.stringWidth(text)) / 2, (getHeight() - metrics.getHeight()) / 2 + metrics.getAscent()); g.dispose(); }
  }

  private static final class LimeSliderUI extends BasicSliderUI {
    LimeSliderUI(JSlider slider) { super(slider); }
    public void paintTrack(Graphics raw) { Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON); int y = trackRect.y + trackRect.height / 2 - 2; g.setColor(new Color(255,255,255,24)); g.fillRoundRect(trackRect.x, y, trackRect.width, 4, 4, 4); int fill = thumbRect.x + thumbRect.width / 2 - trackRect.x; g.setColor(LIME); g.fillRoundRect(trackRect.x, y, Math.max(0, fill), 4, 4, 4); g.dispose(); }
    public void paintThumb(Graphics raw) { Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON); g.setColor(new Color(216,255,66,55)); g.fillOval(thumbRect.x - 4, thumbRect.y - 4, thumbRect.width + 8, thumbRect.height + 8); g.setColor(TEXT); g.fillOval(thumbRect.x, thumbRect.y, thumbRect.width, thumbRect.height); g.dispose(); }
    protected Dimension getThumbSize() { return new Dimension(13, 13); }
  }

  private static final class SignalMeter extends JPanel {
    SignalMeter() { setOpaque(false); setPreferredSize(new Dimension(24, 12)); setMaximumSize(new Dimension(24, 12)); }
    protected void paintComponent(Graphics raw) { Graphics2D g = (Graphics2D) raw.create(); g.setColor(LIME); for (int i = 0; i < 4; i++) { int height = 4 + (i % 3) * 3; g.fillRect(i * 5, (12 - height) / 2, 2, height); } g.dispose(); }
  }

  private static final class DiscView extends JPanel {
    private double angle; private boolean spinning; private boolean lookingUp; private BufferedImage cover; private final Timer motion = new Timer(16, e -> { angle += .1; repaint(); });
    DiscView() { setOpaque(false); setPreferredSize(new Dimension(520, 520)); }
    void setSpinning(boolean value) { spinning = value; if (value) motion.start(); else motion.stop(); repaint(); }
    void setCover(BufferedImage image) { cover = image; repaint(); }
    void setLookingUp(boolean value) { lookingUp = value; repaint(); }
    protected void paintComponent(Graphics raw) {
      super.paintComponent(raw); Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      int side = Math.min(225, Math.min(getWidth(), getHeight()) - 185), x = (getWidth()-side)/2, y = (getHeight()-side)/2 + 24, centerX = getWidth()/2, centerY = y + side/2;
      int caseSide = side + 50, caseX = centerX - caseSide / 2, caseY = centerY - caseSide / 2;
      g.setColor(new Color(226,239,224, 22)); g.fillRoundRect(caseX, caseY, caseSide, caseSide, 9, 9); g.setColor(new Color(216,255,66, 105)); g.setStroke(new BasicStroke(2)); g.drawRoundRect(caseX, caseY, caseSide, caseSide, 9, 9);
      g.setColor(new Color(255,255,255,48)); g.setStroke(new BasicStroke(1)); g.drawLine(caseX + 8, caseY + 8, caseX + caseSide - 8, caseY + 8); g.drawLine(caseX + 8, caseY + caseSide - 8, caseX + caseSide - 8, caseY + caseSide - 8);
      if (cover != null) { g.setColor(new Color(0,0,0,105)); g.fillRoundRect(caseX + 13, caseY + 13, 56, 56, 4, 4); g.drawImage(cover, caseX + 16, caseY + 16, 50, 50, null); g.setColor(LIME); g.drawRect(caseX + 15, caseY + 15, 51, 51); }
      g.setColor(new Color(216,255,66, 27)); g.setStroke(new BasicStroke(1)); g.drawOval(centerX-side/2-16, centerY-side/2-16, side+32, side+32); g.drawOval(centerX-side/2+32, centerY-side/2+32, side-64, side-64);
      g.setColor(new Color(216,255,66, 30)); g.fill(new Ellipse2D.Double(x+40,y+55,side-80,side-80));
      AffineTransform old = g.getTransform(); g.rotate(angle, centerX, centerY);
      g.setPaint(new GradientPaint(x, y, new Color(237,255,135), x+side, y+side, new Color(45,61,15), true)); g.fillOval(x, y, side, side);
      g.setColor(new Color(0,0,0,88)); for(int r=side/2-9; r>side/8; r-=7) g.drawOval(centerX-r,centerY-r,r*2,r*2);
      g.setColor(new Color(255,255,255,42)); g.setStroke(new BasicStroke(Math.max(1, side / 140))); g.drawArc(x+side/13,y+side/13,side*11/13,side*11/13,198,92);
      int labelSize = side / 3, labelX = centerX - labelSize / 2, labelY = centerY - labelSize / 2;
      g.setColor(new Color(208,239,91)); g.fillOval(labelX, labelY, labelSize, labelSize);
      if (cover != null) { java.awt.Shape oldClip = g.getClip(); g.setClip(new Ellipse2D.Double(labelX, labelY, labelSize, labelSize)); g.drawImage(cover, labelX, labelY, labelSize, labelSize, null); g.setClip(oldClip); }
      else if (lookingUp) { g.setColor(new Color(15,19,10)); g.fillOval(labelX, labelY, labelSize, labelSize); g.setColor(LIME); g.setFont(new Font(Font.MONOSPACED, Font.BOLD, Math.max(7, side / 34))); String loading = "FETCHING"; int textWidth = g.getFontMetrics().stringWidth(loading); g.drawString(loading, centerX - textWidth / 2, centerY + side / 42); }
      g.setColor(new Color(247,255,190)); g.drawOval(labelX, labelY, labelSize, labelSize); g.setColor(INK); g.fillOval(centerX-side/15, centerY-side/15, side/7, side/7);
      g.setColor(new Color(18,27,10)); g.setFont(new Font(Font.MONOSPACED, Font.BOLD, Math.max(9, side/35))); g.drawString("CDPLAYER", x+side/6, y+side/3); g.drawString("SIDE A", x+side/2, y+side*3/4); g.setFont(new Font("SansSerif", Font.BOLD, side/9)); g.drawString("01", x+side/4, y+side*2/3);
      g.setTransform(old); if (!spinning) { g.setColor(new Color(9,11,11,92)); g.fillOval(x,y,side,side); } g.dispose();
    }
  }
}
