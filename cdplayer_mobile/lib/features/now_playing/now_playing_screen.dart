import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/palette.dart';
import '../../app/theme/particle_mode_provider.dart';
import '../../app/theme/theme_controller.dart';
import '../cd_view/cd_view_screen.dart';
import '../queue/player_controller.dart';
import '../queue/player_state.dart';
import '../themes_gallery/particles/particle_field.dart';
import '../themes_gallery/theme_picker.dart';
import 'widgets/seek_bar.dart';
import 'widgets/spinning_disc.dart';

/// Now-playing screen: spinning disc with cover art, particle theme
/// background, title/artist, seek bar, transport controls, volume, and the
/// queue. Functionally mirrors desktop's `playerPanel()` + `ThemeOverlay` +
/// `DiscView` combined into one screen.
class NowPlayingScreen extends ConsumerWidget {
  const NowPlayingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playerState = ref.watch(playerControllerProvider);
    final controller = ref.read(playerControllerProvider.notifier);
    final palette = ref.watch(currentPaletteProvider);
    final particleMode = ref.watch(particleModeProvider);
    final track = playerState.currentTrack;

    return Scaffold(
      backgroundColor: palette.bg,
      appBar: AppBar(
        backgroundColor: palette.bg,
        title: Text('CDPlayer', style: TextStyle(color: palette.text)),
        actions: [
          IconButton(
            icon: Icon(Icons.palette_outlined, color: palette.muted),
            tooltip: 'Theme',
            onPressed: () => showThemePicker(context),
          ),
          IconButton(
            icon: Icon(Icons.fullscreen, color: palette.muted),
            tooltip: 'CD View',
            onPressed: track == null
                ? null
                : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CdViewScreen())),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(child: ParticleField(mode: particleMode, accent: palette.accent)),
                  Center(
                    child: SpinningDisc(
                      palette: palette,
                      coverArt: track?.coverArt,
                      spinning: playerState.playing,
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Column(
                children: [
                  Text(
                    track?.displayTitle ?? 'Nothing loaded',
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
            const SizedBox(height: 12),
            SeekBar(palette: palette),
            _TransportControls(playerState: playerState, controller: controller, palette: palette),
            _VolumeRow(playerState: playerState, controller: controller, palette: palette),
            Divider(height: 1, color: palette.card),
            Expanded(
              flex: 2,
              child: _QueueList(playerState: playerState, controller: controller, palette: palette),
            ),
          ],
        ),
      ),
    );
  }
}

class _TransportControls extends StatelessWidget {
  const _TransportControls({required this.playerState, required this.controller, required this.palette});
  final PlayerState playerState;
  final PlayerController controller;
  final CDPalette palette;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconButton(
          iconSize: 28,
          icon: Icon(playerState.shuffleEnabled ? Icons.shuffle_on_outlined : Icons.shuffle),
          color: playerState.shuffleEnabled ? palette.accent : palette.muted,
          onPressed: controller.toggleShuffle,
        ),
        IconButton(
          iconSize: 32,
          icon: Icon(Icons.skip_previous, color: palette.text),
          onPressed: playerState.hasPrevious || playerState.currentTrack != null ? controller.previous : null,
        ),
        IconButton(
          iconSize: 56,
          icon: Icon(playerState.playing ? Icons.pause_circle_filled : Icons.play_circle_filled, color: palette.accent),
          onPressed: playerState.currentTrack == null ? null : controller.togglePlayPause,
        ),
        IconButton(
          iconSize: 32,
          icon: Icon(Icons.skip_next, color: palette.text),
          onPressed: playerState.hasNext ? controller.next : null,
        ),
        IconButton(
          iconSize: 28,
          icon: Icon(switch (playerState.repeatMode) {
            QueueRepeatMode.off => Icons.repeat,
            QueueRepeatMode.all => Icons.repeat_on_outlined,
            QueueRepeatMode.one => Icons.repeat_one_on_outlined,
          }),
          color: playerState.repeatMode != QueueRepeatMode.off ? palette.accent : palette.muted,
          onPressed: controller.cycleRepeat,
        ),
      ],
    );
  }
}

class _VolumeRow extends StatelessWidget {
  const _VolumeRow({required this.playerState, required this.controller, required this.palette});
  final PlayerState playerState;
  final PlayerController controller;
  final CDPalette palette;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Row(
        children: [
          Icon(Icons.volume_down, size: 18, color: palette.muted),
          Expanded(
            child: SliderTheme(
              data: SliderTheme.of(context).copyWith(activeTrackColor: palette.accent, thumbColor: palette.accent),
              child: Slider(
                value: playerState.volume.clamp(0.0, 1.0),
                onChanged: controller.setVolume,
              ),
            ),
          ),
          Icon(Icons.volume_up, size: 18, color: palette.muted),
        ],
      ),
    );
  }
}

class _QueueList extends StatelessWidget {
  const _QueueList({required this.playerState, required this.controller, required this.palette});
  final PlayerState playerState;
  final PlayerController controller;
  final CDPalette palette;

  @override
  Widget build(BuildContext context) {
    if (playerState.queue.isEmpty) {
      return Center(child: Text('Queue is empty', style: TextStyle(color: palette.muted)));
    }
    return ListView.builder(
      itemCount: playerState.queue.length,
      itemBuilder: (context, index) {
        final track = playerState.queue[index];
        final isCurrent = index == playerState.currentIndex;
        return ListTile(
          selected: isCurrent,
          leading: Text('${index + 1}', style: TextStyle(color: palette.muted)),
          title: Text(
            track.displayTitle,
            style: TextStyle(color: isCurrent ? palette.accent : palette.text),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: track.artist == null
              ? null
              : Text(track.artist!, style: TextStyle(color: palette.muted), maxLines: 1, overflow: TextOverflow.ellipsis),
          onTap: () => controller.playAt(index),
        );
      },
    );
  }
}
