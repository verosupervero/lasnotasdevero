# Sincronización privada de Lucas: operación y límites

> Documento de la arquitectura anterior de Netlify, conservado como registro. El proveedor nuevo preparado es Firebase; ver `docs/firebase-sincronizacion.md`. Las instrucciones de activación de este documento no corresponden a la arquitectura nueva y no deben ejecutarse para habilitarla.

Este documento es interno. La sincronización se prepara desactivada y no autoriza publicar, activar Identity, cambiar el plan ni contratar servicios. El progreso local existente debe seguir funcionando cuando no hay sesión, conexión o respuesta del servidor.

## Conservación y bloqueo de publicación

El servidor completo se conserva en `netlify/disabled-functions/lucas-progress.mjs`, fuera de `netlify/functions`, que es el único directorio de Functions configurado explícitamente en `netlify.toml`. No hay un paso de build que copie o importe ese servidor desde una función activa. Con esta configuración, un despliegue normal del proyecto no incluye la función de Lucas. Esta separación importa: un handler desplegado que responde 503 también podría consumir invocaciones; un interruptor interno no basta para evitar ese consumo.

Defensa adicional: `config/_default/config.toml` establece `lucas_sync_enabled = false`, y el contexto de producción de `netlify.toml` establece `LUCAS_SYNC_ENABLED = "false"`. Los scripts, las pruebas y la implementación quedan guardados en el directorio de trabajo local; no se hizo stage, commit, push ni publicación. Los archivos nuevos todavía sin seguimiento de Git también existen en disco, pero no están protegidos por un commit ni por una copia remota.

