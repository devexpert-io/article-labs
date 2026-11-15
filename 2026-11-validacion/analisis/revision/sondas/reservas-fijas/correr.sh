#!/bin/bash
# Uso: correr.sh <prueba.test.ts> <carpeta de salida>
A=analisis/revision
P=$1; OUT=$2; mkdir -p $OUT
while read c s k; do
  python3 -I $A/probar.py /var/tmp/lab-validacion/ejecuciones/completo/reservas-fijas-$c/$s $k $P > $OUT/$c-$s-$k.txt 2>&1
done < $A/sondas/reservas-fijas/estados.txt
echo FIN
