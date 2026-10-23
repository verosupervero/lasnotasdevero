# Firebase Spark: sincronización opcional del progreso

Estado: implementación local preparada y verificada con emuladores, sin publicar. La titular proporcionó la configuración pública de `lnv-data`; se guardó con `enabled: false` y Hugo mantiene `study_sync_enabled = false`. El 23 de octubre de 2026 confirmó que el proyecto está en **Spark y sin cuenta de facturación vinculada**. Esa confirmación proviene de la titular, no de una consulta administrativa autenticada al proyecto. No se creó ni se modificó un proyecto remoto desde esta implementación, no se vinculó facturación y no se activó Blaze, Identity Platform, Cloud Functions, Storage ni extensiones.

## Auditoría y trabajo conservado

El flujo anterior era Hugo → `static/js/study-guide.js` → `static/js/study-sync.js` → rutas `/api/lucas/*` → Netlify Identity y Blobs. El servidor ya estaba apartado en `netlify/disabled-functions/`; no existían perfiles sincronizados en los almacenes consultados durante la auditoría anterior.

Se conservan el modelo `static/js/study-progress.js`, el formato JSON v1, los identificadores de clases/preguntas y la clave original `lasnotasdevero:lucas:progress:v1`. El controlador sigue siendo responsable de guardar localmente. La exportación/importación se inicializa antes de evaluar la configuración de sincronización.

El cliente, la plantilla y los recursos técnicos de cuenta anteriores se guardaron en `legacy/netlify-sync/`. La página informativa de cuenta también se conserva allí como `cuenta-info.html`, fuera de `static/`, para no crear una ruta pública `/cuenta/` durante esta publicación. El acceso Google futuro se ofrece desde la guía y no utiliza esa página. El servidor, sus módulos, el catálogo y la herramienta de copias Netlify también se conservan con sus pruebas. No son el proveedor activo. El endpoint de contacto ya retirado se conservó en `netlify/disabled-functions/contact.mjs`; `netlify/functions/` queda sin puntos de entrada desplegables. El contenido editorial, los videos y la bibliografía no se reescriben para esta migración.

La consulta anterior de solo lectura al despliegue público encontró `contact` y una función interna `emails`, sin Lucas, e Identity desactivado. No se modificó ese despliegue. Antes de una publicación futura como hosting exclusivamente estático, revisar en la cuenta de Netlify la integración existente que genera `emails`: no está definida por estos archivos y un directorio local vacío no demuestra que una extensión remota deje de generarla. No se contrató ni se activó esa integración durante este trabajo.

## Arquitectura preparada

Hugo sirve HTML/CSS/JavaScript estático desde Netlify. `study-sync.js` usa una interfaz de proveedor, sin llamadas activas a `/api/lucas/`. El proveedor Firebase se compila desde `assets/js/study-firebase-provider.js` con el SDK modular oficial a `/js/study-firebase.bundle.js`. Solo se carga si Hugo habilita la función y la configuración pública válida tiene `enabled: true`.

El acceso es opcional con Google. No hay formulario de contraseña propio, Admin SDK, cuentas de servicio ni Functions de servidor. Firebase Authentication conserva su sesión con el mecanismo de sesión del SDK; Firestore utiliza caché en memoria, sin cola persistente de escrituras offline. Si no hay red, permiso o cuota, la aplicación mantiene el progreso local y limita o detiene los reintentos.

Etapa actual de publicación: `study_sync_enabled = false`, `enabled: false` en la configuración pública y `study_private_storage = false`. La autenticación nunca se habilitó en producción y no hay sesiones privadas creadas por esta implementación. Así se puede publicar la nueva presentación de Lucas conservando las ventanas emergentes de citas bíblicas de los otros artículos. La guía no muestra controles de Google ni carga el SDK o la configuración de Firebase mientras Hugo mantiene la sincronización apagada. Los archivos técnicos preparados pueden quedar disponibles como recursos estáticos; eso no activa el servicio.

