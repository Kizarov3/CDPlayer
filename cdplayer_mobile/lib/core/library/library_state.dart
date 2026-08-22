import '../../shared/models/track.dart';

enum LibraryStatus { idle, scanning, ready, needsFolder, error }

class LibraryState {
  const LibraryState({
    this.status = LibraryStatus.idle,
    this.folderPath,
    this.tracks = const [],
    this.errorMessage,
    this.searchQuery = '',
  });

  final LibraryStatus status;
  final String? folderPath;
  final List<Track> tracks;
  final String? errorMessage;
  final String searchQuery;

  List<Track> get filteredTracks {
    if (searchQuery.trim().isEmpty) return tracks;
    final q = searchQuery.toLowerCase();
    return tracks
        .where((t) => t.displayTitle.toLowerCase().contains(q) || (t.artist?.toLowerCase().contains(q) ?? false))
        .toList();
  }

  LibraryState copyWith({
    LibraryStatus? status,
    String? folderPath,
    List<Track>? tracks,
    String? errorMessage,
    bool clearError = false,
    String? searchQuery,
  }) {
    return LibraryState(
      status: status ?? this.status,
      folderPath: folderPath ?? this.folderPath,
      tracks: tracks ?? this.tracks,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      searchQuery: searchQuery ?? this.searchQuery,
    );
  }
}
