# Revisión de preparación para producción

Actualizado el 24 de octubre de 2026. Producción ya sirve Firebase Sync y App Check habilitados con `study_private_storage = true`; el deployment live es `6adc3e9fa00c0635b0b49e56`. La clave pública está en el archivo versionado `static/config/firebase.json`; no se repite aquí.

## Estado confirmado

### Reanudación verificada

Confirmación posterior de la titular: después de la publicación informó «bien, funciona». Se registra como comprobación manual comunicada por ella; no hubo acceso automatizado a su cuenta ni a los datos de estudiantes. No se detallaron en esa confirmación todos los casos de guardado, dos cuentas y dos dispositivos en producción.

La titular confirmó que el número de proyecto de `lnv-data` es `303954316495`, que reCAPTCHA Enterprise está habilitado y que la clave pública corregida está registrada en Firebase App Check para la app correcta. El preflight y la comprobación posterior a publicar obtuvieron HTTP 200; la verificación live informó `ok: true`, sin errores de App Check ni CSP. Ambas se hicieron sin login ni acceso a Firestore, sin guardar tokens en logs y sin cambios IAM. Confirman la atestación en producción, pero todavía no demuestran una sesión autenticada ni lecturas o escrituras de progreso desde una cuenta real.

La causa del HTTP 400 anterior no está confirmada. Que la clave o el registro tardaran en propagarse después de la corrección es una posibilidad, no un hecho comprobado. No atribuir el fallo a IAM ni a CSP.

Se comprobó además que una lectura REST anónima a una ruta ficticia de producción fue rechazada con HTTP 403 / `PERMISSION_DENIED` y «Missing or insufficient permissions». No se usó un UID de estudiante ni se escribieron documentos. Esto comprueba ese rechazo anónimo; no reemplaza las pruebas entre UIDs de los emuladores ni demuestra todas las reglas de producción.

Se publicó `6adc3e9fa00c0635b0b49e56`; Netlify confirmó `ready` y `published: true`, 551 archivos (260.426.605 bytes), sin build remoto, Functions ni Edge Functions. HTTP 200 confirmó la guía y sus variantes de ruta, configuración live de `lnv-data` con `enabled: true` y App Check habilitado, los ocho recursos JS por hash y RefTagger ausente. La pausa segura anterior fue `6adc3a215779e3e0255041b2`. La titular aún no ha probado una escritura autenticada en producción; la prueba real previa de dos cuentas PC/teléfono fue en el proyecto de ensayo y la suite de emulador pasó.

Los tres párrafos siguientes conservan los fallos anteriores a la confirmación del número de proyecto y al preflight HTTP 200.

Último ensayo: la titular reemplazó la clave por otra terminada en `T9W2F` y confirmó haberla registrado en Firebase. Se guardó localmente con la sincronización desactivada. Una comprobación de esa clave en producción siguió devolviendo HTTP 400 / `FAILED_PRECONDITION`. Una comprobación de control con la misma herramienta en `lnv-test` sí obtuvo un token válido; no se registró el token. Ambas pruebas se realizaron sin login ni acceso a Firestore. La publicación principal no cambió. Sigue pendiente comprobar el número de proyecto que contiene la clave de producción frente a `303954316495`; cambiar otra vez de clave sin verificar esa correspondencia no establece la causa del rechazo.

Actualización del diagnóstico: la titular confirmó que habilitó la API de reCAPTCHA Enterprise y que Firebase App Check conserva la clave terminada en `bDIxm`. Dos comprobaciones acotadas posteriores, separadas por un margen de espera, siguieron devolviendo HTTP 400 / `FAILED_PRECONDITION`. Ninguna inició sesión ni accedió a Firestore. Se mantiene la pausa; no se atribuye el error a un permiso IAM concreto ni se modifican permisos sin evidencia. La siguiente comprobación solicita comparar el número del proyecto que contiene la clave con `303954316495`, el número de la app configurada en el sitio. No hay una sesión administrativa Firebase disponible localmente para comprobar la consola por cuenta de la titular.

