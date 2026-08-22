import 'dart:async';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart' show ProcessingState;

import '../../core/audio/playback_engine.dart';
import '../../core/persistence/settings_store.dart';
import '../../shared/models/track.dart';
import 'player_state.dart';

/// Owns the [PlaybackEngine], the queue, and shuffle/repeat — the mobile
/// equivalent of desktop's scattered `player`/queue fields and `tick()`/
/// `trackFinished()` methods, folded into one Riverpod [StateNotifier] so
/// the now-playing UI, queue screen, and (later) the persistent mini-player
/// bar can all subscribe to the same state.
class PlayerController extends StateNotifier<PlayerState> {
  PlayerController(this._settings) : super(const PlayerState()) {
    _positionSub = _engine.positionStream.listen((p) => state = state.copyWith(position: p));
    _durationSub = _engine.durationStream.listen((d) => state = state.copyWith(duration: d ?? Duration.zero));
    _playingSub = _engine.playingStream.listen((p) => state = state.copyWith(playing: p));
    _processingSub = _engine.processingStateStream.listen((processingState) {
      if (processingState == ProcessingState.completed) _handleTrackFinished();
    });
    state = state.copyWith(volume: _settings.volume);
  }

  final SettingsStore _settings;
  final PlaybackEngine _engine = PlaybackEngine();
  final _random = Random();

  late final StreamSubscription<Duration> _positionSub;
  late final StreamSubscription<Duration?> _durationSub;
  late final StreamSubscription<bool> _playingSub;
  late final StreamSubscription<ProcessingState> _processingSub;

  /// Replaces the whole queue (e.g. after the dev/real library loads) and
  /// starts loaded-but-paused on the track matching [settings.lastTrackId]
  /// if it's still present, otherwise the first track — mirrors desktop's
  /// `restoreQueueState()` picking up where the last session left off.
  Future<void> setQueue(List<Track> tracks) async {
    if (tracks.isEmpty) {
      state = state.copyWith(queue: tracks, currentIndex: -1);
      return;
    }
    final lastId = _settings.lastTrackId;
    final restoredIndex = lastId == null ? -1 : tracks.indexWhere((t) => t.id == lastId);
    final startIndex = restoredIndex >= 0 ? restoredIndex : 0;
    state = state.copyWith(queue: tracks, currentIndex: startIndex);
    await _loadCurrent(autoplay: false);
  }

  Future<void> playAt(int index) async {
    if (index < 0 || index >= state.queue.length) return;
    state = state.copyWith(currentIndex: index);
    await _loadCurrent(autoplay: true);
  }

  Future<void> togglePlayPause() async {
    if (state.currentTrack == null) return;
    if (state.playing) {
      await _engine.pause();
    } else {
      await _engine.play();
    }
  }

  Future<void> next() async {
    if (!state.hasNext) return;
    state = state.copyWith(currentIndex: _nextIndex());
    await _loadCurrent(autoplay: true);
  }

  Future<void> previous() async {
    if (!state.hasPrevious) return;
    // Restart the current track instead of skipping back once meaningfully
    // into it — same "restart vs. skip back" convention as most players and
    // as desktop's own previous-track button.
    if (state.position > const Duration(seconds: 3)) {
      await _engine.seek(Duration.zero);
      return;
    }
    state = state.copyWith(currentIndex: _previousIndex());
    await _loadCurrent(autoplay: true);
  }

  Future<void> seekTo(Duration position) => _engine.seek(position);

  Future<void> setVolume(double volume) async {
    state = state.copyWith(volume: volume);
    await _engine.setVolume(volume);
    await _settings.setVolume(volume);
  }

  void toggleShuffle() => state = state.copyWith(shuffleEnabled: !state.shuffleEnabled);

  void cycleRepeat() {
    final next = switch (state.repeatMode) {
      QueueRepeatMode.off => QueueRepeatMode.all,
      QueueRepeatMode.all => QueueRepeatMode.one,
      QueueRepeatMode.one => QueueRepeatMode.off,
    };
    state = state.copyWith(repeatMode: next);
  }

  Future<void> _loadCurrent({required bool autoplay}) async {
    final track = state.currentTrack;
    if (track == null) return;
    state = state.copyWith(isLoading: true);
    await _engine.load(track.filePath);
    await _engine.setVolume(state.volume);
    await _settings.setLastTrackId(track.id);
    state = state.copyWith(isLoading: false);
    if (autoplay) await _engine.play();
  }

  Future<void> _handleTrackFinished() async {
    if (state.repeatMode == QueueRepeatMode.one) {
      await _engine.seek(Duration.zero);
      await _engine.play();
      return;
    }
    if (state.hasNext) {
      state = state.copyWith(currentIndex: _nextIndex());
      await _loadCurrent(autoplay: true);
    } else {
      await _engine.pause();
      await _engine.seek(Duration.zero);
    }
  }

  int _nextIndex() {
    if (state.queue.isEmpty) return -1;
    if (state.shuffleEnabled && state.queue.length > 1) {
      int candidate;
      do {
        candidate = _random.nextInt(state.queue.length);
      } while (candidate == state.currentIndex);
      return candidate;
    }
    final atEnd = state.currentIndex >= state.queue.length - 1;
    if (atEnd) return state.repeatMode == QueueRepeatMode.all ? 0 : state.currentIndex;
    return state.currentIndex + 1;
  }

  int _previousIndex() {
    if (state.queue.isEmpty) return -1;
    if (state.shuffleEnabled && state.queue.length > 1) {
      int candidate;
      do {
        candidate = _random.nextInt(state.queue.length);
      } while (candidate == state.currentIndex);
      return candidate;
    }
    final atStart = state.currentIndex <= 0;
    if (atStart) return state.repeatMode == QueueRepeatMode.all ? state.queue.length - 1 : 0;
    return state.currentIndex - 1;
  }

  @override
  void dispose() {
    _positionSub.cancel();
    _durationSub.cancel();
    _playingSub.cancel();
    _processingSub.cancel();
    _engine.dispose();
    super.dispose();
  }
}

final settingsStoreProvider = FutureProvider<SettingsStore>((ref) => SettingsStore.load());

final playerControllerProvider = StateNotifierProvider<PlayerController, PlayerState>((ref) {
  final settings = ref.watch(settingsStoreProvider).requireValue;
  return PlayerController(settings);
});
