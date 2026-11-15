"""Escribe la revisión de reservas-fijas: un objeto por hallazgo del paquete."""
import json
from pathlib import Path

A = Path("analisis/revision")
paquete = json.loads((A / "paquetes/reservas-fijas.json").read_text())

F = "sondas/reservas-fijas/fechas.test.ts (salida en out-fechas/)"
D = "sondas/reservas-fijas/dst.test.ts (salida en out-dst/)"
S = "sondas/reservas-fijas/forma.test.ts (salida en out-forma/)"
BASE_FECHAS = "En la base, POST /api/reservas con 2027-13-01T10:30, 2027-12-32T10:30 o 2027-02-30T10:30 da 201 y guarda la fecha tal cual, sin 500 ni desplazamiento."
BASE_DST = ("En la base, con la misma sonda, la reserva normal del 2027-03-28T10:30 se cancela gratis con el reloj en 2027-03-27T10:30 (23 h reales) "
            "y la del 2027-10-31T10:30 da FUERA_DE_PLAZO con el reloj en 2027-10-30T11:00 (24,5 h reales), igual con TZ=UTC y TZ=Europe/Madrid.")


def dst_estado(commit: str) -> str:
    return (f"{D} en {commit}: la serie del 2027-03-28T10:30 se cancela gratis con 23 h reales, la del 2027-10-31T10:30 queda en pendientes "
            f"con 24,5 h reales y con forzar paga 2000, lo mismo que la reserva normal. {BASE_DST}")


def defecto(id_, gravedad, comprobacion, nota, mismo_que=None, arreglado=None):
    return dict(id=id_, categoria="defecto", tipo="comportamiento", gravedad_real=gravedad, mismo_que=mismo_que,
                comprobacion=comprobacion, arreglado=arreglado, nota=nota)


def previo(id_, gravedad, comprobacion, nota, mismo_que=None):
    return dict(id=id_, categoria="previo", tipo=None, gravedad_real=gravedad, mismo_que=mismo_que,
                comprobacion=comprobacion, arreglado=None, nota=nota)


def otra(id_, categoria, comprobacion, nota, mismo_que=None):
    return dict(id=id_, categoria=categoria, tipo=None, gravedad_real=None, mismo_que=mismo_que,
                comprobacion=comprobacion, arreglado=None, nota=nota)