Protección para la futura activación: antes del primer acceso con Firebase, establecer `study_private_storage = true`. Hugo rechaza el build si `study_sync_enabled = true` sin esa protección. El parámetro excluye RefTagger de todas las páginas del mismo origen, incluso con la sincronización temporalmente apagada. Una exclusión solo en la guía no basta: un script externo de otro artículo puede leer el mismo almacenamiento del navegador. Esto desactivará las ventanas emergentes externas de citas bíblicas; no borra las citas ni sus enlaces. Una vez utilizadas las cuentas, mantener ese parámetro en true aunque se pause la sincronización; no volver a habilitar el script mientras existan sesiones o copias privadas sin revisar el aislamiento. Google GAPI, necesario para el popup oficial, se permite de manera acotada en la CSP de la guía. Las fuentes CSS y los reproductores en iframes de otros orígenes no reciben acceso al almacenamiento de la página principal por esa configuración.

El generador de imágenes también cargaba JavaScript externo desde un CDN. Se conserva exactamente html2canvas 1.4.1, ahora servido localmente con su licencia MIT. Solo cambió la dirección del script; no se reescribió su lógica ni su interfaz y no se espera un cambio visible. Con la protección futura habilitada, un build limpio no incluye scripts de terceros con acceso al almacenamiento, salvo Google GAPI cuando se utilice la autenticación preparada. En la configuración actual se conserva RefTagger por la razón indicada arriba.

El progreso anónimo no se sube automáticamente al ingresar. Se ofrece incorporar ese avance o usar el de la cuenta. Cada cuenta tiene un espacio local separado; al cerrar sesión se retira la copia de esa cuenta y se recupera el espacio anónimo. Lucas conserva su clave previa; las otras guías utilizan su propio identificador.

Si la web está disponible pero Firestore falla después de una recarga, al elegir el avance de la cuenta se puede abrir su copia local existente. El cliente comprueba otra vez que el SDK reconoce el mismo UID; nunca busca o adivina otra cuenta. Esta alternativa solo se ofrece ante errores de red, servidor o cuota, no ante errores de autenticación, permisos o borrado. Permite estudiar, editar y exportar, sin inventar una revisión remota: las escrituras y el borrado de progreso remoto quedan bloqueados hasta pulsar reconectar y comprobar la generación. Con la misma generación se combinan los cambios locales; con una nueva se descarta la subida automática del estado anterior. Si se había elegido incorporar avance anónimo, durante esa caída permanece separado y el mensaje lo aclara.

La combinación usa las fechas de cada campo existente, revisión transaccional y generación de borrado. Las transacciones detectan versiones concurrentes; las preguntas distintas se combinan. El borrado cambia la generación para que otro dispositivo no pueda restaurar una copia vieja de forma automática. No hay listeners de tiempo real ni consultas periódicas: el otro dispositivo recibe el estado al conectar o sincronizar; no se promete actualización instantánea.

## Datos y reglas

Registro de guías públicas: `firebase/courses.json`. Las reglas y el catálogo se generan a partir de los IDs ya presentes en el Markdown mediante `npm run build:firebase`. No editar a mano el archivo generado `firebase/firestore.rules`: corregir el generador o el registro y regenerarlo.

Rutas privadas:

```text
students/{uid}/guides/{courseId}                  revisión, generación y resumen
students/{uid}/guides/{courseId}/classes/{classId} avance de una clase
students/{uid}                                  solo bloqueo de eliminación, si existe
```

Las reglas exigen el UID autenticado propietario, proveedor Google y correo verificado. Se rechaza todo lo demás por defecto. Las clases y preguntas aceptadas se derivan del contenido público; cada mapa tiene campos cerrados, tipos definidos, valores y fechas acotados. Un mapa genérico o un JSON opaco sin validar no sirve de autorización.

Se separó el documento por clase para validar explícitamente los campos sin exigir una validación recursiva de mapas arbitrarios. Los tamaños quedan acotados por las listas cerradas de IDs y campos; los strings admitidos tienen límite de 200 caracteres y los valores son booleanos o enteros de fecha. El cliente también limita el perfil a 32 KiB. Este control de JavaScript complementa las reglas, no las reemplaza. El límite general de Firestore de 1 MiB no es el control principal.

Firestore no guarda nombres, correos, contraseñas, tokens ni respuestas personales. Authentication sí administra la identidad necesaria del acceso Google; esos datos no se copian al progreso, a GitHub ni al registro editorial.

### Eliminación y su límite sin servidor

