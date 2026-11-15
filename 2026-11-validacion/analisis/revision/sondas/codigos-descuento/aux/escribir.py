import json, sys
from pathlib import Path

PAQ = Path("analisis/revision/paquetes/codigos-descuento.json")
SAL = Path("analisis/revision/clasificacion/codigos-descuento.json")
S = "sondas/codigos-descuento/"

def e(id, categoria, comprobacion, nota, tipo=None, gravedad=None, mismo_que=None, arreglado=None):
    return {"id": id, "categoria": categoria, "tipo": tipo, "gravedad_real": gravedad, "mismo_que": mismo_que,
            "comprobacion": comprobacion, "arreglado": arreglado, "nota": nota}

H1 = "codigos-descuento-haiku-r1/"
H2 = "codigos-descuento-haiku-r2/"
L1 = "codigos-descuento-luna-r1/"
L2 = "codigos-descuento-luna-r2/"

r = []

# ---------------- haiku-r1 (b399f3a) ----------------
r.append(e(H1 + "D1/h1", "defecto",
    f"{S}sonda-formato.test.ts en impl b399f3a: pista-4 cerrada con codigo NOEXISTE da 400 CODIGO_INVALIDO, socio-999 con NOEXISTE da 400 CODIGO_INVALIDO y franja pasada o cuota inactiva (socio-011) con NOEXISTE dan 400 CODIGO_INVALIDO. En la base esas peticiones dan PISTA_CERRADA, SOCIO_NO_ENCONTRADO, FRANJA_PASADA y CUOTA_INACTIVA. src/nucleo.ts:184-185 valida tipo y catálogo antes de buscar el socio. Con un código válido la regla sí va primero (pista-4 con BIENVENIDA da 409 PISTA_CERRADA). C8 dice que si la reserva no se puede hacer (cuota, franja, pista, límite) se responde ese error. La misma sonda sobre referencias/codigos-descuento da PISTA_CERRADA, SOCIO_NO_ENCONTRADO, FRANJA_PASADA y CUOTA_INACTIVA con NOEXISTE ({S}salidas/formato_referencia.txt), y las otras nueve implementaciones del encargo también buscan el código en el catálogo después de las reglas. Los tests ocultos de C8 solo usan códigos válidos. La parte del codigo no textual (DATOS_INVALIDOS antes de las reglas) es aceptable, la base valida así el tipo de notas y la referencia hace lo mismo.",
    "Un código fuera del catálogo se rechaza con 400 antes que la pista cerrada, la cuota, la franja pasada o el socio inexistente, en contra de C8, aunque rechazar antes un codigo que no es texto sí vale.",
    tipo="comportamiento", gravedad="baja"))
r.append(e(H1 + "D1/h2", "defecto",
    f"README.md:64 de b399f3a dice que las reglas del club se comprueban antes que el código, pero la misma sonda ({S}sonda-formato.test.ts) muestra que un código fuera del catálogo se rechaza antes que la pista cerrada o el socio inexistente. La frase repite lo que pide C8 y deja de ser falsa en cuanto se corrige el orden de D1/h1, como dice el propio hallazgo.",
    "El README describe el orden que pide la spec y no el que tiene el código, así que es el mismo defecto de orden de D1/h1 visto desde la documentación.",
    tipo="comportamiento", gravedad="baja", mismo_que=H1 + "D1/h1"))
r.append(e(H1 + "D1/h3", "de_mas",
    "test/codigos.test.ts de b399f3a: el test de CLUB10 comprueba el 10 %, que la cancelada no cuenta y que la cuarta reserva da 409 con tres confirmadas ya pasadas. src/nucleo.ts cuenta estado distinto de cancelada, así que entran las no presentadas. La API no tiene ninguna ruta para marcar una reserva como no presentada. El test de núcleo con no presentadas que añadió la reparación de C (718cd8c, sin tocar src) pasa en " + S + "sonda-gate.test.ts.",
    "CLUB10 ya tiene tests por la API y las no presentadas no se pueden crear por la API, así que ese test es un caso de más.",
    ))
