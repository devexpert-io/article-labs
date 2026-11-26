# Spec: torneos

- **id:** `torneos`
- **Estado:** pendiente de implementar

## Objetivo

El club organiza torneos de parejas por eliminación directa y hoy lo lleva todo en una hoja de cálculo: bloquear las pistas, apuntar a las parejas, hacer el cuadro, poner hora a los partidos y apuntar los resultados. Con esta feature, la recepción crea el torneo y bloquea sus pistas, los socios se inscriben por parejas y, al cerrar la inscripción, el sistema genera el cuadro y el calendario. Después, la recepción apunta los resultados hasta que hay una pareja campeona.

## No-objetivos

- No cambiar cómo funcionan las reservas normales, salvo que no se pueden hacer en las franjas que bloquea un torneo.
- No hacer cuadros de consolación, fases de grupos ni ligas.
- No cobrar: la cuota de inscripción solo se anota en cada inscripción.
- No añadir dependencias nuevas.

## Usuarios y permisos

- Crear, cerrar y cancelar torneos y apuntar resultados: solo un gestor (cabecera `X-Socio` de un socio con rol `gestor`).
- Inscribir a una pareja o darla de baja: uno de los dos socios de la pareja o un gestor.
- Consultar torneos: cualquiera, sin identificarse.
- Sin `X-Socio` donde hace falta, `401 NO_IDENTIFICADO`. Con un socio que no tiene permiso, `403 SIN_PERMISO`.

## API

- `POST /api/torneos` con `{ nombre, pistas, franjas, plazas, cuota }`: crea el torneo. `pistas` son los ids de las pistas que usa, y `franjas`, los inicios de las franjas que usa en todas ellas. `plazas` es el número máximo de parejas y `cuota`, lo que paga cada pareja, en céntimos. Responde `201 { torneo }`.
- `GET /api/torneos[?estado=<estado>]`: los torneos. Responde `{ torneos }`.
- `GET /api/torneos/:id`: un torneo, con sus inscripciones y sus partidos. Responde `{ torneo }`.
- `POST /api/torneos/:id/inscripciones` con `{ socios: [id, id] }`: inscribe a una pareja. Responde `201 { inscripcion }`.
- `POST /api/torneos/:id/inscripciones/:inscripcionId/baja`: da de baja a una pareja. Responde `{ inscripcion }`.
- `POST /api/torneos/:id/cerrar`: cierra la inscripción y genera el cuadro y el calendario. Responde `{ torneo }`.
- `POST /api/torneos/:id/partidos/:partidoId/resultado` con `{ ganadora, marcador? }`: apunta el resultado de un partido. `ganadora` es el id de la inscripción que gana y `marcador`, un texto libre (por ejemplo, `"6-4 6-3"`). Responde `{ partido }`.
- `POST /api/torneos/:id/cancelar`: cancela el torneo. Responde `{ torneo }`.

Un torneo tiene `id`, `nombre`, `pistas`, `franjas` (en orden cronológico), `plazas`, `cuota`, `estado` (`inscripcion`, `en_juego`, `terminado` o `cancelado`), `inscripciones` (por orden de inscripción), `partidos` y `campeona` (el id de la inscripción que gana el torneo, o `null`).

Una inscripción tiene `id`, `socios` (los dos ids), `estado` (`inscrita` o `baja`) e `importe` (la cuota del torneo).

Un partido tiene `id`, `ronda` (la primera es la 1), `numero` (su orden dentro de la ronda, desde 1), `parejas` (los ids de las dos inscripciones que lo juegan, con `null` mientras no se sepa cuál es), `estado` (`pendiente`, `jugado` o `descanso`), `ganadora`, `marcador`, `pistaId` e `inicio`. Mientras no tienen valor, `ganadora`, `marcador`, `pistaId` e `inicio` son `null`, y los descansos no tienen ni pista ni hora.

## Criterios de aceptación