Eliminar el progreso de una guía borra sus documentos de clase y conserva un resumen técnico de borrado sin avance. Eliminar la cuenta solicita reautenticación Google, bloquea nuevas escrituras para ese UID, elimina las guías registradas y luego elimina el usuario de Firebase Authentication. No elimina la cuenta Google del estudiante.

Authentication y Firestore no tienen una transacción conjunta. Si se interrumpe el proceso, la interfaz ofrece reintentar la eliminación incluso si ya no puede conectar al progreso. El bloqueo evita que una sesión vieja repueble datos durante o después de ese proceso. No se informa éxito si no se confirmó la eliminación de ambos servicios.

**Permanece un marcador técnico mínimo con UID en la ruta y fecha de borrado. Es seudónimo, no anónimo; no equivale a eliminar absolutamente todo dato vinculable.** Los ID tokens pueden durar hasta una hora y borrar la cuenta no borra Firestore automáticamente. Para retirar el marcador, el operador debe comprobar en su consola que la cuenta ya no existe y que vencieron todas sus sesiones antiguas, dejando un margen adicional; no retirarlo si el borrado de Authentication falló. Esa limpieza se hace manualmente. No se habilitó TTL, una Function ni una extensión paga para automatizarla.

## Qué debe crear la titular en Firebase

1. Crear un proyecto propio en Firebase Console y mantener **Spark**, sin tarjeta, cuenta de facturación ni crédito promocional de Google Cloud. No aceptar una ampliación a Blaze.
2. No habilitar Analytics para esta función; no hace falta. No ampliar Authentication a Identity Platform.
3. Registrar una **app web** y copiar su objeto público `firebaseConfig`.
4. En Authentication → Sign-in method, habilitar solo **Google**, con el nombre público y el correo de soporte de la titular. No crear una contraseña ni un secreto OAuth para el repositorio.
5. En Authentication → Settings → Authorized domains, añadir los dominios reales utilizados: `www.lasnotasdevero.com` y `lasnotasdevero.com`. Para una prueba local real, añadir explícitamente `localhost` en el proyecto de pruebas; los proyectos nuevos pueden no incluirlo automáticamente. No autorizar dominios ajenos ni previews de terceros.
6. Crear **Cloud Firestore Standard**, base `(default)`, en **modo producción**. Elegir conscientemente la región: su ubicación no se cambia como una preferencia visual. Mantener las reglas iniciales cerradas hasta revisar y autorizar las reglas probadas.
7. No habilitar Functions, Firebase Hosting/App Hosting, Cloud Storage, extensiones, copias administradas, PITR, TTL ni servicios que pidan facturación.
8. Separar la prueba real del proyecto de producción. Para los emuladores no se crea ningún proyecto en la nube: se usa `demo-lasnotasdevero`. Para el ensayo con dos cuentas Google reales y dos dispositivos, usar un proyecto Spark de prueba separado antes de configurar el de producción.

No se publican reglas, índices ni la web desde esta entrega. La prueba real necesitará una autorización posterior y configuración del proyecto de pruebas; preparar el código no autoriza ejecutar `firebase deploy`.

### Datos públicos que hacen falta

Enviar exclusivamente los valores de la app web:

```json
{
  "apiKey": "valor público de Firebase",
  "authDomain": "tu-proyecto.firebaseapp.com",
  "projectId": "tu-proyecto",
  "appId": "valor público de la app web"
}
```

`messagingSenderId` puede conservarse si aparece en el objeto; no se habilita mensajería. No hacen falta `storageBucket` ni `measurementId` para esta función. La API key web de Firebase es pública por diseño; **las reglas y Authentication protegen los datos**, no ocultar esa clave. No enviar una clave privada, contraseña, token administrativo ni JSON de cuenta de servicio.

El archivo `static/config/firebase.json` conserva este envoltorio y sigue deshabilitado. Los campos de su sección `firebase` ya contienen los valores públicos proporcionados para `lnv-data`; el ejemplo muestra la estructura, no una segunda copia de la configuración:

```json
{
  "enabled": false,
  "firebase": { "apiKey": "", "authDomain": "", "projectId": "", "appId": "" }
}
```

