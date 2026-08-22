import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/particle_mode_provider.dart';
import '../../app/theme/theme_controller.dart';
import '../now_playing/widgets/spinning_disc.dart';
import '../queue/player_controller.dart';
import '../themes_gallery/particles/particle_field.dart';

/// Full-screen, distraction-free mode: nothing but a large spinning disc and
/// the track's title/artist — port of desktop's CD View
/// (`toggleCdView`/`applyCdViewState`, `CDPlayer.java`), sized proportionally
/// to the phone screen rather than desktop's fixed 640px cap.
class CdViewScreen extends ConsumerWidget {
  const CdViewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playerState = ref.watch(playerControllerProvider);
    final palette = ref.watch(currentPaletteProvider);
    final particleMode = ref.watch(particleModeProvider);
    final track = playerState.currentTrack;
    final discSize = MediaQuery.of(context).size.shortestSide * 0.78;

    return Scaffold(
      backgroundColor: palette.bg,
      body: Stack(
        children: [
          Positioned.fill(child: ParticleField(mode: particleMode, accent: palette.accent)),
          SafeArea(
            child: Column(
              children: [
                Align(
                  alignment: Alignment.topRight,
                  child: IconButton(
                    icon: Icon(Icons.close, color: palette.muted),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
                Expanded(
                  child: Center(
                    child: SpinningDisc(
                      palette: palette,
                      coverArt: track?.coverArt,
                      spinning: playerState.playing,
                      size: discSize,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(bottom: 32),
                  child: Column(
                    children: [
                      Text(
                        track?.displayTitle ?? '',
                        style: TextStyle(color: palette.text, fontSize: 20, fontWeight: FontWeight.w600),
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        track?.artist ?? '',
                        style: TextStyle(color: palette.muted, fontSize: 14),
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
