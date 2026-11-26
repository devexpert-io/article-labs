# Consultas sobre la actividad del club

Las preguntas sobre lo que ha pasado en el club (ocupación, ingresos, cancelaciones, horas con más reservas) se responden con `scripts/consulta.ts`, que calcula sobre el estado de la semilla. No escribas un script nuevo ni sumes a mano leyendo `src/semilla.ts`: el historial tiene cientos de reservas y es fácil equivocarse con los estados.

## Las consultas

| Pregunta | Orden |
|---|---|
| A qué hora hay más reservas confirmadas | `node scripts/consulta.ts franjas --mes AAAA-MM` |
| Cuánto se ha ingresado por pista | `node scripts/consulta.ts ingresos --mes AAAA-MM [--pista pista-N]` |
| Quién cancela más y cuántas cancelaciones hay | `node scripts/consulta.ts cancelaciones --mes AAAA-MM [--top N]` |
| Qué parte de las franjas está ocupada | `node scripts/consulta.ts ocupacion --mes AAAA-MM [--pista pista-N] [--finde \| --laborables]` |

Todas aceptan `--json`. `node scripts/consulta.ts --help` da la lista completa.

## Qué cuenta cada una

- **Ingresos:** reservas `confirmada` y `no_presentada` por su `importe`. Las penalizaciones salen aparte. En céntimos con `--json`, en euros sin él.
- **Ocupación:** franjas con una reserva no cancelada (`confirmada` o `no_presentada`) entre las franjas de los días en que la pista estaba abierta. La pista 4 cerró por obras el 9 de noviembre de 2026.
- **Cancelaciones:** reservas en estado `cancelada`, con o sin penalización.
- El mes de una reserva es el de su inicio.

## Cómo responder

1. Lanza la consulta que corresponde a cada pregunta. Si una pregunta mezcla dos, lanza las dos.
2. Si la orden falla, mira el mensaje: casi siempre falta `--mes` o la pista se escribe `pista-N`.
3. Responde con la cifra que da el script, sin recalcularla, y di qué consulta has usado.