Mantener `enabled: false` y `study_sync_enabled = false` hasta completar las pruebas y autorizar la publicación. No se utilizaron `storageBucket` ni `measurementId` del objeto recibido y no se inicializaron Storage ni Analytics. El SDK cliente no puede certificar el plan de facturación: la titular debe comprobar Spark y ausencia de una cuenta de facturación en la consola. Nunca automatizar un cambio de plan para superar una cuota.

## Spark y consumo

Firestore Standard incluye una base gratuita, 1 GiB, 50.000 lecturas/día, 20.000 escrituras/día, 20.000 eliminaciones/día y 10 GiB/mes de transferencia saliente. Las cuotas de operaciones se reinician aproximadamente a medianoche del Pacífico. Spark no factura excesos sin pasar a un plan de pago, pero puede rechazar operaciones o suspender el producto cuando se exceden sus límites. No se promete sincronización ininterrumpida ni un momento exacto de recuperación basándose solo en una cuota diaria.

La sincronización agotada no ejecuta Functions de Netlify ni hace que Netlify espere una respuesta de Firebase para servir el material. El estudiante puede continuar localmente y exportar su progreso. Esto separa la disponibilidad de la guía de la cuota de la sincronización; Netlify conserva sus propios límites de hosting estático.

Con nueve clases, cada transacción actual consulta el marcador de borrado, el resumen y las nueve clases: **11 lecturas de documentos**, más las lecturas necesarias para evaluar reglas. Una edición normal escribe el resumen y la clase modificada: normalmente **2 escrituras**. La comparación es independiente del orden de campos para evitar reescribir todas las clases sin cambios. Una primera carga completa puede escribir hasta 10 documentos; borrar progreso puede eliminar hasta nueve clases. No se deben calcular costos como si cada llamada al SDK fuera una única lectura.

Ejemplo conservador, no medición: 100 estudiantes × 12 sesiones/mes × 50 lotes de guardado = 60.000 transacciones de escritura/mes. En un mes de 30 días son 2.000/día; reservar además 200 transacciones de lectura/día da **24.200 lecturas base/día**, antes de reglas y conflictos. Dos lecturas dependientes adicionales por transacción darían unas **28.600** como escenario orientativo, no un máximo garantizado. Son unas **4.000 escrituras/día** si cambia una clase por lote, pero hasta **20.000** si todos los lotes modifican las nueve clases.

Un pico de 100 estudiantes guardando 50 veces cada uno en el mismo día ya requiere 55.000 lecturas base, antes de reglas. Supera el cupo de lecturas. El SDK limita a tres intentos cada transacción y el cliente tiene reintentos acotados; en situación adversa los intentos se multiplican. Los intentos fallidos no equivalen todos a escrituras confirmadas, pero sí pueden generar lecturas. Se deben medir operaciones reales en consola antes de habilitar producción.

La prueba del proveedor real contra emuladores detectó que una carrera de escritura puede producir `permission-denied` por las reglas de revisión, en lugar del conflicto esperado por el cliente. El proveedor ahora hace una única inspección transaccional adicional del estado propio en ese caso. Solo lo convierte a conflicto o borrado si comprueba que cambió la revisión o generación; si no, conserva el rechazo. Esa inspección no escribe y también tiene hasta tres intentos del SDK. En conflictos adversos puede aproximadamente duplicar los intentos de lectura del adaptador, antes de los reintentos del cliente; no está incluida como consumo habitual en el ejemplo anterior.

Las reglas impiden que un usuario lea o escriba el progreso de otro y rechazan cargas arbitrarias. No pueden impedir de manera absoluta que una cuenta autenticada maliciosa consuma su parte de una cuota compartida. La clave pública tampoco es un limitador de gasto. No se activó App Check con un proveedor que pudiera exigir facturación, ni se presenta como una defensa ya operativa. La protección contra abuso de Firebase y las reglas reducen riesgos; no garantizan cuota siempre disponible. Ante agotamiento se conserva el modo local, no se cambia a Blaze.

Los servicios de emulación se instalan en `tools/firebase/` con su propio lockfile: Netlify no instala Firebase CLI ni Java para construir el sitio. El bundle del SDK es estático y se descarga únicamente al habilitar la función; su tamaño debe medirse tras el build, sin confundirlo con operaciones de Firestore.

