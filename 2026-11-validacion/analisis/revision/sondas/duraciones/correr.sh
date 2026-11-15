#!/bin/bash
# Uso: correr.sh <sonda.test.ts> <etiqueta> "<carpeta> <commit>" ...
cd analisis/revision
S=$1; et=$2; shift 2
E=/var/tmp/lab-validacion/ejecuciones/completo
for par in "$@"; do
  set -- $par
  if [ "$1" = "base" ]; then n=base; python3 -I sondas/duraciones/probar_completo.py --base $S > sondas/duraciones/salidas/${et}_$n.txt 2>&1
  else n=$(echo $1 | tr '/' '_')_$2; python3 -I sondas/duraciones/probar_completo.py $E/$1 $2 $S > sondas/duraciones/salidas/${et}_$n.txt 2>&1; fi
  echo "$n: $(tail -1 sondas/duraciones/salidas/${et}_$n.txt)"
done
