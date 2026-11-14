# Spec: exportar reservas a CSV

- **id:** `exportar-csv`
- **Estado:** pendiente de implementar

## Objetivo

La recepción quiere sacar las reservas de un periodo a una hoja de cálculo para cuadrar la caja y preparar el informe del mes. Hoy solo puede listarlas por la API, de 100 en 100 y en JSON. Esta feature añade una exportación en CSV que se abre bien en cualquier hoja de cálculo.

## No-objetivos

- No cambiar `GET /api/reservas`: ni sus filtros, ni su paginación, ni su formato.
- No exportar socios ni pistas por separado.
- No añadir dependencias nuevas.

## Usuarios y permisos

- Solo los gestores pueden exportar.
- Sin cabecera `X-Socio`: `401 NO_IDENTIFICADO`.
- Con un socio que no es gestor: `403 SIN_PERMISO`.

## API

`GET /api/reservas/exportar?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&estado=<estado>]`

Responde `200` con el CSV en el cuerpo, no en JSON, y estas cabeceras:

- `content-type: text/csv; charset=utf-8`
- `content-disposition: attachment; filename="reservas-<desde>-<hasta>.csv"`

La primera línea es esta cabecera, exacta:

```
id,fecha,hora,pista,socio,email,estado,importe,penalizacion,notas
```

- `fecha` y `hora`: el día (`AAAA-MM-DD`) y la hora (`HH:MM`) de inicio.
- `pista`: el nombre de la pista (`Pista 1`), no su id.
- `socio` y `email`: el nombre y el email del socio.
- `importe` y `penalizacion`: en euros, con dos decimales y punto decimal (`1800` céntimos es `18.00`).

## Criterios de aceptación

1. **Permisos.** Solo exporta un gestor. Sin `X-Socio` responde `401 NO_IDENTIFICADO`, y con un socio que no es gestor, `403 SIN_PERMISO`.
2. **Respuesta.** Responde `200` con el `content-type` y el `content-disposition` de arriba, con las fechas del periodo en el nombre del fichero.
3. **Cabecera.** La primera línea es la cabecera exacta, con las columnas en ese orden.
4. **Filas.** Hay una fila por cada reserva que empieza entre `desde` y `hasta`, ambos días incluidos, en cualquier estado salvo que se filtre. Van ordenadas por inicio y, si empiezan a la vez, por id de pista.
5. **Importes.** `importe` y `penalizacion` van en euros con dos decimales y punto. Si la reserva no tiene penalización, el campo va vacío.
6. **Escapado.** Sigue el RFC 4180: un campo que contiene una coma, comillas dobles o un salto de línea va entre comillas dobles, y las comillas de dentro se duplican. El resto de campos va sin comillas.
7. **Fin de línea.** Cada línea, también la cabecera y la última, termina en CRLF (`\r\n`).
8. **Periodo.** `desde` y `hasta` son obligatorios y con formato `AAAA-MM-DD`. Si faltan, el formato no vale o `desde` es posterior a `hasta`, responde `400 DATOS_INVALIDOS`. El periodo puede abarcar como mucho 92 días contando los dos extremos. Si abarca más, responde `400 RANGO_DEMASIADO_GRANDE`.
9. **Filtro por estado.** `estado` es opcional y vale `confirmada`, `cancelada` o `no_presentada`. Con otro valor responde `400 DATOS_INVALIDOS`.
10. **Lo demás no cambia.** `GET /api/reservas` responde exactamente igual que antes.
11. **Documentación.** La referencia de la API del `README.md` incluye el endpoint: parámetros, permisos, formato y errores.

## Plan de verificación

- Tests de la API para cada criterio, incluidas notas con comas, comillas y saltos de línea.
- `npm run check` en verde.

## Impacto en la documentación

- `README.md`: el endpoint nuevo en la sección de reservas.
