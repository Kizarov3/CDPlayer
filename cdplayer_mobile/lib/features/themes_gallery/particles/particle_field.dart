import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import 'particle_mode.dart';

/// Falling/rising/twinkling particle effects behind the disc — a single
/// simulation + painter handling all five modes, ported from desktop's
/// `ThemeOverlay` (`CDPlayer.java:5289-5560`), which is likewise one class
/// for every mode rather than one per effect: the modes share the same
/// per-particle arrays, seeding, and tick cadence, so splitting them into
/// separate files would just duplicate that machinery five times.
///
/// One deliberate difference from desktop: there, particles are clipped
/// around the disc's on-screen rectangle (`buildClip()`) because the
/// particle layer is a topmost glass pane that would otherwise paint over
/// it. Here the particle layer is simply placed *behind* the disc/content
/// in a `Stack`, so the opaque disc naturally occludes particles under it —
/// same visual result, no clip-rectangle bookkeeping needed.
class ParticleField extends StatefulWidget {
  const ParticleField({super.key, required this.mode, required this.accent});

  final ParticleMode mode;
  final Color accent;

  @override
  State<ParticleField> createState() => _ParticleFieldState();
}

class _ParticleFieldState extends State<ParticleField> with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  final _sim = _ParticleSimulation();
  Duration _lastTick = Duration.zero;
  Size _lastSize = Size.zero;

  @override
  void initState() {
    super.initState();
    _sim.mode = widget.mode;
    _ticker = createTicker(_onTick)..start();
  }

  @override
  void didUpdateWidget(covariant ParticleField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.mode != widget.mode) {
      _sim.mode = widget.mode;
      _sim.seed(_lastSize);
    }
  }

  // Same fixed ~35ms tick cadence as desktop's particle Timer (CDPlayer.java:5304), not vsync-locked, so ported
  // per-tick speed/phase constants (e.g. "0.6 + rand*1.6 px/tick") keep the exact same on-screen feel.
  static const _tickInterval = Duration(milliseconds: 35);

  void _onTick(Duration elapsed) {
    if (elapsed - _lastTick < _tickInterval) return;
    _lastTick = elapsed;
    if (widget.mode == ParticleMode.none || _lastSize.isEmpty) return;
    _sim.advance(_lastSize);
    setState(() {}); // CustomPainter's `repaint` Listenable (below) is what actually drives repaint; this just keeps the widget alive to receive ticks
  }

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.mode == ParticleMode.none) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(constraints.maxWidth, constraints.maxHeight);
        if (size != _lastSize && !size.isEmpty) {
          _lastSize = size;
          _sim.seed(size);
        }
        // ClipRect matters here, not just cosmetic: CustomPaint doesn't clip to its own `size` by default, and
        // MATRIX's falling glyph trails (and any particle whose position briefly lands just past a boundary
        // between ticks) would otherwise bleed a few pixels into whatever sits just below/beside this field —
        // confirmed directly (digit trails overlapping the title text under the disc) before adding this.
        return ClipRect(
          child: RepaintBoundary(
            child: CustomPaint(
              size: size,
              painter: _ParticlePainter(sim: _sim, accent: widget.accent),
            ),
          ),
        );
      },
    );
  }
}

const _particleCount = 140;
const _matrixColumnWidth = 16.0;

// Pre-baked LEAF_PALETTE at the same 210 alpha desktop uses (CDPlayer.java:5296/5461).
const _leafPalette = [
  Color.fromARGB(210, 224, 122, 40),
  Color.fromARGB(210, 200, 60, 46),
  Color.fromARGB(210, 230, 176, 60),
  Color.fromARGB(210, 180, 90, 40),
  Color.fromARGB(210, 214, 140, 70),
];

class _ParticleSimulation {
  ParticleMode mode = ParticleMode.none;
  double clock = 0;

  final _random = Random();
  final x = List<double>.filled(_particleCount, 0);
  final y = List<double>.filled(_particleCount, 0);
  final speed = List<double>.filled(_particleCount, 0);
  final phase = List<double>.filled(_particleCount, 0);
  final size = List<double>.filled(_particleCount, 0);
  final spin = List<double>.filled(_particleCount, 0);
  final shootingStars = <List<double>>[]; // each: [x, y, vx, vy, life]

