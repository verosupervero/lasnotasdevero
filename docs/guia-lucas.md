# Guía de Lucas: edición, progreso y futura sincronización

La página sigue en `/estudios/guia-estudio-lucas/`. Esta versión permite estudiar sin cuenta y guarda el avance en el navegador. No hay autenticación, base de datos de estudiantes ni sincronización por correo configuradas en este repositorio. La función de contacto de Netlify no sirve como base de datos de progreso.

## Agregar clases

La fuente editorial está dividida en archivos Markdown dentro de `content/estudios/guia-estudio-lucas/`. `index.md` conserva los metadatos y reúne automáticamente los materiales mediante `{{< study-materials >}}`. La página usa su propio layout `layouts/estudios/study-guide.html`; el resto del sitio conserva sus plantillas.

Cada clase se declara con un bloque `study-video` y cada grupo de preguntas con un bloque `study-question`. El selector se construye con las clases realmente presentes en el HTML; no hay una lista duplicada en JavaScript que deba actualizarse. `planned_videos = 13` en el frontmatter expresa la planificación, no publica clases vacías.

Para sumar una clase:

1. Crear un archivo Markdown en esa carpeta, por ejemplo `070-video-7.md` (y, cuando corresponda, `130-video-13.md`), copiando la estructura de una clase existente, incluido su frontmatter. El prefijo numérico determina el orden; las clases van antes de `900-integracion.md`. No hace falta editar `index.md` ni una lista de clases.
2. Asignar un `id` nuevo, permanente y único, por ejemplo `video-7`, y completar el título, etiqueta y pasaje reales.
3. Agregar `video` solo cuando se haya confirmado el ID de YouTube. Si falta, dejar un enlace verdadero a la playlist dentro del contenido y un comentario TODO.
4. Escribir los grupos de preguntas con `study-question`, cada uno con su propio `id` semántico y permanente, `title` real y `anchor` único para su encabezado. Conservar el texto completo, sus listas, enlaces y bibliografía.
5. Asociar únicamente las referencias documentadas para esa clase mediante sus IDs en `bibliography`; no heredar automáticamente la lista de la clase copiada. Las fichas completas se mantienen en `data/bibliography.json`. Ver [auditoría e instrucciones bibliográficas](bibliografia-lucas-auditoria.md).
6. Ejecutar el build y comprobar el selector, las preguntas y la vista móvil.

Los archivos actuales son:

- `010-video-1.md`, `020-video-2.md`, `030-video-3.md`, `040-video-4.md` y `050-video-5.md`: clases incorporadas a la guía. El Video 5 conserva sus ocho bloques de preguntas, usa el enlace confirmado por la autora (`n0BoSXnUtIc`) y asocia sus cuatro fuentes confirmadas mediante IDs del catálogo central.
- `060-video-6.md`: Lucas 6:12–49, nueve bloques de preguntas y video confirmado (`zoxk16AU3uw`). Asocia tres fuentes utilizadas y distingue Walton/Keener como material de apoyo mediante `bibliography_support`, dentro del mismo desplegable bibliográfico.
- `065-cierre-practico-lucas-1-6.md`: cierre práctico del Bloque I, nueve bloques de preguntas y video `IGksUPG4ebU`. Usa `kind="complement"`, con progreso propio; no ocupa el lugar del Video 7. La bibliografía distingue libros identificados, fuentes pendientes (`bibliography_pending`) y material de apoyo (`bibliography_support`).
- `035-censo-lucas-2.md`: complemento junto al Video 3.
- `900-integracion.md`: integración final.
- `910-presentacion-objetivos.md`, `920-metodologia.md`, `930-bibliografia.md` y `940-recursos.md`: materiales generales.

Cada archivo contiene un frontmatter TOML entre líneas `+++` y el bloque completo `study-video` o `study-resource`, con sus preguntas dentro. El frontmatter guarda las asociaciones bibliográficas; en recursos sin datos puede estar vacío, pero no debe omitirse porque Hugo podría interpretar el comienzo `{{` como JSON. Son recursos de la página principal, sin páginas independientes. Para modificar las preguntas de una clase, editar solamente su archivo. Para cambiar el título general o la cantidad prevista de videos, editar el frontmatter de `index.md`.

Los identificadores de clase y de bloque son claves de progreso; son independientes del nombre y del prefijo del archivo. No cambiarlos al retitular, reordenar o ampliar una clase. Nunca reutilizar un ID de un bloque eliminado para un tema distinto. Los títulos y las anclas de navegación se pueden actualizar conservando alias de los enlaces ya publicados.

