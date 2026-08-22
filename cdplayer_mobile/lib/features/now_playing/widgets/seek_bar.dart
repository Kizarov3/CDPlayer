import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/palette.dart';
import '../../queue/player_controller.dart';

String _format(Duration d) {
  final minutes = d.inMinutes;
  final seconds = d.inSeconds % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}

/// Drag-to-seek slider mirroring desktop's `progress`/`adjusting` pattern:
/// while the user is dragging, local state (not the live position stream)
/// drives the thumb, so the stream's own updates don't fight the drag.
class SeekBar extends ConsumerStatefulWidget {
  const SeekBar({super.key, required this.palette});

  final CDPalette palette;

  @override
  ConsumerState<SeekBar> createState() => _SeekBarState();
}

class _SeekBarState extends ConsumerState<SeekBar> {
  double? _dragValue;

  @override
  Widget build(BuildContext context) {
    final playerState = ref.watch(playerControllerProvider);
    final durationMs = playerState.duration.inMilliseconds;
    final positionMs = playerState.position.inMilliseconds.clamp(0, durationMs == 0 ? 1 : durationMs);
    final sliderValue = _dragValue ?? (durationMs == 0 ? 0.0 : positionMs / durationMs);

    return Column(
      children: [
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            trackHeight: 3,
            thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
            overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
            activeTrackColor: widget.palette.accent,
            thumbColor: widget.palette.accent,
            inactiveTrackColor: widget.palette.card,
          ),
          child: Slider(
            value: sliderValue.clamp(0.0, 1.0),
            onChanged: durationMs == 0 ? null : (v) => setState(() => _dragValue = v),
            onChangeEnd: durationMs == 0
                ? null
                : (v) {
                    final target = Duration(milliseconds: (durationMs * v).round());
                    ref.read(playerControllerProvider.notifier).seekTo(target);
                    setState(() => _dragValue = null);
                  },
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(_format(playerState.position), style: TextStyle(color: widget.palette.muted, fontSize: 12)),
              Text(_format(playerState.duration), style: TextStyle(color: widget.palette.muted, fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }
}
