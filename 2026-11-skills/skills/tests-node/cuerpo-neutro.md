# Tests con node:test

Cómo escribir los tests del club con `node:test` y `node:assert/strict`.

- Escribe al menos un test por criterio de aceptación de la spec y pon el número del criterio al principio del nombre, por ejemplo `C3 · un socio sin cuota no puede reservar`. Así se ve qué criterio falla.
- Usa el arranque de `test/ayuda.ts`, que levanta la API en un puerto libre con una semilla nueva. Cada test empieza con su propio estado: no dependas de lo que dejó otro test ni del orden en que se ejecutan.
- Cambia la hora con `POST /_reloj` cuando el criterio depende del momento. No uses la hora del sistema.
- Comprueba el código HTTP y el cuerpo de la respuesta, incluido el código de error (`{"error": {"codigo"}}`), no solo que la llamada no falle.
- Cubre los casos límite que nombre la spec: el último minuto de un plazo, una lista vacía, un importe con redondeo.
- Usa `assert.deepEqual` cuando compares objetos enteros y `assert.equal` para valores sueltos.
- Cuando termines, pasa `npm run check`.
