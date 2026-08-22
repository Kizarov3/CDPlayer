import 'dart:typed_data';

/// A single playable track. Mirrors the desktop app's per-file metadata
/// (title/artist/album + embedded cover art), read via [TagReader] instead
/// of desktop's `ffprobe`/`ffmpeg` shell-outs.
class Track {
  const Track({
    required this.id,
    required this.filePath,
    required this.title,
    this.artist,
    this.album,
    this.coverArt,
    this.durationMs,
  });

  /// Stable identity for this track — currently the file path, since Phase 1
  /// loads from a fixed dev folder. Phase 3's SAF/bookmark-backed access may
  /// need a different stable id once files are referenced by content URI.
  final String id;
  final String filePath;
  final String title;
  final String? artist;
  final String? album;
  final Uint8List? coverArt;
  final int? durationMs;

  String get displayTitle => title.trim().isNotEmpty ? title : filePath.split('/').last;

  Track copyWith({int? durationMs}) => Track(
        id: id,
        filePath: filePath,
        title: title,
        artist: artist,
        album: album,
        coverArt: coverArt,
        durationMs: durationMs ?? this.durationMs,
      );
}
