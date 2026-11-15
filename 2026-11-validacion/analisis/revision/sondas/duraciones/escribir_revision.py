"""Escribe revision/duraciones.json y revision/exportar-csv.json con la clasificación hallazgo a hallazgo.

Las salidas de las sondas citadas están en sondas/duraciones/salidas/ (ini_* para sonda-inicios.test.ts,
exp_* para exportar/sonda-exportar.test.ts y efe_* para sonda-efecto-1060.test.ts).
"""
import json
from pathlib import Path

ANALISIS = Path("analisis/revision")


def h(id, categoria, comprobacion, nota, tipo=None, gravedad=None, mismo_que=None, arreglado=None):
    e = {"id": id, "categoria": categoria}
    if categoria == "defecto":
        e["tipo"] = tipo
    if categoria in ("defecto", "previo"):
        e["gravedad_real"] = gravedad
    e.update({"mismo_que": mismo_que, "comprobacion": comprobacion, "arreglado": arreglado, "nota": nota})
    return e


HORAS_RARAS = "10:60, 09:60, 09:90, 12:60, 20:60, 08:60 y 08:90 con 60 o 90 minutos"
BASE_RARAS = "En la base (club/) las 21 horas raras de la sonda (minutos 60, 75, 90 u horas 23 a 99) responden 400 FRANJA_INVALIDA"