r.append(e(H1 + "D1/h4", "de_mas",
    "git diff base b399f3a no toca docs/specs, la spec sigue con Estado pendiente de implementar. Ni la spec ni club/AGENTS.md piden cambiar ese estado.",
    "Actualizar el estado de la spec no lo pide la spec ni AGENTS.md."))
r.append(e(H1 + "C1/h1", "defecto",
    f"README.md:62 de b399f3a lista SOCIO_NO_ENCONTRADO y PISTA_NO_ENCONTRADA entre los errores 409 de POST /api/reservas. {S}sonda-formato.test.ts: socio-999 da 404 SOCIO_NO_ENCONTRADO y pista-9 da 404 PISTA_NO_ENCONTRADA. El README de la base no daba códigos HTTP, así que el error es nuevo y contradice la convención del propio README (404 si algo no existe). La spec pide actualizar la referencia de POST /api/reservas. En 718cd8c README.md:62 pone 404 para esos dos errores y los quita de la lista de 409.",
    "La referencia de POST /api/reservas que pide actualizar la spec quedó con dos errores 404 listados como 409, y la reparación lo corrigió.",
    tipo="documentacion", gravedad="baja", arreglado=True))
r.append(e(H1 + "C1/h2", "defecto",
    f"Mismo commit b399f3a y mismo orden que D1/h1. {S}sonda-formato.test.ts en la reparación 718cd8c: pista-4 con NOEXISTE sigue dando 400 CODIGO_INVALIDO y socio-999 con NOEXISTE también. La reparación no movió la comprobación (src sin cambios) y solo dejó escrito en README.md:65 que los errores 400 van antes que las reglas del club.",
    "Es el mismo código fuera del catálogo rechazado antes que las reglas del club, y la reparación lo documentó en vez de cambiar el orden.",
    tipo="comportamiento", gravedad="baja", mismo_que=H1 + "D1/h1", arreglado=False))
r.append(e(H1 + "C1/h3", "de_mas",
    "Mismo commit b399f3a y mismo punto que D1/h3: CLUB10 tiene tests de API del descuento, de la cancelada y del límite con confirmadas pasadas, y las no presentadas solo se pueden probar por el núcleo.",
    "El criterio ya estaba probado y las no presentadas no se pueden crear por la API.",
    mismo_que=H1 + "D1/h3"))

# ---------------- haiku-r2 (c1a54bd) ----------------
r.append(e(H2 + "B1/h1", "de_mas",
    f"test/codigos-descuento.test.ts de c1a54bd: el test de BIENVENIDA reserva para socio-041 la pista-1 el miércoles 25 a las 10:30, una franja de MANANAS, y exige descuento 900 e importe 900, así que un descuento acumulado lo haría fallar. El test de codigo 123 comprueba que un codigo no textual da 400 DATOS_INVALIDOS. Solo falta el caso del array. npm run check en verde con 16 tests ({S}sonda-gate.test.ts).",
    "El test de BIENVENIDA en una mañana entre semana ya comprueba que los descuentos no se acumulan y el de 123 que solo vale un texto, así que el array es un caso de más."))
r.append(e(H2 + "B1/h2", "defecto",
    f"{S}sonda-formato.test.ts en c1a54bd: pista-4 con codigo 123 y cuota inactiva con 123 dan 400 DATOS_INVALIDOS (src/nucleo.ts:160), mientras que con NOEXISTE salen PISTA_CERRADA y CUOTA_INACTIVA. Validar el tipo antes de las reglas es admisible, la base lo hace con notas y la referencia también (pista-4 con 123 da DATOS_INVALIDOS en {S}salidas/formato_referencia.txt). Pero README.md:62 dice que CODIGO_INVALIDO, CODIGO_NO_APLICABLE y DATOS_INVALIDOS se comprueban después de las reglas del club, lo que es falso para DATOS_INVALIDOS. En 90e57b2 la comprobación de tipo pasa a src/nucleo.ts:175, detrás de las reglas: pista-4 con 123 da 409 PISTA_CERRADA y el README queda cierto.",
    "El orden en sí era válido, pero el README afirmaba lo contrario y el cambio pedido, decidir y dejarlo escrito, resolvía esa contradicción, como hizo la reparación.",
    tipo="documentacion", gravedad="baja", arreglado=True))
