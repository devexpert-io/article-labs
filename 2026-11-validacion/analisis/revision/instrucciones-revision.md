# Revisión a mano de los hallazgos de los validadores

Eres revisor de un experimento sobre validadores de IA. Trabajas solo: no lances subagentes.

## Contexto

El laboratorio está en `/home/antonio/Projects/devexpert-io/article-labs/2026-11-validacion`. Lee primero su `README.md` entero (diseño, condiciones A, B, C y D, verdad de referencia).

Cinco agentes implementaron features en una API de reservas de un club de pádel (`club/`, TypeScript, Node 26). Después, validadores de IA dieron veredictos `accept`, `revise` o `block`, criterio a criterio y con hallazgos. La verdad de referencia son los tests ocultos (`ocultos/<encargo>/*.test.ts`, uno o varios por criterio, con nombres que empiezan por "C<n> · ").

Tu paquete tiene los hallazgos de veredictos `revise` o `block` sobre estados que los tests ocultos dan por completos. Es decir, el validador pidió cambios en un trabajo que, según nuestros tests, ya estaba bien. Los tests ocultos pueden dejarse cosas, así que hay que saber, hallazgo a hallazgo, si el validador tenía razón. De esto sale una cifra central del artículo, así que la precisión importa más que la velocidad.

Cada hallazgo trae: `id`, `cadena`, quién implementó (`implementa`) y quién validó (`validador`), `condicion` y `ronda`, la `gravedad` que le dio el validador, `criterio`, `descripcion`, `cambio` pedido, la marca del validador en ese criterio (`marca_del_criterio`), el estado validado (`estado_validado`: carpeta git y commit) y, si hubo una reparación después, el estado reparado (`estado_reparado`).

## Categorías

Clasifica cada hallazgo en una:

- `defecto`: el estado no cumple algo que pide su spec (`club/docs/specs/<encargo>.md`) o rompe algo que la spec dice que no cambia, y los tests ocultos no lo miran. El validador tiene razón. Añade `tipo`:
  - `comportamiento`: la API hace algo distinto de lo que pide la spec.
  - `documentacion`: el README no cuenta algo que la spec pide documentar expresamente.
  - `tests`: un criterio no tiene ningún test entre los tests del agente, y el plan de verificación de la spec pide tests para cada criterio.
- `previo`: el comportamiento es real, pero ya estaba así en la base (antes de la feature) y la spec no pide cambiarlo. Compruébalo contra la base. Si la feature hereda un fallo de la base pero además añade uno propio (por ejemplo, un 500 nuevo), el añadido es `defecto`.
- `de_mas`: la spec no lo pide. Validaciones de entrada que la spec no exige, casos límite que la spec deja abiertos, tests de más casos cuando el criterio ya tiene tests, más detalle o mejor redacción en la documentación de lo que pide la spec, estilo, u otra forma válida de hacerlo.
- `error`: lo que dice el validador es falso, y el estado sí cumple ese punto (leyó mal el código, probó mal, se equivocó de franja…).
- `ambigua`: la spec admite de verdad las dos lecturas. Úsala poco y cita las líneas de la spec.

Juzga siempre contra el texto de la spec y `club/AGENTS.md`, no contra lo que tú harías. Si dudas entre `defecto` y `de_mas`, pregúntate si un revisor humano que solo tuviera la spec diría que el trabajo no está terminado.

## Cómo comprobar

No te fíes de la descripción del validador: compruébala.

- Para comportamiento, escribe una prueba pequeña (un `*.test.ts` como los ocultos, que importa `arrancarApi` de `./ayuda.ts`; toma como modelo un test oculto del encargo) y ejecútala con:

  ```sh
  python3 -I analisis/revision/probar.py <carpeta> <commit> <prueba.test.ts>
  python3 -I analisis/revision/probar.py --base <prueba.test.ts>
  ```

  El script copia el estado (o la base) a una carpeta temporal y lo ejecuta en la misma caja (bubblewrap) que el corrector. Imprime la salida del test: usa `console.log` para ver respuestas. El reloj del club se fija con `arrancarApi({ AHORA: "2027-01-04T10:00", TZ: "UTC" })` y se mueve con `POST /_reloj`, como en los tests ocultos.
- Para leer código de un estado: `git -C <carpeta> show <commit>:<ruta>`, o `git -C <carpeta> diff base <commit>` para ver todo lo que cambió respecto a la base (cada carpeta tiene la etiqueta `base`).
- La base es `club/` en el repo del laboratorio (y la etiqueta `base` de cada carpeta).
- Los tests ocultos del criterio te dicen qué está cubierto ya.

Muchos hallazgos se repiten: D1, B1 y C1 de una cadena validan el mismo commit, y una misma cosa puede salir en varias rondas. Agrúpalos: comprueba una vez y marca los demás con `mismo_que` (el id del que comprobaste). Si dos hallazgos iguales están en estados distintos (otro commit), comprueba los dos.

Si un hallazgo es `defecto` y tiene `estado_reparado`, comprueba con la misma prueba si la reparación lo arregló (`arreglado`: true o false).

## Reglas

- No modifiques nada en `/var/tmp/lab-validacion/ejecuciones` ni en el repo del laboratorio. Escribe solo en tu carpeta de trabajo.
- No lances subagentes.
- Si algo no arranca o no cuadra (un test oculto que parezca equivocado, un estado que no compila), apúntalo y sigue.

## Entrega

1. Un JSON en la ruta de salida que te indiquen: una lista con un objeto por hallazgo del paquete (todos, también los repetidos), con estos campos:
   - `id`
   - `categoria`: `defecto`, `previo`, `de_mas`, `error` o `ambigua`
   - `tipo`: solo para `defecto`
   - `gravedad_real`: solo para `defecto` y `previo`. `alta` si da un resultado equivocado en un uso normal, `media` si pasa en un caso que la spec cubre pero es poco frecuente, `baja` si es cosmético o casi no se nota.
   - `mismo_que`: id o null
   - `comprobacion`: qué hiciste (la prueba y su resultado, o fichero:línea)
   - `arreglado`: true, false o null
   - `nota`: una frase en español, sin punto y coma
2. Como respuesta final, un resumen breve: cuántos hay de cada categoría por encargo, los defectos de verdad (uno por línea, con su cadena y si se arregló), y cualquier cosa rara que hayas visto.