duraciones = [
    h("duraciones-deepseek-r2/B1/h1", "defecto",
      f"sonda-inicios.test.ts en aa7d5ed: {HORAS_RARAS} -> 500 ERROR_INTERNO, porque minutosDeHora acepta 10:60 y sumarMinutos "
      "(semilla.ts:50, llamada en nucleo.ts:185) hace Date.parse de ...T10:60 y toISOString lanza RangeError. "
      f"{BASE_RARAS}. En 4e13d4c las 21 -> 400 FRANJA_INVALIDA (salidas/ini_duraciones-deepseek-r2_B_*.txt).",
      "La feature convierte en un 500 un inicio con minutos 60 o 90 que la base rechazaba con 400 FRANJA_INVALIDA, y la reparación lo arregla",
      tipo="comportamiento", gravedad="media", arreglado=True),
    h("duraciones-deepseek-r2/B2/h1", "defecto",
      "sonda-inicios.test.ts: GET /api/disponibilidad con fecha 2026-13-01, 2026-11-32, 2026-99-99 y 0000-00-00 -> 500 en 4e13d4c "
      "(y ya en aa7d5ed), 200 en la base. Con 2026-02-30 el fin de la franja de las 09:00 sale 2026-03-02T10:30 (base 2026-02-30T10:30). "
      "finDeFranja pasa a usar sumarMinutos con Date (semilla.ts:72). La reparación 57bc512 es un commit vacío y sigue dando 500 "
      "(logs/B-reparar2.jsonl: un solo paso que lee cuatro ficheros y termina).",
      "La base ya aceptaba fechas imposibles en la disponibilidad pero el 500 es nuevo de la feature, y la segunda reparación no cambió nada porque la sesión de DeepSeek terminó tras leer cuatro ficheros",
      tipo="comportamiento", gravedad="baja", arreglado=False),
    h("duraciones-deepseek-r3/B1/h1", "defecto",
      "sonda-inicios.test.ts en 9a79f9f: 99:00+60 -> 201 con fin ...T100:00 e importe 1867, y también 98:00+120, 99:30+90, 99:00+120 y "
      "98:30+120. inicioValido compara el fin como texto (nucleo.ts:35-38) y 100:00 queda antes de 22:30. "
      f"{BASE_RARAS}. En a2da7cd las 21 -> 400.",
      "Una hora 99:00 se acepta y guarda un fin 100:00 porque el cierre se compara como texto, algo que la base rechazaba",
      tipo="comportamiento", gravedad="media", arreglado=True),
    h("duraciones-deepseek-r3/B1/h2", "de_mas",
      "test/duraciones.test.ts de 9a79f9f tiene el test de inicios (línea 47) con casos válidos e inválidos, así que el criterio 2 ya tiene tests.",
      "Pide un caso más para un criterio que ya tiene tests, y el fallo real es el de comportamiento de h1"),
    h("duraciones-haiku-r1/D1/h1", "defecto",
      f"sonda-inicios.test.ts en 0b2b57c: {HORAS_RARAS} -> 201 con el inicio guardado tal cual (...T10:60, fin 12:00) y huecos como "
      f"09:00-10:60. nucleo.ts:180 solo comprueba comienzo % 30 sobre los minutos del día. {BASE_RARAS}. "
      "sonda-efecto-1060.test.ts: con una reserva 10:60-12:00 guardada, una 10:00+60 válida recibe 409 FRANJA_NO_DISPONIBLE.",
      "La feature acepta inicios con minutos 60 o 90 que no son en punto ni y media, que la base rechazaba y que luego bloquean reservas válidas pegadas",
      tipo="comportamiento", gravedad="media"),
    h("duraciones-haiku-r1/D1/h2", "previo",
      "sonda-inicios.test.ts: 2026-13-45T10:00 -> 201 en 0b2b57c con fin, duracion e importe coherentes, y la base acepta con 201 "
      "2026-13-45T10:30, 2026-13-01T12:00 y 2027-02-31T10:30. La disponibilidad con fechas imposibles responde 200 igual que en la base.",
      "Aceptar fechas imposibles viene de la base y la spec no pide validarlas, y la feature no añade ningún fallo propio con ellas",
      gravedad="baja"),
    h("duraciones-haiku-r1/D1/h3", "de_mas",
      "En 0b2b57c el criterio 10 tiene los tests de la base (test/club.test.ts:27-38, PISTA_CERRADA y FRANJA_PASADA) y el plan de "
      "verificación no nombra el límite de reservas. El test oculto del límite con duraciones mezcladas pasa.",
      "El criterio ya tiene tests y el propio validador reconoce que la lógica es correcta, así que pide un caso más"),
    h("duraciones-haiku-r1/B1/h1", "defecto",
      "Mismo commit 0b2b57c que D1/h1. Reparación 8a47785 (FECHA_HORA exige :00 o :30): las 21 horas raras de sonda-inicios.test.ts -> 400 FRANJA_INVALIDA.",
      "Es el mismo fallo de los minutos 60 y 90 y la reparación lo arregla",
      tipo="comportamiento", gravedad="media", mismo_que="duraciones-haiku-r1/D1/h1", arreglado=True),
    h("duraciones-haiku-r1/B1/h2", "de_mas",
      "sonda-inicios.test.ts en 0b2b57c: duracion null -> 400 DURACION_INVALIDA. La spec dice que si no viene son 90 y que cualquier otro valor da 400, sin hablar de null.",
      "Un null explícito es un caso que la spec deja abierto y la lectura literal de cualquier otro valor respalda el 400"),
    h("duraciones-haiku-r1/B2/h1", "de_mas",
      "En 8a47785 el criterio 10 sigue teniendo los tests de la base (test/club.test.ts:27-38). Es cierto que ningún test prueba "
      "CUOTA_INACTIVA ni el límite, pero el criterio tiene tests y el plan de verificación no nombra las reglas.",
      "Pide tests con 60 y 120 minutos para reglas que ya tienen tests y cuyo código no depende de la duración"),
    h("duraciones-haiku-r1/B2/h2", "de_mas",
      "sonda-inicios.test.ts en 8a47785: duracion null -> 400 DURACION_INVALIDA, igual que en 0b2b57c.",
      "El propio validador acepta esta lectura y no pide ningún cambio obligatorio"),
    h("duraciones-haiku-r1/B2/h3", "de_mas",
      "nucleo.ts:16 de 8a47785 ya exige :00 o :30 en FECHA_HORA y nucleo.ts:180 mantiene comienzo % 30, redundante pero inocuo.",
      "Es una cuestión de estilo sin efecto en el comportamiento"),
    h("duraciones-haiku-r1/B2/h4", "de_mas",
      "test/duraciones.test.ts de 8a47785 usa R-0520 (línea 205) y la reserva sembrada de las 19:30 del jueves 19 (línea 151).",
      "La dependencia de la semilla es real pero es robustez de los tests, algo que la spec no pide"),
    h("duraciones-haiku-r1/C1/h1", "defecto",
      "Mismo commit 0b2b57c que D1/h1. Reparación 3d1d7bd: las 21 horas raras de sonda-inicios.test.ts -> 400 FRANJA_INVALIDA.",
      "Mismo fallo de minutos fuera de 00 y 30, arreglado en la reparación de C",
      tipo="comportamiento", gravedad="media", mismo_que="duraciones-haiku-r1/D1/h1", arreglado=True),
    h("duraciones-haiku-r1/C1/h2", "de_mas",
      "test/duraciones.test.ts de 0b2b57c tiene el test de inicios (línea 71) con casos válidos e inválidos.",
      "Pide más casos para un criterio que ya tiene tests"),
    h("duraciones-haiku-r2/D1/h1", "defecto",
      f"sonda-inicios.test.ts en 64860c2: {HORAS_RARAS} -> 201 con el inicio guardado tal cual y huecos como 09:00-09:60. "
      f"inicioValido usa comienzo % 60 (nucleo.ts:91-92). {BASE_RARAS}. sonda-efecto-1060.test.ts: tras guardar 10:60-12:00, una 10:00+60 válida -> 409.",
      "La feature acepta minutos 60 y 90 en el inicio, una regresión respecto a la base que además bloquea reservas válidas pegadas",
      tipo="comportamiento", gravedad="media"),
    h("duraciones-haiku-r2/D1/h2", "de_mas",
      "semilla.ts de 64860c2: esPunta compara con el literal 18:00 e importe usa MINUTO_DE_PUNTA. La duplicación existe pero no cambia ningún resultado.",
      "Es mantenimiento del código, no algo que pida la spec"),
    h("duraciones-haiku-r2/B1/h1", "defecto",
      "Mismo commit 64860c2 que D1/h1. Reparación 4f99ade: las 21 horas raras de sonda-inicios.test.ts -> 400 FRANJA_INVALIDA.",
      "Mismo fallo de minutos, arreglado en la reparación de B",
      tipo="comportamiento", gravedad="media", mismo_que="duraciones-haiku-r2/D1/h1", arreglado=True),
    h("duraciones-haiku-r2/B1/h2", "de_mas",
      "semilla.ts de 64860c2 añade duracion: MINUTOS_FRANJA a las reservas sembradas, que es lo que pide el criterio 7, y el test oculto de la huella de la semilla pasa.",
      "El validador no pide ningún cambio y anotarlo en la documentación no lo exige la spec"),
    h("duraciones-haiku-r2/C1/h1", "defecto",
      "Mismo commit 64860c2 que D1/h1. Reparación 1137e8f: las 21 horas raras de sonda-inicios.test.ts -> 400 FRANJA_INVALIDA.",
      "Mismo fallo de minutos, arreglado en la reparación de C",
      tipo="comportamiento", gravedad="media", mismo_que="duraciones-haiku-r2/D1/h1", arreglado=True),
    h("duraciones-haiku-r3/D1/h1", "defecto",
      f"sonda-inicios.test.ts en 45f1e3d: {HORAS_RARAS} -> 201 con el inicio guardado tal cual y huecos como 09:00-10:60. "
      f"nucleo.ts:166 solo comprueba comienzo % 30. {BASE_RARAS}. sonda-efecto-1060.test.ts: tras guardar 10:60-12:00, una 10:00+60 válida -> 409.",
      "La feature acepta minutos 60 y 90 en el inicio, que la base rechazaba",
      tipo="comportamiento", gravedad="media"),
    h("duraciones-haiku-r3/D1/h2", "de_mas",
      "test/duraciones.test.ts de 45f1e3d tiene el test de inicios (línea 52) con casos válidos e inválidos.",
      "Pide más casos para un criterio que ya tiene tests"),
    h("duraciones-haiku-r3/B1/h1", "defecto",
      "Mismo commit 45f1e3d que D1/h1. Reparación cfe42d0: las 21 horas raras de sonda-inicios.test.ts -> 400 FRANJA_INVALIDA.",
      "Mismo fallo de minutos, arreglado en la reparación de B",
      tipo="comportamiento", gravedad="media", mismo_que="duraciones-haiku-r3/D1/h1", arreglado=True),
    h("duraciones-haiku-r3/C1/h1", "defecto",
      "Mismo commit 45f1e3d que D1/h1. Reparación ff59362: las 21 horas raras de sonda-inicios.test.ts -> 400 FRANJA_INVALIDA.",
      "Mismo fallo de minutos, arreglado en la reparación de C",
      tipo="comportamiento", gravedad="media", mismo_que="duraciones-haiku-r3/D1/h1", arreglado=True),
    h("duraciones-luna-r1/B1/h1", "previo",
      "sonda-inicios.test.ts en 9524cf4: 2026-11-31T12:00 y 2026-13-01T12:00 -> 201 con fin, duracion e importe coherentes, igual que "
      "en la base (201). La disponibilidad con esas fechas responde 200 como en la base.",
      "Aceptar fechas imposibles viene de la base y la spec de duraciones no pide validarlas",
      gravedad="baja"),
    h("duraciones-luna-r1/C1/h1", "defecto",
      "test/club.test.ts de 9524cf4: el único solape probado es contra una reserva nueva (líneas 46-47) y ninguno contra una reserva de "
      "la semilla, aunque el plan de verificación pide solapes con reservas nuevas y antiguas. Los huecos solo se miran con Array.isArray "
      "(línea 56) y en la pista cerrada (línea 58). La reparación 24b768e añade el solape con la reserva sembrada del jueves 19 a las 18:00 "
      "y huecos exactos, con el gate en verde.",
      "Lo exigible es el test de solapes con reservas antiguas que el plan nombra y faltaba, el resto de la lista son casos de más para criterios que ya tenían tests",
      tipo="tests", gravedad="baja", arreglado=True),
    h("duraciones-luna-r2/C1/h1", "defecto",
      "test/club.test.ts de 0cd925a: los dos tests nuevos no prueban ningún 409 por solape y el criterio 4 solo tiene el test de la base "
      "que repite la franja exacta de una reserva nueva (línea 33). El plan pide solapes con reservas nuevas y antiguas. La reparación "
      "6d6d414 añade solapes parciales con reservas heredadas y nuevas, adyacencia y liberación al cancelar, con el gate en verde.",
      "Faltaban los tests de solapes que el plan de verificación nombra expresamente",
      tipo="tests", gravedad="baja", arreglado=True),
    h("duraciones-luna-r3/D1/h1", "defecto",
      "README.md:17 de 23fddd8 dice que las reservas deben terminar antes de las 22:30. La spec dice como muy tarde a las 22:30 y la API "
      "acepta 21:30+60 (el test oculto de C2 que termina justo a las 22:30 pasa).",
      "El README explica mal el límite de los inicios válidos que el criterio 12 pide documentar",
      tipo="documentacion", gravedad="baja"),
    h("duraciones-luna-r3/B1/h1", "defecto",
      "Mismo commit 23fddd8 que D1/h1. En la reparación 04ae309 README.md:17 dice terminar como muy tarde a las 22:30.",
      "Mismo error del README, corregido en la reparación de B",
      tipo="documentacion", gravedad="baja", mismo_que="duraciones-luna-r3/D1/h1", arreglado=True),
    h("duraciones-luna-r3/B2/h1", "previo",
      "sonda-inicios.test.ts en 04ae309: 2026-99-99T12:00 -> 201 con fin, duracion e importe coherentes, y la base también lo acepta con 201.",
      "Las fechas imposibles ya se aceptaban en la base y la spec no pide validarlas",
      gravedad="baja"),
    h("duraciones-luna-r3/C1/h1", "defecto",
      "sonda-inicios.test.ts en 23fddd8: 99:00+60 -> 201 con fin ...T100:00, y también 98:00+120, 99:30+90, 99:00+120 y 98:30+120. "
      f"nucleo.ts:162 compara fin.slice(11) con 22:30 como texto. {BASE_RARAS}. En la reparación 2504f15 las 21 -> 400.",
      "Una hora 99:00 pasa la validación porque el fin se compara como texto, y la reparación de C lo arregla",
      tipo="comportamiento", gravedad="media", arreglado=True),
    h("duraciones-luna-r3/C1/h2", "defecto",
      "Mismo commit 23fddd8 que D1/h1. En la reparación 2504f15 README.md:17 dice terminar como muy tarde a las 22:30.",
      "Mismo error del README, corregido en la reparación de C",
      tipo="documentacion", gravedad="baja", mismo_que="duraciones-luna-r3/D1/h1", arreglado=True),
    h("duraciones-luna-r3/C2/h1", "de_mas",
      "test/club.test.ts de 2504f15: el criterio 10 tiene los tests de la base (líneas 27-38), el 11 el de cancelar (línea 40), los huecos "
      "tienen test (líneas 117-119) y hay un solape con reserva nueva (línea 85). Todo lo que la descripción echa en falta son casos de más. "
      "El único caso del plan que falta, el solape con reservas de la semilla, solo aparece en el cambio y sigue sin test en 2e50093.",
      "Pide más casos para criterios que ya tienen tests, aunque de paso menciona un caso del plan, el solape con reservas antiguas, que nunca se añadió"),
    h("duraciones-sol-r2/D1/h1", "defecto",
      "sonda-inicios.test.ts en 7485976: 2027-13-01T09:00 con 60, 90 y 120, 2026-13-01T12:00 y 2026-99-99T12:00 -> 201 con duracion null "
      "al crear, en el detalle y en el listado, porque reservaConDuracion la saca con Date.parse (nucleo.ts:35-36). La base acepta esas "
      "fechas con 201 pero no tenía el campo. Con 2026-11-31 y 2027-02-31 sale 90.",
      "Aceptar la fecha imposible es previo, pero devolver duracion null es un fallo nuevo del campo que añade la feature, aunque solo aparece con fechas que no existen",
      tipo="comportamiento", gravedad="baja"),
]

