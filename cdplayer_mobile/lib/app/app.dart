import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/library/dev_library_loader.dart';
import '../features/now_playing/now_playing_screen.dart';
import '../features/queue/player_controller.dart';

/// Waits for settings to load, then loads Phase 1's dev test library into
/// the queue — the one-time startup sequence, analogous to desktop's
/// `restoreSettingsState()` + `restoreQueueState()` pair run once at launch.
final bootstrapProvider = FutureProvider<void>((ref) async {
  await ref.watch(settingsStoreProvider.future);
  final tracks = await DevLibraryLoader.loadDevLibrary();
  await ref.read(playerControllerProvider.notifier).setQueue(tracks);
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
      data: (_) => const NowPlayingScreen(),
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