r.append(e(H2 + "B1/h3", "de_mas",
    "test/codigos-descuento.test.ts de c1a54bd: MANANAS tiene tests del miércoles 10:30 con descuento 400, del lunes 09:00 en minúsculas, de las 12:00 con 409 y del sábado 09:00 con 409. La lógica es día de lunes a viernes y hora menor que 12:00, y los tests ocultos de viernes y domingo pasan.",
    "MANANAS ya tiene tests del descuento y de los rechazos, así que viernes y domingo son casos de más."))
r.append(e(H2 + "B1/h4", "de_mas",
    "git diff base c1a54bd no toca docs/specs. Ni la spec ni club/AGENTS.md piden cambiar el estado de la spec.",
    "Cambiar el estado de la spec no lo pide nadie y el propio validador lo da por opcional."))

# ---------------- luna-r1 ----------------
r.append(e(L1 + "D1/h1", "defecto",
    f"{S}sonda-formato.test.ts en impl 2000fbf: codigo vacío, de tres espacios o un tabulador responde 201 y crea la reserva sin codigo (socio-003 pasa de 13 a 14 reservas). src/nucleo.ts:150 solo valida el catálogo si el código normalizado es verdadero. C5 dice que un código que no está en el catálogo responde 400 CODIGO_INVALIDO y el texto vacío no está. La misma sonda sobre la referencia y sobre las dos implementaciones de haiku da 400 CODIGO_INVALIDO. Los tests ocultos de C5 no prueban el código vacío.",
    "Un codigo vacío o de espacios se acepta como reserva sin código en vez de responder 400 CODIGO_INVALIDO, un caso raro cuyo efecto es el mismo que no mandar código.",
    tipo="comportamiento", gravedad="baja"))
r.append(e(L1 + "D1/h2", "defecto",
    f"{S}sonda-gate.test.ts (npm run check) en 2000fbf: rc 1, pasan 6 de 8 tests. Falla el test de descuentos con TypeError en test/club.test.ts:47 porque socio-042 no existe y responde 404, y el de penalización con TypeError en test/club.test.ts:70 porque la pista-3 del 19 a las 09:00 ya la ocupa R-0520 ({S}sonda-socio007.test.ts).",
    "npm run check queda en rojo porque los tests nuevos usan socios que no existen y una franja ocupada, y AGENTS.md exige pasarlo.",
    tipo="tests", gravedad="alta"))
r.append(e(L1 + "D1/h3", "defecto",
    f"Mismo gate rojo de 2000fbf que D1/h2. El tramo del límite de CLUB10 está al final del test de penalización, que falla antes en test/club.test.ts:70. Aunque llegara, socio-007 ya tiene una reserva futura (R-0515, {S}sonda-socio007.test.ts), así que la tercera reserva con CLUB10 chocaría con LIMITE_DE_RESERVAS antes que con el límite del código.",
    "El test del límite de CLUB10 está roto y ni funcionando podría comprobar el límite, dentro del mismo gate en rojo de D1/h2.",
    tipo="tests", gravedad="alta", mismo_que=L1 + "D1/h2"))
r.append(e(L1 + "B1/h1", "defecto",
    f"Mismo commit 2000fbf y mismo defecto que D1/h1. {S}sonda-formato.test.ts en la reparación 66fab9d: codigo vacío, de espacios o un tabulador da 400 CODIGO_INVALIDO y no crea reserva (src/nucleo.ts:150 comprueba si se mandó codigo).",
    "Es el mismo código vacío aceptado de D1/h1 y la primera reparación de B lo arregló.",
    tipo="comportamiento", gravedad="baja", mismo_que=L1 + "D1/h1", arreglado=True))
