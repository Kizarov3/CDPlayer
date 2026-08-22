import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/palette.dart';
import '../../app/theme/theme_controller.dart';

/// Theme picker sheet — port of desktop's theme dropdown menu
/// (`showThemeMenu`/`ThemeMenuOverlay`), listing all of [kThemes].
void showThemePicker(BuildContext context) {
  showModalBottomSheet(
    context: context,
    backgroundColor: const Color(0xFF1B1C22),
    builder: (context) => const _ThemePickerSheet(),
  );
}

class _ThemePickerSheet extends ConsumerWidget {
  const _ThemePickerSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedIndex = ref.watch(themeControllerProvider);
    return SafeArea(
      child: ListView.builder(
        shrinkWrap: true,
        itemCount: kThemes.length,
        itemBuilder: (context, index) {
          final theme = kThemes[index];
          final selected = index == selectedIndex;
          return ListTile(
            leading: CircleAvatar(backgroundColor: theme.accent, radius: 10),
            title: Text(theme.name),
            trailing: selected ? Icon(Icons.check, color: theme.accent) : null,
            onTap: () {
              ref.read(themeControllerProvider.notifier).select(index);
              Navigator.of(context).pop();
            },
          );
        },
      ),
    );
  }
}
