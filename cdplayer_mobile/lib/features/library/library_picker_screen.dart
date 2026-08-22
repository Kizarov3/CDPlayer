import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/library/library_controller.dart';
import '../../core/library/library_state.dart';

/// Shown at startup when no music folder is picked yet, or when a
/// previously-saved one no longer grants access (see
/// `LibraryController`'s doc comment on iOS's lack of a persisted
/// security-scoped bookmark) — the mobile equivalent of desktop's free
/// filesystem walk, which never needed an explicit "choose a folder" step.
class LibraryPickerScreen extends ConsumerWidget {
  const LibraryPickerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(libraryControllerProvider);
    final scanning = state.status == LibraryStatus.scanning;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.folder_open, size: 72, color: Colors.grey),
                const SizedBox(height: 24),
                Text(
                  'CDPlayer',
                  style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'Choose a folder with your music (WAV, AIFF, AU, FLAC, M4A, MP3) to get started.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.grey),
                  textAlign: TextAlign.center,
                ),
                if (state.errorMessage != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    state.errorMessage!,
                    style: const TextStyle(color: Colors.orangeAccent),
                    textAlign: TextAlign.center,
                  ),
                ],
                const SizedBox(height: 28),
                FilledButton.icon(
                  onPressed: scanning ? null : () => ref.read(libraryControllerProvider.notifier).pickFolder(),
                  icon: scanning
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.folder_open),
                  label: Text(scanning ? 'Scanning…' : 'Choose Music Folder'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
