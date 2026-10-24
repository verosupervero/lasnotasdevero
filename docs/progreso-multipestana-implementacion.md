# Progreso entre pestañas y envíos parciales

Implementación del 24 de octubre de 2026, publicada en producción mediante `6adc3e9fa00c0635b0b49e56`, con sincronización Firebase y App Check del cliente habilitados. HTTP y el diagnóstico real de App Check posterior a publicar pasaron. El guardado autenticado en producción queda pendiente de comprobación por la titular. El desarrollo y las pruebas automatizadas usan identidades sintéticas; no se incorporan datos de estudiantes al repositorio. Ver el [estado operativo y límites](production-readiness.md); los resultados de borradores posteriores son historial de ensayo.

## Qué cambia

El progreso de cada pestaña deja de compartir una única clave privada con otras pestañas. Cada página recibe un identificador aleatorio de escritor y guarda un registro propio:

```text
lasnotasdevero:lucas:progress:v1:private:v2:{UID codificado}:{escritor}
→ { version: 2, uid, generation, snapshot, pending, closed? }
```

Generación, copia de progreso y pendientes se escriben juntos en un JSON. Otra pestaña puede leer el registro tras verificar la misma cuenta, pero no sobrescribe una cola activa ajena. `snapshot` conserva el avance visible; `pending` contiene únicamente cambios aún no cubiertos por una confirmación. No es una lista ilimitada de clics: se conserva el registro vigente de cada campo.

La copia anónima mantiene la clave y el formato v1 anteriores. La exportación/importación continúa usando progreso v1 sin metadatos privados internos. Las clases o preguntas retiradas permanecen en las copias locales de la misma generación, pero quedan fuera del envío a Firestore.

## Guardado y combinación

1. Una edición explícita del estudiante calcula los campos cambiados entre antes y después. Incluye desmarcaciones `false`.
2. Se guardan los pendientes en el registro propio y se mantiene el plazo de agrupación de unos siete segundos. Cada pestaña conserva un solo envío en curso.
3. El proveedor recibe una operación lógica `PATCH` con revisión, generación y cambios. Sigue siendo SDK directo a Firestore; no hay endpoint ni Function nuevos.
4. La transacción verifica identidad, bloqueo de eliminación y cabecera. Si coincide la generación, combina los cambios con el estado remoto vigente aunque la revisión recibida sea anterior. Una omisión no borra una pregunta ni una clase.
5. Escribe los documentos realmente modificados y devuelve todo el progreso confirmado. Un envío sin cambios efectivos no escribe ni incrementa revisión.
6. El coordinador aplica la respuesta y retira solo los pendientes cubiertos; conserva ediciones realizadas durante el envío. Un cambio de contexto o cuenta invalida respuestas tardías.

El desempate entre registros de igual fecha utiliza una representación ordenada de sus campos, compartida por el modelo y el proveedor. El orden de propiedades que traiga Firestore o un JSON no puede cambiar el ganador ni causar reenvíos perpetuos.

La generación sigue siendo estricta para impedir restauraciones de avances borrados. DELETE y PUT conservan sus comprobaciones originales; PUT se utiliza, entre otros casos, para distinguir primera creación simultánea de un borrado real. Los reintentos del SDK y del cliente siguen acotados.

## Comunicación y ciclo de vida

- Un aviso `storage` de otra pestaña de la misma cuenta/generación combina la vista; no crea nuevas intenciones de edición ni una consulta de Firebase.
- La retirada de la copia de otra pestaña al cerrar sesión no vacía el perfil propio.
- Un aviso de otra generación pausa envíos y exige comprobar la cuenta antes de continuar. No autentica la cuenta ni autoriza adoptar esa generación; un aviso antiguo puede provocar esa pausa conservadora.
- En `pagehide`, la página sella su registro y rota inmediatamente su identificador. Un retorno desde BFCache o una confirmación tardía usa un escritor nuevo y no reabre la clave sellada.
- La limpieza solo retira registros sellados de la misma generación cuyo pendiente está cubierto por el servidor y cuya copia está cubierta por el registro propio ya persistido. No borra escritores activos. Una prueba de cien ciclos de cierre/recarga comprueba que las copias confirmadas no se acumulan sin límite.

Hay cotas de 96 KiB por registro, 64 registros y 1 MiB de registros privados por guía. El almacenamiento del navegador puede fallar antes por su cuota compartida con otros datos. Se informa entonces que la copia no quedó persistida y se permite exportar; cerrar sesión no se da por terminado si eso perdería la única copia pendiente.

## Recuperación y migración

Al reconectar se verifica el UID y la generación remota antes de recuperar pendientes de registros de pestañas cerradas. Se filtran los que ya cubre el servidor; conservar un registro ajeno no implica volver a escribir todos sus datos.

Sin servidor, varias generaciones diferentes en un arranque nuevo son ambiguas: no se elige una por la fecha de última actividad, porque una copia antigua podría ser posterior en el reloj local a un borrado. Se conservan los registros y se requiere comprobar la cuenta. No se promete acceso a una copia privada de generación incierta durante ese caso; el estudio sin cuenta sigue disponible.

Las claves privadas antiguas de progreso, generación y bandera pendiente se conservan sin certificar su correspondencia. La interfaz ofrece **Exportar copia anterior de esta cuenta** únicamente después de reconocer el mismo UID. No se mezclan automáticamente en la opción de combinar avance anónimo. El estudiante puede revisar el archivo y usar la importación explícita existente.