La variable escrita en `netlify.toml` expresa la configuración del build: **no configura el entorno de ejecución de Functions**. Netlify exige definir ese entorno por UI, CLI o API. No se modificó el entorno remoto. El servidor además rechaza solicitudes si su variable de ejecución no es exactamente `true`, pero el bloqueo que evita invocaciones es la exclusión física del archivo. [Documentación oficial sobre variables de Functions](https://docs.netlify.com/build/functions/environment-variables/).

Comprobación de producción del 23 de octubre de 2026: una consulta de solo lectura a los metadatos del sitio mostró únicamente `contact` y una función interna `emails` en el despliegue publicado; ninguna función de Lucas. Identity continúa desactivado. No se llamaron los endpoints de esas funciones, no se modificó el despliegue y no se consultaron registros de estudiantes. El consumo de esas funciones existentes sigue sin cuantificar y debe sumarse al presupuesto futuro.

El bloqueo impide desplegar la función de Lucas con la configuración entregada. No protege contra una futura modificación deliberada del directorio de funciones ni garantiza disponibilidad frente a tráfico que agote la transferencia del sitio estático. La disponibilidad absoluta tampoco puede garantizarse en un plan gratuito compartido.

## Cuenta y presupuesto comprobados el 23 de octubre de 2026

La cuenta consultada es **Free Legacy** (`free-is-free`), creada el 22 de julio de 2025. No tiene tarjeta registrada, las recargas automáticas están desactivadas y las funciones de facturación por créditos no están habilitadas. No cambiar a un plan por créditos: los 34 despliegues de producción del período consumirían 510 créditos a 15 por despliegue; el Free nuevo incluye 300.

| Recurso | Consumo observado | Límite / situación |
| --- | --- | --- |
| Builds | 7 minutos | 300 minutos mensuales |
| Transferencia | 9.899.982.128 bytes (aprox. 9,22 GiB) | 100 GiB mensuales |
| Despliegues de producción | 34 | Consumen los minutos de build de Legacy |
| Functions | Consumo actual sin confirmar | 125.000 solicitudes/sitio/mes y 100 GB-h según Legacy |
| Identity | Desactivado; la titular confirmó que el panel ofrece nivel de $0 | Confirmar sus límites y mantener confirmación de correo habilitada antes de activar |
| Blobs | API consultada: HTTP 200, cero stores; despliegue en `us-east-2` | El panel no muestra precio ni límites; cuota total aplicable a Legacy sin confirmar |

Blobs se describe como beta gratuita en el anuncio oficial de 2023. Eso no equivale a una garantía perpetua de almacenamiento ilimitado ni confirma una cuota específica para esta cuenta Legacy. Mientras no esté resuelta la cobertura gratuita y el consumo actual de Functions, **no habilitar ni publicar la sincronización**. No se activó ningún servicio para comprobar precios.

Fuentes oficiales para volver a comprobar antes de habilitar:

- [Precios de planes Legacy](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/legacy-pricing-plans/).
- [Planes de Identity](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/plans-and-pricing/).
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).
- [Anuncio de Netlify Blobs en beta](https://www.netlify.com/blog/introducing-netlify-blobs-beta/).
- [Cómputo de créditos](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/).

### Estimación conservadora para una activación futura

**Estado actual: cero invocaciones de sincronización**, porque la función no está publicada y queda excluida del directorio desplegable local. El tráfico de otras funciones y del sitio estático no es cero ni está incluido en esta afirmación.

Hipótesis de planificación, no mediciones ni topes garantizados: mes de 30 días, 100 estudiantes, 12 sesiones por estudiante y mes; por sesión, 50 lotes de escritura y 5 solicitudes de autenticación/lectura. El cliente agrupa cambios tras siete segundos de inactividad, no sondea periódicamente y limita los reintentos de escritura. Para el cálculo de cómputo se reserva **1 segundo por invocación a 1 GiB**; como sensibilidad, 2 segundos duplican los GB-h. Se presupuestan 16 KiB de entrada y 16 KiB de salida por solicitud como volumen orientativo, no como medición facturable de Netlify.

| Escenario futuro | Solicitudes/mes | GB-h a 1 s / 1 GiB | Tráfico orientativo, ambos sentidos | Comparación con 125.000 invocaciones |
| --- | ---: | ---: | ---: | --- |
| Estudiantes, sin reintentos | 66.000 | 18,33 | 2,01 GiB | Deja 59.000 para otras funciones y tráfico |
| Estudiantes + bot a 1 solicitud/minuto | 109.200 | 30,33 | 3,33 GiB | Deja solo 15.800 antes de otras funciones |
| Cuatro intentos por lote de escritura + bot a 1/minuto | 289.200 | 80,33 | 8,83 GiB | Supera el cupo en 164.200 |
| Estudiantes sin reintentos + bot a 5/minuto | 282.000 | 78,33 | 8,61 GiB | Supera el cupo en 157.000 |

Fórmulas: `100 × 12 × (50 + 5) = 66.000`; un bot a 1/minuto suma `60 × 24 × 30 = 43.200`; cuatro intentos por cada uno de los 50 lotes dan `100 × 12 × (50 × 4 + 5) = 246.000` antes del bot. A 5/minuto, el bot suma 216.000. Los reintentos dependen del error y no todas las rutas se reintentan: la fila representa una situación adversa de las escrituras, no un pronóstico.

Para el total hay que agregar el consumo desconocido de las funciones actuales (`contact` e interna `emails`), otras llamadas administrativas por Functions si las hubiera, y pruebas futuras que se hagan contra Netlify real. Los 34 despliegues y los 7 minutos de build observados son recursos separados: no equivalen a 34 invocaciones de Functions. Los nuevos builds también utilizarán parte del cupo de 300 minutos y deberán medirse.

Una llamada sin sesión, un error, un escaneo de `/.netlify/functions/…` o una solicitud directa al API pueden alcanzar una Function publicada aunque el navegador legítimo no la use. No se descuenta tráfico automatizado del presupuesto. El límite previsto de 60 solicitudes/minuto por IP y dominio no frena un bot lento ni múltiples IP, y el límite de 30/minuto por usuario se comprueba dentro de la función, después de la invocación. La documentación de rate limiting advierte demoras de hasta 10 segundos en la aplicación de reglas. No es un límite mensual global ni una garantía de costo o disponibilidad. Confirmar con Support cómo se computan solicitudes bloqueadas antes de ejecutar la función; hasta entonces no atribuirles ahorro garantizado.

Cada lectura autenticada puede requerir unas 3–4 operaciones de Blobs y cada escritura al menos cuatro, incluyendo el límite de solicitudes y el acceso al perfil. Cuatro operaciones por las 66.000 solicitudes darían unas **264.000 operaciones** como orden de magnitud, con variación por ruta, conflictos y reintentos. Una solicitud sin sesión rechazada antes de abrir Blobs no realiza esas operaciones. No se encontró una cuota Legacy publicada que permita certificar el volumen sin costo adicional.

El perfil con los 63 bloques actuales se estimó en 7.230 bytes. Un original y siete revisiones para 100 estudiantes rondarían 5,52 MiB de contenido; reservar aproximadamente 11 MiB permite metadatos y variación, pero no es una cuota garantizada.

La frecuencia real de guardado, reconexiones, reintentos, sesiones simultáneas y llamadas administrativas deben medirse. Las copias manuales agregan operaciones de listado y lectura de Blobs; no crean llamadas a Functions ni despliegues. Los márgenes anteriores no prueban cobertura gratuita de un volumen ilimitado. El tope gratuito puede implicar suspensión del sitio al agotarse; costo $0 no equivale a capacidad ni disponibilidad garantizadas. El consumo actual de Functions y la cuota Legacy de Blobs siguen sin confirmar, por lo que **la publicación permanece bloqueada**. Revisar mensualmente, antes de activar, y después de cualquier cambio de condiciones. Si no se puede garantizar $0, mantener solo progreso local y exportación/importación de archivos.

## Controles que debe conservar la implementación

- Servidor conservado fuera del directorio desplegable y doble interruptor explícitamente apagado: parámetro Hugo `lucas_sync_enabled` y variable de producción `LUCAS_SYNC_ENABLED`. No introducir SMTP, correo pago ni complementos.
- Verificar la sesión en el servidor mediante `getUser` de la API oficial de Netlify Identity. El identificador enviado por el navegador nunca acredita identidad. La autenticación usa HTTP oficial; las cookies de sesión deben ser HttpOnly y las credenciales no se exponen al controlador público. No se renueva automáticamente la sesión: al vencer, el estudiante debe volver a ingresar y conserva su progreso local.
- Usar únicamente el sujeto verificado para derivar la clave privada del perfil. No almacenar correos, contraseñas ni respuestas personales en el progreso ni en las copias.
- Operaciones de escritura limitadas al mismo origen, con comprobaciones CSRF; entradas acotadas por tamaño, IDs conocidos, estados y fechas. Aplicar límites de solicitudes.
- Separar el progreso de cada cuenta en el navegador; no subir automáticamente progreso de otra sesión. Mantener controles de revisión y generación para evitar sobrescrituras y cargas obsoletas tras una eliminación.
- Exportar y eliminar el progreso propio. La eliminación debe alcanzar también las revisiones privadas asociadas; conservar únicamente el marcador mínimo necesario para impedir que un dispositivo viejo lo recree.
- No poner credenciales en JavaScript público, contenido, Git, argumentos de comandos, mensajes de error ni registros.

El guardado local permite continuar con una página ya cargada y sincronizar después. **No se garantiza cargar todo el sitio desde cero sin conexión**: no se añadió un service worker ni una copia offline del sitio.

## Copias privadas sin GitHub Actions

El repositorio actual de GitHub es **público** y Actions está deshabilitado. No se agrega un workflow ni se sube progreso a GitHub. No hay copias de estudiantes en el repositorio.

El servidor mantiene un máximo de siete revisiones privadas por propietario, dentro del mismo registro para que su eliminación sea atómica. Una revisión del mismo proveedor ayuda frente a una modificación accidental, pero **no es una copia externa ante un fallo de Netlify ni un mecanismo de recuperación ya operado**. El segundo store está reservado y no recibe escrituras automáticas del servidor.

La herramienta `scripts/lucas-backup.mjs` permite al operador crear archivos locales cifrados. Usa RSA-OAEP con SHA-256 para envolver una clave aleatoria AES-256-GCM, nonce aleatorio y datos de autenticación del formato. La clave privada PKCS8 queda cifrada con una contraseña de al menos 16 caracteres. Se utilizan primitivas de `node:crypto`; no se inventa un algoritmo criptográfico.

Todos los archivos se crean exclusivamente en `.lucas-private/`, ignorado por Git. Se rechazan rutas externas, recorridos de directorio y enlaces simbólicos; los archivos existentes no se sobrescriben. Permisos solicitados: carpeta 0700 y archivos 0600. **En Windows esos modos no sustituyen las ACL**: restringir el acceso al usuario operador y conservar obligatoriamente la contraseña de la clave privada. No mover archivos a `public`, `static`, `content`, carpetas compartidas ni artefactos públicos.

### Preparación local

Requiere Node 22 y las dependencias ya instaladas del proyecto. Proporcionar `LUCAS_BACKUP_PASSPHRASE` mediante el gestor de secretos o entrada privada del entorno de la sesión; no escribir el valor en el historial del terminal, archivos versionados ni argumentos. Guardar esa contraseña por separado de los archivos cifrados.

```text
node scripts/lucas-backup.mjs generate-key
```

Esto crea `backup-private.pem` cifrado y `backup-public.pem`. Conservar otra copia privada de la clave cifrada en un dispositivo bajo control del operador. Perder la clave privada o su contraseña hace irrecuperables las copias. No generar ni mover credenciales reales durante las pruebas automatizadas.

### Exportar una copia cifrada

Una vez habilitado y probado el sistema, proporcionar `NETLIFY_SITE_ID` y `NETLIFY_AUTH_TOKEN` por entorno, con permisos mínimos disponibles para leer el sitio. No poner el token en el comando ni reutilizarlo en el navegador. La copia solo necesita la clave pública; no necesita la contraseña de recuperación.

```text
node scripts/lucas-backup.mjs backup
```

El SDK oficial lee los stores privados `lucas-progress-v1` y `lucas-progress-backups-v1`. No escribe ni restaura datos remotos. Solo archiva las claves de propietario derivadas mediante SHA-256 y el JSON de progreso validado; excluye registros de límites de solicitudes, metadatos del proveedor, credenciales y datos de Identity. Rechaza propiedades inesperadas. Impone máximos de 10.000 objetos listados, 256 KiB por objeto y 16 MiB totales. Superar un límite aborta sin crear una copia parcial. No imprime identificadores ni progreso. El archivo resultante es `backup-<fecha>-<aleatorio>.json`, cifrado y autenticado.

Programación propuesta: una copia manual semanal y después de un cambio importante; verificar el descifrado con datos sintéticos antes de usar datos reales, retener las cuatro últimas copias cifradas y eliminar las más antiguas. Esto es una tarea del operador, **no una automatización activada**. El costo local de almacenamiento depende del equipo ya disponible; no se contrató otro destino. No afirmar que existe una copia real hasta que el operador ejecute el comando correctamente.

### Preparar recuperación

```text
node scripts/lucas-backup.mjs decrypt backup-<fecha>-<aleatorio>.json
```

Requiere la clave privada cifrada y `LUCAS_BACKUP_PASSPHRASE`. Genera `recovery-<fecha>-<aleatorio>.json` **en texto plano dentro de la carpeta privada**, nunca en stdout. Eliminar ese archivo tras la recuperación. El comando no importa nada a Netlify.

Antes de cualquier restauración manual, validar esquema e IDs contra el curso actual y cotejar **los marcadores de eliminación del estado remoto actual**, no solo los incluidos en la copia. La copia conserva el contador interno `resetCount`, entero no negativo: recuerda las eliminaciones incluso si el estudiante vuelve a crear progreso y evita confundir una carga antigua con la primera sincronización. No eliminar ni reiniciar ese contador durante una recuperación. Una copia antigua no debe resucitar un perfil eliminado posteriormente. La restauración requiere un procedimiento revisado por operador y pruebas separadas; no hay restauración remota automática.

Las copias históricas locales son cifradas, pero también contienen datos de progreso: aplicar la retención limitada y, ante una solicitud de borrado, retirar o reemplazar los archivos que contengan ese perfil. El borrado en la aplicación no puede borrar archivos desconectados del equipo del operador. No se puede prometer eliminación completa de copias externas sin completar esa tarea.

## Pruebas y bloqueo de publicación

`npm run test:lucas-sync` precarga `tests/helpers/forbid-network.mjs`: bloquea fetch, HTTP, HTTPS, TCP y TLS antes de ejecutar las suites. Una prueba comprueba que los intentos de conexión fallan sin abrir sockets. Las suites usan Identity y Blobs simulados, progreso construido por las pruebas, credenciales ficticias y directorios temporales para los ensayos de cifrado. No leen `.lucas-private` del proyecto, secretos del operador ni perfiles reales de estudiantes. Los IDs de clases del catálogo provienen del contenido público y no son datos de estudiantes.

El navegador de prueba utiliza un perfil temporal e intercepta las solicitudes para servir la web desde archivos locales; no utiliza el perfil personal de Edge. Las solicitudes externas se bloquean. El guardado, la exportación y la importación local se deben probar con los endpoints de sincronización indisponibles, sin Identity ni Blobs. Las pruebas de navegador y sus archivos sintéticos no deben publicarse.

`node --test tests/lucas-backup.test.mjs` usa **solo datos sintéticos y stores simulados**: cifrado/descifrado, clave incorrecta, alteración de campos autenticados, rutas y enlaces, escritura exclusiva, límites y ausencia de datos en los mensajes. No demuestra una lectura real del SDK contra Netlify ni crea una copia de producción.

Antes de publicar o activar deben quedar verificadas y documentadas:

1. Cobertura gratuita efectiva de Identity, Blobs y Functions para esta cuenta, consumo de Functions y límites; sin migración, tarjeta, recargas ni servicios pagos.
2. Identity con confirmación de correo habilitada y dos cuentas de prueba confirmadas. Sesiones reales validadas por la API oficial.
3. Solicitudes HTTP manipuladas: una cuenta no puede leer, modificar, exportar ni borrar el progreso de otra; un ID o token inventado no sirve. Rechazar CSRF, entradas excesivas/desconocidas y exceso de solicitudes.
4. Sincronización entre dispositivos, conflictos, borrado concurrente, cierre/cambio de cuenta, pérdida de red, error de servidor y continuidad del progreso local sin perder los IDs existentes.
5. Prueba real de lectura de Blobs y copia cifrada con perfiles de prueba; recuperación privada revisada y eliminación de sus archivos temporales.
6. Revisión independiente y build de Hugo. Las pruebas con dobles de API y entorno local se informan por separado de las pruebas reales de Netlify.

Hasta completar esos controles, el estado correcto es **preparado pero apagado y sin publicar**.

### Configuración posterior a superar todas las condiciones

Esta lista no habilita el sistema ni sustituye las pruebas reales anteriores. Solo una vez aprobadas las condiciones de costo, seguridad y publicación:

1. Definir `LUCAS_SYNC_ORIGIN` con el origen HTTPS canónico exacto que usa el navegador, por ejemplo `https://www.lasnotasdevero.com`, sin ruta ni barra final. No asumir que la variable automática `URL` coincide: un dominio de Netlify diferente causaría rechazo de las solicitudes legítimas.
2. Revisar y autorizar explícitamente la reincorporación de `netlify/disabled-functions/lucas-progress.mjs` al directorio de Functions, después de las pruebas aisladas necesarias. No hay una copia automática en el build. Solo entonces configurar `LUCAS_SYNC_ENABLED` para el entorno de ejecución de Functions por los mecanismos oficiales y cambiar el parámetro Hugo `lucas_sync_enabled`. No basta con editar una variable de build en `netlify.toml`. Cambiar únicamente las variables tampoco vuelve desplegable el servidor conservado. No hace falta proporcionar secretos al código público del navegador.
3. Verificar la ruta aislada `/cuenta/` para confirmación de correo, y la política CSP acotada a las páginas de la guía habilitada y de cuenta. Excluir RefTagger de ese flujo reduce la exposición de campos de contraseña a scripts externos; revisar que no se haya relajado la política para permitirlos.
4. Repetir las pruebas reales de sesiones confirmadas, aislamiento entre dos estudiantes, solicitudes HTTP manipuladas, CAS, borrado y funcionamiento local. Solo después autorizar el despliegue correspondiente.

Comprobaciones locales preparadas:

```text
npm run build:lucas
npm run test:lucas-sync
node tests/study-guide-browser.mjs
```

El generador prepara el catálogo de IDs conocido por el servidor. Las tres suites y las pruebas del navegador utilizan entornos controlados o simulados; **no acreditan** entrega y confirmación real de correo, sesiones de Identity reales ni CAS entre dos cuentas contra Blobs en Netlify. Esas comprobaciones siguen siendo una condición separada antes de habilitar o publicar.

Las preguntas concretas de costos, cuotas, bloqueo de excesos y restricciones se encuentran en `docs/netlify-support-free-legacy.md`. Es un borrador local, no un mensaje enviado.

Fuentes para la planificación de Functions y tráfico automatizado: [directorio de Functions y despliegue](https://docs.netlify.com/build/functions/get-started/), [límites Legacy](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/legacy-pricing-plans/) y [alcance y demora del rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/).
