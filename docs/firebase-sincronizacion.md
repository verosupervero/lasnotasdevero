# Firebase Spark: sincronización opcional del progreso

Actualización del 24 de octubre: producción está activada en `lnv-data` mediante el despliegue `6adc3e9fa00c0635b0b49e56`, confirmado listo y publicado. HTTP verificó configuración, rutas, encabezados y ocho recursos JavaScript por hash. App Check obtuvo un token válido con la configuración publicada, sin login ni acceso a progreso. El sitio completo conserva 311 rutas HTML; no desplegó Functions, Edge Functions ni build remoto. La revisión previa pasó 107 pruebas Node, 13 de reglas, proveedor emulado y navegador con cuatro pestañas; la titular confirmó dos cuentas entre PC y teléfono en el ensayo. Falta comprobar un guardado autenticado en el dominio principal. Los detalles y límites están en [implementación multipestaña](progreso-multipestana-implementacion.md) y [revisión de preparación](production-readiness.md). Las descripciones históricas posteriores se conservan como evidencia.

Estado al 24 de octubre de 2026: Sync, App Check del cliente y `study_private_storage` están habilitados. El rechazo anterior de App Check se conserva como historial; el diagnóstico posterior a la publicación obtuvo HTTP 200. No se modificó la exigencia remota de App Check. El borrador sigue conectado a `lnv-test`. La titular confirmó **Spark sin facturación vinculada** y configuración de Google Authentication, dominios, App Check y reglas de producción; no hubo una inspección administrativa independiente. No se vinculó facturación ni se activaron Blaze, Identity Platform, Cloud Functions, Storage o extensiones desde esta implementación. Sigue pendiente un respaldo central privado.

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

El progreso anónimo no se sube automáticamente al ingresar. Las opciones son «Combinar ambos avances» y «Usar progreso de mi cuenta Google». La segunda conserva el avance sin cuenta por separado: no lo elimina ni lo incorpora. Si se eligió esa opción por error, desde la cuenta conectada se puede pulsar «Incorporar avance guardado sin cuenta»; se combinan las marcas locales y remotas con las fechas de cada campo, sin reemplazar todo el perfil. Cada cuenta tiene un espacio local separado. La salida intenta confirmar los pendientes antes de retirar su copia; si el envío falla, conserva los pendientes por UID y recupera el espacio anónimo. Lucas conserva su clave previa; las otras guías utilizan su propio identificador.

Después de recargar con F5, el cliente intenta recuperar la conexión anterior únicamente si el SDK reconoce el mismo UID y existen una copia privada válida y su marcador de generación. Consulta el avance remoto antes de combinar esa copia; no reincorpora automáticamente el avance sin cuenta. Si la generación cambió o se borró el avance remoto, no restaura las marcas de la generación anterior. Ante una caída de red, solo abre la copia privada del propietario verificado y deja la sincronización pausada, como se describe abajo. Sin una conexión anterior válida vuelve a ofrecer las dos opciones.

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

La titular publicó manualmente las reglas en `lnv-test`; no se desplegaron reglas ni índices mediante Firebase CLI. La publicación autorizada de la vista de prueba se describe abajo y no habilita la integración de producción. Preparar el código no autoriza ejecutar `firebase deploy` ni modificar `lnv-data`.

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

### Vista local con Firebase de pruebas

La producción conserva ambos interruptores apagados. Para ensayar Google y Firestore sin editar esa configuración, crear **otro proyecto Spark sin facturación** siguiendo los pasos anteriores, habilitar Google, autorizar `localhost` y revisar/aplicar en ese proyecto las reglas de `firebase/firestore.rules`. La herramienta siguiente no publica reglas ni comprueba el plan: verificar Spark y ausencia de facturación en la consola antes de ejecutarla.

Guardar su configuración pública como JSON en `.lucas-private/firebase-test.json` (directorio ignorado por Git), sin `const`, comentarios, claves privadas ni cuentas de servicio:

```json
{
  "apiKey": "API_KEY_WEB_PUBLICA_DEL_PROYECTO_DE_PRUEBAS",
  "authDomain": "tu-proyecto-pruebas.firebaseapp.com",
  "projectId": "tu-proyecto-pruebas",
  "appId": "APP_ID_WEB_DEL_PROYECTO_DE_PRUEBAS"
}
```

También se admite el envoltorio `{ "enabled": false, "firebase": { ... } }` y el campo público opcional `messagingSenderId`. No incluir `storageBucket` ni `measurementId`; esta integración no usa Storage ni Analytics.

```powershell
npm run preview:firebase -- --config .lucas-private/firebase-test.json --project tu-proyecto-pruebas --serve
```

El comando valida el proyecto separado, construye el SDK y Hugo, y crea una carpeta única dentro de `.contact-test-output/firebase-preview/`. Solo esa copia tiene sincronización y protección de almacenamiento activadas, con la configuración pública de pruebas. No cambia `config/_default/config.toml`, `static/config/firebase.json` ni `public/`; no hace commit, push ni despliegue. Sin `--config` y `--project` no construye ni activa nada. La construcción del SDK regenera sus artefactos locales habituales y las reglas derivadas del catálogo, sin subirlos a Firebase.

Con `--serve` abre un servidor restringido a `127.0.0.1`, accesible en `http://localhost:1314/estudios/guia-estudio-lucas/`; detenerlo con Ctrl+C. Se puede elegir otro puerto con `--port 1315`. No hay túnel, acceso por red local ni publicación. Sin `--serve`, solo genera la carpeta de salida. No servir el repositorio entero ni utilizar `hugo server` sobre la configuración de producción para esta prueba, porque reconstruiría otra versión.

La generación y sus pruebas unitarias no consultan Firebase. **Abrir la vista y entrar con Google sí utiliza el proyecto de pruebas real**, sus cuentas y cuotas. Usar cuentas controladas por la titular, nunca datos de estudiantes. La prueba de una computadora no reemplaza el ensayo posterior con dos dispositivos; para eso se preparó el borrador HTTPS siguiente. No usar `lnv-data` para ensayar.

### Borrador HTTPS para probar desde PC y celular