exportar = [
    h("exportar-csv-deepseek-r2/B1/h1", "ambigua",
      "sonda-exportar.test.ts en b0e6875: desde=2026-02-30 y 2026-02-29 -> 200 sin filas, 2026-09-31..2026-10-05 -> 200 con las mismas 46 "
      "filas que 2026-10-01..2026-10-05, y 2027-13-01 -> 400. GET /api/reservas de la base acepta esas fechas con 200, y en la base "
      "el aviso debe tener el formato AAAA-MM-DD solo comprueba la expresión FECHA (club/src/nucleo.ts:103). La referencia sí las "
      "rechaza (referencias/exportar-csv/src/nucleo.ts:30, numeroDeDia) y el test oculto de formato solo prueba formas mal escritas. "
      "En a19f726 todas -> 400.",
      "La spec (exportar-csv.md:51) dice con formato AAAA-MM-DD y si el formato no vale 400, y 2026-02-30 tiene ese formato pero no existe, así que admite leer formato como forma, igual que la base, o como fecha válida, igual que la referencia"),
    h("exportar-csv-deepseek-r2/B1/h2", "de_mas",
      "sonda-exportar.test.ts en b0e6875: una nota =HYPERLINK(...) sale entre comillas y con las comillas duplicadas, como pide el RFC 4180.",
      "La neutralización de fórmulas no la pide la spec y el propio validador lo reconoce"),
    h("exportar-csv-haiku-r1/B1/h1", "de_mas",
      "test/exportar.test.ts de 3137bce: before() crea B, C, A, F y D en el mismo orden en que deben salir, así que quitar el sort no "
      "rompería el test de filas, pero el criterio 4 tiene ese test y el orden real es correcto (test oculto en verde).",
      "Es una mejora de un test que ya existe para el criterio 4"),
    h("exportar-csv-haiku-r1/B1/h2", "de_mas",
      "sonda-exportar.test.ts en 3137bce: estado= -> 400 DATOS_INVALIDOS, coherente con el criterio 9 (con otro valor, 400) y con GET /api/reservas.",
      "El caso del estado vacío lo deja abierto la spec y el comportamiento es coherente con ella"),
    h("exportar-csv-haiku-r1/B1/h3", "de_mas",
      "sonda-exportar.test.ts en 3137bce: la nota =HYPERLINK(...) se exporta tal cual con el escapado del RFC 4180.",
      "La spec pide el RFC 4180 exacto y no habla de fórmulas"),
    h("exportar-csv-haiku-r1/B2/h1", "de_mas",
      "git diff 3137bce 55adde0 -- docs/specs/exportar-csv.md: la reparación añade una sección Decisiones a la spec. Ni la spec ni AGENTS.md "
      "lo prohíben y no cambia la API ni el README que pide el criterio 11. La reparación 2eee30e la quita.",
      "Es una objeción de proceso sobre dónde se registran las decisiones, no un incumplimiento de la spec"),
    h("exportar-csv-haiku-r1/B2/h2", "de_mas",
      "sonda-exportar.test.ts en 55adde0: desde=2026-01-01&hasta=2026-12-31&estado=pagada -> 400 RANGO_DEMASIADO_GRANDE, y estado=pagada con "
      "un periodo válido -> 400 DATOS_INVALIDOS.",
      "La spec no fija qué error gana cuando fallan a la vez el periodo y el estado"),
    h("exportar-csv-haiku-r1/B2/h3", "de_mas",
      "test/exportar.test.ts de 55adde0: el test respuesta no afirma el 200, pero el de permisos sí lo afirma para el gestor.",
      "El criterio 2 ya tiene tests y pide una aserción más"),
    h("exportar-csv-haiku-r1/B2/h4", "de_mas",
      "test/exportar.test.ts de 55adde0: el test de GET /api/reservas mira total, longitud y una reserva.",
      "El criterio 10 ya tiene test y el propio validador marca la mejora como opcional"),
    h("exportar-csv-haiku-r2/B1/h1", "defecto",
      "sonda-exportar.test.ts en 1b226cb: desde=2027-13-01, desde=2027-00-10, desde=2027-02-00 y hasta=2027-13-11 -> 500 ERROR_INTERNO, "
      "porque fechaExiste llama a toISOString con una fecha inválida (nucleo.ts:41). En 99c6002 -> 400 DATOS_INVALIDOS.",
      "Un 500 no es una respuesta válida con ninguna lectura del criterio 8, y la reparación lo convierte en 400",
      tipo="comportamiento", gravedad="media", arreglado=True),
    h("exportar-csv-haiku-r2/B1/h2", "de_mas",
      "sonda-exportar.test.ts en 1b226cb: la nota =HYPERLINK(...) sale tal cual con el escapado del RFC 4180.",
      "Riesgo fuera de la spec, como reconoce el propio validador"),
    h("exportar-csv-luna-r2/C1/h1", "defecto",
      "test/club.test.ts de 8bac5bd: el test RFC 4180 (línea 59) no crea notas con comas, comillas ni saltos de línea, y ningún test mira "
      "importe ni penalización (la expresión de la línea 74 solo cubre los cuatro primeros campos). El plan pide notas con comas, comillas "
      "y saltos de línea. La reparación 73c4dd9 añade la comparación exacta del CSV con la semilla, que cubre importes y orden, pero la "
      "semilla no tiene notas con esos caracteres.",
      "Faltaban los tests de escapado que el plan nombra expresamente y el criterio 5 no tenía ningún test, y la primera reparación solo arregló lo segundo",
      tipo="tests", gravedad="baja", arreglado=False),
    h("exportar-csv-luna-r2/C2/h1", "defecto",
      "test/club.test.ts de 73c4dd9: la comparación exacta (líneas 79-86) usa solo notas de la semilla, sin comas, comillas ni saltos de "
      "línea, así que el escapado no se ejercita. La reparación c839497 crea notas con coma, comillas, LF y CRLF y compara el escapado "
      "literal, con el gate en verde.",
      "El plan de verificación pide expresamente notas con comas, comillas y saltos de línea y la segunda reparación las añade",
      tipo="tests", gravedad="baja", arreglado=True),
]


