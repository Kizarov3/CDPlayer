import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/palette.dart';
import '../../core/library/library_controller.dart';
import '../queue/player_controller.dart';

/// Search-as-you-type over the scanned library — port of desktop's search
/// field filtering (`refreshSearchResults`), minus the Spotify-link
/// branching (that's Phase 8). Tapping a result plays it, using the full
/// scanned library as the queue starting at that track.
class LibrarySearchScreen extends ConsumerStatefulWidget {
  const LibrarySearchScreen({super.key, required this.palette});

  final CDPalette palette;

  @override
  ConsumerState<LibrarySearchScreen> createState() => _LibrarySearchScreenState();
}

class _LibrarySearchScreenState extends ConsumerState<LibrarySearchScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = widget.palette;
    final libraryState = ref.watch(libraryControllerProvider);
    final results = libraryState.filteredTracks;

    return Scaffold(
      backgroundColor: palette.bg,
      appBar: AppBar(
        backgroundColor: palette.bg,
        title: TextField(
          controller: _controller,
          autofocus: true,
          style: TextStyle(color: palette.text),
          decoration: InputDecoration(
            hintText: 'Search your library',
            hintStyle: TextStyle(color: palette.muted),
            border: InputBorder.none,
          ),
          onChanged: (q) => ref.read(libraryControllerProvider.notifier).setSearchQuery(q),
        ),
      ),
      body: results.isEmpty
          ? Center(child: Text('No matches', style: TextStyle(color: palette.muted)))
          : ListView.builder(
              itemCount: results.length,
              itemBuilder: (context, index) {
                final track = results[index];
                return ListTile(
                  title: Text(track.displayTitle, style: TextStyle(color: palette.text), maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: track.artist == null
                      ? null
                      : Text(track.artist!, style: TextStyle(color: palette.muted), maxLines: 1, overflow: TextOverflow.ellipsis),
                  onTap: () {
                    final fullIndex = libraryState.tracks.indexWhere((t) => t.id == track.id);
                    if (fullIndex >= 0) ref.read(playerControllerProvider.notifier).playAt(fullIndex);
                    Navigator.of(context).pop();
                  },
                );
              },
            ),
    );
  }
}
