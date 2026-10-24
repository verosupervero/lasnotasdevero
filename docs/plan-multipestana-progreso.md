# Plan de progreso en varias pestañas con envíos de cambios

Estado posterior: este plan se implementó y publicó únicamente en el borrador de pruebas. Las diferencias prácticas, límites, migración y resultados están documentados en [implementación multipestaña](progreso-multipestana-implementacion.md). El texto siguiente conserva el diseño previo y sus estimaciones; no reemplaza las mediciones del informe de implementación.

24 de octubre de 2026. Diseño propuesto a partir de la elección de la titular: conservar varias pestañas, enviar cambios y aprovechar la transacción para recuperar el resto. Este documento no describe una implementación terminada ni resultados de pruebas nuevas. No se modificaron Firebase, reglas, planes ni despliegues durante este análisis.

## Objetivo

Editar desde varias pestañas sin perder marcas, sin restaurar generaciones borradas y sin agregar consultas periódicas a Firebase. Conservar IDs, avance anónimo v1 y exportación/importación JSON.

## Lo que ya hace el código

El coordinador envía una copia completa, pero el proveedor solo escribe documentos de clase que cambian y su resumen. El guardado con caché confirmada vigente hace dos lecturas base; un resumen remoto distinto obliga a leer las nueve clases, once documentos base en total. La revisión antigua produce 409 y otra operación para combinar/reintentar. El progreso local y su generación se guardan por separado, y varias pestañas escriben la misma copia privada.

Por eso enviar menos JSON no garantiza menos escrituras. El ahorro principal propuesto es evitar la segunda operación por una revisión antigua, y evitar guardados redundantes. El problema local de generaciones debe corregirse además del protocolo de envío.

## Alternativas comparadas

| Diseño | Seguridad y comportamiento | Consumo y complejidad |
| --- | --- | --- |
| Copia completa con combinación actual fuera de la transacción | Conserva los fallos locales ya reproducidos y exige reintentar una revisión antigua | Menor cambio, pero no satisface el objetivo |
| Cambios por campo combinados dentro de la transacción, más pendientes privados aislados por pestaña y generación | Una pestaña no reemplaza la cola de otra; se conserva lo que no fue modificado | Recomendado; no exige nuevas colecciones remotas, pero requiere limpieza y migración locales cuidadosas |
| Un registro local compartido por cuenta/generación con Web Locks breves | Puede ser seguro si todas las escrituras respetan el bloqueo; no limita a una sola pestaña editora | Menos registros, pero cambia el guardado local a asíncrono y necesita una alternativa segura si el navegador no dispone de Web Locks |
| Listener permanente de Firestore | Puede refrescar dispositivos inactivos más rápido; por sí solo no arregla las carreras locales | Agrega consumo de lecturas y reconexiones; no se propone para este cambio |

## Propuesta recomendada

### Copia local y pendientes

- Cada pestaña mantiene un espacio de escritura propio para cada UID y generación. La generación y su contenido se guardan juntos en un registro, evitando asociar datos antiguos con una generación nueva por una escritura intermedia.
- La cola de pendientes conserva la última edición de cada campo, con su valor y fecha; no crea un historial ilimitado de clics. Una desmarcación `false` es un cambio explícito.
- Las notificaciones de otras pestañas permiten actualizar la vista de la misma cuenta/generación. No crean por sí solas nuevas intenciones de edición ni autorizan cambiar de UID o generación.
- Cerrar sesión o retirar la copia de A no significa borrar el avance remoto de B. La pestaña B conserva su sesión y comprueba el contexto antes de seguir enviando.
- Un borrado confirmado cambia la generación. Los pendientes de la anterior no se vuelven a enviar bajo la nueva. Las operaciones asíncronas conservan el UID y la generación que tenían al empezar.
- Las copias de pestañas cerradas con cambios sin confirmar se recuperan solo tras verificar la misma cuenta y generación. No borrar una cola ajena activa basándose en una lectura antigua de ella. La recuperación y limpieza requieren un protocolo probado, no una simple enumeración seguida de `removeItem`.
- La clave anónima y el JSON exportable v1 permanecen separados de estos metadatos internos. Las copias antiguas se conservan para recuperación; no se certifica su generación basándose únicamente en las dos claves actuales, que pudieron sufrir la mezcla detectada.

### Una transacción para combinar y devolver el avance

Agregar una operación lógica de cambios parciales al proveedor existente; no es una Function ni un endpoint HTTP nuevo. Mantener la validación de campos, UID y límites de tamaño.