p = "reservas-fijas-"
r = [
    # ---- deepseek-r1, 1b6e99e7 ----
    defecto(p + "deepseek-r1/D1/h1", "media",
            f"{F} en 1b6e99e7: POST /api/series con 2027-13-01T10:30 y 2027-12-32T10:30 da 500 ERROR_INTERNO (RangeError en sumarSemanas, src/nucleo.ts) "
            f"y con 2027-02-30T10:30 da 201 con serie.inicio 2027-02-30T10:30 y reservas el 2027-03-02 y el 2027-03-09. {BASE_FECHAS}",
            "La base tolera fechas imposibles en reservas normales pero la serie añade un 500 y una primera reserva que no cae en inicio, y C2 pide 400 FRANJA_INVALIDA"),
    defecto(p + "deepseek-r1/B1/h1", "baja",
            f"Mismo commit y misma sonda que D1/h1 (500 con mes 13 y día 32). Con la reparación bd95beb1, {F} da 400 FRANJA_INVALIDA en todas las fechas imposibles "
            "y POST /api/reservas sigue dando 201 como la base.",
            "El 500 lo añade la feature y la reparación lo cambia por 400 FRANJA_INVALIDA sin tocar las reservas normales",
            mismo_que=p + "deepseek-r1/D1/h1", arreglado=True),
    defecto(p + "deepseek-r1/B1/h2", "media",
            f"{F} en 1b6e99e7: 2027-02-30, 2027-02-29 y 2027-04-31 a las 10:30 dan 201 con la primera reserva el 2027-03-02, el 2027-03-01 y el 2027-05-01 "
            "y serie.inicio con la fecha imposible. En bd95beb1 las tres dan 400 FRANJA_INVALIDA.",
            "La serie se desplaza de día respecto a su inicio, cosa que la base no hace porque guarda la fecha tal cual, y la reparación lo rechaza con 400",
            mismo_que=p + "deepseek-r1/D1/h1", arreglado=True),
    otra(p + "deepseek-r1/B1/h3", "de_mas",
         "test/reservas-fijas.test.ts:41 de 1b6e99e7 ya prueba C2 (semanas, socio y pista inexistentes, hora 10:15 con FRANJA_INVALIDA y franja pasada).",
         "C2 ya tiene tests y pedir los de fechas imposibles es pedir más casos, aunque el fallo de comportamiento es real y se cuenta en D1/h1"),
    otra(p + "deepseek-r1/B1/h4", "de_mas",
         "git diff base 1b6e99e7 no toca docs/specs, y ni la spec ni club/AGENTS.md piden cambiar el campo Estado de la spec (C13 solo habla del README).",
         "Marcar la spec como implementada no lo pide nadie y el README sí documenta las series"),

    # ---- deepseek-r3, 18a2c9c5 ----
    defecto(p + "deepseek-r3/D1/h1", "media",
            f"{F} en 18a2c9c5: 2027-13-01T10:30 y 2027-12-32T10:30 dan 500 (RangeError en sumarDias) y 2027-02-30T10:30 da 201 con serie.inicio 2027-02-30T10:30 "
            f"y reservas el 2027-03-02 y el 2027-03-09. {BASE_FECHAS}",
            "La feature añade un 500 y una serie desplazada sobre la tolerancia de la base, cuando C2 pide 400 FRANJA_INVALIDA para una franja no válida"),
    previo(p + "deepseek-r3/D1/h2", "media", dst_estado("18a2c9c5"),
           "El plazo de 24 horas en horas de reloj es la regla de siempre de cancelarReserva en la base y C10 pide la penalización de siempre sin hablar del cambio de hora"),
    defecto(p + "deepseek-r3/B1/h1", "media",
            f"Mismo commit y misma sonda que D1/h1. Con la reparación 85f72bcd, {F} da 400 FRANJA_INVALIDA para todas las fechas imposibles y también para 9999-12-28T19:30 "
            "con 2 semanas, y POST /api/reservas sigue dando 201 como la base.",
            "Lo de las fechas imposibles es real y queda arreglado, y lo del año 9999 que añade es un caso límite que la spec deja abierto",
            mismo_que=p + "deepseek-r3/D1/h1", arreglado=True),
    previo(p + "deepseek-r3/B1/h2", "media", f"Misma sonda que D1/h2 en 18a2c9c5. {BASE_DST}",
           "Es el cálculo de horasEntre de la base, que la cancelación normal ya aplica igual, y la spec no pide cambiarlo",
           mismo_que=p + "deepseek-r3/D1/h2"),

    # ---- haiku-r1, 82e14c80 ----
    defecto(p + "haiku-r1/D1/h1", "baja",
            f"{F} en 82e14c80: 2027-13-01, 2027-00-10, 2027-01-00 y 2027-12-32 a las 10:30 dan 500 porque la comprobación sumarDias(fecha, 0) !== fecha "
            f"lanza RangeError en crearSerie antes de responder FRANJA_INVALIDA, mientras que 2027-02-30 ya da 400. {BASE_FECHAS}",
            "El 500 lo añade la feature porque la base no revienta con esas fechas, aunque solo cambia el código de error de una petición que falla igual"),
    otra(p + "haiku-r1/D1/h2", "error",
         f"{S} en 82e14c80: POST da 201 con serie.reservas como ids y GET /api/reservas/:id trae serieId. La sección API de la spec fija ids en la serie "
         "y reservas completas solo en GET, y README.md ya dice que POST responde 201 { serie } con reservas como ids y que GET trae las reservas completas.",
         "El estado cumple C8 tal como lo define la spec y el README ya deja explícito que POST devuelve ids, así que no queda nada que decidir ni documentar"),
    otra(p + "haiku-r1/D1/h3", "de_mas",
         "README.md de 82e14c80 documenta los errores nuevos (NO_IDENTIFICADO, SIN_PERMISO, SERIE_VACIA y SERIE_NO_ENCONTRADA) y la viñeta de reservas fijas "
         "dice que sus reservas no cuentan para el límite de 3. DATOS_INVALIDOS ya existía y la base tampoco lo lista para forzar.",
         "Pide pulir el README en cosas que C13 no exige porque DATOS_INVALIDOS no es nuevo y la exclusión del límite ya está documentada"),
    defecto(p + "haiku-r1/B1/h1", "baja",
            f"Mismo commit y misma sonda que D1/h1. Con la reparación 7831f620, {F} da 400 FRANJA_INVALIDA para todas las fechas imposibles y POST /api/reservas sigue dando 201.",
            "El 500 es real y la reparación lo arregla sin cambiar las reservas normales",
            mismo_que=p + "haiku-r1/D1/h1", arreglado=True),
    previo(p + "haiku-r1/B1/h2", "media", dst_estado("82e14c80"),
           "Es la convención de horas de reloj que ya tiene cancelarReserva en la base y la spec no pide cambiarla para las series"),
    defecto(p + "haiku-r1/C1/h1", "baja",
            f"Mismo commit y misma sonda que D1/h1. Con la reparación 9e452990, {F} da 400 FRANJA_INVALIDA para todas las fechas imposibles y las reservas normales siguen como en la base.",
            "Es el mismo 500 que D1/h1 y la reparación de la condición C lo arregla",
            mismo_que=p + "haiku-r1/D1/h1", arreglado=True),
    otra(p + "haiku-r1/C1/h2", "de_mas",
         "test/series.test.ts:197 de 82e14c80 prueba C10 (24 h, pendientes, forzar, empezadas y canceladas) y no menciona no_presentada, un estado que la API no permite crear.",
         "C10 ya tiene tests y el caso no_presentada ni siquiera se puede preparar por la API, así que es un test de más"),
    otra(p + "haiku-r1/C1/h3", "de_mas",
         "test/series.test.ts:148 de 82e14c80 prueba el descuento (2800 pasa a 2520 con 8 semanas y precio normal con 7). Todos los precios de la semilla son múltiplos de 100, "
         "como apunta el test oculto de C7, así que el redondeo hacia abajo no se distingue por la API.",
         "C7 ya tiene tests y el redondeo no se puede observar con la semilla, así que pedir otro test es de más"),

    # ---- haiku-r2, 57190334 ----
    defecto(p + "haiku-r2/D1/h1", "media",
            f"{F} en 57190334: 2027-13-01T10:30 y 2027-12-32T10:30 dan 500 (RangeError en sumarDias) y 2027-02-30T10:30 da 201 con serie.inicio 2027-02-30T10:30 "
            f"y reservas el 2027-03-02 y el 2027-03-09. {BASE_FECHAS}",
            "La feature añade un 500 y una serie desplazada que la base no tiene, y C2 pide 400 FRANJA_INVALIDA"),
    defecto(p + "haiku-r2/D1/h2", "media",
            f"{F} en 57190334: 2027-02-30T10:30 da 201 con serie.inicio 2027-02-30T10:30 y reservas el 2027-03-02 y el 2027-03-09, no en una fecha inexistente como dice el validador. "
            "POST /api/reservas con esa fecha da 201 y la guarda tal cual, igual que en la base.",
            "Aceptar la fecha imposible viene de la base pero la serie la desplaza al 2 de marzo y deja inicio sin su primera reserva, que es lo que añade la feature",
            mismo_que=p + "haiku-r2/D1/h1"),
    previo(p + "haiku-r2/D1/h3", "media", dst_estado("57190334"),
           "La regla de 24 horas de reloj es la de siempre y la spec no pide cambiarla para las series"),
    otra(p + "haiku-r2/D1/h4", "de_mas",
         "test/series.test.ts:215 y :245 de 57190334 prueban C10 y ninguno usa no_presentada, un estado que la API no permite crear (el código solo cancela las confirmadas).",
         "C10 ya tiene tests y el caso no_presentada no se puede preparar por la API, así que es un test de más"),
    previo(p + "haiku-r2/D1/h5", "baja",
           f"{S} en la base y en 57190334: cancelar la reserva de un socio con la X-Socio de otro da 200 cancelada. cancelarReserva de la base no mira quién llama "
           "y el test oculto de C12 dice expresamente que cualquiera puede cancelar.",
           "Es como funciona la base y la spec pide no cambiar la cancelación de reservas normales"),
    defecto(p + "haiku-r2/B1/h1", "media",
            f"Mismo commit y misma sonda que D1/h1 (la primera reserva cae el 2027-03-02, no el 2027-02-30 que dice el validador). Con la reparación 81f7cd13, {F} da 400 FRANJA_INVALIDA "
            "para 2027-13-01, 2027-12-32 y 2027-02-30 y POST /api/reservas sigue dando 201.",
            "El 500 y la serie desplazada son reales aunque el detalle de las fechas no es exacto, y la reparación los arregla sin tocar las reservas normales",
            mismo_que=p + "haiku-r2/D1/h1", arreglado=True),
    otra(p + "haiku-r2/B1/h2", "de_mas",
         "test/series.test.ts:215 de 57190334 prueba C10 con 23 h, forzar con penalización de 1800 y repetición, sin el límite exacto de 24 h (el código usa >= 24). "
         "Lo del cambio de hora es la convención de la base, ver D1/h3.",
         "C10 ya tiene tests y el límite exacto es un caso más, y la parte del cambio de hora es previa"),

    # ---- haiku-r3, a1499c1b ----
    otra(p + "haiku-r3/D1/h1", "error",
         f"{S} en a1499c1b: POST da 201 {{ serie }} con reservas como ids y GET /api/reservas/:id y GET /api/series/:id traen serieId. La spec dice que serie.reservas son ids "
         "y que solo GET trae las reservas completas, el test oculto de C8 exige ids en el POST y README.md:64 lo explica.",
         "El validador lee C8 como si el POST tuviera que traer las reservas completas, pero la spec fija ids y el estado cumple"),
    otra(p + "haiku-r3/D1/h2", "de_mas",
         "README.md:29 de a1499c1b dice que las reservas de una serie no cuentan para el límite de 3 reservas futuras, ni el límite le impide a la serie crearse.",
         "La frase se entiende y cubre lo que pide C13, así que es una mejora de redacción"),
    otra(p + "haiku-r3/D1/h3", "de_mas",
         f"{S} en a1499c1b: GET /api/series y DELETE /api/series/S-0001 sin X-Socio dan 401 NO_IDENTIFICADO y con el gestor 404 RUTA_NO_ENCONTRADA. Las tres rutas de la spec dan 401 y 403 como pide C1.",
         "La spec no dice qué deben responder rutas de series que no existen, así que es un detalle fuera de lo que pide"),
    otra(p + "haiku-r3/D1/h4", "de_mas",
         f"test/series.test.ts:185 y :214 de a1499c1b prueban C10 y el de la línea 172 prueba SERIE_NO_ENCONTRADA en GET. {S} confirma que cancelar S-9999 da 404 SERIE_NO_ENCONTRADA y forzar no booleano da 400.",
         "C10 ya tiene tests y el comportamiento es correcto, así que son tests de más casos"),

    # ---- luna-r2 ----
    previo(p + "luna-r2/C2/h1", "media", dst_estado("9b01ca1a"),
           "La serie usa la regla de 24 horas de siempre y la spec no pide horas reales en C10"),
    otra(p + "luna-r2/C3/h1", "de_mas",
         f"{F} en a72b8b41: 9999-12-28T19:30 con 2 semanas da 201 con una reserva en +010000-01T19:30, y cancelar con forzar solo cancela la primera. "
         "La base también acepta 9999-12-28T19:30 en POST /api/reservas y la spec no dice nada de fechas fuera de AAAA.",
         "Es real pero solo pasa con una serie en el año 9999, un caso límite que la spec deja abierto"),

    # ---- luna-r3 ----
    previo(p + "luna-r3/C2/h1", "media", dst_estado("dc6b1e54"),
           "Es el plazo de 24 horas de reloj que ya usa la base y la spec no pide cambiarlo"),

    # ---- opus-r1, 010a1884 ----
    previo(p + "opus-r1/D1/h1", "media", dst_estado("010a1884"),
           "Es la regla de 24 horas de la base, que la spec manda aplicar como la de siempre"),
    otra(p + "opus-r1/D1/h2", "de_mas",
         f"{S} en 010a1884: con un cuerpo que no es JSON, POST /api/series y cancelar dan 400 DATOS_INVALIDOS sin X-Socio y con socio-003, y con cuerpo válido dan 401 y 403. "
         "La implementación de referencia también lee el cuerpo antes de mirar los permisos.",
         "La spec no fija qué error gana cuando fallan a la vez el cuerpo y el permiso, y con cuerpo válido los permisos son los que pide C1"),
    otra(p + "opus-r1/D1/h3", "de_mas",
         f"{S} en 010a1884: POST da 201 {{ serie, reservas }} con serie.reservas como ids y las reservas completas en la raíz, documentado en README.md:68.",
         "Es un campo de más que no rompe nada y está documentado, así que es otra forma válida de hacerlo"),
    otra(p + "opus-r1/D1/h4", "de_mas",
         "test/series.test.ts:214, :249 y :265 de 010a1884 prueban C10 y ninguno usa no_presentada, un estado que la API no permite crear.",
         "C10 ya tiene tests y el caso no_presentada no se puede preparar por la API, así que es un test de más"),
    defecto(p + "opus-r1/B1/h1", "media",
            f"{F} en 010a1884: 2027-02-30T10:30 da 201 con serie.inicio 2027-02-30T10:30 y reservas el 2027-03-02 y el 2027-03-09 (y 2027-13-01 da 500). {BASE_FECHAS} "
            "Con la reparación 0eab9329 la serie da 400 FRANJA_INVALIDA.",
            "La serie desplazada la añade la feature y la reparación la rechaza, aunque de paso cambió las reservas normales (ver B2/h1)",
            arreglado=True),
    previo(p + "opus-r1/B1/h2", "media", f"Misma sonda que D1/h1 en 010a1884. {BASE_DST}",
           "Es el mismo cálculo de horas de reloj que cancelarReserva en la base y la spec no pide cambiarlo",
           mismo_que=p + "opus-r1/D1/h1"),
    otra(p + "opus-r1/B1/h3", "de_mas", f"Misma sonda que D1/h3 en 010a1884.",
         "Es un campo de más en la respuesta, documentado y sin efecto en lo que pide C8",
         mismo_que=p + "opus-r1/D1/h3"),

    # ---- opus-r1, 0eab9329 ----
    defecto(p + "opus-r1/B2/h1", "baja",
            f"{F}: en la base POST /api/reservas con 2027-02-30T10:30 da 201 y en 0eab9329 da 400 FRANJA_INVALIDA, y {S} muestra el mensaje nuevo de FRANJA_INVALIDA en las reservas normales. "
            "En 3696dcce crearReserva vuelve a ser la de la base salvo el filtro de serieId que pide C6, el mensaje vuelve a ser el de siempre y la reserva normal da otra vez 201.",
            "La primera reparación cambió las reservas normales contra el no-objetivo y C12, aunque solo con fechas imposibles, y la segunda lo deshizo",
            arreglado=True),
    otra(p + "opus-r1/B2/h2", "de_mas",
         f"{S} en 0eab9329: POST sigue dando {{ serie, reservas }} con serie.reservas como ids y el campo extra documentado en el README.",
         "Es un campo de más que no rompe C8, otra forma válida de hacerlo"),

    # ---- opus-r1, 3696dcce ----
    previo(p + "opus-r1/B3/h1", "media", dst_estado("3696dcce"),
           "Es la regla de siempre de la base y la spec no pide tener en cuenta el cambio de hora al cancelar"),
    previo(p + "opus-r1/B3/h2", "media",
           f"src/nucleo.ts de la base: cancelarReserva usa horasEntre, que trata la hora local como UTC. {BASE_DST} En 3696dcce la serie y la reserva suelta dan el mismo resultado.",
           "Describe el cálculo que ya tenía cancelarReserva en la base, que la spec dice que no cambia, y hoy serie y reserva suelta son coherentes"),

    # ---- opus-r2, feaf499d ----
    defecto(p + "opus-r2/B1/h1", "media",
            f"{F} en feaf499d: 2027-13-01T10:30 y 2027-12-32T10:30 dan 500 y 2027-02-30T10:30 da 201 con reservas el 2027-03-02 y el 2027-03-09. {BASE_FECHAS} "
            "Con la reparación a3205e1c todas dan 400 FRANJA_INVALIDA y POST /api/reservas sigue dando 201.",
            "La feature añade un 500 y una serie desplazada que la base no tiene, y la reparación lo arregla sin tocar las reservas normales",
            arreglado=True),
    previo(p + "opus-r2/B1/h2", "media", dst_estado("feaf499d"),
           "El propio validador lo ve como el cálculo de siempre y la spec no pide cambiarlo"),

    # ---- sol-r1, 51b8a6b9 ----
    previo(p + "sol-r1/D1/h1", "media", dst_estado("51b8a6b9"),
           "La serie aplica la regla de 24 horas de siempre, que en la base ya ignora el cambio de hora"),
    previo(p + "sol-r1/B1/h1", "media", f"Misma sonda que D1/h1 en 51b8a6b9. {BASE_DST}",
           "Es el cálculo de cancelarReserva de la base, en el que además delega la serie, y la spec no pide cambiarlo",
           mismo_que=p + "sol-r1/D1/h1"),

    # ---- sol-r2, 593093f7 ----
    previo(p + "sol-r2/D1/h1", "media", dst_estado("593093f7"),
           "La serie aplica la regla de 24 horas de siempre, que en la base ya ignora el cambio de hora"),
    previo(p + "sol-r2/B1/h1", "media", f"Misma sonda que D1/h1 en 593093f7. {BASE_DST}",
           "Es el cálculo de cancelarReserva de la base, en el que la serie además delega la penalización, y la spec no pide cambiarlo",
           mismo_que=p + "sol-r2/D1/h1"),

    # ---- sol-r3, 8ef5e618 ----
    previo(p + "sol-r3/D1/h1", "media", dst_estado("8ef5e618"),
           "La serie aplica la regla de 24 horas de siempre, que en la base ya ignora el cambio de hora"),
    otra(p + "sol-r3/D1/h2", "de_mas",
         f"{F} en 8ef5e618: 9999-12-28T19:30 con 2 semanas da 201 con una reserva en +010000-01T19:30. La base acepta 9999-12-28T19:30 en POST /api/reservas "
         "y la spec no dice nada de fechas fuera de AAAA.",
         "Es real pero solo pasa con una serie en el año 9999, un caso límite que la spec deja abierto"),
    previo(p + "sol-r3/B1/h1", "media", f"Misma sonda que D1/h1 en 8ef5e618. {BASE_DST}",
           "Es el cálculo de cancelarReserva de la base y la spec no pide cambiarlo",
           mismo_que=p + "sol-r3/D1/h1"),
    otra(p + "sol-r3/B1/h2", "de_mas", "Misma sonda que D1/h2 en 8ef5e618.",
         "Caso límite del año 9999 que la spec deja abierto",
         mismo_que=p + "sol-r3/D1/h2"),
]

