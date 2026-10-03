#!/bin/sh
# Extra Electron flags, one per line, e.g. --ozone-platform-hint=auto
flags_file="${XDG_CONFIG_HOME:-$HOME/.config}/cdplayer-flags.conf"
if [ -r "$flags_file" ]; then
  set -- $(grep -v '^[[:space:]]*#' "$flags_file") "$@"
fi
exec /opt/cdplayer/cdplayer "$@"
