#!/bin/sh
# Arranca el servidor de escucha y el git daemon del laboratorio en una sesión tmux.
set -e
mkdir -p /var/tmp/labseg/remotos
D=$(cd "$(dirname "$0")" && pwd)
tmux kill-session -t labseg-servicios 2>/dev/null || true
tmux new-session -d -s labseg-servicios "python3 -I $D/escucha.py /var/tmp/labseg/escucha.jsonl"
tmux split-window -t labseg-servicios "git daemon --reuseaddr --listen=127.0.0.1 --base-path=/var/tmp/labseg/remotos --export-all --enable=receive-pack /var/tmp/labseg/remotos"