ids_paquete = [h["id"] for h in paquete]
ids_revision = [x["id"] for x in r]
assert sorted(ids_paquete) == sorted(ids_revision), (set(ids_paquete) ^ set(ids_revision))
assert len(set(ids_revision)) == len(ids_revision)
orden = {i: n for n, i in enumerate(ids_paquete)}
r.sort(key=lambda x: orden[x["id"]])
for x in r:
    assert ";" not in x["nota"] and "«" not in x["nota"] and "»" not in x["nota"], x["id"]
    assert not x["nota"].endswith("."), x["id"]
    if x["mismo_que"]:
        assert x["mismo_que"] in orden, x["id"]
        madre = next(y for y in r if y["id"] == x["mismo_que"])
        assert madre["categoria"] == x["categoria"], x["id"]
    h = next(y for y in paquete if y["id"] == x["id"])
    if x["categoria"] == "defecto" and h["estado_reparado"]:
        assert x["arreglado"] in (True, False), x["id"]
    else:
        assert x["arreglado"] is None, x["id"]
salida = A / "revision/reservas-fijas.json"
salida.parent.mkdir(exist_ok=True)
salida.write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n")
from collections import Counter
print(len(r), Counter(x["categoria"] for x in r))
print("defectos:", [(x["id"], x["gravedad_real"], x["arreglado"], x["mismo_que"]) for x in r if x["categoria"] == "defecto"])
