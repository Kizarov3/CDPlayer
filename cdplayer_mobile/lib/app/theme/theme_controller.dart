import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'palette.dart';

/// Selected theme index into [kThemes] — mirrors desktop's
/// `currentThemeIndex` (`CDPlayer.java:1263` etc.). No color-lerp animation
/// yet (desktop's `animateThemeColors`); switching is instant for now.
class ThemeController extends StateNotifier<int> {
  ThemeController() : super(0);

  CDPalette get palette => kThemes[state];

  void select(int index) {
    if (index < 0 || index >= kThemes.length) return;
    state = index;
  }
}

final themeControllerProvider = StateNotifierProvider<ThemeController, int>((ref) => ThemeController());

final currentPaletteProvider = Provider<CDPalette>((ref) => kThemes[ref.watch(themeControllerProvider)]);
