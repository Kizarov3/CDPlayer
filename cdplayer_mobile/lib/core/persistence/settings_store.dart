import 'package:shared_preferences/shared_preferences.dart';

/// Flat key-value settings persistence — the mobile equivalent of desktop's
/// `~/.cdplayer/settings.txt`. Phase 1 only needs volume and the last-played
/// track id; later phases (theme, EQ gains, crossfade seconds, Mini Mode's
/// replacement state, etc.) add keys here rather than introducing a second
/// persistence mechanism.
class SettingsStore {
  SettingsStore(this._prefs);

  static Future<SettingsStore> load() async {
    final prefs = await SharedPreferences.getInstance();
    return SettingsStore(prefs);
  }

  final SharedPreferences _prefs;

  static const _volumeKey = 'volume';
  static const _lastTrackIdKey = 'last_track_id';

  double get volume => _prefs.getDouble(_volumeKey) ?? 1.0;
  Future<void> setVolume(double value) => _prefs.setDouble(_volumeKey, value);

  String? get lastTrackId => _prefs.getString(_lastTrackIdKey);
  Future<void> setLastTrackId(String? id) =>
      id == null ? _prefs.remove(_lastTrackIdKey) : _prefs.setString(_lastTrackIdKey, id);
}
