---
name: add-lucas-study
description: "Use when adding or integrating a class, video, study, or post into the Lucas study guide at content/estudios/guia-estudio-lucas/; covers lesson structure, bibliography, Firebase progress anchors, Hugo validation, and deployment checks."
---

# Agregar un estudio a la guía de Lucas

Usá este procedimiento para integrar una clase nueva, un video o material de estudio en la guía `/estudios/guia-estudio-lucas/`. La guía es un conjunto de recursos Markdown que se compilan juntos; no crees una página independiente para cada clase.

## 1. Revisar la estructura vigente

- Leé `docs/guia-lucas.md`, `docs/bibliografia-lucas-auditoria.md`, `layouts/shortcodes/study-materials.html`, `layouts/shortcodes/study-video.html` y una clase vecina relevante.
- Confirmá el orden actual en `content/estudios/guia-estudio-lucas/`. Los nombres numéricos ordenan las clases; la serie actual llega a `080-video-8-9.md` y `085-oracion-y-mision.md`. Elegí el siguiente prefijo disponible que mantenga el orden editorial.
- No edites `public/`: es salida generada, no fuente. No edites adjuntos o snapshots de solo lectura.
- Conservá el texto de la fuente y su intención. No inventes datos, referencias, preguntas, números de video ni conclusiones.

## 2. Crear el archivo fuente

- Creá un archivo Markdown nuevo dentro de `content/estudios/guia-estudio-lucas/`.
- Todo recurso, incluso si no tiene bibliografía, debe empezar con frontmatter TOML delimitado por `+++` en dos líneas separadas. Si no hay metadatos, dejá el bloque vacío:

  ```toml
  +++
  +++
  ```

  Sin este bloque Hugo puede interpretar el shortcode inicial `{{< ... >}}` como JSON y fallar al compilar.
- Incluí exactamente un shortcode envolvente `study-video`, seguido del texto de introducción, preguntas y materiales, y cerralo con `{{< /study-video >}}`.
- El shortcode debe incluir un `id` nuevo, permanente y único; `block="Bloque I"` o `block="Bloque II"`; una etiqueta, título y pasaje fieles al material.
- El ID de YouTube va en el atributo `video` solo después de confirmarlo. El shortcode genera una miniatura que abre YouTube en otra pestaña. No uses `{{< youtube ... >}}` ni iframe dentro del contenido. Si no hay video confirmado, omití `video` y no inventes un enlace.
- Ubicá la clase en el bloque que corresponde a la guía y mantené el rótulo de bloque explícito.

## 3. Escribir preguntas y registrar fuentes

- Cada pregunta debe usar `study-question` con `id`, `anchor` y `title`. El `anchor` es obligatorio para la sincronización de progreso y debe ser único en todo el curso. Por seguridad, usá valores semánticos ASCII en minúsculas, números y guiones; no reutilices IDs o anchors de otra pregunta.
- No elimines preguntas, enlaces, pasajes ni texto del material original al integrarlo. Conservá sus calificadores editoriales y diferenciá lo que dice el texto de las interpretaciones o aplicaciones.
- Asociá en el frontmatter `bibliography` únicamente IDs de fuentes que la clase realmente identifica y utiliza. Las fichas se mantienen en `data/bibliography.json`; verificá que cada ID exista y que sus datos y URL estén confirmados.
- No agregues obras por inferencia, no copies automáticamente toda la bibliografía de otra clase y no publiques referencias `pending`. Si el material no identifica libros o comentarios, no agregues fichas académicas; podés dejarlo explicado de forma breve si es necesario.
- Actualizá `docs/bibliografia-lucas-auditoria.md` cuando la integración afecte el registro editorial o el catálogo.

## 4. Validar antes de terminar

Ejecutá en este orden, verificando el código de salida de cada comando:

```powershell
npm.cmd run build:contact
npm.cmd run build:firebase
hugo --minify --destination "$env:TEMP\lucas-guide-build"
```

`build:firebase` es obligatorio: comprueba que cada ID y cada `anchor` de pregunta sean válidos y actualiza el catálogo y las reglas de progreso. Una falla ahí bloquea el build de producción de Netlify aunque el Markdown parezca correcto. Inspeccioná el diff de los archivos generados, especialmente `firebase/firestore.rules`, y conservá los cambios generados que correspondan a la clase.

Después del build:

- Confirmá que la clase aparece una sola vez en `$env:TEMP\lucas-guide-build\estudios\guia-estudio-lucas\index.html`, en el orden esperado, con el `data-block` correcto, su enlace o miniatura de YouTube si corresponde y todas sus preguntas.
- Confirmá que el catálogo generado incluye el ID de clase y todos los IDs de preguntas. No declares la integración terminada si una validación falla.
- Ejecutá `git diff --check` y revisá el diff para detectar cambios de prosa o metadatos no solicitados.
- Limpiá únicamente la carpeta temporal que creaste para el build. No borres ni reescribas `public/`.

## 5. Publicar solo con autorización

- No hagas `git add`, commit, push ni deploy salvo que la usuaria lo pida explícitamente.
- Si autorizó publicar, primero verificá la compilación completa y los archivos generados. Netlify ejecuta `npm ci --ignore-scripts --include=dev`, `npm run build:contact`, `npm run build:firebase` y `hugo --minify`.
- Después de publicar, comprobá en el HTML de producción que aparezcan la nueva clase, el video y sus preguntas; un push por sí solo no confirma una publicación exitosa.