r.append(e(L1 + "B1/h2", "defecto",
    f"Mismo gate rojo de 2000fbf que D1/h2. {S}sonda-gate.test.ts en la reparación 66fab9d: npm run check sigue con rc 1, falla el test de descuentos en test/club.test.ts:47 (socio-042, 404 en vez de 201) y el de penalización en test/club.test.ts:81 (MANANAS el sábado 21, 409 en vez de 201).",
    "El gate en rojo es real y la primera reparación no lo dejó en verde.",
    tipo="tests", gravedad="alta", mismo_que=L1 + "D1/h2", arreglado=False))
r.append(e(L1 + "B2/h1", "error",
    f"{S}sonda-formato.test.ts en 66fab9d: /_estado tiene 41 socios y socio-041 (Nora Benítez, cuota al día, sin reservas) existe, y POST con socio-041 y BIENVENIDA responde 201 con descuento 1400. En el gate de 66fab9d la reserva BIENVENIDA de socio-041 se crea y el test falla después, con socio-042. Los tests ocultos de C2, que usan socio-041, pasan en este estado.",
    "socio-041 sí existe y BIENVENIDA funciona con ella, el 404 venía de socio-042, y la reparación que provocó este hallazgo añadió un socio de prueba a la semilla."))
r.append(e(L1 + "B2/h2", "defecto",
    f"{S}sonda-gate.test.ts en 66fab9d: npm run check con rc 1, el test de descuentos falla en test/club.test.ts:47 porque la reserva MANANAS de socio-042 responde 404. En la reparación 52180b2 ese tramo usa socio-041 y npm run check pasa 8 de 8.",
    "El test de MANANAS usa un socio que no existe y deja el gate en rojo, y la segunda reparación lo arregló.",
    tipo="tests", gravedad="alta", arreglado=True))
r.append(e(L1 + "B2/h3", "defecto",
    f"Mismo gate rojo de 66fab9d que B2/h2. El 10 % de CLUB10 se prueba con socio-043, que no existe, detrás del fallo de socio-042, y el tramo del límite usa socio-007 al final del test de penalización, que falla antes en test/club.test.ts:81, así que ningún test llega a comprobar CLUB10. En 52180b2 el límite se prueba con socio-042 y su historial y el gate pasa.",
    "Ningún test llegaba a comprobar CLUB10 en 66fab9d aunque el límite usaba socio-007 y no socio-043, y la reparación lo dejó probado en verde a costa de meter un socio en la semilla.",
    tipo="tests", gravedad="alta", mismo_que=L1 + "B2/h2", arreglado=True))
r.append(e(L1 + "B2/h4", "defecto",
    f"{S}sonda-gate.test.ts en 66fab9d: el test de penalización falla en test/club.test.ts:81 con 409 en vez de 201 porque pide MANANAS el sábado 21 de noviembre (día 6 según {S}sonda-socio007.test.ts). En 52180b2 usa el viernes 20 y pasa.",
    "El test de penalización pedía MANANAS en sábado y fallaba, y la segunda reparación lo corrigió.",
    tipo="tests", gravedad="alta", mismo_que=L1 + "B2/h2", arreglado=True))
r.append(e(L1 + "B2/h5", "error",
    f"{S}sonda-gate.test.ts en 66fab9d: el test de descuentos crea la reserva de socio-041 con BIENVENIDA (201, 1200, 600, 600) y comprueba el listado antes de fallar en test/club.test.ts:47 por socio-042. {S}sonda-formato.test.ts confirma que socio-041 existe. C7 ya se comprueba en la respuesta del POST y en GET /api/reservas, y los tests ocultos de C7 pasan.",
    "La prueba de C7 no falla por socio-041, que existe y crea la reserva, y que falte el GET por id es un caso de más."))