## Pruebas y mantenimiento

```text
npm ci --ignore-scripts
npm run build:firebase
npm run test:firebase:client
npm --prefix tools/firebase ci --ignore-scripts
npm run test:firebase
npm run test:firebase:provider
hugo --minify
node tests/study-guide-browser.mjs
```

Emulator Suite necesita Java 21 o superior en la versión fijada. Se preparó un JDK portátil solo para las pruebas locales; no se instaló en el sistema ni se necesita en Netlify. Los emuladores Auth y Firestore usan exclusivamente `demo-lasnotasdevero` y loopback; las suites se niegan a usar un ID de proyecto real. No usar cuentas, perfiles, respaldos ni credenciales de estudiantes en las pruebas.

Para repetir esos comandos, Java 21 debe estar disponible para la sesión de terminal mediante `JAVA_HOME`/`PATH`, además de las dependencias de `tools/firebase/`. La presencia del ZIP portátil descargado no configura automáticamente el sistema. Los estudiantes y el hosting no necesitan Java.

Las pruebas unitarias del cliente usan un proveedor falso y bloqueo de conexiones de red. Las reglas se prueban realmente con Emulator Suite y usuarios sintéticos A/B. Los resultados concretos y cualquier comprobación pendiente deben informarse al cerrar el trabajo: este documento de diseño no declara que una prueba haya pasado por el hecho de estar programada.

`test:firebase:provider` es una regresión adicional del adaptador real junto con Auth/Firestore emulados. Requiere un navegador Chromium; permite indicar su ejecutable mediante `BROWSER` o `LUCAS_BROWSER` y falla con un mensaje si no existe. Usa dos perfiles temporales independientes, rechaza conexiones que no sean de loopback y compila su módulo auxiliar únicamente en una carpeta ignorada, sin incluirlo en el sitio público. No lee la configuración real de `lnv-data` ni necesita cuentas Google reales.

### Resultados locales del 23 de octubre de 2026

| Comprobación | Resultado |
| --- | --- |
| Cliente Firebase, proveedor simulado y red bloqueada | 24 pruebas aprobadas |
| Reglas y Auth/Firestore Emulator, identidades sintéticas | 13 pruebas aprobadas |
| Implementación Netlify conservada y exclusión del despliegue | 40 pruebas aprobadas |
| Modelo de progreso local, IDs y combinación de campos | 6 pruebas aprobadas |
| Contacto existente y endpoint retirado conservado | 8 pruebas aprobadas |
| Proveedor real en dos perfiles Chromium contra emuladores | Aprobado: sesión conservada al recargar, nueve clases, aislamiento A/B, UID falsificado rechazado, solo la clase modificada reescrita y cambios concurrentes de la misma cuenta conservados en revisión 4 |
| Build Hugo | 320 páginas, sin advertencias |
| Guía en 360, 390, 768, 1366 y 1920 px | Aprobado; sin desbordamiento ni solicitudes de sincronización cuando está apagada |
| HTML generado de inicio, artículo y guía | Prueba inicial con protección futura: RefTagger excluido globalmente; configuración actual de publicación: RefTagger conservado, guía sin carga de SDK/configuración Firebase y archivo público con `enabled: false` |

Las pruebas de edición y exportación/importación local siguen siendo independientes de Identity, Blobs y Firebase; el nuevo fallback cubre además la copia privada reconocida por el SDK cuando Firestore falla. No se modificaron el contenido de clases, bibliografía, modelo de progreso ni la cabecera global. La eliminación global de RefTagger queda aplazada hasta la futura activación de cuentas: el comportamiento visible actual de las citas de otros artículos se conserva. El reemplazo local de html2canvas mantiene la versión y la interfaz existentes.

Los errores de permisos en los registros del emulador son esperados en las pruebas negativas y en la carrera que se corrigió. Los avisos de Edge headless y los recursos antiguos ausentes del tema no impidieron los resultados. No se probaron el popup Google de `lnv-data`, dos cuentas Google reales ni dos dispositivos físicos. Las pruebas locales aprobadas no reemplazan esa condición de publicación.

### Dependencias y avisos conocidos