Comprobación posterior: la titular entregó una nueva clave pública de reCAPTCHA Enterprise, terminada en `bDIxm`, tras identificar que el proyecto anterior era incorrecto. Se guardó en la configuración local versionada, manteniendo ambos indicadores `enabled` en `false`. Un único ensayo de esa clave en el dominio real, mediante una sustitución en memoria del diagnóstico, volvió a recibir HTTP 400 / `FAILED_PRECONDITION`: Google solicita verificar que la API de reCAPTCHA Enterprise esté habilitada y que la clave pertenezca al proyecto de la aplicación. No se inició sesión, no se consultó Firestore ni se registraron tokens. No se hizo un nuevo despliegue: la publicación continúa pausada. Se solicitó comprobar la API directamente en `lnv-data` y el registro de la clave en Firebase App Check; el error por sí solo no identifica cuál de esas condiciones falla.

La titular confirmó para `lnv-data` Spark sin facturación vinculada, Google Authentication, dominios autorizados, App Check y reglas publicadas. Es una confirmación de la titular, no una lectura administrativa independiente de la consola. La aplicación valida App Check solo para los identificadores exactos `lnv-test` y `lnv-data`; la herramienta de vista previa sigue siendo exclusiva de `lnv-test`. En una vista previa no se puede activar producción.

El render de privacidad de Hugo con la versión fijada de producción, 0.124.1, pasó como comprobación aislada y no desplegable: 311 documentos HTML, cero etiquetas de scripts externos, RefTagger ausente y cero filtraciones privadas. Para generarlo se activaron temporalmente flags Hugo de render, mientras la configuración Firebase mantuvo `enabled: false`; los valores por defecto del código no cambiaron. Este resultado verifica el HTML de esa variante; no activa Firebase, no representa un deploy ni prueba el comportamiento remoto.

El borrador público de ensayo ya se actualizó a `6adc3861ca255b5cafec6232`. Netlify confirmó `ready`, contexto `deploy-preview`, 24 archivos y 1.641.531 bytes; sin build remoto, Functions ni Edge Functions y con la publicación principal intacta. HTTP 200 confirmó los recursos genuinos, `lnv-test` activo y `lnv-data` apagado. La titular confirmó que el flujo actualizado funciona con dos cuentas entre una PC y un teléfono.

## Intento de producción y pausa segura

El intento `6adc39c50e2dd31bf3fe0454` falló al intercambiar el token de App Check: HTTP 400 `FAILED_PRECONDITION` / `CreateAssessment`, con un mensaje de Google que pide comprobar que reCAPTCHA Enterprise esté habilitado y que la site key corresponda al mismo proyecto que la app. La petición se hizo sin login, sin lecturas/escrituras de Firestore y sin registrar tokens. No fue un error de CSP.

Se publicó enseguida la pausa segura `6adc3a215779e3e0255041b2`, confirmada `ready` y como puntero principal. HTTP 200 verificó portada, contacto y guía con/sin barra final; ocho recursos JS coincidieron por hash. En esa pausa histórica, la configuración de `lnv-data` mantuvo Sync y App Check apagados, RefTagger ausente y `study_private_storage` activo. Netlify indicó 551 archivos (260.423.714 bytes), sin Functions, Edge Functions ni build remoto. No hubo operaciones de progreso ni acceso a cuentas durante el diagnóstico.

La reanudación posterior sí quedó confirmada por ID, HTTP y App Check con la configuración publicada, según el estado actual al comienzo de este documento. Estas verificaciones no equivalen a probar una sesión ni un guardado autenticado; no se cambiaron reglas ni enforcement remoto.

## Trabajo de borrado y límite declarado

