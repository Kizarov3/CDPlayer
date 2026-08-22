import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/themes_gallery/particles/particle_mode.dart';
import 'theme_controller.dart';

/// Derives the active [ParticleMode] from the selected theme, shared between
/// the now-playing screen and CD View.
final particleModeProvider = Provider<ParticleMode>((ref) {
  final palette = ref.watch(currentPaletteProvider);
  return particleModeForTheme(palette.name);
});
