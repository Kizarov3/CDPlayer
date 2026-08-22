import 'package:just_audio/just_audio.dart';

/// Thin wrapper around a single `just_audio` [AudioPlayer].
///
/// Deliberately kept single-player and single-purpose for Phase 1 (load one
/// file, play/pause/seek/volume, report position/duration/completion) rather
/// than folding in queue or crossfade concerns here — Phase 4's crossfade
/// controller will own a *second* [PlaybackEngine] instance and cross-fade
/// between the two, and the queue lives in its own controller (see
/// `features/queue/queue_controller.dart`) that calls into this class one
/// track at a time. Keeping this class single-file-scoped now means Phase 4
/// composes two of these instead of having to carve single-player
/// assumptions out of a more tangled class later.
class PlaybackEngine {
  PlaybackEngine() : _player = AudioPlayer();

  final AudioPlayer _player;

  Stream<Duration> get positionStream => _player.positionStream;
  Stream<Duration?> get durationStream => _player.durationStream;
  Stream<bool> get playingStream => _player.playerStateStream.map((s) => s.playing);
  Stream<ProcessingState> get processingStateStream => _player.processingStateStream;

  bool get playing => _player.playing;
  Duration get position => _player.position;
  Duration? get duration => _player.duration;

  Future<Duration?> load(String filePath) => _player.setFilePath(filePath);

  Future<void> play() => _player.play();

  Future<void> pause() => _player.pause();

  Future<void> seek(Duration position) => _player.seek(position);

  /// 0.0-1.0, matching desktop's volume slider range (see `CDPlayer.java`'s
  /// `volumeSlider`, 0-100 there — the queue controller's UI layer is
  /// responsible for that /100 conversion, not this class).
  Future<void> setVolume(double volume) => _player.setVolume(volume.clamp(0.0, 1.0));

  Future<void> dispose() => _player.dispose();
}