  void seed(Size bounds) {
    final w = max(1.0, bounds.width), h = max(1.0, bounds.height);
    shootingStars.clear();
    for (var i = 0; i < _particleCount; i++) {
      switch (mode) {
        case ParticleMode.snow:
          x[i] = _random.nextDouble() * w;
          y[i] = _random.nextDouble() * h;
          speed[i] = 0.6 + _random.nextDouble() * 1.6;
          phase[i] = _random.nextDouble() * pi * 2;
          size[i] = 1.2 + _random.nextDouble() * 2.3;
        case ParticleMode.ocean:
          x[i] = _random.nextDouble() * w;
          y[i] = _random.nextDouble() * h;
          speed[i] = 0.3 + _random.nextDouble() * 0.9;
          phase[i] = _random.nextDouble() * pi * 2;
          size[i] = 1.4 + _random.nextDouble() * 2.8;
        case ParticleMode.autumn:
          x[i] = _random.nextDouble() * w;
          y[i] = _random.nextDouble() * h;
          speed[i] = 0.4 + _random.nextDouble() * 1.0;
          phase[i] = _random.nextDouble() * pi * 2;
          size[i] = 2.6 + _random.nextDouble() * 2.6;
          spin[i] = _random.nextDouble() * pi * 2;
        case ParticleMode.galaxy:
          x[i] = _random.nextDouble() * w;
          y[i] = _random.nextDouble() * h;
          speed[i] = 0.4 + _random.nextDouble() * 1.6;
          phase[i] = _random.nextDouble() * pi * 2;
          size[i] = 0.6 + _random.nextDouble() * 1.6;
        case ParticleMode.matrix:
          // Fixed column positions (independent of width) so a later resize doesn't leave gaps.
          x[i] = i * _matrixColumnWidth;
          y[i] = -_random.nextDouble() * h - 20;
          speed[i] = 2 + _random.nextDouble() * 4;
        case ParticleMode.none:
          break;
      }
    }
  }

  void advance(Size bounds) {
    clock += 0.035;
    final w = max(1.0, bounds.width), h = max(1.0, bounds.height);
    switch (mode) {
      case ParticleMode.snow:
        _fall(w, h, 1);
      case ParticleMode.ocean:
        _fall(w, h, -1);
      case ParticleMode.autumn:
        _fall(w, h, 1);
        for (var i = 0; i < _particleCount; i++) {
          spin[i] += 0.02 + speed[i] * 0.015;
        }
      case ParticleMode.galaxy:
        _advanceShootingStars(w, h);
      case ParticleMode.matrix:
        _advanceMatrix(h);
      case ParticleMode.none:
        break;
    }
  }

  void _fall(double w, double h, int direction) {
    for (var i = 0; i < _particleCount; i++) {
      y[i] += speed[i] * direction;
      x[i] += sin((y[i] * 0.02) + phase[i]) * 0.6;
      if (direction > 0 && y[i] > h) {
        y[i] = -4;
        x[i] = _random.nextDouble() * w;
      } else if (direction < 0 && y[i] < -4) {
        y[i] = h + 4;
        x[i] = _random.nextDouble() * w;
      }
      if (x[i] < -6) {
        x[i] = w + 6;
      } else if (x[i] > w + 6) {
        x[i] = -6;
      }
    }
  }

  void _advanceMatrix(double h) {
    for (var i = 0; i < _particleCount; i++) {
      y[i] += speed[i];
      if (y[i] > h + 160) y[i] = -_random.nextDouble() * h * 0.6 - 20;
    }
  }

  void _advanceShootingStars(double w, double h) {
    if (shootingStars.length < 2 && _random.nextDouble() < 0.012) {
      final vx = 6 + _random.nextDouble() * 5, vy = 3 + _random.nextDouble() * 2.5;
      shootingStars.add([_random.nextDouble() * w * 0.5, _random.nextDouble() * h * 0.4, vx, vy, 1.0]);
    }
    for (final s in shootingStars) {
      s[0] += s[2];
      s[1] += s[3];
      s[4] -= 0.02;
    }
    shootingStars.removeWhere((s) => s[4] <= 0 || s[0] > w + 40 || s[1] > h + 40);
  }
}

class _ParticlePainter extends CustomPainter {
  _ParticlePainter({required this.sim, required this.accent});

