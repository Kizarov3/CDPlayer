package com.cdplayer;

import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.BorderLayout;
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
import java.util.List;
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
  private Clip clip;
  private File loadedFile;
  private boolean adjusting;
  private final Timer clock = new Timer(70, this::tick);

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
          if (!files.isEmpty()) load(files.get(0));
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
    JLabel hint = label("DROP A WAV, AIFF OR AU FILE ANYWHERE · IT STAYS ON YOUR DEVICE", 10, new Color(97, 110, 95));
    hint.setHorizontalAlignment(SwingConstants.CENTER); root.add(hint, BorderLayout.SOUTH);
    return root;
  }

  private JPanel header() {
    JPanel bar = new JPanel(new BorderLayout()); bar.setOpaque(false); bar.setPreferredSize(new Dimension(0, 53));
    JLabel brand = label("C   CD\n    PLAYER", 11, TEXT); brand.setFont(new Font(Font.MONOSPACED, Font.BOLD, 11));
    bar.add(brand, BorderLayout.WEST); status.setHorizontalAlignment(SwingConstants.CENTER); bar.add(status, BorderLayout.CENTER);
    JLabel about = label("STANDALONE JAVA APP  ↗", 10, TEXT); about.setHorizontalAlignment(SwingConstants.RIGHT); bar.add(about, BorderLayout.EAST);
    return bar;
  }

  private JPanel playerPanel() {
    JPanel panel = new JPanel(); panel.setOpaque(false); panel.setLayout(new javax.swing.BoxLayout(panel, javax.swing.BoxLayout.Y_AXIS));
    JLabel now = label("NOW PLAYING", 11, LIME); now.setAlignmentX(Component.LEFT_ALIGNMENT); panel.add(now);
    panel.add(javax.swing.Box.createVerticalStrut(16));
    track.setForeground(TEXT); track.setFont(new Font("SansSerif", Font.BOLD, 32)); track.setAlignmentX(Component.LEFT_ALIGNMENT); panel.add(track);
    panel.add(javax.swing.Box.createVerticalStrut(16)); source.setAlignmentX(Component.LEFT_ALIGNMENT); panel.add(source);
    panel.add(javax.swing.Box.createVerticalStrut(45));
    progress.setOpaque(false); progress.setAlignmentX(Component.LEFT_ALIGNMENT); progress.setMaximumSize(new Dimension(Integer.MAX_VALUE, 24));
    progress.addChangeListener(e -> { if (clip != null && progress.getValueIsAdjusting()) adjusting = true; else if (clip != null && adjusting) { clip.setMicrosecondPosition((long) (clip.getMicrosecondLength() * progress.getValue() / 1000.0)); adjusting = false; } });
    panel.add(progress);
    JPanel times = new JPanel(new BorderLayout()); times.setOpaque(false); times.setMaximumSize(new Dimension(Integer.MAX_VALUE, 18)); times.add(elapsed, BorderLayout.WEST); times.add(length, BorderLayout.EAST); panel.add(times);
    panel.add(javax.swing.Box.createVerticalStrut(22));
    JPanel controls = new JPanel(); controls.setOpaque(false); controls.setLayout(new javax.swing.BoxLayout(controls, javax.swing.BoxLayout.X_AXIS)); controls.setAlignmentX(Component.LEFT_ALIGNMENT);
    JButton back = roundButton("↶", 42, false); back.addActionListener(e -> seek(-10)); controls.add(back); controls.add(javax.swing.Box.createHorizontalStrut(13));
    play.addActionListener(e -> toggle()); controls.add(play); controls.add(javax.swing.Box.createHorizontalStrut(13));
    JButton forward = roundButton("↷", 42, false); forward.addActionListener(e -> seek(10)); controls.add(forward); controls.add(javax.swing.Box.createHorizontalGlue());
    JButton load = textButton("LOAD A TRACK  +"); load.addActionListener(e -> choose()); controls.add(load); panel.add(controls);
    return panel;
  }

  private void choose() { JFileChooser chooser = new JFileChooser(); chooser.setFileFilter(new FileNameExtensionFilter("Audio files (WAV, AIFF, AU)", "wav", "wave", "aif", "aiff", "au")); if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) load(chooser.getSelectedFile()); }
  private void load(File file) {
    try {
      if (clip != null) { clip.stop(); clip.close(); }
      AudioInputStream stream = AudioSystem.getAudioInputStream(file); clip = AudioSystem.getClip(); clip.open(stream); loadedFile = file;
      clip.addLineListener(event -> { if (event.getType() == LineEvent.Type.STOP && clip.getMicrosecondPosition() >= clip.getMicrosecondLength()) SwingUtilities.invokeLater(() -> setPlaying(false)); });
      String name = file.getName().replaceFirst("\\.[^.]+$", "").replace('_', ' ').replace('-', ' ');
      track.setText("<html>" + escape(name) + "</html>"); source.setText("LOCAL AUDIO FILE · " + file.getName().substring(file.getName().lastIndexOf('.') + 1).toUpperCase());
      length.setText(format(clip.getMicrosecondLength())); elapsed.setText("0:00"); progress.setValue(0); status.setText("●  TRACK LOADED");
      clip.start(); setPlaying(true);
    } catch (Exception error) { status.setText("●  USE WAV, AIFF OR AU AUDIO"); }
  }
  private void toggle() { if (clip == null) { choose(); return; } if (clip.isRunning()) { clip.stop(); setPlaying(false); } else { clip.start(); setPlaying(true); } }
  private void seek(int seconds) { if (clip == null) return; long target = Math.max(0, Math.min(clip.getMicrosecondLength(), clip.getMicrosecondPosition() + seconds * 1_000_000L)); clip.setMicrosecondPosition(target); }
  private void tick(ActionEvent event) { if (clip == null || adjusting) return; long duration = clip.getMicrosecondLength(); long position = clip.getMicrosecondPosition(); progress.setValue(duration == 0 ? 0 : (int) (position * 1000 / duration)); elapsed.setText(format(position)); }
  private void setPlaying(boolean playing) { disc.setSpinning(playing); play.setText(playing ? "Ⅱ" : "▶"); status.setText(playing ? "●  NOW SPINNING" : (loadedFile == null ? "●  READY TO PLAY" : "●  PAUSED")); if (playing) clock.start(); else clock.stop(); }
  private static String format(long micros) { long seconds = micros / 1_000_000L; return String.format("%d:%02d", seconds / 60, seconds % 60); }
  private static String escape(String value) { return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); }
  private static JLabel label(String value, int size, Color color) { JLabel result = new JLabel("<html>" + value.replace("\n", "<br>") + "</html>"); result.setForeground(color); result.setFont(new Font(Font.MONOSPACED, Font.PLAIN, size)); return result; }
  private static JButton roundButton(String caption, int size, boolean primary) { JButton button = new JButton(caption); button.setFont(new Font("SansSerif", Font.PLAIN, primary ? 24 : 19)); button.setForeground(primary ? INK : LIME); button.setBackground(primary ? LIME : new Color(22, 29, 20)); button.setFocusPainted(false); button.setBorder(BorderFactory.createLineBorder(primary ? LIME : new Color(125, 150, 56))); button.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); button.setPreferredSize(new Dimension(size, size)); button.setMaximumSize(new Dimension(size, size)); return button; }
  private static JButton textButton(String caption) { JButton button = new JButton(caption); button.setFont(new Font(Font.MONOSPACED, Font.BOLD, 10)); button.setForeground(LIME); button.setOpaque(false); button.setContentAreaFilled(false); button.setBorder(BorderFactory.createMatteBorder(0, 0, 1, 0, LIME)); button.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); return button; }

  private static final class DiscView extends JPanel {
    private double angle; private boolean spinning; private final Timer motion = new Timer(16, e -> { angle += .1; repaint(); });
    DiscView() { setOpaque(false); setPreferredSize(new Dimension(520, 520)); }
    void setSpinning(boolean value) { spinning = value; if (value) motion.start(); else motion.stop(); repaint(); }
    protected void paintComponent(Graphics raw) {
      super.paintComponent(raw); Graphics2D g = (Graphics2D) raw.create(); g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
      int side = Math.min(getWidth(), getHeight()) - 55, x = (getWidth()-side)/2, y = (getHeight()-side)/2, centerX = getWidth()/2, centerY = getHeight()/2;
      g.setColor(new Color(216,255,66, 27)); g.setStroke(new BasicStroke(1)); g.drawOval(centerX-side/2-22, centerY-side/2-22, side+44, side+44); g.drawOval(centerX-side/2+43, centerY-side/2+43, side-86, side-86);
      g.setColor(new Color(216,255,66, 30)); g.fill(new Ellipse2D.Double(x+40,y+55,side-80,side-80));
      AffineTransform old = g.getTransform(); g.rotate(angle, centerX, centerY);
      g.setPaint(new GradientPaint(x, y, new Color(230,255,125), x+side, y+side, new Color(55,74,20), true)); g.fillOval(x, y, side, side);
      g.setColor(new Color(0,0,0,80)); for(int r=side/2-9; r>side/8; r-=7) g.drawOval(centerX-r,centerY-r,r*2,r*2);
      g.setColor(new Color(208,239,91)); g.fillOval(centerX-side/6, centerY-side/6, side/3, side/3); g.setColor(INK); g.fillOval(centerX-side/15, centerY-side/15, side/7, side/7);
      g.setColor(new Color(18,27,10)); g.setFont(new Font(Font.MONOSPACED, Font.BOLD, Math.max(9, side/35))); g.drawString("CDPLAYER", x+side/6, y+side/3); g.drawString("SIDE A", x+side/2, y+side*3/4); g.setFont(new Font("SansSerif", Font.BOLD, side/9)); g.drawString("01", x+side/4, y+side*2/3);
      g.setTransform(old); if (!spinning) { g.setColor(new Color(9,11,11,92)); g.fillOval(x,y,side,side); } g.dispose();
    }
  }
}
