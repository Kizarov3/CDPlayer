import 'dart:io';

import 'package:flutter_taglib/flutter_taglib.dart';

import '../../shared/models/track.dart';

/// Reads title/artist/album/embedded-cover-art from a local audio file,
/// replacing desktop's `ffprobe`/`ffmpeg`-based metadata extraction (mobile
/// can't shell out to arbitrary binaries).
///
/// Phase 1's bake-off pick: `flutter_taglib` (TagLib via FFI/native assets).
/// If format coverage gaps show up against a real mixed-format library,
/// `metadata_god` is the planned fallback — this class is the seam to swap
/// the implementation behind without touching call sites.
class TagReader {
  static Track readTrack(String filePath) {
    final fallbackTitle = filePath.split(Platform.pathSeparator).last;
    if (!TagLibFile.isSupported) {
      return Track(id: filePath, filePath: filePath, title: fallbackTitle);
    }
    final file = TagLibFile.open(filePath);
    if (file == null) {
      return Track(id: filePath, filePath: filePath, title: fallbackTitle);
    }
    try {
      final title = file.title.trim();
      final artist = file.artist.trim();
      final album = file.album.trim();
      return Track(
        id: filePath,
        filePath: filePath,
        title: title.isNotEmpty ? title : fallbackTitle,
        artist: artist.isEmpty ? null : artist,
        album: album.isEmpty ? null : album,
        coverArt: file.hasCover ? file.coverData : null,
        durationMs: file.duration.inMilliseconds > 0 ? file.duration.inMilliseconds : null,
      );
    } finally {
      file.close();
    }
  }
}
