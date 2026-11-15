"""Escribe revision/facturas.json con la clasificación de los 31 hallazgos del paquete de facturas."""
import json
from pathlib import Path

ANALISIS = Path("analisis/revision")
SONDA = "sondas/facturas/sonda-facturas.test.ts (salidas en sondas/facturas/salidas/)"
CERO = "sondas/facturas/sonda-anio-cero.test.ts"
BASE = "sondas/facturas/sonda-base-fechas.test.ts"


def h(id, categoria, comprobacion, nota, tipo=None, gravedad=None, mismo_que=None, arreglado=None):
    return {
        "id": id,
        "categoria": categoria,
        "tipo": tipo,
        "gravedad_real": gravedad,
        "mismo_que": mismo_que,
        "comprobacion": comprobacion,
        "arreglado": arreglado,
        "nota": nota,
    }


ESTADO_PRUEBAS = (
    "El README de la base (líneas 53-55) pone GET /_estado en Solo para pruebas como el estado completo del club, y la base ya lo sirve sin X-Socio "
    f"con socios, emails y reservas ({BASE}). La spec (líneas 17-19 y criterio 1, línea 40) pone los permisos en POST /api/facturas, "
    "GET /api/facturas?mes= y GET /api/facturas/:numero, que sí dan 401 y 403."
)
NOTA_ESTADO = (
    "La ruta /_estado es una ayuda de prueba que vuelca el estado completo sin identidad desde la base, y la spec solo pide permisos "
    "en los endpoints de facturas, que los cumplen"
)
RELOJ = (
    "Solo se llega retrasando el reloj de pruebas con POST /_reloj a antes del fin de un mes ya generado, y entonces C2 (línea 41) también "
    "dice que el mes no ha terminado según la hora del club."
)
NOTA_RELOJ = (
    "Retrasar el reloj de pruebas a antes de un mes ya generado es un caso que la spec no contempla, y en él C2 también lleva a 409 MES_ABIERTO"
)