r.append(e(L1 + "B3/h1", "defecto",
    f"git diff 66fab9d 52180b2 en src/semilla.ts:126 y :163-166: la reparación mete en la semilla a socio-042 (Álex Pruebas) y tres reservas del 16 de noviembre con codigo CLUB10 y descuento 0. {S}sonda-semilla.test.ts en 52180b2 frente a la base: 42 socios y 528 reservas en vez de 41 y 525, GET /api/reservas/R-0526 devuelve codigo CLUB10 con importeBase 1800, descuento 0 e importe 1800, GET /api/reservas del 16 pasa de 7 a 10, GET /api/socios?texto=pruebas lo devuelve, la disponibilidad del 16 cambia en la pista-1 a las 09:00 y la primera reserva nueva es R-0529 y no R-0526.",
    "La segunda reparación metió en la semilla un socio de prueba con reservas CLUB10 sin descuento que la API devuelve, algo que la spec no pide y que no cuadra con lo que guarda una reserva con código.",
    tipo="comportamiento", gravedad="baja"))
r.append(e(L1 + "C1/h1", "defecto",
    f"Mismo commit 2000fbf y mismo defecto que D1/h1. {S}sonda-formato.test.ts en la reparación 0f1d3ab: codigo vacío, de espacios o un tabulador da 400 CODIGO_INVALIDO sin crear reserva (src/nucleo.ts:150 comprueba codigo distinto de undefined).",
    "Es el mismo código vacío aceptado de D1/h1 y la reparación de C lo arregló.",
    tipo="comportamiento", gravedad="baja", mismo_que=L1 + "D1/h1", arreglado=True))
r.append(e(L1 + "C1/h2", "de_mas",
    f"{S}sonda-formato.test.ts en 2000fbf: socio-011 (cuota inactiva) con codigo 123 y pista-4 con 123 dan 400 DATOS_INVALIDOS (src/nucleo.ts:134), mientras que con NOEXISTE salen CUOTA_INACTIVA y PISTA_CERRADA. La base valida el tipo de notas antes de cualquier regla, la referencia valida el tipo de codigo en ese mismo punto y C5 lo trata como error de datos. El README de 2000fbf no dice nada del orden.",
    "Rechazar primero un codigo que no es texto es validación de datos como la de notas y la spec no exige ponerla detrás de las reglas del club."))
r.append(e(L1 + "C1/h3", "defecto",
    f"Mismo gate rojo de 2000fbf que D1/h2 (rc 1, TypeError en test/club.test.ts:47 y :70). {S}sonda-gate.test.ts en la reparación 0f1d3ab: npm run check pasa 9 de 9.",
    "El gate en rojo es real y la reparación de C lo dejó en verde.",
    tipo="tests", gravedad="alta", mismo_que=L1 + "D1/h2", arreglado=True))
r.append(e(L1 + "C1/h4", "de_mas",
    "README.md:28 de 2000fbf da los tres códigos con sus condiciones en una línea (BIENVENIDA 50 % en la primera reserva hasta el 31 de diciembre de 2026, MANANAS 4,00 € de lunes a viernes en franjas que empiezan antes de las 12:00, CLUB10 10 % en cualquier franja hasta tres reservas activas o no presentadas por socio), y además el campo codigo, los campos nuevos y los errores nuevos.",
    "El README ya documenta el catálogo con sus condiciones y lo que pide el validador es más precisión en la redacción."))

# ---------------- luna-r2 (67fced1) ----------------
r.append(e(L2 + "D1/h1", "defecto",
    f"{S}sonda-formato.test.ts en impl 67fced1: codigo vacío, de tres espacios o un tabulador responde 201 y crea la reserva sin codigo (socio-003 pasa de 13 a 14 reservas). src/nucleo.ts:150 solo valida el catálogo si el código normalizado es verdadero. C5 manda 400 CODIGO_INVALIDO para lo que no está en el catálogo y los tests ocultos no prueban el código vacío.",
    "Igual que en luna-r1, un codigo vacío o de espacios se acepta como reserva sin código en vez de responder 400 CODIGO_INVALIDO.",
    tipo="comportamiento", gravedad="baja"))
r.append(e(L2 + "B1/h1", "defecto",
    f"Mismo commit 67fced1 y mismo defecto que D1/h1. {S}sonda-formato.test.ts en la reparación 36afe36: codigo vacío, de espacios o un tabulador da 400 CODIGO_INVALIDO y no crea reserva (src/nucleo.ts:150).",
    "Es el mismo código vacío aceptado de D1/h1 y la reparación de B lo arregló.",
    tipo="comportamiento", gravedad="baja", mismo_que=L2 + "D1/h1", arreglado=True))