1. **Permisos.** Crear, cerrar y cancelar torneos y apuntar resultados solo lo puede hacer un gestor. Inscribir o dar de baja a una pareja, uno de sus dos socios o un gestor. Sin `X-Socio`, `401 NO_IDENTIFICADO`, y con un socio sin permiso, `403 SIN_PERMISO`. Consultar no necesita identificarse.
2. **Datos del torneo.** `nombre` es un texto no vacío, `pistas` y `franjas` son listas no vacías y sin repetidos, `plazas` es un entero entre 4 y 16 y `cuota`, un entero de 0 o más (si no, `400 DATOS_INVALIDOS`). Cada pista tiene que existir (`404 PISTA_NO_ENCONTRADA`), y cada franja, ser una franja válida (`400 FRANJA_INVALIDA`) que no haya empezado (`409 FRANJA_PASADA`).
3. **Pistas libres.** Si alguna de las pistas está cerrada, `409 PISTA_CERRADA`. Si alguna de las franjas tiene, en alguna de las pistas, una reserva confirmada o la bloquea otro torneo que no está cancelado, `409 FRANJAS_OCUPADAS`, y el error trae `conflictos`: una lista con el `pistaId`, el `inicio` y el `reservaId` o el `torneoId` de cada choque. En los dos casos no se crea nada.
4. **Crear y consultar.** `POST /api/torneos` responde `201` con el torneo en estado `inscripcion`, sin inscripciones ni partidos y con `campeona: null`. `GET /api/torneos/:id` devuelve el torneo con sus inscripciones y sus partidos. Si el torneo no existe, `404 TORNEO_NO_ENCONTRADO`, en este y en el resto de endpoints de un torneo.
5. **Listado.** `GET /api/torneos` devuelve todos los torneos, también los cancelados, por orden de su primera franja. Cada uno trae `id`, `nombre`, `estado`, `plazas`, `cuota` e `inscritas` (cuántas inscripciones están `inscrita`). Con `estado`, solo los de ese estado, y con un estado que no existe, `400 DATOS_INVALIDOS`.
6. **Franjas bloqueadas.** Mientras un torneo no esté cancelado, cada una de sus franjas en cada una de sus pistas sale en `GET /api/disponibilidad` con `estado: "torneo"` y el `torneoId`, y reservarla con `POST /api/reservas` responde `409 FRANJA_NO_DISPONIBLE`. Al cerrar, las que no se usan dejan de estar bloqueadas (criterio 17).
7. **Inscribirse.** `POST /api/torneos/:id/inscripciones` recibe en `socios` una lista con dos ids distintos (si no, `400 DATOS_INVALIDOS`). Responde `201` con la inscripción en estado `inscrita` y con `importe` igual a la cuota del torneo, y la inscripción queda al final de `inscripciones`.
8. **Quién puede jugar.** Los dos socios tienen que existir (`404 SOCIO_NO_ENCONTRADO`) y tener la cuota al día (`409 CUOTA_INACTIVA`), y ninguno puede estar ya en otra inscripción `inscrita` del mismo torneo (`409 YA_INSCRITO`).
9. **Plazas.** Si el torneo ya tiene tantas inscripciones `inscrita` como `plazas`, `409 TORNEO_COMPLETO`. Las bajas dejan su plaza libre.
10. **Plazo de inscripción.** Inscribirse y darse de baja solo se puede con el torneo en estado `inscripcion` y mientras falten 48 horas o más para su primera franja. Fuera de eso, `409 INSCRIPCION_CERRADA`.
11. **Baja.** `POST /api/torneos/:id/inscripciones/:inscripcionId/baja` deja la inscripción en estado `baja` y la devuelve. La inscripción sigue en `inscripciones`, y sus dos socios se pueden volver a inscribir. Si no existe en ese torneo, `404 INSCRIPCION_NO_ENCONTRADA`, y si ya estaba de baja, `409 YA_DE_BAJA`.
12. **Cerrar.** `POST /api/torneos/:id/cerrar` solo funciona con el torneo en estado `inscripcion` (si no, `409 TORNEO_NO_EN_INSCRIPCION`) y con 2 inscripciones `inscrita` o más (si no, `409 PAREJAS_INSUFICIENTES`). Se puede cerrar antes de que acabe el plazo de inscripción. Pasa el torneo a `en_juego`, genera el cuadro y el calendario y responde con el torneo.
13. **Cuadro: primera ronda.** Juegan las inscripciones `inscrita`, numeradas por su orden de inscripción (la primera es la 1). El cuadro tiene T plazas: la menor potencia de 2 que llega al número de parejas. La primera ronda tiene T/2 partidos, y el partido con `numero` i lo juegan la pareja i y la pareja T+1−i, en ese orden en `parejas`. Si la pareja T+1−i no existe, el partido es un descanso: sus `parejas` son la pareja i y `null`, su `estado` es `descanso` y la pareja i es su `ganadora`. Por ejemplo, con 5 parejas, T es 8 y la primera ronda es 1 contra nadie, 2 contra nadie, 3 contra nadie y 4 contra 5.
14. **Cuadro: rondas siguientes.** Cada ronda tiene la mitad de partidos que la anterior, hasta la final, que tiene uno. Si la ronda anterior tiene M partidos, el partido j de la siguiente lo juegan la ganadora del partido j y la del partido M+1−j de la anterior, en ese orden en `parejas`. Al cerrar se crean todos los partidos de todas las rondas, con `null` en las parejas que aún no se saben. En el ejemplo de 5 parejas, la segunda ronda es 1 contra la ganadora de 4 y 5, y 2 contra 3.
15. **Calendario.** Cada partido que no es un descanso recibe una pista y una franja del torneo que no haya empezado. Se asignan por orden de ronda y, dentro de cada ronda, por `numero`. A cada partido le toca la primera combinación de franja y pista que no tiene otro partido (la franja más temprana y, en la misma franja, la pista que va antes en `pistas`) cuya franja empiece a la hora en que terminan, o después, los partidos de la ronda anterior de los que salen sus parejas. Los descansos no cuentan.
16. **Franjas insuficientes.** Si no hay combinaciones para todos los partidos, cerrar responde `409 FRANJAS_INSUFICIENTES` y el torneo se queda como estaba, en estado `inscripcion`.
17. **Franjas sobrantes.** Al cerrar, las combinaciones de franja y pista que no le tocan a ningún partido dejan de estar bloqueadas y se pueden reservar.
18. **Apuntar un resultado.** `POST /api/torneos/:id/partidos/:partidoId/resultado` apunta como `ganadora` una de las dos parejas del partido (si no es una de ellas, `400 DATOS_INVALIDOS`), con su `marcador` si lo trae o `null` si no, y deja el partido `jugado`. Solo se puede con el torneo `en_juego` (si no, `409 TORNEO_NO_EN_JUEGO`), con las dos parejas del partido ya sabidas (si no, o si es un descanso, `409 PARTIDO_NO_LISTO`) y cuando el partido ya ha empezado (si no, `409 PARTIDO_NO_EMPEZADO`). Si el partido no existe en ese torneo, `404 PARTIDO_NO_ENCONTRADO`.
19. **La ganadora pasa de ronda.** La ganadora de un partido ocupa su sitio en el partido de la ronda siguiente, y las de los descansos, al cerrar. Cuando un partido tiene sus dos parejas, ya se puede apuntar su resultado.
20. **Corregir un resultado.** Volver a apuntar el resultado de un partido `jugado` lo cambia, y también cambia la pareja que pasó a la ronda siguiente, mientras ese partido de la ronda siguiente no se haya jugado. Si ya se jugó, `409 RESULTADO_CERRADO`.
21. **Campeona.** Al apuntar el resultado de la final, el torneo pasa a `terminado` y su `campeona` es la ganadora. Con 2 parejas, el único partido es la final.
22. **Cancelar.** `POST /api/torneos/:id/cancelar` deja el torneo `cancelado` y libera todas sus franjas, también si ya está `en_juego`. Un torneo `terminado` no se cancela (`409 TORNEO_TERMINADO`), y uno cancelado tampoco (`409 YA_CANCELADO`).
23. **Los partidos no son reservas.** Los partidos de un torneo no salen en `GET /api/reservas` ni cuentan para el límite de 3 reservas futuras de sus jugadores.
24. **Lo demás no cambia.** Reservar, cancelar y consultar reservas, y la disponibilidad de las franjas que no bloquea ningún torneo, funcionan igual que antes.
25. **Documentación.** El `README.md` documenta los torneos: quién hace qué, los endpoints, los estados, el plazo de inscripción, cómo se forman el cuadro y el calendario y los errores nuevos.

## Plan de verificación

- Tests de la API para cada criterio, moviendo la hora del club con `POST /_reloj` para el plazo de inscripción y los resultados.
- `npm run check` en verde.

## Impacto en la documentación

- `README.md`: reglas del club (torneos) y referencia de la API.
