# Archivos conservados localmente — Lucas

> Inventario histórico anterior a la migración Firebase. La arquitectura y las rutas activas actuales se describen en `docs/firebase-sincronizacion.md`; algunos recursos técnicos de cuenta y cliente ahora se conservan en `legacy/netlify-sync/`.

Revisión del 23 de octubre de 2026. Todos los archivos de la tabla existen en el directorio de trabajo `C:\Users\Vero\lasnotasdevero`.

Son 29 archivos: 10 modificados que Git ya seguía y 19 nuevos sin seguimiento. Están guardados en disco; no se hizo stage, commit, push ni publicación. Estar guardados en el proyecto no equivale a tener una copia remota ni un commit de respaldo. Esta lista incluye los ajustes de diseño de la guía que ya estaban en curso y se conservaron.

| Archivo | Estado local | Propósito |
| --- | --- | --- |
| [`.gitignore`](../.gitignore) | Modificado | Excluir secretos, copias privadas y catálogo generado. |
| [`config/_default/config.toml`](../config/_default/config.toml) | Modificado | Parámetro Hugo de sincronización explícitamente apagado. |
| [`layouts/estudios/study-guide.html`](../layouts/estudios/study-guide.html) | Modificado | Distribución de la guía, controles locales y cuenta opcional. |
| [`netlify.toml`](../netlify.toml) | Modificado | Directorio desplegable explícito, build y cabeceras de seguridad. |
| [`package.json`](../package.json) | Modificado | Dependencias, catálogo y comando de pruebas con bloqueo de red. |
| [`package-lock.json`](../package-lock.json) | Modificado | Versiones exactas de dependencias. |
| [`static/js/study-guide.js`](../static/js/study-guide.js) | Modificado | Navegación, progreso local y conexión opcional al módulo de sincronización. |
| [`static/styles/study-guide.css`](../static/styles/study-guide.css) | Modificado | Diseño adaptable y controles compactos. |
| [`tests/study-guide-browser.mjs`](../tests/study-guide-browser.mjs) | Modificado | Regresión del diseño, contenidos y progreso en navegador aislado. |
| [`themes/vero/layouts/partials/head.html`](../themes/vero/layouts/partials/head.html) | Modificado | Protección de scripts cuando se habilite la cuenta; comportamiento habitual conservado con el parámetro apagado. |
| [`netlify/disabled-functions/lucas-progress.mjs`](../netlify/disabled-functions/lucas-progress.mjs) | Nuevo; apartado de Functions | Servidor completo conservado fuera del directorio publicable. Antes estaba en `netlify/functions/lucas-progress.mjs`, también sin seguimiento. |
| [`netlify/lib/lucas-identity.mjs`](../netlify/lib/lucas-identity.mjs) | Nuevo | Adaptador oficial de autenticación y cookies. |
| [`netlify/lib/lucas-progress-store.mjs`](../netlify/lib/lucas-progress-store.mjs) | Nuevo | Escrituras condicionales, conflictos, borrado e historial privado. |
| [`netlify/lib/lucas-progress-validation.mjs`](../netlify/lib/lucas-progress-validation.mjs) | Nuevo | Validación de entradas e identificadores permitidos. |
| [`netlify/lib/lucas-sync-config.mjs`](../netlify/lib/lucas-sync-config.mjs) | Nuevo | Límites y configuración compartida. |
| [`scripts/build-lucas-catalog.mjs`](../scripts/build-lucas-catalog.mjs) | Nuevo | Catálogo derivado de los IDs públicos existentes, sin duplicarlos a mano. |
| [`scripts/lucas-backup.mjs`](../scripts/lucas-backup.mjs) | Nuevo | Herramienta manual de respaldos privados cifrados. |
| [`static/cuenta/index.html`](../static/cuenta/index.html) | Nuevo | Página aislada de confirmación y recuperación. |
| [`static/js/study-auth-callback.js`](../static/js/study-auth-callback.js) | Nuevo | Tratamiento de enlaces de confirmación y recuperación. |
| [`static/js/study-sync.js`](../static/js/study-sync.js) | Nuevo | Exportación/importación local y sincronización opcional por cuenta. |
| [`static/styles/study-account.css`](../static/styles/study-account.css) | Nuevo | Estilo de la página aislada de cuenta. |
| [`tests/helpers/forbid-network.mjs`](../tests/helpers/forbid-network.mjs) | Nuevo | Bloqueo de conexiones de red durante pruebas sintéticas. |
| [`tests/lucas-backup.test.mjs`](../tests/lucas-backup.test.mjs) | Nuevo | Cifrado, validación y archivos temporales sintéticos. |
| [`tests/lucas-no-network.test.mjs`](../tests/lucas-no-network.test.mjs) | Nuevo | Comprueba el bloqueo de transportes de red. |
| [`tests/lucas-sync-client.test.mjs`](../tests/lucas-sync-client.test.mjs) | Nuevo | Cuentas simuladas, conflictos, desconexión y recuperación. |
| [`tests/lucas-sync-server.test.mjs`](../tests/lucas-sync-server.test.mjs) | Nuevo | Autorización simulada, validación, CSRF y exclusión del despliegue. |
| [`docs/lucas-sincronizacion.md`](lucas-sincronizacion.md) | Nuevo | Estado, consumo conservador, límites y condiciones de activación futura. |
| [`docs/netlify-support-free-legacy.md`](netlify-support-free-legacy.md) | Nuevo | Consulta concreta preparada para Support; no enviada. |
| [`docs/lucas-archivos-locales.md`](lucas-archivos-locales.md) | Nuevo | Este inventario. |

No se modificaron las preguntas, bibliografías ni los IDs existentes del contenido durante esta revisión. `static/js/study-progress.js`, el modelo original de progreso, también se conserva. Los resultados de build, capturas y el catálogo generado se encuentran en rutas ignoradas por Git y no son archivos fuente de esta tabla.

## Verificación realizada

- `npm.cmd run test:lucas-sync`: 40 pruebas aprobadas, con conexiones de red bloqueadas.
- `node --test --test-isolation=none tests/study-progress.test.mjs`: 6 aprobadas.
- `npm.cmd run test:contact`: 8 aprobadas; `npm.cmd run build:contact` también pasó.
- `npm run build:lucas`: 9 clases y 63 preguntas; `hugo --minify`: 320 páginas.
- Navegador aislado en 360, 390, 768, 1366 y 1920 px: sin llamadas a `/api/lucas/` con sincronización apagada.
- Prueba adicional real de la interfaz local: marcar una pregunta, exportar JSON, borrar almacenamiento, recargar e importar el mismo archivo restauró exactamente el estado, con solicitudes externas bloqueadas. El arnés y sus resultados están en `.contact-test-output/`, sin datos reales.

Las restricciones iniciales de procesos del sandbox de Windows se resolvieron repitiendo los comandos locales fuera del sandbox. Los avisos de recursos antiguos ausentes (favicon, Font Awesome y una imagen de fondo) no impidieron las pruebas. No se probó Identity ni Blobs real, no se usaron datos de estudiantes y no se activaron servicios.
