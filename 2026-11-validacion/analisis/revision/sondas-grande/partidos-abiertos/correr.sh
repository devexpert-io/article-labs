#!/usr/bin/env bash
# Uso: correr.sh <nombre> <carpeta|--base> [commit]   -> salidas/<nombre>.txt con las líneas SONDA de las dos sondas
set -u
W=/tmp/claude-1000/-home-antonio-DevExpert/d02c7072-e3cd-494e-b9d6-b6218548fa66/scratchpad/revision-grande/partidos-abiertos
LAB=/home/antonio/Projects/devexpert-io/article-labs/2026-11-validacion
nombre=$1; shift
out=$W/salidas/$nombre.txt
: > "$out"
for s in sondas-a sondas-b; do
  if [ "$1" = "--base" ]; then
    (cd "$LAB" && LAB_SCRATCH=/var/tmp/lab-validacion python3 -I analisis/revision/probar.py --base "$W/sondas/$s.test.ts") > "$W/salidas/$nombre.$s.raw" 2>&1
  else
    (cd "$LAB" && LAB_SCRATCH=/var/tmp/lab-validacion python3 -I analisis/revision/probar.py "$1" "$2" "$W/sondas/$s.test.ts") > "$W/salidas/$nombre.$s.raw" 2>&1
  fi
  grep -h "SONDA\|^rc:" "$W/salidas/$nombre.$s.raw" >> "$out"
done
echo "$nombre: $(grep -c SONDA "$out") líneas"
