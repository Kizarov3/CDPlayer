import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../../app/theme/palette.dart';

/// The rotating disc, with the track's cover art composited onto its face —
/// port of desktop's `DiscView.renderDiscFace()`/`paintComponent()`
/// (`CDPlayer.java:5684-5841`): gradient body (accent → accent2), concentric
/// grooves, a reflective highlight arc, the cover art filling the full disc
/// face (see desktop's "100% fill" note — same design here, no separate
/// small label chip), and a spindle hole in the background color.
///
/// Desktop caches the rendered face as a bitmap and only rebuilds it on an
/// actual size/color/cover change (`discFaceCache`), redrawing it through a
/// rotation transform every spin frame instead of repainting from scratch.
/// Flutter's `Canvas.drawImage`-based `CustomPainter` here does the
/// equivalent implicitly: the cover art is decoded to a `ui.Image` once (see
/// `_SpinningDiscState._decodeCover`) and the gradient/grooves/arc are cheap
/// vector draws Skia handles well per-frame, so no separate offscreen-bitmap
/// cache is needed to hit 60fps — simpler than the desktop's cache, not a
/// missing optimization.
class SpinningDisc extends StatefulWidget {
  const SpinningDisc({
    super.key,
    required this.palette,
    required this.coverArt,
    required this.spinning,
    this.size = 260,
  });

  final CDPalette palette;
  final Uint8List? coverArt;
  final bool spinning;
  final double size;

  @override
  State<SpinningDisc> createState() => _SpinningDiscState();
}

class _SpinningDiscState extends State<SpinningDisc> with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  double _angle = 0;
  Duration _lastElapsed = Duration.zero;
  ui.Image? _coverImage;
  Uint8List? _decodedFrom;

  // Matches desktop's `motion` Timer exactly: angle += .045 rad every 16ms tick (CDPlayer.java:5588).
  static const _radiansPerMs = 0.045 / 16;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker(_onTick)..start();
    _decodeCover();
  }

  @override
  void didUpdateWidget(covariant SpinningDisc oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.coverArt != widget.coverArt) _decodeCover();
  }

  Future<void> _decodeCover() async {
    final bytes = widget.coverArt;
    if (bytes == null) {
      setState(() {
        _coverImage = null;
        _decodedFrom = null;
      });
      return;
    }
    if (identical(bytes, _decodedFrom)) return;
    final codec = await ui.instantiateImageCodec(bytes, targetWidth: 600);
    final frame = await codec.getNextFrame();
    if (!mounted) return;
    setState(() {
      _coverImage = frame.image;
      _decodedFrom = bytes;
    });
  }

  void _onTick(Duration elapsed) {
    if (!widget.spinning) {
      _lastElapsed = elapsed;
      return;
    }
    final deltaMs = (elapsed - _lastElapsed).inMicroseconds / 1000.0;
    _lastElapsed = elapsed;
    setState(() => _angle += _radiansPerMs * deltaMs);
  }

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(
        size: Size.square(widget.size),
        painter: _DiscPainter(
          angle: _angle,
          palette: widget.palette,
          cover: _coverImage,
        ),
      ),
    );
  }
}

class _DiscPainter extends CustomPainter {
  _DiscPainter({required this.angle, required this.palette, required this.cover});

  final double angle;
  final CDPalette palette;
  final ui.Image? cover;

  @override
  void paint(Canvas canvas, Size size) {
    final side = min(size.width, size.height);
    final center = Offset(size.width / 2, size.height / 2);

    // Soft drop shadow beneath the disc (CDPlayer.java:5823-5824).
    canvas.drawOval(
      Rect.fromCenter(center: center + const Offset(0, 6), width: side, height: side),
      Paint()..color = const Color.fromARGB(110, 0, 0, 0),
    );

    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.rotate(angle);
    canvas.translate(-center.dx, -center.dy);

    final discRect = Rect.fromCenter(center: center, width: side, height: side);

    // Gradient body (CDPlayer.java:5692-5693).
    final gradientPaint = Paint()
      ..shader = ui.Gradient.linear(
        discRect.topLeft,
        discRect.bottomRight,
        [palette.accent, palette.accent2],
      );
    canvas.drawOval(discRect, gradientPaint);

    // Concentric grooves (CDPlayer.java:5696-5698).
    final groovePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = const Color.fromARGB(22, 255, 255, 255);
    for (var r = side / 2 - 16; r > side / 6; r -= 18) {
      canvas.drawOval(Rect.fromCircle(center: center, radius: r), groovePaint);
    }

    // Reflective highlight arc (CDPlayer.java:5700-5703).
    final archRect = Rect.fromLTWH(side / 12, side / 12, side * 5 / 6, side * 5 / 6);
    final arcPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = max(2, side / 110)
      ..strokeCap = StrokeCap.round
      ..color = const Color.fromARGB(55, 255, 255, 255);
    canvas.drawArc(archRect, _degToRad(200), _degToRad(80), false, arcPaint);

    // Center label — the cover art fills the full disc face (CDPlayer.java:5710, "100% fill" note).
    final labelPaint = Paint()..color = const Color.fromARGB(255, 20, 21, 28);
    canvas.drawOval(discRect, labelPaint);
    if (cover != null) {
      canvas.save();
      canvas.clipPath(Path()..addOval(discRect));
      paintImage(canvas: canvas, rect: discRect, image: cover!, fit: BoxFit.cover);
      canvas.restore();
    } else {
      // "♪" fallback when no cover art is loaded (CDPlayer.java:5726-5729).
      final painter = TextPainter(
        text: TextSpan(
          text: '♪',
          style: TextStyle(color: const Color.fromARGB(55, 255, 255, 255), fontSize: side / 3),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      painter.paint(canvas, center - Offset(painter.width / 2, painter.height / 2));
    }
    canvas.drawOval(
      discRect,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = const Color.fromARGB(45, 255, 255, 255),
    );

    // Spindle hole (CDPlayer.java:5734-5736).
    final holeRadius = side / 22;
    canvas.drawCircle(center, holeRadius, Paint()..color = palette.bg);
    canvas.drawCircle(
      center,
      holeRadius,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = const Color.fromARGB(60, 255, 255, 255),
    );

    canvas.restore();
  }

  double _degToRad(double deg) => deg * pi / 180;

  @override
  bool shouldRepaint(covariant _DiscPainter oldDelegate) =>
      oldDelegate.angle != angle || oldDelegate.palette != palette || oldDelegate.cover != cover;
}
