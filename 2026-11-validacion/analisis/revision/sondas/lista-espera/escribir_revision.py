"""Escribe revision/lista-espera.json con la clasificación de los 49 hallazgos del paquete lista-espera."""
import json
from pathlib import Path

RAIZ = Path("analisis/revision")
S = "sondas/lista-espera/"


def h(id, categoria, comprobacion, nota, tipo=None, gravedad_real=None, mismo_que=None, arreglado=None):
    return {"id": id, "categoria": categoria, "tipo": tipo, "gravedad_real": gravedad_real, "mismo_que": mismo_que,
            "comprobacion": comprobacion, "arreglado": arreglado, "nota": nota}


H1 = "lista-espera-haiku-r1/"
H2 = "lista-espera-haiku-r2/"
L1 = "lista-espera-luna-r1/"
L2 = "lista-espera-luna-r2/"

revision = [
    # ---- haiku-r1 ----
    h(H1 + "D1/h1", "previo",
      f"{S}fechas.test.ts en d2e8bf0: POST /api/esperas con 2026-13-45T09:00 y 2027-02-31T10:30 da 409 FRANJA_LIBRE (2026-02-30T09:00 da FRANJA_PASADA, no FRANJA_LIBRE), y tras reservar esa franja imposible (201, igual que en la base con --base) apuntarse da 201. apuntarse usa la misma comprobación que crearReserva (src/nucleo.ts:204 frente a :185, patrón y HORAS, sin validar el calendario).",
      "La espera aplica las mismas comprobaciones que reservar, como pide la spec, y la base ya acepta fechas imposibles al reservar.",
      gravedad_real="baja"),
    h(H1 + "D1/h2", "de_mas",
      f"{S}haiku1.test.ts en d2e8bf0: DELETE de una espera ajena da 403 SIN_PERMISO y DELETE de E-9999 da 404 ESPERA_NO_ENCONTRADA (src/nucleo.ts:248-250), que es justo lo que piden Usuarios y permisos y el criterio 5.",
      "La spec pide 403 para la espera de otro y 404 para la que no existe, así que ocultar la existencia es un endurecimiento que la contradice."),
    h(H1 + "D1/h3", "de_mas",
      f"{S}haiku1.test.ts en d2e8bf0: tras apuntarse y cerrar pista-1, cancelar R-0515 da 200 con asignadaA null, la espera sigue activa y no se crea ninguna reserva (src/nucleo.ts:92).",
      "La spec no dice qué pasa con la lista si la pista está cerrada al cancelar, y no asignar respeta la regla de no reservar pistas cerradas y el objetivo de dar la franja al primero que puede jugar."),
    h(H1 + "B1/h1", "de_mas",
      f"Mismo commit y mismo comportamiento que {H1}D1/h3 ({S}haiku1.test.ts en d2e8bf0: asignadaA null y espera activa con la pista cerrada).",
      "Quitar la comprobación no lo pide la spec y hace que se creen reservas en pistas cerradas, que es el defecto que introdujo la reparación 5120ff5 y que B2 detectó.",
      mismo_que=H1 + "D1/h3"),
    h(H1 + "B1/h2", "de_mas",
      f"test/lista-espera.test.ts:154 en d2e8bf0 prueba el salto (Nora con 3 reservas futuras queda descartada y se asigna a Marta). Ningún fichero de src/ cambia cuotaActiva (git grep) y {S}haiku1.test.ts confirma que PATCH, POST y PUT /api/socios/socio-003 dan 404 RUTA_NO_ENCONTRADA.",
      "El criterio 7 ya tiene su test y la rama de cuota no se puede alcanzar por la API, así que pedir otro test es de más."),
    h(H1 + "B1/h3", "de_mas",
      f"{S}haiku1.test.ts en d2e8bf0: socio-007, que tiene pista-1 a las 19:30, puede esperar pista-2 a las 19:30 (201) y no pista-1 a las 19:30 (409 YA_RESERVADA), src/nucleo.ts:215-218.",
      "En la API de la spec una franja se identifica por pista e inicio (POST /api/esperas con pistaId e inicio), así que el código hace lo que pide."),
    h(H1 + "B1/h4", "de_mas",
      "git show d2e8bf0:docs/specs/lista-espera.md sigue con Estado pendiente de implementar, y ni la spec ni AGENTS.md piden cambiarlo.",
      "Actualizar el estado de la spec no forma parte de lo que pide el encargo."),
    h(H1 + "B2/h1", "defecto",
      f"{S}haiku1.test.ts en 5120ff5: tras apuntarse y cerrar pista-1, cancelar R-0515 da asignadaA R-0526, una reserva confirmada en la pista cerrada (5120ff5 quitó la comprobación de src/nucleo.ts:92 a petición de B1). En c04c1c3 la misma prueba da asignadaA null, ninguna reserva nueva y la espera activa (src/nucleo.ts:93).",
      "Asignar crea una reserva en una pista cerrada, contra la regla del club que la spec dice que no cambia y contra el objetivo de dar la franja al primero que puede jugar.",
      tipo="comportamiento", gravedad_real="media", arreglado=True),
    h(H1 + "B2/h2", "de_mas",
      f"{S}haiku1.test.ts en 5120ff5: GET /api/esperas?socio= da 403 SIN_PERMISO a un socio y 404 SOCIO_NO_ENCONTRADO (con el mensaje sin id) al gestor, porque src/servidor.ts:101 usa ?? en vez de ||.",
      "La spec no dice qué hacer con un ?socio= vacío, así que es un caso límite que deja abierto."),
    h(H1 + "B2/h3", "de_mas",
      f"{S}haiku1.test.ts en 5120ff5: socio-011, sin cuota, en una franja libre recibe CUOTA_INACTIVA tanto en POST /api/esperas como en POST /api/reservas, el mismo orden que reservar.",
      "La spec no fija la prioridad entre errores y el orden coincide con el de reservar."),
    h(H1 + "B2/h4", "de_mas",
      f"{S}haiku1.test.ts en 5120ff5: tras mover el reloj a 2026-11-19T19:45, GET /api/esperas no la devuelve y /_estado la sigue mostrando activa (src/nucleo.ts:66, caducidad al leer).",
      "La spec no define un estado caducada y lo que pide el criterio 8 (no aparecer, no asignarse y no contar para el límite) se cumple."),
    h(H1 + "B2/h5", "de_mas",
      f"En 5120ff5 test/lista-espera.test.ts es el de d2e8bf0 (git diff d2e8bf0 5120ff5 solo toca README, spec y src/nucleo.ts) y su línea 154 prueba el salto por 3 reservas futuras. La cuota no se puede cambiar por la API (git grep en src/ y {S}haiku1.test.ts).",
      "El criterio 7 tiene test y la rama de cuota no es alcanzable por la API."),
    h(H1 + "B2/h6", "de_mas",
      "git diff d2e8bf0 5120ff5 -- docs/specs/lista-espera.md cambia Estado a implementada y añade un Glosario que define franja como pista más hora, sin tocar ningún criterio.",
      "Es un cambio de forma en la spec que no altera lo que se pide ni el comportamiento."),
    # ---- haiku-r2 ----
    h(H2 + "B1/h1", "defecto",
      f"{S}haiku2.test.ts en c5150ab: socio-003 (primero) y socio-013 (segundo) esperan pista-2 2026-11-25T12:00, con la pista cerrada se cancela la reserva (asignadaA null), se reabre, socio-003 la reserva directamente (201) y su espera sigue activa en posición 1 con socio-013 en la 2. Al cancelar socio-003 su reserva, la franja se le asigna otra vez a él (R-0528). En 45b2408 la misma prueba deja su espera en retirada, socio-013 sube a la 1 y recibe R-0528.",
      "El socio acaba esperando una franja que tiene reservada, lo que prohíbe el criterio 3, y al cancelarla se la devuelven a él en vez de al siguiente de la lista.",
      tipo="comportamiento", gravedad_real="media", arreglado=True),
    h(H2 + "B1/h2", "de_mas",
      f"{S}haiku2.test.ts en c5150ab: con X-Socio socio-003 y socioId socio-999 en el cuerpo, la espera se guarda para socio-003 y solo el registro anota socio-999 (src/servidor.ts:103). La base hace lo mismo en cancelar (el registro anota reservaId R-FALSA si viene en el cuerpo) y la implementación de referencia usa el mismo patrón.",
      "La spec no dice nada del registro de operaciones, la espera queda a nombre de quien llama y el patrón es el de la base."),
    h(H2 + "B1/h3", "de_mas",
      f"{S}haiku2.test.ts en c5150ab: GET /api/esperas?socio= da 403 SIN_PERMISO a un socio y 200 con la lista vacía al gestor (src/servidor.ts:110 usa ??).",
      "Un ?socio= vacío es un caso límite que la spec no trata."),
    h(H2 + "B1/h4", "de_mas",
      f"{S}haiku2.test.ts en c5150ab: con pista-2 cerrada, cancelar da 200 con asignadaA null, la espera sigue activa y no hay reserva nueva (src/nucleo.ts:86).",
      "No asignar en una pista cerrada respeta las reglas de reservar, y qué hacer con la lista en ese caso lo deja abierto la spec."),
    h(H2 + "B1/h5", "de_mas",
      "git diff base c5150ab -- docs/specs/lista-espera.md solo cambia Estado a implementada.",
      "Cambiar el estado de la spec no afecta a ningún criterio."),
    h(H2 + "B1/h6", "de_mas",
      "test/lista-espera.test.ts:210 en c5150ab prueba la caducidad con POST /_reloj (la espera no aparece en GET y no cuenta para el límite), y cancelar una franja ya empezada da RESERVA_PASADA antes de llegar a la asignación.",
      "El criterio 8 ya tiene test y el caso que pide no se puede provocar por la API."),
    h(H2 + "B2/h1", "de_mas",
      f"En 45b2408 crearReserva retira la espera propia de esa franja (src/nucleo.ts:220), {S}haiku2.test.ts muestra que la respuesta de reservar no cambia (201 con los mismos campos) y los tests ocultos de C9 pasan en ese estado.",
      "Las reglas de reservar no cambian y retirar la espera propia evita el estado que prohíbe el criterio 3, así que no hace falta deshacerlo."),
    h(H2 + "B2/h2", "de_mas",
      f"{S}haiku2.test.ts en 45b2408: DELETE de una espera caducada da 409 ESPERA_NO_ACTIVA, que el README documenta.",
      "La spec no dice qué responder al retirar una espera que ya no está activa y un 409 propio es una forma válida, la misma que usa la referencia."),
    h(H2 + "B2/h3", "de_mas",
      "test/lista-espera.test.ts:215 en 45b2408 prueba la caducidad con POST /_reloj, igual que en c5150ab.",
      "El criterio 8 tiene test y el caso que pide no se puede provocar por la API."),
    h(H2 + "B2/h4", "de_mas",
      f"{S}haiku2.test.ts en 45b2408: tras mover el reloj al inicio de la franja, GET no la devuelve y /_estado la muestra activa.",
      "La spec no define un estado caducada y el criterio 8 se cumple por la API."),
    h(H2 + "B3/h1", "de_mas",
      "git diff 45b2408 87cc7c9 -- docs/specs/lista-espera.md añade a los criterios 5 y 9 el 409 ESPERA_NO_ACTIVA y la retirada de la espera propia al reservar. Contra la spec original los dos comportamientos son válidos (las reglas de reservar no cambian y los tests ocultos de C5 y C9 pasan).",
      "Editar la spec es mala práctica, pero el comportamiento cumple la spec original y ni la spec ni AGENTS.md lo prohíben."),
    h(H2 + "B3/h2", "de_mas",
      f"{S}haiku2.test.ts en 87cc7c9: con pista-2 cerrada, asignadaA null, la espera sigue activa y no hay reserva nueva (src/nucleo.ts:88).",
      "No asignar en una pista cerrada es una lectura válida de un caso que la spec no trata."),
    h(H2 + "B3/h3", "de_mas",
      "test/lista-espera.test.ts:157 en 87cc7c9 prueba el salto por 3 reservas futuras y ningún fichero de src/ cambia cuotaActiva (git grep).",
      "El criterio 7 tiene test y la cuota no se puede cambiar por la API."),
    h(H2 + "B3/h4", "de_mas",
      "test/lista-espera.test.ts:248 en 87cc7c9 espera RESERVA_PASADA al cancelar una franja empezada y comprueba que la espera no pasa a asignada, que es lo que dice su nombre en la práctica.",
      "Es una cuestión de nombre de un test, no de comportamiento ni de cobertura del criterio."),
    h(H2 + "B3/h5", "de_mas",
      f"{S}haiku2.test.ts en 87cc7c9: tras el inicio de la franja, GET no la devuelve y /_estado la muestra activa, como documenta el README.",
      "La spec no define un estado caducada y lo que pide el criterio 8 se cumple."),
    h(H2 + "B3/h6", "de_mas",
      "git show 87cc7c9:README.md no menciona DATOS_INVALIDOS, igual que el README de la base, y sí están todos los errores nuevos de la spec.",
      "DATOS_INVALIDOS no es un error nuevo y la spec solo pide documentar los nuevos."),
    h(H2 + "B3/h7", "de_mas",
      f"{S}haiku2.test.ts en 87cc7c9: GET /api/esperas?socio=socio-999 como gestor da 200 con la lista vacía (src/nucleo.ts:288).",
      "La spec no dice qué responder si el socio pedido no existe."),
    # ---- luna-r1 ----
    h(L1 + "D1/h1", "defecto",
      "git diff base 750ebaf -- test/: solo hay dos tests nuevos en test/club.test.ts (una asignación directa y la caducidad) y ninguno pone a un candidato que no pueda reservar, mientras el plan de verificación pide tests de la API del salto.",
      "El criterio 7 no tiene ningún test y la spec pide tests de la API para el salto.",
      tipo="tests", gravedad_real="baja"),
    h(L1 + "B1/h1", "defecto",
      f"Mismo commit 750ebaf que {L1}D1/h1 (tampoco hay ningún test del criterio 3). En 91b2452, test/club.test.ts:159 es un test de API en el que el primero tiene 3 reservas futuras, queda descartado y se asigna al siguiente.",
      "Faltaba el test del salto y la reparación lo añadió por la API, junto con los de errores, duplicados y límite.",
      tipo="tests", gravedad_real="baja", mismo_que=L1 + "D1/h1", arreglado=True),
    h(L1 + "B2/h1", "defecto",
      f"{S}luna1.test.ts en 91b2452: tras 9998 altas y retiradas por la API, la espera E-9999 (la primera en llegar) sale en posición 2, la E-10000 en la 1, y al cancelar se asigna a la segunda (socio-004), por el localeCompare de los ids en src/nucleo.ts:59 y 208. En ca7e8a8 la misma prueba da posiciones 1 y 2 y asigna a la primera.",
      "El orden de llegada se invierte a partir de la espera 10000, un caso que la spec cubre pero que en la práctica casi no se da.",
      tipo="comportamiento", gravedad_real="baja", arreglado=True),
    h(L1 + "C1/h1", "defecto",
      f"{S}luna1.test.ts en 750ebaf: apuntarse, cerrar pista-1 y cancelar R-0515 da asignadaA R-0526, una reserva confirmada en la pista cerrada (crearInterna, src/nucleo.ts:214, no mira la pista). En fa3e02a la misma prueba da asignadaA null, la espera descartada y ninguna reserva nueva (src/nucleo.ts:213).",
      "La asignación crea una reserva en una pista cerrada, contra la regla del club que la spec dice que no cambia y contra el objetivo de dar la franja a quien puede jugar.",
      tipo="comportamiento", gravedad_real="media", arreglado=True),
    h(L1 + "C1/h2", "defecto",
      f"{S}luna1.test.ts en 750ebaf: tras 9998 altas y retiradas, E-9999 sale en posición 2, E-10000 en la 1 y la franja se asigna a la segunda en llegar. En fa3e02a, posiciones 1 y 2 y se asigna a la primera.",
      "Es el mismo fallo de orden que en 91b2452, real pero solo a partir de la espera 10000.",
      tipo="comportamiento", gravedad_real="baja", arreglado=True),
    h(L1 + "C1/h3", "defecto",
      f"Mismo commit 750ebaf que {L1}D1/h1. En fa3e02a, test/club.test.ts:172 comprueba con el núcleo el descarte por cuota y por 3 reservas futuras, y hay tests nuevos de API de errores, duplicados, límite y gestor.",
      "Faltaban tests del salto y la reparación los añadió, aunque el del salto va contra el núcleo y no por la API.",
      tipo="tests", gravedad_real="baja", mismo_que=L1 + "D1/h1", arreglado=True),
    # ---- luna-r2 ----
    h(L2 + "D1/h1", "error",
      f"{S}nopresentada.test.ts en 41faa01: con el reloj del club no hay ninguna no_presentada futura y cancelarla da RESERVA_PASADA, como en la base. Solo con el reloj atrasado se llega a la cola y tampoco asigna, porque la franja tiene otra reserva confirmada: da 409 FRANJA_NO_DISPONIBLE (deja la no_presentada cancelada y la espera en asignada).",
      "La asignación que anuncia el validador no puede ocurrir, porque las no_presentada siempre están en el pasado y solo con el reloj de pruebas atrasado se llega a esa rama, que además falla sin asignar."),
    h(L2 + "B1/h1", "defecto",
      f"{S}luna2.test.ts en 41faa01: con X-Socio socio-003 y socioId socio-041 en el cuerpo, la espera se crea para socio-041 (201), y socio-011, sin cuota, crea una para socio-006 (src/servidor.ts:56). En 2ec6fcf la espera queda para socio-003 y socio-011 recibe 409 CUOTA_INACTIVA.",
      "POST /api/esperas tiene que apuntar a quien llama y un socioId en el cuerpo lo suplantaba.",
      tipo="comportamiento", gravedad_real="media", arreglado=True),
    h(L2 + "B1/h2", "de_mas",
      "git show 41faa01:README.md:53 lista los seis errores nuevos (FRANJA_LIBRE, YA_EN_ESPERA, YA_RESERVADA, LIMITE_DE_ESPERAS, ESPERA_NO_ENCONTRADA y SIN_PERMISO), y los que pide añadir ya existían en la base.",
      "La spec pide documentar los errores nuevos y los que faltan no lo son."),
    h(L2 + "B2/h1", "de_mas",
      f"{S}luna2.test.ts en 2ec6fcf: si nadie ha leído tras mover el reloj, DELETE de la espera caducada da 200 y la deja en retirada, y después de un GET da 404. En los dos casos no aparece en GET, no se asigna y no cuenta para el límite.",
      "El criterio 8 no dice nada de retirar una espera caducada y sus efectos se cumplen en los dos casos."),
    h(L2 + "B3/h1", "de_mas",
      "git show 6840b55:README.md: la línea de POST /api/esperas ya lista sus errores con NO_IDENTIFICADO y la de DELETE (línea 53) termina con la lista general Errores nuevos, en la que están todos los nuevos.",
      "Los errores nuevos están documentados, así que ordenarlos por endpoint es una mejora de redacción que la spec no pide."),
    h(L2 + "C1/h1", "defecto",
      f"Mismo commit 41faa01 que {L2}B1/h1. En acce177, {S}luna2.test.ts deja la espera a nombre de socio-003 y socio-011 recibe 409 CUOTA_INACTIVA (src/servidor.ts:56 solo toma pistaId e inicio del cuerpo).",
      "La suplantación es real y la reparación de C la cerró.",
      tipo="comportamiento", gravedad_real="media", mismo_que=L2 + "B1/h1", arreglado=True),
    h(L2 + "C1/h2", "defecto",
      f"{S}luna2.test.ts en 41faa01: apuntarse, cerrar pista-1 y cancelar R-0515 da 409 PISTA_CERRADA, pero R-0515 queda cancelada y la espera asignada sin reserva nueva, y el reintento da YA_CANCELADA (src/nucleo.ts:183-192). Sin lista, y en la base, esa cancelación da 200. En acce177 da 200, asignadaA null y la espera sigue activa (src/nucleo.ts:192).",
      "Cancelar responde con error aunque cancela y deja una espera asignada sin reserva, cuando la spec dice que cancelar sigue con sus reglas.",
      tipo="comportamiento", gravedad_real="media", arreglado=True),
    h(L2 + "C1/h3", "de_mas",
      "git show 41faa01:README.md documenta las reglas principales (límite de 2, orden de llegada, asignación, salto y caducidad), los tres endpoints, asignadaA y los seis errores nuevos (línea 53). Lo que falta (que X-Socio es obligatorio, explicar duplicados y reserva propia, y la respuesta de DELETE) son detalles, y NO_IDENTIFICADO no es un error nuevo.",
      "El README cubre lo que pide el criterio 10 a nivel básico y el resto es más detalle del que exige la spec."),
    h(L2 + "C1/h4", "defecto",
      "git diff base 41faa01 -- test/: un solo test nuevo (test/club.test.ts:72) sin ningún candidato que no pueda reservar, y tampoco hay tests de C2 ni de C3. acce177 añade tests de errores, duplicados, límite, pista cerrada y cola vacía, pero ninguno del salto.",
      "El criterio 7 no tenía ningún test y la reparación de C1 siguió sin añadirlo.",
      tipo="tests", gravedad_real="baja", arreglado=False),
    h(L2 + "C2/h1", "defecto",
      "git show acce177:test/club.test.ts no tiene ningún test del salto. 9447b2a añade test/club.test.ts:167 y 192, que comprueban con el núcleo el descarte por cuota y por 3 reservas futuras y la asignación al siguiente o a nadie.",
      "Faltaba el test del salto y 9447b2a lo añadió, aunque contra el núcleo y no por la API.",
      tipo="tests", gravedad_real="baja", arreglado=True),
    h(L2 + "C2/h2", "de_mas",
      "test/club.test.ts:89-90 en acce177 prueba la caducidad con POST /_reloj (la espera deja de aparecer en GET).",
      "El criterio 8 ya tiene test y pedir que cubra también el límite es pedir más casos."),
    # ---- sol ----
    h("lista-espera-sol-r1/D1/h1", "de_mas",
      f"{S}sol.test.ts en a73ff03: DELETE de una espera asignada da 200 con estado asignada (también como gestor), de una caducada 200 con descartada y de una activa 200 con retirada (src/nucleo.ts:130), y README.md:62 lo documenta.",
      "La spec describe retirarse de la lista y no dice qué hacer con una espera ya asignada o caducada, y pasarla a retirada falsearía que se asignó."),
    h("lista-espera-sol-r2/D1/h1", "de_mas",
      f"{S}sol.test.ts en d69f59c: el mismo resultado que en sol-r1 (200 con asignada o descartada, y retirada solo si estaba activa, src/nucleo.ts:114), documentado en README.md:62.",
      "Retirar una espera que ya no está en la lista es un caso que la spec deja abierto y la implementación lo documenta."),
]

