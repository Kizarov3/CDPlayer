#!/usr/bin/env bash
set -euo pipefail

APP_OUT="out"
rm -rf "$APP_OUT"
mkdir -p "$APP_OUT"
javac -d "$APP_OUT" src/main/java/com/cdlikeplayer/Server.java
cp -R public "$APP_OUT/public"
echo "CD like Player is ready at http://localhost:8080"
java -cp "$APP_OUT" com.cdlikeplayer.Server

