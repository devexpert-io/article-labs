# Tests ampliados: probar cada defecto en todos los estados

Gracias por la revisión. Queda un sesgo que solo se corrige con tus pruebas. Los defectos que encontraste salieron de lo que miró cada validador. A las implementaciones de Haiku y Luna las miraron tres validadores (D, B y C, y en C uno potente), y a las de Opus, Sol y DeepSeek solo dos, siempre del mismo modelo. Para comparar de forma justa, cada clase de defecto de comportamiento que confirmaste hay que probarla en todos los estados del encargo, lo mirara un validador o no.

## Qué hacer

Escribe un fichero `ampliados-<encargo>.test.ts` con un test por clase de defecto de comportamiento que confirmaste (`categoria: defecto` y `tipo: comportamiento`), de cualquier gravedad. Añade también los defectos de comportamiento que viste fuera de tu paquete.

- **Nombre de cada test:** `X<n> · <lo que pide la spec, en positivo> (C<criterio>)`. Por ejemplo: `X1 · una serie con una fecha imposible no responde 500 (C2)`.
- **Solo lo que exige la spec,** no una forma concreta de arreglarlo. Si la spec admite varias respuestas, acéptalas todas. Por ejemplo, para una serie que empieza el 30 de febrero: "si responde 201, la primera reserva empieza en `inicio`, y nunca responde 500".
- **Con los principios de los tests ocultos:** caja negra por la API, cada test arranca su propia API, sin depender del orden y con el reloj fijado (`AHORA`, `TZ`). Toma uno de los ocultos como modelo.
- **Fuera:** los defectos de tipo `documentacion` o `tests`, y todo lo `previo`, `de_mas`, `error` o `ambigua`. Si un defecto no cambia ninguna respuesta de la API, tampoco entra.
- **Comprueba el fichero antes de usarlo:** tiene que fallar en los estados donde confirmaste el defecto y pasar en los que se arregló. Si la referencia también falla en alguno, no pasa nada, apúntalo.

Después, ejecútalo contra todos los estados del encargo:

```sh
python3 -I analisis/ampliar.py <encargo> <fichero.test.ts> analisis/ampliados/<encargo>.json
```

El script prueba la base, la referencia y, de cada cadena, la implementación (A) y los estados finales de B y de C, en la misma caja que el corrector. Repite una vez lo que falla, como el corrector, y al final imprime una matriz de estados por tests. Tarda unos minutos.

Si un test da en algún estado un resultado que no esperabas, compruébalo a mano antes de darlo por bueno, porque puede que el test sea demasiado estricto. Si lo cambias, vuelve a ejecutar el script entero.

## Reglas

Las mismas de antes. No modifiques nada en `/var/tmp/lab-validacion/ejecuciones` ni en el repo del laboratorio, y no lances subagentes.

## Entrega

- El fichero de tests en `analisis/ampliados/ampliados-<encargo>.test.ts`.
- La matriz en `analisis/ampliados/<encargo>.json` (la escribe el script).
- Como respuesta final, un resumen breve: qué comprueba cada test (X1, X2…), cuántos estados A fallan cada uno por modelo, qué pasa con los estados finales de B y C, y cualquier test que hayas tenido que ajustar o que te deje dudas.
