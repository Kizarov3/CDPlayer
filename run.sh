#!/usr/bin/env bash
set -euo pipefail

APP_OUT="out"
rm -rf "$APP_OUT"
mkdir -p "$APP_OUT"
javac -d "$APP_OUT" src/main/java/com/cdplayer/CDPlayer.java
echo "Launching CDPlayer..."
java -cp "$APP_OUT" com.cdplayer.CDPlayer
