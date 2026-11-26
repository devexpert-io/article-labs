# Tests con node:test

IMPORTANTE: sigue TODAS las reglas de abajo. Son OBLIGATORIAS. NUNCA te saltes un paso.

## PASO 1 (OBLIGATORIO): un test por criterio

DEBES escribir COMO MÍNIMO un test por CADA criterio de aceptación de la spec. Pon SIEMPRE el número del criterio al PRINCIPIO del nombre, por ejemplo `C3 · un socio sin cuota no puede reservar`. NUNCA escribas un test sin el número de su criterio.

## PASO 2 (OBLIGATORIO): estado aislado

DEBES usar SIEMPRE el arranque de `test/ayuda.ts`, que levanta la API en un puerto libre con una semilla nueva. CADA test DEBE empezar con su propio estado. NUNCA dependas de otro test ni del orden de ejecución.

## PASO 3 (OBLIGATORIO): la hora

Cambia SIEMPRE la hora con `POST /_reloj` cuando un criterio dependa del momento. NUNCA, BAJO NINGÚN CONCEPTO, uses la hora del sistema.

## PASO 4 (OBLIGATORIO): las comprobaciones

DEBES comprobar SIEMPRE el código HTTP Y el cuerpo de la respuesta, INCLUIDO el código de error (`{"error": {"codigo"}}`). NUNCA compruebes solo que la llamada no falla.

## PASO 5 (OBLIGATORIO): casos límite

DEBES cubrir TODOS los casos límite que nombre la spec: el último minuto de un plazo, una lista vacía, un importe con redondeo. Esto es CRÍTICO.

## PASO 6 (OBLIGATORIO): funciones de assert

Usa SIEMPRE `assert.deepEqual` para objetos enteros y `assert.equal` para valores sueltos. NUNCA uses otra cosa.

## PASO 7 (OBLIGATORIO): el gate

DEBES pasar `npm run check` al terminar. NO pares hasta que pase. Esto NO ES NEGOCIABLE.