El censo usa `kind="complement"` y la integración `kind="integration"`. Las clases del curso usan `kind="course"` (valor predeterminado). Solo estas últimas forman el denominador de clases publicadas. El complemento y la integración tienen su propio avance, sin convertirse en videos numerados del curso.

## Alcance del guardado local

Hay un perfil local anónimo por navegador y origen del sitio. No se solicita nombre, email ni contraseña. En un dispositivo compartido, las personas que usen ese mismo perfil del navegador comparten este avance; un navegador o perfil distinto tiene otro progreso.

Se guardan los IDs de clase y bloque, las marcas de bloques trabajados, la finalización explícita de cada clase, el último punto de estudio y las fechas de actividad. No se guardan respuestas escritas ni se detecta que alguien haya visto un video: abrir una clase no la completa.

La clave es `lasnotasdevero:lucas:progress:v1`. El esquema tiene `version`, `selected`, `lastActivity` y un mapa `classes`; cada clase contiene `blocks` y los registros opcionales `complete`, `lastPoint` y `lastActivity`. Cada registro guarda `value` y `updatedAt`. El modelo está separado en `static/js/study-progress.js`, sin depender del orden del selector. Las pestañas del mismo navegador unen y persisten sus cambios por campo; un estado corrupto o de una versión posterior se conserva intacto y activa la modalidad en memoria.

La selección y las marcas se recuperan al volver al mismo navegador. Borrar los datos del sitio o usar una sesión privada puede eliminar el avance. Si el almacenamiento está bloqueado o lleno, se puede seguir estudiando y la página informa que el guardado no está disponible. El dominio con `www`, sin `www`, las vistas locales y las de prueba tienen almacenamientos separados.

El estado conserva las claves de clases y bloques que no aparezcan en la edición actual: agregar clases o reordenarlas no reinicia lo trabajado. Las desmarcas también deben conservar su fecha para que una copia más antigua no vuelva a marcarlas.

## Sincronización por email: propuesta pendiente

Esta sección es una propuesta técnica; no se ha creado ningún servicio ni enviado ningún correo. La modalidad local funciona independientemente de esta segunda etapa.

Antes de implementarla, Vero necesita crear o autorizar:

1. Un proyecto de Supabase, su región y las condiciones del plan elegido. Confirmar las cuotas vigentes antes de ofrecer la sincronización como servicio gratuito.
2. Supabase Auth con email y enlace mágico, sin contraseña, y las URLs exactas del sitio y de retorno permitidas. El enlace debe validarse antes de asociar datos a una persona. [Documentación de acceso por email](https://supabase.com/docs/guides/auth/auth-email-passwordless).
3. Un proveedor SMTP transaccional y un remitente propio; configurar las credenciales en Supabase y verificar el dominio con el proveedor. El SMTP predeterminado tiene restricciones y no está destinado al envío público de producción. [Documentación de SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
4. Las tablas de progreso y sus políticas de acceso. La configuración pública del navegador podrá incluir la URL del proyecto y su clave publicable; las claves secretas o `service_role` nunca deben enviarse al frontend.
5. La explicación de privacidad, la política de conservación y un procedimiento para borrar la cuenta y su progreso. No conectar estos correos con marketing.

### Modelo propuesto y protección

Guardar registros pequeños por `user_id`, `course_id`, `class_id` y campo de progreso; los bloques agregan `question_id`. El email queda en Auth, sin duplicarlo en cada fila. Separar las marcas de bloques, la finalización de clases y los puntos de reanudación evita sobrescribir toda una clase cuando cambió una sola casilla.

Activar Row Level Security antes de exponer las tablas. Las operaciones SELECT, INSERT, UPDATE y DELETE deben restringirse a sesiones autenticadas cuyo `auth.uid()` coincida con el `user_id` de la fila. UPDATE también debe comprobar el propietario del resultado; no basta con filtrar las lecturas. Probar con dos usuarios y una petición sin sesión. [Documentación de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Unión del avance entre dispositivos

Tras validar el enlace mágico y obtener una sesión confirmada, descargar el progreso del usuario y unirlo con una copia del avance local. Comparar por campo y por bloque, conservar tanto los valores verdaderos como las desmarcas y no sustituir el estado completo con un `upsert` ciego.

La implementación remota deberá usar revisiones del servidor y una escritura condicional/transaccional que detecte cambios concurrentes. Las fechas del navegador, por sí solas, no garantizan cuál edición es más reciente entre dispositivos con relojes distintos. En conflictos que no se puedan ordenar con seguridad, conservar ambas versiones hasta resolverlos, sin descartar la copia local. Reintentar las operaciones pendientes al recuperar la conexión.

Cerrar sesión debe separar el estado de esa cuenta de cualquier cuenta posterior. La primera importación local debe explicarse para evitar transferir automáticamente el avance de otra persona en un dispositivo compartido. El estudiante debe poder continuar localmente aunque falle el servicio remoto.

La aceptación de esta etapa requiere pruebas reales de entrega y caducidad del enlace, verificación del email, dos dispositivos, dos usuarios aislados por RLS, pérdida de conexión y conflictos de edición. Escribir una dirección de correo en un formulario no constituye sincronización.

## Verificación

La separación en archivos conserva la URL `/estudios/guia-estudio-lucas/`. El build local con `hugo --minify` pasó después de la migración: el HTML de la guía coincide exactamente con el anterior, con seis estudios y 33 casillas de bloques. Se compararon los diez bloques editoriales con la fuente anterior y se conservaron completos, junto con el frontmatter original de la página. Los recursos Markdown no generan páginas adicionales.

El build habitual es `hugo --minify`. El modelo de progreso se verifica con `node --test tests/study-progress.test.mjs` (en el sandbox con Node 24 puede usarse `--test-isolation=none` si se bloquea la creación del proceso de pruebas). Las comprobaciones de navegador se ejecutan con `node tests/study-guide-browser.mjs` y requieren Edge/Chromium local. No hace falta instalar una dependencia de aplicación nueva.

Además del guardado y la reanudación, verificar que las preguntas completas estén en el HTML, que los enlaces antiguos abran el estudio y el bloque correctos, que no haya más de un reproductor activo y que la vista siga siendo legible a 360, 768 y 1280 píxeles. Las capturas locales y los perfiles de pruebas se guardan en `.contact-test-output/lucas-platform/`, fuera del código publicado.

### Resultado de esta implementación

Validación local del 23 de octubre de 2026:

- `hugo --minify`: PASS, sin errores ni advertencias de Hugo. Binario local 0.157.0; Netlify sigue configurado con 0.124.1, que no se ejecutó directamente en esta sesión.
- Modelo de progreso: seis pruebas PASS con `node --test --test-isolation=none tests/study-progress.test.mjs`.
- Navegador Edge: PASS con `node tests/study-guide-browser.mjs`. Se verificaron recarga y reinicio completo del navegador, reanudación, casillas, finalización y desmarcas, fechas de actividad, conflictos entre pestañas, eliminación del estado, almacenamiento bloqueado/lleno/corrupto y versiones futuras.
- Se conservaron las 110 entradas originales de preguntas/párrafos comprobadas, todos los enlaces y todas las anclas. Hay cuatro clases del curso, un complemento, una integración y 33 bloques de preguntas. Los IDs desconocidos del progreso sobreviven a cambios del catálogo; las pruebas del modelo cubren ampliación y reordenamiento.
- Sin desbordes a 360, 768 y 1280 píxeles. Solo hay un iframe activo, con proporción 16:9. Se verificaron teclado, nombres y estados en el árbol de accesibilidad; no se realizó una sesión manual con un lector de pantalla.
- Sin JavaScript, permanecen los seis estudios y los 33 bloques en el HTML, accesibles mediante los desplegables nativos. El guardado requiere JavaScript.
- Las páginas de contacto y del estudio de Efesios comprobadas mantuvieron exactamente su salida anterior. Las referencias al título de Lucas pueden reflejar el cambio de título solicitado.

El entorno de pruebas bloquea YouTube, fuentes remotas y RefTagger: la reproducción real del video queda pendiente de una comprobación en un navegador con conexión. El Video 2 conserva la playlist y su TODO porque su ID individual sigue sin confirmar. La edición posterior del usuario proporciona `16zxJ8iV_-o` para el Video 3, incorporado al reproductor de carga diferida. Continúan tres recursos faltantes anteriores del tema: `/styles/font-awesome.min.css`, `/styles/images/bg01.png` y `/favicon.ico`.

`git diff --check` identifica siete líneas movidas con espacios finales ya presentes en el original; seis corresponden a saltos Markdown de la bibliografía. Se conservaron sus caracteres. No se hizo commit, push ni deploy.
