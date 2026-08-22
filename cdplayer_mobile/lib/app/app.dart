import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/library/dev_library_loader.dart';
import '../core/library/library_controller.dart';
import '../core/library/library_state.dart';
import '../features/library/library_picker_screen.dart';
import '../features/now_playing/now_playing_screen.dart';
import '../features/queue/player_controller.dart';

/// Waits for settings to load, then seeds Phase 1's dev test library into
/// the app's Documents directory — no longer fed straight into the queue
/// (see [LibraryController]), but kept around as a real, pickable folder so
/// the actual folder-picker flow (Files > On My iPhone > CDPlayer >
/// dev_test_library on iOS) has something to select during development,
/// without needing a real personal music library on hand.
final bootstrapProvider = FutureProvider<void>((ref) async {
  await ref.watch(settingsStoreProvider.future);
  await DevLibraryLoader.loadDevLibrary();
});

class CDPlayerApp extends ConsumerWidget {
  const CDPlayerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'CDPlayer',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: const Color(0xFF15161B),
        colorScheme: ThemeData.dark(useMaterial3: true).colorScheme.copyWith(
              primary: const Color(0xFFE8563C),
              secondary: const Color(0xFFE8563C),
            ),
      ),
      home: const _Bootstrapper(),
    );
  }
}

class _Bootstrapper extends ConsumerWidget {
  const _Bootstrapper();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bootstrap = ref.watch(bootstrapProvider);
    return bootstrap.when(
      data: (_) => const _LibraryGate(),
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (error, stack) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('Failed to start: $error', textAlign: TextAlign.center),
          ),
        ),
      ),
    );
  }
}

/// Routes to the folder picker or the now-playing screen depending on
/// whether a valid, scanned music folder is available yet (see
/// [LibraryController] for how "valid" is determined, including the iOS
/// re-validate-on-launch behavior).
class _LibraryGate extends ConsumerWidget {
  const _LibraryGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final libraryState = ref.watch(libraryControllerProvider);
    return switch (libraryState.status) {
      LibraryStatus.ready => const NowPlayingScreen(),
      LibraryStatus.idle || LibraryStatus.scanning => const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      LibraryStatus.needsFolder || LibraryStatus.error => const LibraryPickerScreen(),
    };
  }
}