paquete = json.loads((RAIZ / "paquetes" / "lista-espera.json").read_text())
ids_paquete = [x["id"] for x in paquete]
ids = [x["id"] for x in revision]
assert len(revision) == 49, len(revision)
assert sorted(ids) == sorted(ids_paquete), set(ids) ^ set(ids_paquete)
assert len(set(ids)) == 49
por_id = {x["id"]: x for x in paquete}
for x in revision:
    assert x["categoria"] in {"defecto", "previo", "de_mas", "error", "ambigua"}, x["id"]
    assert (x["tipo"] is not None) == (x["categoria"] == "defecto"), x["id"]
    assert (x["gravedad_real"] is not None) == (x["categoria"] in {"defecto", "previo"}), x["id"]
    if x["categoria"] == "defecto" and por_id[x["id"]]["estado_reparado"]:
        assert x["arreglado"] in (True, False), x["id"]
    else:
        assert x["arreglado"] is None, x["id"]
    if x["mismo_que"]:
        assert x["mismo_que"] in por_id and por_id[x["mismo_que"]]["estado_validado"]["commit"] == por_id[x["id"]]["estado_validado"]["commit"], x["id"]
    for campo in ("nota", "comprobacion"):
        assert ";" not in x[campo] and "«" not in x[campo] and "»" not in x[campo], (x["id"], campo)
    assert x["nota"].count(". ") == 0 and x["nota"].endswith("."), x["id"]
# Mismo orden que el paquete.
revision.sort(key=lambda x: ids_paquete.index(x["id"]))
salida = RAIZ / "revision" / "lista-espera.json"
salida.write_text(json.dumps(revision, ensure_ascii=False, indent=2) + "\n")
from collections import Counter
print("escrito", salida, len(revision))
print(Counter(x["categoria"] for x in revision))
for cadena in ["haiku-r1", "haiku-r2", "luna-r1", "luna-r2", "sol-r1", "sol-r2"]:
    print(cadena, dict(Counter(x["categoria"] for x in revision if x["id"].startswith(f"lista-espera-{cadena}/"))))
