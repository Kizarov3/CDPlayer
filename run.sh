#!/usr/bin/env bash
set -euo pipefail

APP_OUT="out"
rm -rf "$APP_OUT"
mkdir -p "$APP_OUT"
javac -d "$APP_OUT" src/main/java/com/cdplayer/CDPlayer.java
mkdir -p "$APP_OUT/com/cdplayer"
cp src/main/java/com/cdplayer/icon.png "$APP_OUT/com/cdplayer/icon.png"
echo "Launching CDPlayer..."
java --enable-native-access=ALL-UNNAMED -cp "$APP_OUT" com.cdplayer.CDPlayer
