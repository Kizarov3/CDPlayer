import '../../shared/models/track.dart';

enum QueueRepeatMode { off, all, one }

/// Everything the now-playing UI and the queue screen need, in one
/// immutable snapshot — mirrors desktop's queue semantics (shuffle, repeat,
/// current index) but as Riverpod state instead of mutable Swing fields.
class PlayerState {
  const PlayerState({
    this.queue = const [],
    this.currentIndex = -1,
    this.shuffleEnabled = false,
    this.repeatMode = QueueRepeatMode.off,
    this.playing = false,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.volume = 1.0,
    this.isLoading = false,
  });

  final List<Track> queue;
  final int currentIndex;
  final bool shuffleEnabled;
  final QueueRepeatMode repeatMode;
  final bool playing;
  final Duration position;
  final Duration duration;
  final double volume;
  final bool isLoading;

  Track? get currentTrack =>
      currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  bool get hasNext => queue.isNotEmpty && (repeatMode != QueueRepeatMode.off || currentIndex < queue.length - 1);
  bool get hasPrevious => queue.isNotEmpty && (repeatMode != QueueRepeatMode.off || currentIndex > 0);

  PlayerState copyWith({
    List<Track>? queue,
    int? currentIndex,
    bool? shuffleEnabled,
    QueueRepeatMode? repeatMode,
    bool? playing,
    Duration? position,
    Duration? duration,
    double? volume,
    bool? isLoading,
  }) {
    return PlayerState(
      queue: queue ?? this.queue,
      currentIndex: currentIndex ?? this.currentIndex,
      shuffleEnabled: shuffleEnabled ?? this.shuffleEnabled,
      repeatMode: repeatMode ?? this.repeatMode,
      playing: playing ?? this.playing,
      position: position ?? this.position,
      duration: duration ?? this.duration,
      volume: volume ?? this.volume,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}
