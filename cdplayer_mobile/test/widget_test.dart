// Phase 1 smoke test. The real bootstrap (settings + dev library load) goes
// through platform channels (shared_preferences, path_provider, the
// flutter_taglib FFI bridge) that aren't wired up in a plain `flutter test`
// run, so this only asserts the widget tree builds and starts the bootstrap
// without throwing — end-to-end verification happens in the iOS Simulator
// (see the plan's verification section), not here.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cdplayer_mobile/app/app.dart';

void main() {
  testWidgets('App renders a loading state without throwing', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: CDPlayerApp()));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