def comprobar(nombre, revision):
    paquete = json.loads((ANALISIS / "paquetes" / f"{nombre}.json").read_text())
    ids = [x["id"] for x in paquete]
    mios = [x["id"] for x in revision]
    assert sorted(ids) == sorted(mios), (set(ids) ^ set(mios))
    assert len(set(mios)) == len(mios)
    por_id = {x["id"]: x for x in revision}
    for x in revision:
        assert x["categoria"] in ("defecto", "previo", "de_mas", "error", "ambigua")
        assert ("tipo" in x) == (x["categoria"] == "defecto")
        assert ("gravedad_real" in x) == (x["categoria"] in ("defecto", "previo"))
        assert ";" not in x["nota"] and "«" not in x["nota"] and "»" not in x["nota"], x["id"]
        assert not x["nota"].endswith("."), x["id"]
        if x["mismo_que"]:
            assert x["mismo_que"] in por_id and por_id[x["mismo_que"]]["mismo_que"] is None
        if x["categoria"] != "defecto":
            assert x["arreglado"] is None, x["id"]
    # Mismo orden que el paquete.
    return [por_id[i] for i in ids]


for nombre, revision in (("duraciones", duraciones), ("exportar-csv", exportar)):
    ordenada = comprobar(nombre, revision)
    destino = ANALISIS / "revision" / f"{nombre}.json"
    destino.write_text(json.dumps(ordenada, ensure_ascii=False, indent=2) + "\n")
    cuenta = {}
    for x in ordenada:
        cuenta[x["categoria"]] = cuenta.get(x["categoria"], 0) + 1
    print(nombre, len(ordenada), cuenta)