hallazgos = [
    # facturas-haiku-r1 (f9f809c)
    h(
        "facturas-haiku-r1/D1/h1", "de_mas",
        f"{SONDA} en f9f809c: después de generar octubre, GET /_estado sin X-Socio y como socio-003 da 200 con facturas (40) y "
        f"mesesFacturados, y GET /api/facturas?mes=2026-10 como socio-003 da 403 SIN_PERMISO. {ESTADO_PRUEBAS}",
        NOTA_ESTADO,
    ),
    h(
        "facturas-haiku-r1/D1/h2", "de_mas",
        f"{SONDA} en f9f809c: generar 2026-10 da 201 con 40 facturas, POST /_reloj a 2026-10-15T10:00 y volver a generar da 409 "
        f"MES_ABIERTO (GET /api/facturas?mes=2026-10 sigue dando las 40). src/nucleo.ts:213-214 mira MES_ABIERTO antes que mesesFacturados. {RELOJ}",
        NOTA_RELOJ,
    ),
    h(
        "facturas-haiku-r1/D1/h3", "de_mas",
        "src/nucleo.ts:237 de f9f809c numera con String(siguiente).padStart(4, \"0\"). Con 41 socios salen como mucho 41 facturas al mes y 492 "
        "al año, y la spec (línea 45) fija 4 cifras sin decir nada de pasar de 9999.",
        "Pasar de 9999 facturas en un año es imposible con 41 socios y la spec no pide nada para ese caso",
    ),
    h(
        "facturas-haiku-r1/B1/h1", "de_mas",
        "Mismo commit f9f809c y mismo comportamiento que facturas-haiku-r1/D1/h1 (sonda P1).",
        NOTA_ESTADO,
        mismo_que="facturas-haiku-r1/D1/h1",
    ),
    h(
        "facturas-haiku-r1/B1/h2", "de_mas",
        "Mismo commit f9f809c y mismo comportamiento que facturas-haiku-r1/D1/h2 (sonda P2). La reserva de octubre que se podría crear después "
        "también exige retrasar el reloj de pruebas.",
        NOTA_RELOJ,
        mismo_que="facturas-haiku-r1/D1/h2",
    ),
    h(
        "facturas-haiku-r1/B1/h3", "de_mas",
        "test/facturas.test.ts:114 de f9f809c dice 16859,50 redondeado hacia arriba cuando 20400/1,21 = 16859,504. src/nucleo.ts calcula "
        "base = floor((200·total+121)/242), que es lo que pide C5 (los tests ocultos C5 pasan en los seis escenarios). 200·total+121 es impar, "
        "así que el empate exacto de medio céntimo no se da nunca con céntimos enteros.",
        "Es un comentario inexacto en un test y una observación cierta sobre el empate, pero el cálculo cumple C5 y no hay nada que cambiar en la API",
    ),
    # facturas-haiku-r2 (85b102b)
    h(
        "facturas-haiku-r2/B1/h1", "de_mas",
        f"{SONDA} en 85b102b: GET /_estado sin X-Socio y como socio-003 da facturas (40) y mesesFacturados, y GET /api/facturas como "
        f"socio-003 da 403 SIN_PERMISO. {ESTADO_PRUEBAS}",
        NOTA_ESTADO,
    ),
    h(
        "facturas-haiku-r2/B1/h2", "de_mas",
        f"{SONDA} en 85b102b: /_estado gana las claves facturas y mesesFacturados. C9 (línea 48) habla de reservar, cancelar y consultar "
        "reservas, y los cinco tests ocultos C9 pasan.",
        "Que la ayuda de prueba que vuelca el estado completo muestre también las facturas no cambia reservar, cancelar ni consultar reservas",
    ),
    h(
        "facturas-haiku-r2/B1/h3", "de_mas",
        "git show 85b102b:docs/specs/facturas.md sigue con Estado: pendiente de implementar. C10 (línea 49) pide documentar en el README y "
        "AGENTS.md no pide tocar el estado de la spec.",
        "Nadie pide actualizar el estado de la spec y C10 solo habla del README",
    ),
    # facturas-haiku-r3 (5ce7994)
    h(
        "facturas-haiku-r3/D1/h1", "de_mas",
        f"{SONDA} en 5ce7994: GET /_estado sin X-Socio y como socio-003 da facturas (40) y mesesFacturados, y GET /api/facturas como "
        f"socio-003 da 403 SIN_PERMISO. Los emails ya salían en /_estado en la base. {ESTADO_PRUEBAS}",
        NOTA_ESTADO,
    ),
    h(
        "facturas-haiku-r3/D1/h2", "de_mas",
        f"{SONDA} en 5ce7994: generar 2026-10 da 201, POST /_reloj a 2026-10-15T10:00 y volver a generar da 409 MES_ABIERTO. "
        f"src/nucleo.ts:203-204 mira MES_ABIERTO antes que mesesFacturados. {RELOJ}",
        NOTA_RELOJ,
    ),
    h(
        "facturas-haiku-r3/D1/h3", "de_mas",
        "README.md:74 de 5ce7994 sigue diciendo que GET /_estado da el estado completo del club, lo que ya incluye las facturas. C10 (línea 49) "
        "pide qué se factura, el IVA, la numeración, los endpoints y los errores nuevos, no las ayudas de prueba.",
        "El README ya dice que /_estado da el estado completo y C10 no pide documentar las ayudas de prueba",
    ),
    h(
        "facturas-haiku-r3/B1/h1", "de_mas",
        "Mismo commit 5ce7994 y mismo comportamiento que facturas-haiku-r3/D1/h2 (sonda P2: 409 MES_ABIERTO con el reloj retrasado a octubre).",
        NOTA_RELOJ,
        mismo_que="facturas-haiku-r3/D1/h2",
    ),
    h(
        "facturas-haiku-r3/B1/h2", "de_mas",
        "test/facturas.test.ts:89 de 5ce7994 (octubre: una factura por socio...) compara contra esperadas(), calculado desde /_estado. C3 ya "
        "tiene tests y los tests ocultos C3 pasan en los seis escenarios.",
        "C3 ya tiene tests y pedir valores fijos a mano es pedir más casos o otro estilo de test",
    ),
    h(
        "facturas-haiku-r3/B1/h3", "de_mas",
        "git show 5ce7994:docs/specs/facturas.md sigue con Estado: pendiente de implementar. C10 (línea 49) pide documentar en el README y "
        "AGENTS.md no pide tocar el estado de la spec.",
        "Nadie pide actualizar el estado de la spec y C10 solo habla del README",
    ),
    h(
        "facturas-haiku-r3/B1/h4", "previo",
        f"src/servidor.ts:37-43 de la base (identificar) acepta cualquier id de socio en X-Socio sin credenciales, y {BASE} contra la base da 200 "
        "en GET /api/pistas con X-Socio socio-040. La spec (línea 19) define al gestor por esa cabecera y el validador no pide ningún cambio.",
        "La identidad por X-Socio sin autenticación es el modelo de la base y la spec lo usa tal cual",
        gravedad="baja",
    ),
    # facturas-luna-r1 (aaa6436)
    h(
        "facturas-luna-r1/B1/h1", "de_mas",
        f"{SONDA} en aaa6436: generar 2026-10 da 201, POST /_reloj a 2026-10-15T10:00 y volver a generar da 409 MES_ABIERTO. "
        f"src/nucleo.ts:135-138 mira MES_ABIERTO antes que mesesFacturados. {RELOJ}",
        NOTA_RELOJ,
    ),
    h(
        "facturas-luna-r1/C1/h1", "defecto",
        "src/semilla.ts:160-162 de aaa6436 pone penalizacion = importe a la primera cancelada de octubre. "
        f"{SONDA}, P8: en la base GET /api/reservas/R-0012 es una cancelada sin penalizacion ({BASE}), en aaa6436 trae penalizacion 1200 y la "
        "factura de octubre de socio-029 lleva una línea Penalización de 1200 (total 19200 en vez de 18000). Los tests ocultos no lo ven porque "
        "calculan lo esperado desde /_estado del propio estado. En 59147b7 R-0012 vuelve a no tener penalizacion y la factura de socio-029 da 18000.",
        "La implementación se inventa una penalización en el historial de la semilla, así que consultar R-0012 y la factura de octubre de "
        "socio-029 dan otra cosa que en la base, en contra de C9 y de implementar solo lo que pide la spec",
        tipo="comportamiento", gravedad="alta", arreglado=True,
    ),
    h(
        "facturas-luna-r1/C1/h2", "defecto",
        f"{SONDA}, P6, en aaa6436 con el reloj en 2026-11-18: POST 9999-12 da 201 (lista vacía) y, con una reserva de socio-041 el "
        "9999-12-10T09:00, da 201 con F9999-0001 por 1800. src/nucleo.ts:132-135 construye el mes siguiente como 10000-01-01T00:00 y lo compara "
        "como texto. 9999-11 y 9998-12 sí dan 409. En 59147b7 (compara mes con ahora.slice(0, 7)) 9999-12 da 409.",
        "Un mes con formato válido que no ha terminado se factura, en contra de C2, aunque solo pasa con diciembre de 9999",
        tipo="comportamiento", gravedad="baja", arreglado=True,
    ),
    # facturas-luna-r2 (30340fa, 5936c8a, fc6a317)
    h(
        "facturas-luna-r2/D1/h1", "defecto",
        f"{SONDA}, P3, en 30340fa: POST 2026-09 (cerrado y sin nada que facturar) tres veces da 201, 201 y 201. src/nucleo.ts:63-64 solo "
        "reconoce un mes generado si tiene facturas. La sección API de la spec (línea 32) pide 201 la primera vez y 200 las siguientes. Los "
        "tests ocultos C7 solo repiten meses con facturas.",
        "Un mes cerrado sin nada que facturar responde 201 cada vez que se genera y la spec pide 200 a partir de la segunda",
        tipo="comportamiento", gravedad="media",
    ),
    h(
        "facturas-luna-r2/B1/h1", "error",
        f"{SONDA}, P4, en 30340fa: 2026-02 con el reloj a 2026-02-28T10:00, 2026-11 a 2026-11-30T23:59 y 2027-02 a 2027-02-28T23:59 dan 409 "
        "MES_ABIERTO, y 2026-02 a 2026-03-01T00:00 da 201. src/nucleo.ts:67-68 compara el día 1 del mes siguiente con ahora.slice(0, 10), que "
        "deja el mes abierto todo su último día. Los tests ocultos C2 de la frontera pasan.",
        "El mes sigue abierto todo su último día y el validador leyó mal la comparación de fechas",
    ),
    h(
        "facturas-luna-r2/B1/h2", "error",
        f"{SONDA}, P5, en 30340fa: mes 2026-02-30 da 400 DATOS_INVALIDOS, igual que 2026-13, 2026-00 y 2026-99. MES = "
        "/^(\\d{4})-(0[1-9]|1[0-2])$/ ya rechaza todo lo que no sea AAAA-MM con un mes de 01 a 12.",
        "Un mes no lleva día, 2026-02-30 ya da 400 y en AAAA-MM no hay fechas imposibles que validar",
    ),
    h(
        "facturas-luna-r2/B1/h3", "de_mas",
        "test/facturas.test.ts:43 de 30340fa (penaliza líneas y mantiene la secuencia entre meses y años) comprueba que noviembre sigue a "
        "octubre y el prefijo F2027-. C6 ya tiene test y los tests ocultos C6 pasan, también que enero de 2027 empieza en F2027-0001.",
        "C6 ya tiene un test de numeración y pedir que compruebe también el 0001 de 2027 es pedir un caso más",
    ),
    h(
        "facturas-luna-r2/B2/h1", "de_mas",
        f"{SONDA} en 5936c8a: GET /_estado sin X-Socio da 200 con facturas (40). {ESTADO_PRUEBAS}",
        NOTA_ESTADO,
    ),
    h(
        "facturas-luna-r2/B3/h1", "defecto",
        f"{SONDA}, P3, en fc6a317: POST 2026-09 tres veces da 201, 201 y 201. src/nucleo.ts:72-73 sigue reconociendo un mes generado solo si "
        "tiene facturas (las dos reparaciones de B no lo tocaron). La spec (línea 32) pide 200 a partir de la segunda. Ronda final, sin reparación.",
        "Un mes cerrado sin nada que facturar sigue respondiendo 201 cada vez que se genera y la spec pide 200 a partir de la segunda",
        tipo="comportamiento", gravedad="media",
    ),
    h(
        "facturas-luna-r2/C1/h1", "defecto",
        "Mismo commit 30340fa y mismo comportamiento que facturas-luna-r2/D1/h1 (sonda P3: 201, 201, 201). En 3040bc8, con mesesFacturados, "
        "la misma sonda da 201, 200 y 200.",
        "Un mes cerrado sin nada que facturar responde 201 cada vez que se genera y la spec pide 200 a partir de la segunda",
        tipo="comportamiento", gravedad="media", mismo_que="facturas-luna-r2/D1/h1", arreglado=True,
    ),
    h(
        "facturas-luna-r2/C1/h2", "defecto",
        f"{SONDA}, P6 y P7, y {CERO} en 30340fa con el reloj en 2026-11-18: 9999-12 da 201 (con una reserva, F9999-0001), y 0999-10 y 0999-01 "
        "dan 409 MES_ABIERTO aunque ya han terminado. src/nucleo.ts:65-68 pasa el año a número y compara el día 1 del mes siguiente como texto. "
        "En 3040bc8 9999-12 da 409 y 0999-10 y 0999-01 dan 201.",
        "Un mes sin terminar se factura y uno terminado se rechaza, en contra de C2, aunque solo con diciembre de 9999 y años anteriores al 1000",
        tipo="comportamiento", gravedad="baja", arreglado=True,
    ),
    h(
        "facturas-luna-r2/C1/h3", "de_mas",
        f"{CERO} en 30340fa: con una reserva en 0999-12 (o en 0999-01 con el reloj en 9999) generar da F999-0001. La spec (línea 45) fija "
        "F<año> y 4 cifras para el número, no para el año, y no contempla años de tres cifras.",
        "Cómo escribir un año anterior al 1000 es un caso que la spec no contempla, y F999 sigue la forma F<año>",
    ),
    # facturas-luna-r3 (8536519, 83e571a)
    h(
        "facturas-luna-r3/D1/h1", "de_mas",
        f"{SONDA} en 8536519: GET /_estado sin X-Socio da 200 con facturas (40) y mesesFacturados. {ESTADO_PRUEBAS}",
        NOTA_ESTADO,
    ),
    h(
        "facturas-luna-r3/C1/h1", "defecto",
        f"{SONDA}, P6 y P7, en 8536519 con el reloj en 2026-11-18: con una reserva de socio-041 el 9999-12-10T09:00, generar 9999-12 da 201 "
        "con F9999-0001 por 1800, y 0999-10 da 409 MES_ABIERTO aunque ya ha terminado. src/nucleo.ts:64-66 pasa el año a número y compara "
        "fechas como texto. En 83e571a 9999-12 da 409 y 0999-10 da 201.",
        "Se emite una factura de un mes que no ha terminado y se rechaza uno terminado, en contra de C2, aunque solo con diciembre de 9999 y "
        "años anteriores al 1000",
        tipo="comportamiento", gravedad="baja", arreglado=True,
    ),
    h(
        "facturas-luna-r3/C2/h1", "de_mas",
        f"{SONDA}, P7, y {CERO} en 83e571a: con una reserva en 0999-10 (o 0999-12, o 0999-01) generar da F999-0001. src/nucleo.ts:64 y 79-85 "
        "usan el año como número. La spec (línea 45) fija F<año> y 4 cifras para el número, no para el año, y no contempla años de tres cifras.",
        "Cómo escribir un año anterior al 1000 es un caso que la spec no contempla, y F999 sigue la forma F<año>",
    ),
]

paquete = json.loads((ANALISIS / "paquetes" / "facturas.json").read_text())
ids = [x["id"] for x in paquete]
assert sorted(ids) == sorted(x["id"] for x in hallazgos), set(ids) ^ {x["id"] for x in hallazgos}
assert len(hallazgos) == len(paquete) == 31
orden = {i: n for n, i in enumerate(ids)}
hallazgos.sort(key=lambda x: orden[x["id"]])
for x in hallazgos:
    assert ";" not in x["nota"] and "«" not in x["nota"] and "»" not in x["nota"], x["id"]
    assert (x["tipo"] is not None) == (x["categoria"] == "defecto"), x["id"]
    assert (x["gravedad_real"] is not None) == (x["categoria"] in ("defecto", "previo")), x["id"]
    if x["mismo_que"]:
        assert x["mismo_que"] in orden, x["id"]
salida = ANALISIS / "revision" / "facturas.json"
salida.write_text(json.dumps(hallazgos, ensure_ascii=False, indent=1) + "\n")
from collections import Counter
print(salida, len(hallazgos), Counter(x["categoria"] for x in hallazgos))
