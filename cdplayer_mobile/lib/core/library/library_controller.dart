import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/queue/player_controller.dart';
import '../persistence/settings_store.dart';
import 'library_scanner.dart';
import 'library_state.dart';

/// Owns the user's picked music folder and the scanned library — replaces
/// Phase 1's hardcoded dev test library with real folder access (Android
/// Storage Access Framework, iOS document picker), both via `file_picker`'s
/// `getDirectoryPath()`.
///
/// Persisted-access note: Android's grant on the returned path is persisted
/// by the OS itself — `android_file_picker` (file_picker's Android backend)
/// already calls `ContentResolver.takePersistableUriPermission` internally,
/// so a saved path keeps working across app restarts with no extra code
/// here. iOS has no equivalent: `file_picker_darwin`'s directory picker
/// returns a security-scoped URL's path without creating a persistable
/// bookmark (no well-maintained Flutter package exposes iOS's
/// `URL.bookmarkData`/`resolvingBookmarkData` bookmark APIs at the time this
/// was written — see the plan's own note flagging this as uncertain). So on
/// iOS a saved folder is only a *hint*: this always re-validates it by
/// actually trying to scan, and falls back to prompting the user to
/// re-select if that comes back empty, rather than assuming silent access
/// like desktop's plain filesystem walk gets to.
class LibraryController extends StateNotifier<LibraryState> {
  LibraryController(this._ref, this._settings) : super(const LibraryState()) {
    _init();
  }

  final Ref _ref;
  final SettingsStore _settings;

  Future<void> _init() async {
    final savedPath = _settings.libraryFolderPath;
    if (savedPath == null) {
      state = state.copyWith(status: LibraryStatus.needsFolder);
      return;
    }
    await _scan(savedPath);
  }

  Future<void> pickFolder() async {
    final path = await FilePicker.getDirectoryPath(dialogTitle: 'Choose your music folder');
    if (path == null) return; // user cancelled
    await _settings.setLibraryFolderPath(path);
    await _scan(path);
  }

  Future<void> rescan() async {
    final path = state.folderPath ?? _settings.libraryFolderPath;
    if (path != null) await _scan(path);
  }

  Future<void> _scan(String path) async {
    state = state.copyWith(status: LibraryStatus.scanning, folderPath: path, clearError: true);
    final tracks = await LibraryScanner.scan(path);
    if (tracks.isEmpty) {
      // Either a genuinely empty folder or (on iOS) a stale security-scoped grant from a previous launch — see
      // this class's doc comment. Either way, the user needs to act (pick again / pick a folder with audio in
      // it), so this surfaces the same as "no folder chosen yet" rather than silently showing an empty library.
      state = state.copyWith(
        status: LibraryStatus.needsFolder,
        tracks: const [],
        errorMessage: 'No audio files found in that folder — it may need to be re-selected.',
      );
      return;
    }
    state = state.copyWith(status: LibraryStatus.ready, tracks: tracks);
    await _ref.read(playerControllerProvider.notifier).setQueue(tracks);
  }

  void setSearchQuery(String query) => state = state.copyWith(searchQuery: query);
}

final libraryControllerProvider = StateNotifierProvider<LibraryController, LibraryState>((ref) {
  final settings = ref.watch(settingsStoreProvider).requireValue;
  return LibraryController(ref, settings);
});