El borrado remoto consulta únicamente documentos del UID autenticado para los IDs de curso que siguen en el registro de cursos del cliente. Las consultas son al servidor y usan límite 201 para imponer un máximo de 200 documentos. No escanea cursos que ya se hayan quitado del registro central. La eliminación de una guía incluye en una transacción las clases activas y retiradas que encuentre dentro de ese límite.

El borrado de cuenta coloca primero el marcador de bloqueo remoto, descubre los cursos registrados, elimina documentos en lotes y solicita borrar Firebase Authentication al final. Si un paso falla, la cuenta de Authentication se conserva y la interfaz permite reintentar; no presenta un borrado completo como exitoso. Firestore y Authentication no ofrecen una transacción conjunta.

Durante la eliminación de cuenta, el cierre del almacenamiento privado hace verificaciones posteriores a la escritura para detectar escrituras concurrentes antes de retirar el registro. Si el proceso se interrumpe entre la escritura y esa comprobación, pueden quedar bytes locales físicos; el marcador terminal impide restaurarlos. No se promete borrado físico local atómico.

No hay un respaldo central privado de Firebase implementado. Las exportaciones individuales del estudiante y los respaldos cifrados administrados fuera de Firebase no equivalen a una copia central recuperable del proyecto. Antes de proponer una recuperación operativa hay que definir una alternativa compatible con Spark, su privacidad, quién custodia la clave y cómo se comprueba la restauración. No afirmar que exista un respaldo de producción.

## Verificaciones y límites vigentes

- Las suites locales finales pasaron: 107/107 pruebas Node sin red, 13/13 Rules en demo emulators, provider real emulado (borrado retirado, tope, retry y aislamiento vecino), navegador de cuatro pestañas/cinco casos, revisión de código y diff. El render de privacidad Hugo 0.124.1 pasó con 311 HTML, cero scripts externos, RefTagger ausente y cero filtraciones privadas. Se generó mediante flags temporales de render, con Firebase desactivado; el artefacto es no deployable.
- El ensayo manual actualizado con dos cuentas entre PC y teléfono fue confirmado por la titular. Esta confirmación no es una inspección independiente de datos ni reemplaza métricas de uso posteriores.
- Revisar consumo, métricas de App Check y condiciones de cuota después de la publicación, sin habilitar facturación. App Check puede desplegarse sin enforcement inicial según el procedimiento autorizado de monitoreo; su existencia no garantiza disponibilidad ni impide abuso por una cuenta legítima.
- Mantener documentada la limitación de cursos quitados del registro central; la eliminación recorre los IDs del registro de cursos del cliente y consulta al servidor solo los documentos del UID autenticado, sin prometer un escaneo del proyecto entero.
- No existe un respaldo central privado de Firebase; abordar su diseño como mejora posterior y no describir el sistema como recuperable ante pérdida del proyecto.
- HTTP y App Check posteriores al despliegue están verificados. Comprobar el guardado autenticado en el dominio principal y mantener el enforcement remoto sin cambios durante el monitoreo inicial.

## Orden de activación y reversión

La versión solicitada está publicada y la configuración activa y App Check se verificaron por HTTP. La siguiente comprobación es ensayar el guardado autenticado en el dominio principal. Mantener el enforcement remoto sin cambios durante el monitoreo inicial.

La versión local de pausa preparada conserva `enabled: false`, `appCheck.enabled: false`, flags de sincronización apagados y `study_private_storage = true`. La publicación actual está activa; ese artefacto se reserva para una reversión si hiciera falta. Con cuentas existentes, conservar la protección del almacenamiento aunque se pause Firebase. No borrar datos remotos como parte de una reversión visual ni retirar marcadores de borrado sin un procedimiento revisado.

Los detalles técnicos y el historial fechado se mantienen en [sincronización Firebase](firebase-sincronizacion.md), [implementación multipestaña](progreso-multipestana-implementacion.md) y [App Check](firebase-app-check-pruebas.md).