  final _ParticleSimulation sim;
  final Color accent;

  @override
  void paint(Canvas canvas, Size size) {
    switch (sim.mode) {
      case ParticleMode.snow:
        _paintSnow(canvas);
      case ParticleMode.ocean:
        _paintOcean(canvas);
      case ParticleMode.autumn:
        _paintAutumn(canvas);
      case ParticleMode.galaxy:
        _paintGalaxy(canvas);
      case ParticleMode.matrix:
        _paintMatrix(canvas, size);
      case ParticleMode.none:
        break;
    }
  }

  void _paintSnow(Canvas canvas) {
    final paint = Paint()..color = const Color.fromARGB(220, 255, 255, 255);
    for (var i = 0; i < _particleCount; i++) {
      canvas.drawCircle(Offset(sim.x[i], sim.y[i]), sim.size[i], paint);
    }
  }

  void _paintOcean(Canvas canvas) {
    final paint = Paint()..color = const Color.fromARGB(130, 210, 245, 250);
    for (var i = 0; i < _particleCount; i++) {
      canvas.drawCircle(Offset(sim.x[i], sim.y[i]), sim.size[i], paint);
    }
  }

  void _paintAutumn(Canvas canvas) {
    for (var i = 0; i < _particleCount; i++) {
      final r = sim.size[i];
      canvas.save();
      canvas.translate(sim.x[i], sim.y[i]);
      canvas.rotate(sim.spin[i]);
      final paint = Paint()..color = _leafPalette[i % _leafPalette.length];
      canvas.drawOval(Rect.fromLTWH(-r, -r * 0.6, r * 2, r * 1.2), paint);
      canvas.restore();
    }
  }

  void _paintGalaxy(Canvas canvas) {
    for (var i = 0; i < _particleCount; i++) {
      final twinkle = 0.5 + 0.5 * sin(sim.clock * (0.6 + sim.speed[i]) + sim.phase[i]);
      final r = sim.size[i] * (0.7 + twinkle * 0.5);
      final alpha = (80 + twinkle * 175).clamp(0, 255).round();
      final paint = Paint()..color = Color.fromARGB(alpha, 255, 255, 255);
      canvas.drawCircle(Offset(sim.x[i], sim.y[i]), r, paint);
    }
    final linePaint = Paint()
      ..strokeWidth = 1.4
      ..strokeCap = StrokeCap.round;
    for (final s in sim.shootingStars) {
      final sx = s[0], sy = s[1], vx = s[2], vy = s[3], life = s[4];
      final norm = sqrt(vx * vx + vy * vy), len = 26;
      final alpha = (life * 230).clamp(0, 255).round();
      linePaint.color = Color.fromARGB(alpha, 255, 255, 255);
      canvas.drawLine(Offset(sx, sy), Offset(sx - vx / norm * len, sy - vy / norm * len), linePaint);
    }
  }

  static const _matrixTrailLength = 10;
  static const _lineHeight = 16.0;
  final _matrixRandom = Random();

  void _paintMatrix(Canvas canvas, Size size) {
    final headStyle = _matrixTextStyle(const Color.fromARGB(255, 224, 255, 224));
    final trailStyles = List.generate(
      _matrixTrailLength,
      (j) => j == 0
          ? headStyle
          : _matrixTextStyle(accent.withAlpha(max(0, 200 - j * 22))),
    );
    for (var i = 0; i < _particleCount; i++) {
      if (sim.x[i] > size.width) continue;
      for (var j = 0; j < _matrixTrailLength; j++) {
        final gy = sim.y[i] - j * _lineHeight;
        if (gy < -_lineHeight || gy > size.height + _lineHeight) continue;
        final glyph = String.fromCharCode('0'.codeUnitAt(0) + _matrixRandom.nextInt(10));
        final painter = TextPainter(
          text: TextSpan(text: glyph, style: trailStyles[j]),
          textDirection: TextDirection.ltr,
        )..layout();
        painter.paint(canvas, Offset(sim.x[i], gy));
      }
    }
  }

  TextStyle _matrixTextStyle(Color color) =>
      TextStyle(color: color, fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 14, height: 1.0);

  @override
  bool shouldRepaint(covariant _ParticlePainter oldDelegate) => true;
}