Firebase SDK está fijado en 13.1.0. La auditoría de npm con conectividad real detectó una versión vulnerable de `@grpc/grpc-js` en la ruta de Firestore para Node. Se fijó una sustitución compatible dentro de la serie 1.x, a 1.14.6, en el paquete principal y las herramientas aisladas. Después se repitieron las 13 pruebas de reglas y Auth SDK con emuladores: aprobadas. La sustitución no introduce gRPC para Node en el bundle web. Revisarla al actualizar Firebase y retirarla cuando la dependencia del SDK ya incorpore una versión corregida adecuada.

Resultado de las auditorías con red, al cerrar esta implementación: **paquete principal: 0 avisos conocidos; herramientas aisladas de Firebase CLI: 6 avisos moderados, 0 altos/críticos**. Los avisos de CLI se relacionan con `@opentelemetry/core`, `uuid` y el componente nativo opcional `re2`, y sus dependientes. No se instalan en el build de Netlify ni se sirven al estudiante. Las herramientas se usaron únicamente contra emuladores sin credenciales privadas ni datos de estudiantes.

No se forzaron sustituciones de versiones mayores incompatibles para hacer desaparecer esos avisos. Deben revisarse con las actualizaciones oficiales del CLI antes de usarlo fuera del entorno demo. Las operaciones remotas de esta entrega no incluyen login ni deploy de Firebase CLI; cualquier aplicación futura de reglas debe autorizarse y revisarse por separado desde las cuentas de la titular. Un resultado de `npm audit` sin red no se considera una auditoría aprobada, ni un resultado con cero avisos prueba ausencia absoluta de fallos.

Referencias de los avisos de herramientas: [OpenTelemetry](https://github.com/advisories/GHSA-8988-4f7v-96qf), [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [re2](https://github.com/advisories/GHSA-ff84-5f28-78qj). Los informes completos de esta ejecución quedaron en `.contact-test-output/firebase-root-audit.json` y `.contact-test-output/firebase-tools-audit.json`, ignorados por Git.

Para agregar otra guía: asignar un `course_id` estable en su página, usar los shortcodes con IDs estables, registrar su directorio en `firebase/courses.json`, regenerar reglas y bundle, ejecutar las pruebas y revisar las reglas antes de cualquier despliegue autorizado. Agregar clases o preguntas también requiere regenerar y, con autorización, actualizar las reglas del proyecto correspondiente: sin ese paso, los nuevos IDs seguirán funcionando localmente y serán rechazados por el catálogo remoto anterior. No se duplica información de estudiantes en archivos del proyecto.

## Condiciones para publicar, aún pendientes

- Configuración pública recibida y Spark sin facturación confirmado por la titular; falta comprobar en consola la configuración de Google, dominios y Firestore Standard y mantener el plan sin cambios.
- Reglas e índices revisados y pruebas de emulador aprobadas.
- Popup Google, dominios autorizados y CSP comprobados con el proyecto real de pruebas.
- Dos cuentas reales en dos dispositivos: separación, combinación de cambios, cierre de sesión, cuotas/desconexión, exportación/importación y borrados.
- Confirmación de que el despliegue estático no incorpora funciones por configuración o extensiones de Netlify.
- Autorización explícita de publicación después de presentar los resultados. No se hizo ninguna publicación durante esta implementación.

## Fuentes oficiales revisadas

- [Planes y agotamiento de cuotas Spark](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).
- [Precios de Firebase](https://firebase.google.com/pricing).
- [Cuotas de Firestore](https://firebase.google.com/docs/firestore/quotas).
- [Autenticación Google web](https://firebase.google.com/docs/auth/web/google-signin).
- [Límites de Authentication](https://firebase.google.com/docs/auth/limits).
- [Validación por campos en reglas](https://firebase.google.com/docs/firestore/security/rules-fields).
- [Pruebas de Security Rules](https://firebase.google.com/docs/rules/unit-tests).
- [Emulador de Authentication y proyectos demo](https://firebase.google.com/docs/emulator-suite/connect_auth).
- [Eliminación de usuarios](https://firebase.google.com/docs/auth/web/manage-users).
- [Duración y revocación de sesiones](https://firebase.google.com/docs/auth/admin/manage-sessions).
- [Claves públicas de configuración Firebase](https://firebase.google.com/docs/projects/api-keys).
