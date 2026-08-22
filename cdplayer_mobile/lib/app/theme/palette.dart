import 'package:flutter/material.dart';

/// A selectable color palette — direct port of desktop's `Theme` class and
/// `THEMES` array (`CDPlayer.java:68-83`). Six roles per theme: background,
/// card surface, accent (disc gradient start / primary controls), accent2
/// (disc gradient end / secondary highlight), text, and muted (secondary
/// text/icons).
class CDPalette {
  const CDPalette({
    required this.name,
    required this.bg,
    required this.card,
    required this.accent,
    required this.accent2,
    required this.text,
    required this.muted,
  });

  final String name;
  final Color bg;
  final Color card;
  final Color accent;
  final Color accent2;
  final Color text;
  final Color muted;
}

/// Ported 1:1 from `CDPlayer.java`'s `THEMES` array. AUTO is a placeholder
/// palette here — desktop derives AUTO's real colors from the current
/// track's cover art (`deriveAutoTheme`); that derivation isn't ported yet,
/// so AUTO currently just shows this neutral placeholder rather than an
/// accurate cover-art-derived palette.
const List<CDPalette> kThemes = [
  CDPalette(
    name: 'RED',
    bg: Color.fromARGB(255, 17, 17, 19),
    card: Color.fromARGB(255, 31, 31, 34),
    accent: Color.fromARGB(255, 196, 20, 28),
    accent2: Color.fromARGB(255, 180, 186, 194),
    text: Color.fromARGB(255, 232, 233, 236),
    muted: Color.fromARGB(255, 138, 142, 148),
  ),
  CDPalette(
    name: 'BLUE',
    bg: Color.fromARGB(255, 6, 10, 22),
    card: Color.fromARGB(255, 13, 19, 36),
    accent: Color.fromARGB(255, 46, 116, 255),
    accent2: Color.fromARGB(255, 150, 210, 255),
    text: Color.fromARGB(255, 232, 240, 250),
    muted: Color.fromARGB(255, 120, 134, 160),
  ),
  CDPalette(
    name: 'SUNSET',
    bg: Color.fromARGB(255, 24, 15, 18),
    card: Color.fromARGB(255, 38, 24, 28),
    accent: Color.fromARGB(255, 255, 106, 61),
    accent2: Color.fromARGB(255, 255, 71, 133),
    text: Color.fromARGB(255, 250, 238, 230),
    muted: Color.fromARGB(255, 176, 148, 142),
  ),
  CDPalette(
    name: 'FOREST',
    bg: Color.fromARGB(255, 11, 17, 14),
    card: Color.fromARGB(255, 20, 30, 24),
    accent: Color.fromARGB(255, 52, 199, 123),
    accent2: Color.fromARGB(255, 178, 214, 58),
    text: Color.fromARGB(255, 230, 240, 228),
    muted: Color.fromARGB(255, 128, 148, 130),
  ),
  CDPalette(
    name: 'GALAXY',
    bg: Color.fromARGB(255, 7, 7, 18),
    card: Color.fromARGB(255, 14, 14, 30),
    accent: Color.fromARGB(255, 150, 120, 255),
    accent2: Color.fromARGB(255, 90, 200, 255),
    text: Color.fromARGB(255, 238, 236, 250),
    muted: Color.fromARGB(255, 140, 140, 172),
  ),
  CDPalette(
    name: 'OCEAN',
    bg: Color.fromARGB(255, 4, 14, 20),
    card: Color.fromARGB(255, 9, 24, 33),
    accent: Color.fromARGB(255, 40, 190, 210),
    accent2: Color.fromARGB(255, 60, 130, 220),
    text: Color.fromARGB(255, 226, 246, 250),
    muted: Color.fromARGB(255, 110, 152, 166),
  ),
  CDPalette(
    name: 'MATRIX',
    bg: Color.fromARGB(255, 4, 8, 5),
    card: Color.fromARGB(255, 9, 15, 10),
    accent: Color.fromARGB(255, 64, 230, 120),
    accent2: Color.fromARGB(255, 140, 255, 170),
    text: Color.fromARGB(255, 214, 250, 224),
    muted: Color.fromARGB(255, 96, 140, 108),
  ),
  CDPalette(
    name: 'AUTUMN',
    bg: Color.fromARGB(255, 20, 12, 8),
    card: Color.fromARGB(255, 34, 21, 14),
    accent: Color.fromARGB(255, 224, 122, 40),
    accent2: Color.fromARGB(255, 200, 60, 46),
    text: Color.fromARGB(255, 250, 236, 220),
    muted: Color.fromARGB(255, 168, 132, 108),
  ),
  CDPalette(
    name: 'SNOW',
    bg: Color.fromARGB(255, 14, 16, 20),
    card: Color.fromARGB(255, 23, 26, 30),
    accent: Color.fromARGB(255, 214, 44, 54),
    accent2: Color.fromARGB(255, 46, 168, 96),
    text: Color.fromARGB(255, 248, 248, 250),
    muted: Color.fromARGB(255, 152, 154, 160),
  ),
  CDPalette(
    name: 'AUTO',
    bg: Color.fromARGB(255, 10, 10, 12),
    card: Color.fromARGB(255, 18, 18, 21),
    accent: Color.fromARGB(255, 150, 150, 160),
    accent2: Color.fromARGB(255, 190, 190, 200),
    text: Color.fromARGB(255, 232, 232, 236),
    muted: Color.fromARGB(255, 140, 140, 148),
  ),
];