El 23 de octubre de 2026 se publicó, con autorización, [la guía de prueba](https://lucas-firebase-test-20261023--lasnotasdevero.netlify.app/estudios/guia-estudio-lucas/) como borrador estático de Netlify, conectado solo a `lnv-test`. El borrador inicial fue `6adc002424298f7b1fdba1b1`; el corregido, disponible en la misma URL, es `6adc042093861c7fda1c54a2`. La respuesta de Netlify confirmó estado `ready`, contexto `deploy-preview`, sin build remoto (`build_id: null`) y sin Functions. El despliegue de producción permaneció en `6adbee64eba0b597da8ae1bf`. Las comprobaciones HTTP públicas devolvieron 200, mostraron las nuevas etiquetas y el botón de incorporación, y confirmaron el código de recuperación tras recarga. El SDK publicado coincide por SHA con el SDK real de 626.756 bytes; la configuración del borrador activa solo `lnv-test` y la de producción sigue apagada.

La titular debe autorizar **`lucas-firebase-test-20261023--lasnotasdevero.netlify.app`**, sin protocolo ni ruta, en Authentication → Settings → Authorized domains de **`lnv-test`**. Este paso sigue pendiente de confirmación. No agregarlo a `lnv-data`.

La titular informó que dos cuentas Google en dos perfiles de la misma PC funcionaron sin problemas en la vista local. Eso es una prueba manual inicial; no demuestra sincronización entre dispositivos ni sustituye ataques HTTP o pruebas de aislamiento con identidades reales.

Para continuar, entrar con la misma cuenta en PC y celular, marcar preguntas distintas y comprobar ambos sentidos mediante reconexión, esperas de guardado y recarga. Después probar cierre de sesión y otra cuenta, desconexión y recuperación, exportación/importación y, al final, eliminación de progreso y cuenta con cuentas propias de prueba. No hay actualización instantánea garantizada ni listeners permanentes; usar el botón de reconectar para consultar el avance del otro dispositivo. Registrar los resultados antes de activar producción.

En el primer ensayo PC/celular la titular informó una marca creada con cuenta en el teléfono y otra creada sin cuenta en la PC; en la PC eligió usar solo el avance de la cuenta y observó que las marcas desaparecían de la vista al recargar, pese al mensaje «Sincronizado». No se considera aprobada esa prueba. Se corrigieron la recuperación de la conexión tras F5 y las etiquetas de elección, y se agregó la opción de incorporar después el avance sin cuenta. Las 31 pruebas unitarias del cliente, la revisión y la comprobación F5 en Chromium con proveedor simulado fueron aprobadas; el build normal generó 320 páginas con Firebase apagado y el borrador corregido ya fue publicado. Sigue pendiente repetir la prueba real PC/celular. No cambiaron las preguntas, las reglas de Firestore ni el contenido de las clases.

La titular detectó después que completar «Lucas 1–6: de estudiar el texto a vivirlo» dejaba la barra en 0/6. La barra contaba solo las seis clases principales y excluía esa actividad, registrada como complemento. La corrección local suma todas las actividades publicadas: actualmente nueve (seis clases, dos complementos y una integración), con desglose por categoría; los 13 videos previstos de la serie principal se mencionan por separado. El total se calcula a partir del catálogo, sin cambiar los tipos, IDs, modelo de progreso ni reglas de Firestore. El encabezado aclara si muestra «Avance de tu cuenta» o «Avance de este navegador»; durante la recuperación muestra un indicador indeterminado en lugar de un cero transitorio. El arranque tiene un límite de espera de 12 segundos y recupera el modo local ante un fallo.

Esta última corrección pasó 32 pruebas del cliente y seis del modelo (38 en total). En Chromium con proveedor simulado y conexiones externas bloqueadas se verificaron cierre 1/9, censo 2/9, integración 3/9 y clase principal 4/9; al desmarcar volvió a 3/9, y completar 9/9 se conservó tras F5. La corrección de barra ya está publicada en la misma URL de pruebas, despliegue `6adc095814194e833573329b`, que reemplaza el borrador anterior. Netlify confirmó `ready`, contexto `deploy-preview`, sin Functions, Edge Functions ni build remoto; el despliegue de producción no cambió. La verificación HTTP comprobó la barra global, la etiqueta de origen, la recuperación de sesión y la coincidencia SHA del controlador y SDK reales con el payload. El borrador sigue usando `lnv-test` habilitado; `lnv-data` permanece apagado. Sigue pendiente la repetición por la titular con PC/celular: las pruebas simuladas no equivalen a un ensayo real aprobado.

El borrador actual contiene 23 archivos, 1.563.927 bytes (aproximadamente 1,5 MiB), sin páginas de contacto, formularios ni archivos privados. Incluye `noindex`, `no-store` y bloqueo de robots; estas medidas no equivalen a control de acceso. Comparte las cuotas de transferencia y solicitudes del mismo sitio Netlify: no publicar en producción reduce el alcance del cambio, pero no garantiza la disponibilidad del hosting ante abuso. Google y Firestore consumen únicamente las cuotas del proyecto Spark de pruebas. No se contrató un servicio adicional ni se ejecutó un build remoto.

## Spark y consumo

### Acceso Google junto al progreso

La descripción funcional y el inventario para auditar están en [Sistema de estudiantes y sincronización Firebase](sistema-estudiantes-auditoria.md). Incluyen las limitaciones de privacidad, respaldo y disponibilidad.

El botón «Iniciar sesión con Google» aparece junto a la barra de progreso cuando la sincronización está habilitada. El icono oficial y Google Sans se sirven desde el propio sitio; sus fuentes y licencia están en `static/fonts/google-sans/`. No se incorpora otro servicio de autenticación ni Analytics.

Después de un ingreso explícito, si existe avance en este navegador, se consulta primero el estado de la cuenta sin modificar ninguna copia. El aviso distingue entre cuenta con progreso y cuenta vacía, y ofrece «Combinar ambos avances» o «Usar progreso de mi cuenta Google». La combinación requiere una elección explícita; usar la cuenta conserva aparte el avance anónimo. Si no existe avance local, se abre directamente el de la cuenta. La recuperación de una sesión al recargar conserva el comportamiento anterior y no vuelve a pedir la elección.

La comparación agrega una consulta remota de progreso cuando existe avance local; al elegir se consulta nuevamente para evitar aplicar una decisión sobre datos desactualizados. Estas consultas consumen lecturas de Firestore según el catálogo y las reglas, aunque no escriben. No se incorpora sondeo periódico. Las 37 pruebas del cliente y seis del modelo se ejecutaron con red bloqueada, proveedor simulado y datos sintéticos: 43 aprobadas.

Actualizado el mismo borrador HTTPS en el despliegue `6adc0e23d718b48a58b2bfc1`: Netlify confirmó `ready`, sin Functions, Edge Functions ni build remoto, y sin cambiar la publicación principal. La comprobación HTTP verificó las etiquetas nuevas, los archivos reales del SDK y del controlador, el icono y la fuente por igualdad de bytes. `lnv-test` permanece habilitado en el borrador y `lnv-data` apagado en producción.

En Chromium aislado se comprobaron la comparación antes de escribir, la elección remota sin alterar el avance anónimo, cuenta vacía, combinación explícita, recuperación con F5, cancelación y reintento de lectura. Un ensayo separado con perfil vacío confirmó la conexión directa sin avance local y sin escrituras. El botón midió 14 px/20 px en 390 y 1366 px, sin desbordamiento horizontal. La carga efectiva de Google Sans no quedó confirmada por `document.fonts.check`; existe fuente alternativa. El ensayo encadenado de logout/reset/login tuvo un fallo de temporización no resuelto en el harness y no se declara aprobado. No se utilizaron cuentas ni datos reales de estudiantes; falta repetir los flujos con Google real en los dos dispositivos.

### Salida segura y recuperación de pendientes

La titular eligió que cerrar sesión intente sincronizar inmediatamente y que un fallo conserve los pendientes localmente. «Guardar y cerrar sesión» espera el envío en curso y puede hacer un segundo envío para incluir cambios llegados durante el primero. Solo retira una copia privada confirmada; en caso de fallo conserva copia, generación y marcador `:pending` por UID. No se envía esa copia después de salir: se recupera al ingresar con el mismo UID y comprobar el estado remoto. El avance anónimo sigue separado.

Con la sesión activa, un evento `online` puede recuperar automáticamente una caída de red, verificando primero identidad y generación. Los eventos simultáneos se agrupan y existe un mínimo de 60 segundos entre recuperaciones automáticas. No se utiliza para saltar pausas por autenticación, permisos, cuota, validación o borrado. Si tampoco puede confirmarse el guardado local, se conserva la copia en memoria y se pide exportar o reintentar antes de salir; no se da un mensaje falso de respaldo.

La revisión corrigió tres casos adicionales: limpieza del UID capturado al eliminar cuenta aunque Auth notifique primero la salida; operaciones concurrentes durante logout sin cierre aparente falso; y pendientes de la generación inicial `null` cuando otro dispositivo creó la primera copia. Este último utiliza la clasificación transaccional existente `409`/`410`, conservando la protección contra restaurar generaciones borradas. No cambiaron reglas, proveedor Firebase, modelo ni configuración de producción. Las 52 pruebas del cliente con red bloqueada están aprobadas; el build Hugo generó 320 páginas.

La verificación focal en Chromium aislado también pasó: guardado inmediato al salir con conexión; recuperación automática con lectura previa; salida sin conexión conserva cache/generación/pendientes; volver la red sin Auth no escribe; el mismo UID recupera y envía, y otro UID no ve ni sube el pendiente anterior. El borrador se actualizó en la misma URL, despliegue `6adc16985d6ad9555dabc710`, confirmado `ready` sin Functions, Edge Functions ni build remoto. La publicación principal no cambió y conserva Firebase apagado. HTTP confirmó el controlador nuevo por igualdad de bytes y los recursos reales. Falta el ensayo manual del flujo actualizado con Google real; las pruebas usaron únicamente datos sintéticos.

### Importaciones reforzadas y protección contra incrustación

La importación ahora rechaza fechas que no sean enteros seguros no negativos o estén adelantadas más de cinco minutos respecto del reloj local, campos extra y claves reservadas de mapas. Mantiene el límite de 64 KiB en bytes UTF-8, IDs retirados válidos y marcas desactivadas. Valida antes de modificar el avance; no normaliza fechas ni sobrescribe el archivo rechazado.

También se corrigió una carrera de lectura asíncrona: el controlador expone una versión de activación del perfil y la importación cancela si cambió durante la lectura. Obtiene la instantánea actual después de leer y validar, de modo que las nuevas marcas del mismo perfil se conservan y un cambio de cuenta o restablecimiento no recibe datos del perfil anterior. No cambió el modelo JSON ni el proveedor Firebase.

`netlify.toml` añade `Content-Security-Policy: frame-ancestors 'none'` y `X-Frame-Options: DENY` a las rutas de la guía. El borrador estático lleva los mismos encabezados en su `_headers` aislado. La revisión pasó; 61 pruebas del cliente aprobaron con red bloqueada; Hugo generó 320 páginas. Chromium sintético confirmó rechazo atómico de un archivo futuro, combinación de uno válido y exportación de ambas marcas sin llamadas al proveedor. La carga directa funcionó; el ensayo local con iframe del mismo origen fue consistente con el bloqueo.

Publicado únicamente en el borrador autorizado `6adc199e7578568cb791c6af`, en la misma URL. Netlify confirmó `ready`, sin Functions, Edge Functions ni build remoto y sin cambiar la publicación principal. HTTP comprobó los controladores reales por igualdad de bytes y CSP/XFO para la guía con barra, sin barra e `index.html`; `lnv-data` permanece desactivado. App Check no se habilitó: sigue pendiente la elección de la titular sobre prepararlo en pruebas con Spark sin facturación y su cuota gratuita limitada, o continuar únicamente con optimizaciones de consumo.

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

Los errores de permisos en los registros del emulador son esperados en las pruebas negativas y en la carrera que se corrigió. Los avisos de Edge headless y los recursos antiguos ausentes del tema no impidieron los resultados. La titular probó después dos cuentas Google reales en perfiles distintos de la misma PC con `lnv-test`, sin problemas informados. Siguen pendientes dos dispositivos físicos y las comprobaciones completas del borrador HTTPS; no se probó el popup Google de `lnv-data`. Las pruebas locales aprobadas no reemplazan las condiciones de activación de producción.

### Dependencias y avisos conocidos

Firebase SDK está fijado en 13.1.0. La auditoría de npm con conectividad real detectó una versión vulnerable de `@grpc/grpc-js` en la ruta de Firestore para Node. Se fijó una sustitución compatible dentro de la serie 1.x, a 1.14.6, en el paquete principal y las herramientas aisladas. Después se repitieron las 13 pruebas de reglas y Auth SDK con emuladores: aprobadas. La sustitución no introduce gRPC para Node en el bundle web. Revisarla al actualizar Firebase y retirarla cuando la dependencia del SDK ya incorpore una versión corregida adecuada.

Resultado de las auditorías con red, al cerrar esta implementación: **paquete principal: 0 avisos conocidos; herramientas aisladas de Firebase CLI: 6 avisos moderados, 0 altos/críticos**. Los avisos de CLI se relacionan con `@opentelemetry/core`, `uuid` y el componente nativo opcional `re2`, y sus dependientes. No se instalan en el build de Netlify ni se sirven al estudiante. Las herramientas se usaron únicamente contra emuladores sin credenciales privadas ni datos de estudiantes.

No se forzaron sustituciones de versiones mayores incompatibles para hacer desaparecer esos avisos. Deben revisarse con las actualizaciones oficiales del CLI antes de usarlo fuera del entorno demo. Las operaciones remotas de esta entrega no incluyen login ni deploy de Firebase CLI; cualquier aplicación futura de reglas debe autorizarse y revisarse por separado desde las cuentas de la titular. Un resultado de `npm audit` sin red no se considera una auditoría aprobada, ni un resultado con cero avisos prueba ausencia absoluta de fallos.

Referencias de los avisos de herramientas: [OpenTelemetry](https://github.com/advisories/GHSA-8988-4f7v-96qf), [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [re2](https://github.com/advisories/GHSA-ff84-5f28-78qj). Los informes completos de esta ejecución quedaron en `.contact-test-output/firebase-root-audit.json` y `.contact-test-output/firebase-tools-audit.json`, ignorados por Git.

Para agregar otra guía: asignar un `course_id` estable en su página, usar los shortcodes con IDs estables, registrar su directorio en `firebase/courses.json`, regenerar reglas y bundle, ejecutar las pruebas y revisar las reglas antes de cualquier despliegue autorizado. Agregar clases o preguntas también requiere regenerar y, con autorización, actualizar las reglas del proyecto correspondiente: sin ese paso, los nuevos IDs seguirán funcionando localmente y serán rechazados por el catálogo remoto anterior. No se duplica información de estudiantes en archivos del proyecto.

## Condiciones para activar producción

La titular confirmó Spark sin facturación, Google Authentication, dominios autorizados, App Check y reglas publicadas para `lnv-data`. Son confirmaciones de la titular, no una inspección administrativa independiente de Firebase. La clave pública de App Check está guardada en el archivo versionado `static/config/firebase.json`; la configuración de aplicación mantiene `enabled: false`, `appCheck.enabled: false` y los valores por defecto de flags Hugo desactivados.

- Las suites finales pasaron: 107/107 pruebas Node sin red, 13/13 Rules demo, provider real con emuladores y navegador de cuatro pestañas/cinco casos.
- La titular confirmó que el flujo actualizado funciona con dos cuentas entre PC y teléfono.
- La revisión autorizada de producción se prepara con flags desactivados hasta cerrar la comprobación del artefacto final y configuración de Netlify.
- No existe un respaldo central privado de Firebase. Documentar esta limitación y no presentar el sistema como recuperable ante pérdida del proyecto.
- Registrar cuotas y métricas después de publicar. App Check se puede iniciar en modo de monitoreo sin enforcement; no tratarlo como protección efectiva contra solicitudes sin token.

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


## Optimización de lecturas y preparación de App Check — 24 de octubre de 2026

Se conserva en memoria una copia de los documentos remotos confirmados por Firebase, separada del avance editable local. Cada operación sigue leyendo el marcador y el resumen. Si coinciden UID, revisión, generación y demás campos de control, reutiliza los documentos de clase confirmados. Un guardado habitual pasa de **11 a 2 lecturas base**; sigue escribiendo resumen y clase modificada. Sin copia válida, con cambios remotos, conflicto, inspección de permisos o borrado vuelve a la lectura completa. El caché se invalida al cambiar cuenta, salir o destruir el proveedor; las entradas y salidas se clonan. Las reglas y el esquema no cambiaron. Ediciones administrativas que eludan las reglas pueden requerir recargar.

Medición con Auth/Firestore Emulator y Chromium, usando identidades sintéticas: 11 llamadas de lectura en carga completa y fallback; 2 en consulta reutilizable y guardado de una clase; 2 escrituras en ese guardado. Son llamadas instrumentadas a la transacción, no un contador de facturación: reglas, conflictos y reintentos pueden agregar consumo. Como presupuesto conservador, siguen siendo aplicables los escenarios anteriores de lectura completa; el ahorro habitual no garantiza disponibilidad bajo abuso.

Se añadió `assets/js/study-app-check.js` y su conexión al proveedor. App Check permanece desactivado hasta recibir una clave pública real de reCAPTCHA Enterprise de **lnv-test**. La herramienta de preview valida el proyecto, crea configuración aislada y permite la CSP adicional solo en esa variante. El SDK se carga al acceder a datos autenticados, reutiliza tokens y no activa renovación automática periódica. Los errores de cuota y permiso conservan su clasificaci?n, sin tratarlos como caídas de red para reintentar. No se aceptan tokens de depuración.

Resultados históricos de esa etapa: **78** unitarias de cliente/App Check/preview aprobadas; **13** de reglas aprobadas y suite del proveedor real con emuladores aprobada, incluyendo aislamiento A/B, conflictos, reset, mutación de copias y medición de lecturas. Hugo generó **320 páginas**. No hubo operaciones contra datos reales. La atestación real, las métricas de evaluaciones y el ensayo con exigencia de App Check seguían pendientes en ese momento. Los resultados finales están resumidos al inicio de este documento y en [implementación multipestaña](progreso-multipestana-implementacion.md).

Pasos de consola, configuración pública requerida, pruebas y reversión: [App Check en lnv-test](firebase-app-check-pruebas.md). Producción continúa apagada; no se contrató nada ni se vinculó facturación.

Publicado exclusivamente en el borrador autorizado `6adc21824a5557572cadd0fa` (misma URL): Netlify confirmó `ready`, sin build remoto, Functions ni Edge Functions y con producción intacta. HTTP verificó bytes de los recursos reales y producción apagada. La configuración publicada de `lnv-test` no incluye App Check habilitado: aún falta la clave pública. Payload estático: 23 archivos, 1.586.732 bytes.


## App Check publicado en el ensayo — 24 de octubre de 2026

Resultado posterior: tras reemplazar la clave que pertenecía a otro proyecto y confirmar su actualización en Firebase App Check, un ensayo desde el navegador temporal obtuvo un token real; `exchangeRecaptchaEnterpriseToken` respondió HTTP 200. Un intento inmediato anterior aún había recibido HTTP 400. No se inició sesión, no se consultó ni modificó Firestore y no se registró el token. No se alteraron permisos IAM, reglas, exigencia de App Check, planes ni la publicación principal. El borrador continúa siendo `6adc28d99a488f646fae86a7`; falta repetir el ensayo autenticado de progreso. Los párrafos siguientes conservan el historial anterior a esta corrección.

La titular confirmó los requisitos del proyecto y canceló la ventana para exigir App Check en Firestore. Se publicó el borrador `6adc2401e92863b31c3aa4c2` con App Check habilitado exclusivamente para `lnv-test`: 23 archivos, 1.587.097 bytes, sin build remoto, Functions ni Edge Functions y sin modificar la publicación principal. HTTP confirmó configuración, clave pública coincidente, CSP, bundle real y producción apagada. La verificación obligatoria no se modificó; su estado remoto se basa en la confirmación de la titular, no en acceso administrativo a Firebase. Falta probar la emisión y aceptación del token real con una sesión de prueba en navegador y revisar métricas; no se declara esa prueba superada.
