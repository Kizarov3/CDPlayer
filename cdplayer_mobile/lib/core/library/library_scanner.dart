import 'dart:io';

import 'package:flutter/foundation.dart' show compute;

import '../../shared/models/track.dart';
import 'tag_reader.dart';

/// Recursively finds and reads every supported audio file under a
/// user-picked folder — port of desktop's `collectAudio`/`isSupportedAudio`
/// (`CDPlayer.java:2832-2833`), same extension set.
class LibraryScanner {
  static const _supportedExtensions = {'wav', 'wave', 'aif', 'aiff', 'au', 'flac', 'm4a', 'mp3'};

  static bool _isSupportedAudio(String path) {
    final dot = path.lastIndexOf('.');
    if (dot < 0) return false;
    return _supportedExtensions.contains(path.substring(dot + 1).toLowerCase());
  }

  /// Runs the (potentially slow, especially on a large library) recursive
  /// directory walk in a background isolate so it doesn't block the UI
  /// thread — mirrors desktop's own background-thread scan
  /// (`startLibraryScan`). Tag reading (see [TagReader]) happens back on the
  /// main isolate afterward: `flutter_taglib`'s FFI bridge isn't verified
  /// isolate-safe, so this keeps that part on the isolate it's known to
  /// work from rather than risking it inside `compute()`.
  static Future<List<Track>> scan(String rootPath) async {
    final paths = await compute(_walk, rootPath);
    paths.sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return [for (final path in paths) TagReader.readTrack(path)];
  }

  static List<String> _walk(String rootPath) {
    final root = Directory(rootPath);
    if (!root.existsSync()) return [];
    final found = <String>[];
    try {
      for (final entity in root.listSync(recursive: true, followLinks: false)) {
        if (entity is File && _isSupportedAudio(entity.path)) found.add(entity.path);
      }
    } on FileSystemException {
      // Access revoked (e.g. a stale iOS security-scoped grant after an app restart — see
      // LibraryController's doc comment) — surfaced to the caller as an empty result, same as "nothing found
      // here", since listSync can throw partway through rather than cleanly up front.
    }
    return found;
  }
}