r.append(e(L2 + "C1/h1", "defecto",
    f"Mismo commit 67fced1 y mismo defecto que D1/h1. {S}sonda-formato.test.ts en la reparación f153cf9: codigo vacío, de espacios o un tabulador da 400 CODIGO_INVALIDO y no crea reserva.",
    "Es el mismo código vacío aceptado de D1/h1 y la reparación de C lo arregló.",
    tipo="comportamiento", gravedad="baja", mismo_que=L2 + "D1/h1", arreglado=True))
r.append(e(L2 + "C1/h2", "de_mas",
    "README.md:28 de 67fced1 da el catálogo en una línea (BIENVENIDA 50 % en la primera reserva hasta el 31/12/2026, MANANAS 4 € de lunes a viernes antes de las 12:00, CLUB10 10 % hasta tres reservas activas o no presentadas por socio), README.md:52 nombra importeBase, descuento, importe como precio tras descuento y codigo si se usó, y README.md:49 da el campo codigo y los errores nuevos. Está todo lo que pide C11, resumido.",
    "El README nombra el campo codigo, el catálogo con sus condiciones, los campos nuevos y los errores, y definir cada campo o precisar las condiciones es más de lo que pide la spec."))
r.append(e(L2 + "C1/h3", "defecto",
    f"test/codigos-descuento.test.ts de 67fced1 tiene tres tests (BIENVENIDA, MANANAS y CLUB10 con importes, errores y penalización). No hay ningún test de C8 ni de C6, ni del límite de CLUB10, la caducidad de BIENVENIDA o los rechazos de MANANAS, y el plan de verificación pide tests de cada código, sus condiciones y sus errores. npm run check en verde ({S}sonda-gate.test.ts). En la reparación f153cf9 hay 16 tests en verde, entre ellos la prioridad de las reglas del club, el límite de CLUB10 con sus estados, la caducidad de BIENVENIDA y los rechazos de MANANAS.",
    "Faltaban tests de criterios enteros como C8 y de las condiciones de CLUB10, MANANAS y BIENVENIDA que pide el plan de verificación, y la reparación de C los añadió.",
    tipo="tests", gravedad="media", arreglado=True))

# Comprobaciones
paquete = json.load(open(PAQ))
ids_paq = [h["id"] for h in paquete]
ids = [x["id"] for x in r]
assert sorted(ids) == sorted(ids_paq), (set(ids) ^ set(ids_paq))
assert len(ids) == len(set(ids)) == 31
for x in r:
    assert x["categoria"] in ("defecto", "previo", "de_mas", "error", "ambigua")
    if x["categoria"] == "defecto":
        assert x["tipo"] in ("comportamiento", "documentacion", "tests"), x["id"]
    else:
        assert x["tipo"] is None, x["id"]
    if x["categoria"] in ("defecto", "previo"):
        assert x["gravedad_real"] in ("alta", "media", "baja"), x["id"]
    else:
        assert x["gravedad_real"] is None, x["id"]
    if x["mismo_que"]:
        assert x["mismo_que"] in ids, x["id"]
    for campo in ("nota", "comprobacion"):
        assert ";" not in x[campo], (x["id"], campo)
        assert "«" not in x[campo] and "»" not in x[campo], (x["id"], campo)
    est = next(h for h in paquete if h["id"] == x["id"])
    if x["categoria"] != "defecto" or est["estado_reparado"] is None:
        assert x["arreglado"] is None, x["id"]
    else:
        assert x["arreglado"] in (True, False), x["id"]
# Mismo orden que el paquete
orden = {i: n for n, i in enumerate(ids_paq)}
r.sort(key=lambda x: orden[x["id"]])
SAL.parent.mkdir(parents=True, exist_ok=True)
SAL.write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n")
from collections import Counter
print(Counter(x["categoria"] for x in r))
print("escrito", SAL)
