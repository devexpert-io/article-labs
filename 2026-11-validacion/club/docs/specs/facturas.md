# Spec: facturas mensuales

- **id:** `facturas`
- **Estado:** pendiente de implementar

## Objetivo

La gestoría pide al club una factura por socio y mes, con lo que ha pagado por sus reservas y por las penalizaciones. Hoy la recepción las hace a mano en una hoja de cálculo. Esta feature genera las facturas de un mes cerrado, con una numeración correlativa por año que no se puede saltar ni repetir, y con el IVA desglosado como lo pide la gestoría.

## No-objetivos

- No enviar las facturas a nadie ni generar PDF.
- No hacer facturas rectificativas: un mes cerrado ya no cambia, porque las reservas que han empezado no se pueden cancelar.
- No cambiar los precios ni las reglas del club.
- No añadir dependencias nuevas.

## Usuarios y permisos

- Solo un gestor (cabecera `X-Socio` de un socio con rol `gestor`) puede generar y consultar facturas. Sin `X-Socio`, `401 NO_IDENTIFICADO`. Con un socio que no es gestor, `403 SIN_PERMISO`.

## Qué se factura

Los importes del club ya llevan el IVA (21 %) incluido. En la factura de un socio y un mes entran sus reservas que empiezan ese mes:

- Las confirmadas y las no presentadas, por su `importe`, con el concepto `Reserva`.
- Las canceladas con penalización, por su `penalizacion`, con el concepto `Penalización`.

Las canceladas sin penalización no se facturan.

## API

- `POST /api/facturas` con `{ mes: "AAAA-MM" }`: genera las facturas de ese mes. Responde `201 { facturas }` la primera vez y `200 { facturas }` las siguientes, con las mismas facturas.
- `GET /api/facturas?mes=AAAA-MM`: las facturas de un mes ya generado. Responde `{ facturas }`.
- `GET /api/facturas/:numero`: una factura. Responde `{ factura }`.

Una factura tiene `numero`, `mes`, `socioId`, `lineas` (cada una con `reservaId`, `concepto` e `importe`), `total`, `base` e `iva`, todos los importes en céntimos.

## Criterios de aceptación

1. **Permisos.** Solo un gestor genera y consulta facturas: sin `X-Socio`, `401 NO_IDENTIFICADO`, y con un socio que no es gestor, `403 SIN_PERMISO`.
2. **Mes cerrado.** `mes` tiene el formato `AAAA-MM` (si no, `400 DATOS_INVALIDOS`). Solo se factura un mes que ya ha terminado según la hora del club. Si no, `409 MES_ABIERTO`.
3. **Una factura por socio.** Se genera una factura por cada socio que tiene algo que facturar ese mes, y ninguna para los demás. Las facturas de un mes van ordenadas por id de socio.
4. **Líneas.** Cada factura tiene una línea por reserva facturable del socio ese mes, según "Qué se factura", ordenadas por el inicio de la reserva, con su `reservaId`, su `concepto` y su `importe`.
5. **Total e IVA.** `total` es la suma de las líneas. La `base` se calcula sobre el total de la factura, no línea a línea: `total / 1,21` redondeado al céntimo más cercano, con medio céntimo hacia arriba. `iva` es `total - base`.
6. **Numeración.** Los números tienen la forma `F<año>-<número de 4 cifras>`, por ejemplo `F2026-0001`. Son correlativos dentro del año del mes facturado, sin huecos ni repetidos, y se asignan por orden de socio al generar el mes. Un mes que se genera después sigue la numeración donde la dejó el anterior generado de ese año. Cada año empieza en `0001`.
7. **Generar dos veces.** Volver a generar un mes ya generado devuelve las mismas facturas, con los mismos números, y no crea ninguna nueva.
8. **Consultar.** `GET /api/facturas?mes=AAAA-MM` devuelve las facturas de un mes generado, y una lista vacía si el mes no se ha generado. `GET /api/facturas/:numero` devuelve una factura, o `404 FACTURA_NO_ENCONTRADA` si no existe.
9. **Lo demás no cambia.** Reservar, cancelar y consultar reservas funciona igual que antes.
10. **Documentación.** El `README.md` explica qué se factura, cómo se calcula el IVA, la numeración, los endpoints y los errores nuevos.

## Plan de verificación

- Tests de la API para cada criterio: un mes con historial (octubre de 2026), las penalizaciones, el redondeo del IVA, la numeración entre meses y entre años (con `POST /_reloj`) y la repetición.
- `npm run check` en verde.

## Impacto en la documentación

- `README.md`: reglas del club (facturación) y referencia de la API.