1. Capturar los cambios pendientes del envío, su cuenta y su generación; conservar los cambios que lleguen después.
2. Dentro de la transacción, leer marcador y resumen; reutilizar únicamente la caché remota confirmada si corresponde. Si el resumen cambió, leer las clases antes de escribir.
3. Si la generación coincide, combinar los campos recibidos con el estado remoto, aunque la revisión del emisor haya quedado atrás. Una omisión no elimina una pregunta ni una clase.
4. Resolver dos ediciones del mismo campo con el criterio por fecha y desempate determinista existente. Campos distintos se conservan ambos. No combinar booleanos con OR: impediría desmarcar.
5. Escribir solo los documentos que cambian y devolver el avance completo de esa versión confirmada. Si el envío no produce cambios efectivos, no escribir ni incrementar la revisión.
6. Después de confirmar, actualizar la interfaz y retirar solo pendientes cubiertos por la respuesta. Una edición realizada durante el envío permanece pendiente. Un cambio de UID/generación invalida la respuesta para el perfil actual.

Firestore exige que las lecturas precedan a las escrituras y puede repetir la función de transacción por concurrencia. Por eso se calcula el resultado dentro y se modifica la interfaz solo después de confirmar: [transacciones oficiales](https://firebase.google.com/docs/firestore/manage-data/transactions).

El borrado conserva revisión y generación estrictas; no se flexibiliza como los cambios ordinarios. La primera creación simultánea y la diferencia entre un perfil nunca creado y uno borrado siguen necesitando su tratamiento explícito.

## Consumo previsto, no medido todavía

Para nueve actividades y una clase modificada:

| Situación | Actual | Propuesto |
| --- | --- | --- |
| Guardado con caché vigente | 2 lecturas base y normalmente 2 escrituras | Igual, en una operación |
| Revisión antigua, misma generación, caché anterior | 11 lecturas, 409 y normalmente otras 11 al reintentar | 11 lecturas y combinación en esa misma transacción |
| Cambios ya aplicados o superados | Puede reenviar/revisar el estado | Lectura necesaria para comprobar; 0 escrituras si no cambia nada |
| Aviso local de otra pestaña, misma generación | Sin consulta automática de nube | Sin consulta automática de nube |

Son operaciones base de documentos, no un máximo de consumo ni una medición de facturación. Se agregan las lecturas dependientes de reglas y los intentos automáticos del SDK. Un `set` o `update` cuenta como una escritura de documento aunque cambie pocos campos: [consumo oficial](https://firebase.google.com/docs/firestore/pricing).

Conservar la agrupación actual de aproximadamente siete segundos, un envío en curso por pestaña y reintentos acotados. No agregar sondeo periódico, un documento por clic ni una colección de operaciones. La sincronización entre dispositivos inactivos no se vuelve instantánea: recibirán cambios al consultar o sincronizar. La respuesta de una transacción representa esa versión confirmada; otra puede modificarse después.

## Archivos previstos y orden

1. Un módulo pequeño de almacenamiento privado: formato por UID/generación/pestaña, pendientes, migración y limpieza segura. Sin modificar contenido editorial.
2. [study-guide.js](../static/js/study-guide.js): separar ediciones locales de avisos externos; conservar `snapshot()` como progreso v1 y evitar mezclar generaciones.
3. [study-sync.js](../static/js/study-sync.js): cola por campos, confirmaciones, recuperación y guardias de identidad/generación; reutilizar la agrupación y reintentos actuales.
4. [study-firebase-provider.js](../assets/js/study-firebase-provider.js): validación de cambios parciales, combinación dentro de la transacción y respuesta completa. Conservar los controles de borrado y no introducir caché basada en datos locales no confirmados.
5. Pruebas focalizadas del cliente, proveedor y dos pestañas del mismo perfil; documentación de migración y límites.

No se prevén cambios del esquema remoto ni de reglas para el envío parcial; esa compatibilidad debe comprobarse con Emulator Suite antes de afirmarla como verificada.

## Aceptación y pruebas necesarias

- Dos pestañas editan preguntas distintas de la misma clase: se conservan ambas.
- Dos pestañas cambian la misma pregunta: se aplica el criterio documentado y se puede desmarcar.
- Logout en A mientras B continúa: B no pierde marcas ni envía una clase vaciada por la limpieza de A.
- Borrado en A con B antigua: no reaparece avance de la generación anterior, incluso con eventos demorados.
- Cambios mientras hay un envío en curso: no se retiran pendientes nuevos al confirmar el envío anterior.
- Escrituras locales simultáneas, cierre antes del envío y recarga: no se pierde la única copia persistida.
- Cambio de cuenta, almacenamiento lleno/denegado, red caída y cuota agotada: separación por UID y mensajes veraces; recuperación/exportación cuando corresponda.
- Instrumentar lecturas y escrituras para comprobar el consumo previsto, incluyendo conflictos y ausencia de cambios. Usar exclusivamente identidades sintéticas y emuladores.
- Después, ensayar manualmente cuentas y dispositivos de prueba. Mantener producción y la exigencia de App Check sin cambios durante el desarrollo.
