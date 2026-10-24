# Prioridades de revisión del progreso de estudiantes

Actualización posterior: se implementaron cierres con comprobación de escrituras concurrentes durante eliminación de cuenta y borrado de documentos de clases retiradas para cursos presentes en el registro. Pasaron 107 pruebas Node sin red, 13 pruebas de reglas, provider real con emuladores y navegador de cuatro pestañas/cinco casos. El borrado no escanea cursos eliminados del registro central y tiene un límite de 200 documentos por consulta. El borrador `6adc3861ca255b5cafec6232` está listo y la titular confirmó que funciona con dos cuentas entre PC y teléfono. El rechazo histórico de App Check se superó: producción sirve `6adc3e9fa00c0635b0b49e56` con sincronización y App Check habilitados, verificados por HTTP y token real posterior a publicar. Falta comprobar un guardado autenticado en el dominio principal; no hay respaldo central privado. El análisis siguiente se conserva como evidencia de los fallos previos; ver [implementación y resultados](progreso-multipestana-implementacion.md) y [revisión de preparación](production-readiness.md).

Revisión del 24 de octubre de 2026. Alcance: código local de sincronización Firebase y documentación existente. No se modificaron reglas remotas, servicios, planes ni despliegues durante esta revisión. La titular confirmó funcionamiento del ensayo después de corregir App Check; esa confirmación no reemplaza los casos de seguridad pendientes.

## 1. Alta: pérdida y restauración involuntaria entre pestañas

Archivos: [controlador de la guía](../static/js/study-guide.js), listener `storage` desde la línea 252; [sincronización](../static/js/study-sync.js), limpieza de copia privada en `detach()` y manejo de generaciones en `connect()`/`remove()`.

El progreso privado se comparte mediante localStorage; las sesiones de Authentication y el estado del coordinador son independientes por pestaña. El listener mezcla datos por fecha sin comprobar su generación remota. Una eliminación de clave vacía el estado visible, pero no detiene al coordinador de esa pestaña.

Se reprodujeron dos escenarios sin acceso a Firebase real: Node VM ejecutó el listener real extraído del controlador y `createSync` real, con almacenamiento compartido y un proveedor CAS sintético.

- Cerrar sesión en A retira la copia local compartida. B sigue conectada, pero pierde su estado en memoria. Al editar otra pregunta de la misma clase, B puede enviar la clase incompleta y reemplazar marcas anteriores. Si omite una clase completa que el proveedor conoce, la validación rechaza el envío con 400 en lugar de perder esa clase: no todos los casos producen el mismo resultado.
- Borrar el progreso de la guía en A genera una época nueva. B puede mezclar su copia anterior con el estado vacío y escribirla otra vez en almacenamiento compartido. A puede incorporarla y subirla bajo la generación nueva al editar después. Se restaura avance que se había solicitado borrar. No es el borrado de cuenta: el bloqueo de eliminación de cuenta es un mecanismo distinto.

La reproducción es una prueba focalizada con proveedor simulado, no un ensayo completo de navegador ni del servidor Firestore. El arreglo deberá comprobar ambos niveles con dos pestañas y emuladores, sin datos reales.

Alternativas a decidir antes de implementar:

1. **Conservar edición en varias pestañas (recomendada):** asociar cada copia privada y cada actualización entre pestañas a una generación comprobada; pausar y revalidar al detectar cierre, retirada de copia o cambio de generación. Una copia antigua no debe mezclarse bajo la generación nueva. La limpieza de una pestaña no debe dejar otra con un coordinador activo sobre un estado vacío. Requiere migrar con cuidado las copias anteriores y conservar pendientes sin exponerlos a otra cuenta.
2. **Una sola pestaña editora por cuenta en ese navegador:** las demás muestran un aviso y permiten transferir el control. Reduce escrituras concurrentes, pero agrega una restricción visible y requiere gestionar pestañas suspendidas, cerradas o sin conexión. Tampoco elimina la necesidad de respetar las generaciones.

Ambas pueden usar mecanismos del navegador y la infraestructura actual, sin contratar servicios. No hay implementación de estas alternativas todavía.

## 2. Media: borrado incompleto de clases retiradas

Archivo: [proveedor Firebase](../assets/js/study-firebase-provider.js), construcción de referencias en `refs()` y bucles de borrado de `readOrMutate()`/`eraseAccount()`.

El borrado enumera solo IDs del catálogo actual. Si una clase previamente guardada desaparece del catálogo, su documento remoto queda fuera de esos bucles y también fuera de la exportación normal. Es una limitación confirmada del código; no se consultó Firestore para determinar si existen documentos reales afectados.

Alternativas:

- Mantener una lista explícita y permanente de IDs retirados para su limpieza: menor cambio y consumo acotado, pero depende de mantenimiento editorial correcto.
- Para un curso conocido, enumerar los documentos propios de `classes` y borrar también los retirados. Las reglas actuales permiten esa consulta por UID incluso después del marcador de eliminación. Para borrar la cuenta, escribir primero el marcador impide nuevas escrituras mientras se limpia; solo eliminar Authentication después de terminar. Deben acotarse páginas/lotes y permitir reintento tras interrupción. Aumenta lecturas/eliminaciones y no resuelve por sí sola cursos completos retirados del registro.

No hace falta contratar un backend para evaluar esas opciones. Firebase advierte que borrar un documento padre no borra sus subcolecciones y desaconseja el borrado de colecciones sin límites desde clientes: [documentación de eliminación](https://firebase.google.com/docs/firestore/manage-data/delete-data). Cualquier alternativa debe respetar ese límite operativo y mantener las autorizaciones por propietario.

## 3. Antes de producción: ensayo completo

Se comprobó un token real y la titular confirmó que el flujo actualizado funciona con dos cuentas entre PC y teléfono. Esa confirmación general no incluye un registro independiente de cada escenario con combinación, cierre con pendientes, pérdida de red, F5 y borrado.

App Check se mantiene sin exigencia remota; por eso no debe presentarse como una barrera aplicada por Firestore a solicitudes sin token. La primera publicación solicitada puede mantener el enforcement desactivado mientras se revisan las métricas y cuotas. Si se decide cambiar la exigencia más adelante, será un cambio remoto separado, con ensayo y reversión documentados. [Funcionamiento de la exigencia](https://firebase.google.com/docs/app-check/enable-enforcement).

## 4. Recuperación y mantenimiento

La exportación/importación JSON funciona como copia individual; la sincronización no es una copia histórica contra borrados o corrupción replicada. No hay un respaldo central Firebase implementado; el script antiguo de backups respalda Netlify Blobs.

El servicio administrado de exportación/importación Firestore requiere facturación y Blaze, por lo que queda descartado bajo las condiciones actuales: [requisitos oficiales](https://firebase.google.com/docs/firestore/manage-data/export-import). Separar una propuesta gratuita de copia privada y restauración de la implementación actual; no afirmar que las exportaciones individuales equivalen a un respaldo central.

Los recursos antiguos ausentes de CSS e imagen deben corregirse en una tarea acotada posterior; no fueron la causa del rechazo de App Check ni tienen la prioridad de los problemas de integridad y eliminación.
