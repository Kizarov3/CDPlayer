import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;
import 'package:path_provider/path_provider.dart';

import '../../shared/models/track.dart';
import 'tag_reader.dart';

/// Phase 1 stand-in for real library access (SAF on Android, document
/// picker + security-scoped bookmarks on iOS — see Phase 3 in the plan).
///
/// Both `just_audio` and `flutter_taglib` need a real filesystem path, not a
/// Flutter asset bundle key, so this copies the bundled dev test files
/// (`dev_test_library/`) into the app's documents directory once, then reads
/// each one back through [TagReader] exactly the way Phase 3's real
/// picker-backed files will be read.
class DevLibraryLoader {
  static const _assetPaths = [
    'dev_test_library/track1.mp3',
    'dev_test_library/track2.flac',
    'dev_test_library/track3.m4a',
    'dev_test_library/track4.wav',
  ];

  static Future<List<Track>> loadDevLibrary() async {
    final docsDir = await getApplicationDocumentsDirectory();
    final libraryDir = Directory('${docsDir.path}/dev_test_library');
    if (!await libraryDir.exists()) {
      await libraryDir.create(recursive: true);
    }

    final tracks = <Track>[];
    for (final assetPath in _assetPaths) {
      final fileName = assetPath.split('/').last;
      final destFile = File('${libraryDir.path}/$fileName');
      if (!await destFile.exists()) {
        final bytes = await rootBundle.load(assetPath);
        await destFile.writeAsBytes(bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes));
      }
      tracks.add(TagReader.readTrack(destFile.path));
    }
    return tracks;
  }
}
