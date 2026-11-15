"""Escribe revision/reembolsos.json con la clasificación de los 12 hallazgos del paquete de reembolsos."""
import json
from collections import Counter
from pathlib import Path

ANALISIS = Path("analisis/revision")
SONDA = "sondas/facturas/sonda-reembolsos.test.ts (salidas en sondas/facturas/salidas-reembolsos/)"
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


DST_API = (
    f"Con la API ({SONDA}, bloque C3), con el reloj a 01:00, 01:15, 01:30, 01:45 y 01:59 de las dos noches del cambio de hora de 2027 "
    "y las 27 franjas de los tres días siguientes, las 270 cancelaciones con forzar dan la penalización que sale de las horas reales, "
    "y el caso más cercano a 24 o 48 h queda a 3 h, lejos de la hora de error. El ejemplo de la spec da el 25 %."
)
NOTA_DST = (
    "La conversión a horas reales falla con el reloj entre la 01:00 y la 01:59 de las noches del cambio de hora, pero con las franjas "
    "del club ese error de una hora nunca cambia el tramo ni la respuesta de la API"
)

hallazgos = [
    # reembolsos-haiku-r2 (652612a)
    h(
        "reembolsos-haiku-r2/B1/h1", "de_mas",
        f"{SONDA}, R1, en 652612a: como gestor con exento, Lesionado con un espacio delante o detrás (10 caracteres) y diez espacios dan 400 "
        "DATOS_INVALIDOS, y Lesionado. da 200. src/nucleo.ts:210 mide datos.motivo.trim().length. La base ya recorta antes de contar "
        "(buscarSocios, src/nucleo.ts:95). La spec (línea 43) pide un motivo de al menos 10 caracteres sin decir nada de los espacios.",
        "No contar los espacios de los extremos es una forma válida de exigir un motivo de 10 caracteres y la spec no entra en ese caso",
    ),
    h(
        "reembolsos-haiku-r2/B1/h2", "de_mas",
        f"test/club.test.ts:27 de 652612a mantiene reservar sigue las reglas del club, que cubre crear reservas (C8). La semilla no trae ninguna "
        f"cancelada con penalización ({BASE}: R-0012 cancelada sin penalizacion) y los tests ocultos C8 pasan, también el de conservar la "
        "penalización al mover el reloj.",
        "C8 ya tiene test de crear reservas y pedir otro para la conservación de penalizaciones es pedir un caso más",
    ),
    h(
        "reembolsos-haiku-r2/B1/h3", "de_mas",
        "src/nucleo.ts:228 de 652612a usa Math.round(r.importe * fraccion). Los precios de src/semilla.ts (1200, 1400, 1800, 2000, 2200 y 2800) "
        "dan céntimos enteros con el 25 % y con el 50 %, así que el redondeo nunca actúa. La spec no pide documentar redondeos.",
        "Con los precios del club el 25 % y el 50 % siempre salen enteros y la spec no pide documentar ningún redondeo",
    ),
    # reembolsos-luna-r1 (7a16f16, 892829e, 492b101)
    h(
        "reembolsos-luna-r1/B1/h1", "de_mas",
        f"{SONDA}, R4, en 7a16f16: GET /api/informes/caja con 2026-99, 2026-00 y 2026-13 da 200 con todo a cero. src/nucleo.ts:204 valida "
        f"/^\\d{{4}}-\\d{{2}}$/. La spec (línea 45) pide 400 solo si mes no tiene el formato AAAA-MM, y la base valida sus fechas solo por la "
        f"forma ({BASE}: /api/reservas?fecha=2026-99-99 y /api/disponibilidad?fecha=2026-99-99 dan 200). Los tests ocultos C7 de formato pasan.",
        "2026-99 tiene la forma AAAA-MM y la spec solo pide validar el formato, como hace la base con sus fechas",
    ),
    h(
        "reembolsos-luna-r1/B2/h1", "de_mas",
        "test/club.test.ts:54 de 892829e prueba las 24 horas justas (25 % sin forzar). C2 ya tiene test y los tests ocultos C2 pasan, también "
        "el de 48 horas justas sin penalización.",
        "C2 ya tiene un test del límite de 24 horas y pedir el de 48 es pedir un caso más",
    ),
    h(
        "reembolsos-luna-r1/B2/h2", "de_mas",
        "test/club.test.ts:68 de 892829e prueba la exención del gestor (reembolso entero y motivoCancelacion) y el 403 SIN_PERMISO de un socio. "
        "C5 ya tiene test y los tests ocultos C5 pasan, también los de motivo ausente o corto y el 401.",
        "C5 ya tiene test y pedir los de motivo corto y sin identidad es pedir más casos",
    ),
    h(
        "reembolsos-luna-r1/B2/h3", "defecto",
        f"git grep RESERVA_PASADA en test/ de 892829e no encuentra nada: ningún test del agente prueba C6 (tampoco en 7a16f16). AGENTS.md "
        "(paso 3) pide tests que cubran cada criterio y el plan de la spec (línea 51) pide tests de la exención, que C6 limita. El "
        f"comportamiento es correcto ({SONDA}, bloque C6, en 892829e: 409 RESERVA_PASADA con exento y con forzar a la hora de inicio y 45 "
        "minutos después). En 492b101 se añade una reserva iniciada rechaza cancelación aunque se solicite exención (test/club.test.ts:122).",
        "C6 no tenía ningún test del agente aunque AGENTS.md pide cubrir cada criterio, y la API ya hacía lo correcto",
        tipo="tests", gravedad="baja", arreglado=True,
    ),
    h(
        "reembolsos-luna-r1/B2/h4", "de_mas",
        "test/club.test.ts:68 de 892829e prueba el informe con gestor (200), socio (403 SIN_PERMISO), sin X-Socio (401) y 2026-99 (400). C7 ya "
        "tiene test y los tests ocultos C7 pasan, también los de contenido, orden y pistas sin movimientos.",
        "C7 ya tiene test y pedir que compruebe el contenido del informe es pedir más casos",
    ),
    h(
        "reembolsos-luna-r1/B3/h1", "defecto",
        "Evalué la instanteMadrid de src/nucleo.ts:22-31 de 492b101 (la misma que en 7a16f16) con sondas/facturas/madrid/492b101.ts y TZ=UTC: "
        "2027-03-28T01:30 da 2027-03-27T23:30Z (la real es 00:30Z) y 2027-10-31T01:30 da 2027-10-31T00:30Z (la real es 23:30Z del día 30), así "
        f"que hasta las 09:00 del día siguiente cuenta 31,5 h donde hay 30,5 y 32,5. {DST_API} Ronda final, sin reparación.",
        NOTA_DST,
        tipo="comportamiento", gravedad="baja",
    ),
    h(
        "reembolsos-luna-r1/C1/h1", "defecto",
        "Evalué la instanteMadrid de src/nucleo.ts:22-31 de 7a16f16 con sondas/facturas/madrid/7a16f16.ts y TZ=UTC: 2027-03-28T01:30 da "
        "2027-03-27T23:30Z (la real es 00:30Z) y 2027-10-31T01:30 da 2027-10-31T00:30Z (la real es 23:30Z del día 30), 31,5 h donde hay 30,5 "
        f"y 32,5. {DST_API} En fad182e la conversión itera y da 00:30Z y 23:30Z, con 30,5 y 32,5 h (sondas/facturas/madrid/fad182e.ts), y la "
        "sonda de la API sigue sin diferencias.",
        NOTA_DST,
        tipo="comportamiento", gravedad="baja", arreglado=True,
    ),
    h(
        "reembolsos-luna-r1/C1/h2", "de_mas",
        f"{SONDA}, R10, en 7a16f16: socio-003 con exento sin motivo o con motivo corto da 400 DATOS_INVALIDOS, con un motivo válido 403 "
        "SIN_PERMISO, y sin X-Socio 401 NO_IDENTIFICADO. src/nucleo.ts:182-183 valida el motivo antes que el rol. La spec (línea 43) da los "
        "tres errores sin decir cuál gana cuando coinciden, y los tests ocultos C5 pasan (403 con motivo válido).",
        "La spec no fija qué error gana cuando quien pide la exención no es gestor y además el motivo es corto",
    ),
    # reembolsos-luna-r2 (62f00ff)
    h(
        "reembolsos-luna-r2/C1/h1", "defecto",
        "git grep RESERVA_PASADA en test/ de 62f00ff no encuentra nada: C6 no tiene ningún test del agente y AGENTS.md (paso 3) pide cubrir "
        "cada criterio. El resto de lo que pide son más casos de criterios que ya tienen test: C7 en test/club.test.ts:54 (200, 4 pistas, 401, "
        "403 y 400), C5 con la exención del gestor en ese mismo test y C8 con reservar sigue las reglas del club (línea 27). El comportamiento "
        f"de C6 es correcto ({SONDA}, bloque C6, en 62f00ff). En 9fbb04a se añade no se cancelan reservas al inicio ni después, con ninguna "
        "modalidad (test/club.test.ts:108).",
        "De todo lo que pide, lo único que falta de verdad es un test de reservas pasadas, porque C6 no tenía ninguno y AGENTS.md pide cubrir "
        "cada criterio",
        tipo="tests", gravedad="baja", arreglado=True,
    ),
]

paquete = json.loads((ANALISIS / "paquetes" / "reembolsos.json").read_text())
ids = [x["id"] for x in paquete]
assert sorted(ids) == sorted(x["id"] for x in hallazgos), set(ids) ^ {x["id"] for x in hallazgos}
assert len(hallazgos) == len(paquete) == 12
orden = {i: n for n, i in enumerate(ids)}
hallazgos.sort(key=lambda x: orden[x["id"]])
for x in hallazgos:
    assert ";" not in x["nota"] and "«" not in x["nota"] and "»" not in x["nota"], x["id"]
    assert (x["tipo"] is not None) == (x["categoria"] == "defecto"), x["id"]
    assert (x["gravedad_real"] is not None) == (x["categoria"] in ("defecto", "previo")), x["id"]
salida = ANALISIS / "revision" / "reembolsos.json"
salida.write_text(json.dumps(hallazgos, ensure_ascii=False, indent=1) + "\n")
print(salida, len(hallazgos), Counter(x["categoria"] for x in hallazgos))