## Eliminación de cuenta

Después de confirmar el borrado remoto, se limpia el conjunto de copias locales del UID en esta guía y se escribe un marcador técnico local terminal para impedir que callbacks o sesiones antiguas las recreen. Las otras cuentas permanecen intactas. Las pestañas notificadas salen del perfil privado y actualizan sus controles.

Si el navegador impide confirmar la limpieza local durante la eliminación de cuenta, la interfaz distingue ese fallo del borrado remoto confirmado. No muestra un éxito de limpieza completa ni pide recrear una cuenta que ya se eliminó. El marcador local contiene el UID y el estado terminal, sin avance; el bloqueo técnico remoto documentado previamente también continúa existiendo. El cierre de almacenamiento privado de ese proceso hace verificaciones posteriores a la escritura para detectar escrituras concurrentes antes de retirar registros. Un corte abrupto entre la escritura y esa comprobación puede dejar bytes físicos locales; el marcador terminal impide restaurarlos. No se promete borrado físico atómico.

El proveedor ahora limpia clases retiradas consultando al servidor los documentos del UID autenticado para IDs de curso presentes en el registro del cliente. La consulta usa un límite de 201 para imponer máximo 200 documentos; los cursos quitados del registro central no se escanean. Borrar una guía elimina las clases activas y retiradas encontradas de manera atómica. Al borrar una cuenta se establece primero el marcador, se recorren los IDs de cursos registrados y se eliminan sus documentos en lotes; Authentication se elimina al final. Si ocurre un fallo, se conserva la cuenta de Authentication y se puede reintentar. Esto no constituye un respaldo central Firebase.

## Consumo y pruebas

El proveedor emulado midió 2 lecturas base para un cambio con caché vigente; 11 para una revisión antigua de la misma generación, combinada sin el segundo viaje habitual por 409; normalmente 2 escrituras para una clase modificada. Un cambio obsoleto o vacío no escribió documentos. Las lecturas de reglas y los reintentos se suman a esas cifras.

No hay sondeo periódico ni listeners remotos nuevos. Dos pestañas que editan pueden enviar un lote cada una; no se implementa un líder para reunir todos los lotes en uno. Las notificaciones locales no consumen operaciones de Firestore. Otro dispositivo inactivo se actualiza al consultar o sincronizar; la respuesta de una transacción representa esa versión confirmada, no todas las modificaciones futuras.

Pruebas focalizadas:

- Modelo, cliente, almacenamiento privado, App Check y preview: tests Node con conexiones externas prohibidas.
- Reglas y proveedor real: Auth/Firestore Emulator, proyecto `demo-lasnotasdevero`, usuarios sintéticos y medición de transacciones.
- [Prueba de navegador entre pestañas](../tests/study-guide-multitab-browser.mjs): HTML real de la guía, cuatro pestañas de un mismo perfil temporal y proveedor CAS sintético servido exclusivamente en loopback. El navegador bloquea todo tráfico externo. No reemplaza el bundle genuino de producción en disco.

La prueba de navegador comprueba cierre en otra pestaña, borrado de generación, ediciones durante una confirmación retenida, recarga y limpieza de cuenta entre pestañas.

## Resultado de verificación y publicación

- **107/107 pruebas Node aprobadas** con conexiones externas bloqueadas.
- **13/13 pruebas de reglas aprobadas** con Auth/Firestore Emulator y proyecto demo.
- **Proveedor real aprobado** con emuladores: cubre borrado de clases retiradas, límite de 200 y respuesta/reintento al superar límite, además de aislamiento del UID vecino y funcionamiento existente.
- **Prueba de navegador aprobada** con cuatro pestañas y cinco casos: cierre de otra pestaña, reset, edición durante envío, recarga y eliminación de cuenta con limpieza de pares y conservación de otro UID.
- **Revisión de código y diff aprobadas**, sin hallazgos materiales pendientes para este alcance.
- **Render de privacidad aprobado** con Hugo 0.124.1: 311 documentos HTML, cero etiquetas de scripts externos, RefTagger ausente y cero filtraciones privadas. Se activaron temporalmente flags Hugo para render, pero Firebase conservó `enabled: false`; el código conserva sus flags por defecto y el resultado es render-only no desplegable.
- **Borrador actualizado:** `6adc3861ca255b5cafec6232`, en la [guía de prueba existente](https://lucas-firebase-test-20261023--lasnotasdevero.netlify.app/estudios/guia-estudio-lucas/). Netlify confirmó `ready`, 24 archivos y 1.641.531 bytes, sin build remoto, Functions ni Edge Functions, y con la publicación principal intacta. HTTP 200 verificó recursos reales, `lnv-test` activo y `lnv-data` desactivado.

Las pruebas de navegador usaron proveedor sintético y las del proveedor real usaron emuladores: no equivalen por sí solas a un ensayo real de Google. La titular confirmó que la revisión actual funciona con dos cuentas entre una PC y un teléfono. Para futuras pruebas en el borrador, recargar todas las pestañas antes de editar; una página abierta puede conservar JavaScript anterior. El borrador `6adc3861ca255b5cafec6232` contiene la revisión final; `6adc3455cd7abfa100a5b8b4` era anterior. El sitio estático de producción se actualizó como `6adc3a215779e3e0255041b2`; un preflight posterior de App Check obtuvo HTTP 200, pero la pausa sigue siendo el deployment live documentado hasta verificar el nuevo release por HTTP. Ver [revisión de preparación](production-readiness.md).
