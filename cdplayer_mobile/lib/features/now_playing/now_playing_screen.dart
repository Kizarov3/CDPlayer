import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../queue/player_controller.dart';
import '../queue/player_state.dart';
import 'widgets/seek_bar.dart';

/// Phase 1's basic now-playing screen: cover art, title/artist, seek bar,
/// transport controls, volume, and the queue — no disc animation or themes
/// yet (those are Phase 2). Functionally mirrors desktop's `playerPanel()`.
class NowPlayingScreen extends ConsumerWidget {
  const NowPlayingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playerState = ref.watch(playerControllerProvider);
    final controller = ref.read(playerControllerProvider.notifier);
    final track = playerState.currentTrack;

    return Scaffold(
      appBar: AppBar(title: const Text('CDPlayer')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Center(
                child: _CoverArt(coverArt: track?.coverArt),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Column(
                children: [
                  Text(
                    track?.displayTitle ?? 'Nothing loaded',
                    style: Theme.of(context).textTheme.titleLarge,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    track?.artist ?? '',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.grey),
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const SeekBar(),
            _TransportControls(playerState: playerState, controller: controller),
            _VolumeRow(playerState: playerState, controller: controller),
            const Divider(height: 1),
            Expanded(
              flex: 2,
              child: _QueueList(playerState: playerState, controller: controller),
            ),
          ],
        ),
      ),
    );
  }
}

class _CoverArt extends StatelessWidget {
  const _CoverArt({required this.coverArt});
  final Uint8List? coverArt;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: 240,
        height: 240,
        child: coverArt != null
            ? Image.memory(coverArt!, fit: BoxFit.cover)
            : Container(
                color: const Color(0xFF23252C),
                child: const Icon(Icons.music_note, size: 64, color: Colors.white24),
              ),
      ),
    );
  }
}

class _TransportControls extends StatelessWidget {
  const _TransportControls({required this.playerState, required this.controller});
  final PlayerState playerState;
  final PlayerController controller;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconButton(
          iconSize: 28,
          icon: Icon(playerState.shuffleEnabled ? Icons.shuffle_on_outlined : Icons.shuffle),
          color: playerState.shuffleEnabled ? Theme.of(context).colorScheme.primary : null,
          onPressed: controller.toggleShuffle,
        ),
        IconButton(
          iconSize: 32,
          icon: const Icon(Icons.skip_previous),
          onPressed: playerState.hasPrevious || playerState.currentTrack != null ? controller.previous : null,
        ),
        IconButton(
          iconSize: 56,
          icon: Icon(playerState.playing ? Icons.pause_circle_filled : Icons.play_circle_filled),
          onPressed: playerState.currentTrack == null ? null : controller.togglePlayPause,
        ),
        IconButton(
          iconSize: 32,
          icon: const Icon(Icons.skip_next),
          onPressed: playerState.hasNext ? controller.next : null,
        ),
        IconButton(
          iconSize: 28,
          icon: Icon(switch (playerState.repeatMode) {
            QueueRepeatMode.off => Icons.repeat,
            QueueRepeatMode.all => Icons.repeat_on_outlined,
            QueueRepeatMode.one => Icons.repeat_one_on_outlined,
          }),
          color: playerState.repeatMode != QueueRepeatMode.off ? Theme.of(context).colorScheme.primary : null,
          onPressed: controller.cycleRepeat,
        ),
      ],
    );
  }
}

class _VolumeRow extends StatelessWidget {
  const _VolumeRow({required this.playerState, required this.controller});
  final PlayerState playerState;
  final PlayerController controller;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Row(
        children: [
          const Icon(Icons.volume_down, size: 18, color: Colors.grey),
          Expanded(
            child: Slider(
              value: playerState.volume.clamp(0.0, 1.0),
              onChanged: controller.setVolume,
            ),
          ),
          const Icon(Icons.volume_up, size: 18, color: Colors.grey),
        ],
      ),
    );
  }
}

class _QueueList extends StatelessWidget {
  const _QueueList({required this.playerState, required this.controller});
  final PlayerState playerState;
  final PlayerController controller;

  @override
  Widget build(BuildContext context) {
    if (playerState.queue.isEmpty) {
      return const Center(child: Text('Queue is empty', style: TextStyle(color: Colors.grey)));
    }
    return ListView.builder(
      itemCount: playerState.queue.length,
      itemBuilder: (context, index) {
        final track = playerState.queue[index];
        final isCurrent = index == playerState.currentIndex;
        return ListTile(
          selected: isCurrent,
          leading: Text('${index + 1}', style: const TextStyle(color: Colors.grey)),
          title: Text(
            track.displayTitle,
            style: TextStyle(color: isCurrent ? Theme.of(context).colorScheme.primary : null),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: track.artist == null ? null : Text(track.artist!, maxLines: 1, overflow: TextOverflow.ellipsis),
          onTap: () => controller.playAt(index),
        );
      },
    );
  }
}
