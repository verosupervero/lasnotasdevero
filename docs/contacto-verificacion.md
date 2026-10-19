# Verificación previa a publicación — 19 de octubre de 2026

**Suspendido por decisión de la autora:** Contacto utiliza ahora solo un enlace
al correo. La implementación cifrada se conserva para el futuro y su despliegue
de prueba se retiró (HTTP 404). El sitio principal no se publicó ni se modificó.
Los resultados siguientes corresponden al ensayo anterior.

Estado: comprobaciones locales y despliegue independiente satisfactorios;
**envío cifrado recibido en Netlify y notificación recibida en Proton;
descifrado pendiente**.
No se publicó en el sitio principal.

## Entorno de compilación comprobado

- Node 22.23.3 y npm 10.9.9.
- Hugo 0.124.1 extended, la versión declarada para producción en `netlify.toml`.
- Binarios portátiles oficiales, contrastados con los SHA-256 de sus respectivos
  servidores de distribución. No se realizó una instalación global.
- Sistema de esta comprobación: Windows. No se ejecutó un build dentro de Netlify
  ni en Linux. Reproducir versiones y comando localmente no sustituye ese ensayo.

El procedimiento configurado es:

```sh
npm ci --ignore-scripts --include=dev && npm run build:contact && hugo --minify
```

La instalación limpia con el lockfile pasó y reportó cero vulnerabilidades
conocidas. El empaquetado y Hugo generaron 294 páginas sin advertencias. Se corrigió
un error que solo aparecía con Hugo 0.124.1: sus plantillas no reconocen
`strings.TrimSpace`; Contacto utiliza ahora `trim` con los mismos caracteres de
espacio, sin cambiar las comprobaciones de la clave.

## Recursos y presentación bajo la CSP

La prueba de navegador aplica la CSP de `netlify.toml` como encabezado HTTP a la
página generada, interceptando las solicitudes de laboratorio. Comprueba:

- Tres hojas de estilo cargadas y con reglas accesibles.
- Cuatro imágenes del encabezado decodificadas correctamente y favicon local.
- Siete fuentes WOFF2 locales cargadas: Open Sans 400/600/700/800 y Poppins
  400/600/700. El navegador confirmó que usa Poppins en el título y Open Sans en
  el texto, mediante su información de fuentes efectivamente renderizadas.
- Cero recursos ausentes y cero violaciones inesperadas de CSP.
- Cero solicitudes externas desde Contacto.
- Sin desbordamiento horizontal ni superposición del menú, marca, donación e
  iconos sociales a 1280, 390 y 320 píxeles. Controles con etiquetas visibles y
  botón con altura mayor a 44 píxeles.

Las fuentes se incorporaron localmente para conservar la tipografía sin permitir
Google Fonts. Se eliminó del CSS generado exclusivamente para Contacto la referencia
a la textura ausente `images/bg01.png`; se mantienen colores y fondos restantes.
El favicon reutiliza `static/logo.png`. El CSS original y la presentación de las
demás páginas no se alteraron por estas correcciones.

Capturas completas de la versión local con la clave pública real validada, antes
de enviar ningún mensaje:

- `.contact-test-output/contact-1280.png`
- `.contact-test-output/contact-390.png`
- `.contact-test-output/contact-320.png`

Los archivos de comprobación quedan fuera de `public/` y no se incluyen en Git.

## Envío y confidencialidad

`form-action 'none'` bloqueó un intento explícito de envío HTML nativo. La prueba
detectó la violación esperada de esa directiva y no hubo POST adicional. El envío
por JavaScript sí llegó al receptor local interceptado: `fetch` se rige por
`connect-src 'self'` y no por `form-action`.

El cuerpo observado contiene exclusivamente `form-name`, `bot-field` y
`encrypted_message`. Ninguno de los cuatro valores originales aparece en URL,
encabezados o cuerpo de la solicitud; tampoco se enviaron cookies. Los campos
sensibles carecen de `name` y de formulario asociado. El descifrado de laboratorio
recuperó exactamente nombre, correo, asunto y mensaje, incluido texto Unicode.

Ocho pruebas automatizadas pasaron. La prueba de navegador también pasó para
clave ausente, inaccesible, inválida y con huella incorrecta; validación y fallo de
cifrado; honeypot; prevención de duplicados; errores que conservan los datos; y
JavaScript deshabilitado. La clave pública de Proton configurada se valida en el
bundle sin modificar, pero no se utilizó ninguna clave privada de la autora.

Los POST de prueba y sus respuestas se interceptan localmente. No son evidencia
de recepción en Netlify ni de entrega o descifrado en Proton Mail.

## Pendientes que impiden dar por finalizada la integración

Lista de comprobaciones del ensayo desplegado, separado de la publicación definitiva
(resultados del ensayo autorizado al final):

1. Comprobar el build en Netlify y la aplicación real de los encabezados a
   `/contacto` y `/contacto/`.
2. Confirmar que Forms detectó `contacto-cifrado` y que recibe solo el bloque
   cifrado y los campos técnicos, sin truncarlo ni descartarlo como spam.
3. Configurar y comprobar la notificación a `lasnotasdevero@protonmail.com`.
4. Realizar un único envío real autorizado y verificar su aceptación en Forms.
5. Confirmar que la autora recupera exactamente los cuatro valores originales con
   su clave privada en un entorno seguro. No se presupone que una notificación
   de Netlify sea PGP/MIME ni que Proton la descifre automáticamente.

La publicación definitiva continúa bloqueada hasta completar esa verificación.
El procedimiento de recepción y descifrado está en `docs/contacto.md`.

## Ensayo independiente autorizado — 19 de octubre de 2026

Se creó `lasnotasdevero-contacto-prueba`, sin dominio personalizado ni conexión
con GitHub, y se subió un despliegue borrador. Su identificador es
`6ad65bad96e4b11ca491f798`:

https://6ad65bad96e4b11ca491f798--lasnotasdevero-contacto-prueba.netlify.app/contacto/

El artefacto se compiló en una carpeta limpia con Hugo 0.124.1. No contiene cachés,
perfiles del navegador, resultados de pruebas ni claves privadas. Este despliegue
sube archivos ya compilados: **no demuestra ejecución de npm ci ni Hugo en los
servidores de compilación de Netlify**. Esa comprobación remota sigue pendiente.

Comprobaciones sobre la URL real de Netlify:

- CSP recibida como encabezado HTTP, con `form-action 'none'` y
  `connect-src 'self'`. Cero violaciones de CSP en la carga y el envío JavaScript.
- Recursos cargados sin errores HTTP, siete fuentes locales cargadas y sin
  desbordamiento horizontal a 1280, 390 y 320 píxeles. Se guardaron capturas
  `netlify-contact-1280.png`, `netlify-contact-390.png` y
  `netlify-contact-320.png` en `.contact-test-output/`.
- Forms detectó `contacto-cifrado`, con honeypot y `encrypted_message`.
- Se configuró una notificación por correo a `lasnotasdevero@protonmail.com`,
  con asunto genérico «Prueba de contacto cifrado — Las Notas de Vero».
- Se realizó un único POST real desde el navegador: HTTP 200 y confirmación en
  la interfaz. Contenía únicamente `form-name`, `bot-field` vacío y
  `encrypted_message`. Los cuatro valores originales no aparecen en URL,
  encabezados ni cuerpo legible; no se enviaron cookies.
- La consulta `6ad65c1ecbc1243063d13aef` contiene exactamente el mismo bloque
  cifrado capturado al salir del navegador, sin truncamiento. Los demás datos
  guardados por Netlify son metadatos técnicos: IP, user agent y referrer. No se
  copiaron sus valores a esta documentación.
- Netlify clasificó inicialmente la consulta como spam. Se marcó manualmente
  como legítima, sin repetir el POST ni desactivar el filtrado. Ahora figura
  entre las consultas verificadas. El funcionamiento habitual del antispam con
  contenido cifrado sigue pendiente de resolver antes de la publicación.
- La autora indicó que usa únicamente Proton Mail en el navegador. Posteriormente
  confirmó la recepción de la notificación y compartió el bloque cifrado que
  muestra el correo. Esto confirma entrega, pero no descifrado: el contenido no
  se presentó de forma legible en esta prueba.
- Se contrastó por API que el despliegue publicado del sitio principal continúa
  siendo `6ad64b5a751877c35f6bdc02` y que su configuración de Forms no cambió.

El texto ficticio cifrado incluye el código `VERO-1910-PGP`. La confirmación de
descifrado requiere recuperar exactamente los cuatro campos, no solo reconocer
ese código ya mostrado en esta conversación. Los valores esperados y el bloque
cifrado están guardados fuera del artefacto público, en `.contact-test-output/`.

No se da por finalizada la integración. Tampoco se presupone que marcar como
legítima una consulta genere o reenvíe automáticamente una notificación.

## Resultado de recepción y configuración pendiente

La notificación nativa de Forms no permitió leer el contenido dentro de Proton
en este ensayo. Es necesario comprobar una entrega con formato OpenPGP de correo
compatible (PGP/Inline o PGP/MIME), conservando cifrado el bloque en todos los
servicios intermedios. No pedir ni exportar la clave privada para resolverlo.

La consulta de la configuración de Netlify mostró `@netlify/plugin-emails`, pero
no los nombres de variables requeridas `NETLIFY_EMAILS_PROVIDER` ni
`NETLIFY_EMAILS_PROVIDER_API_KEY`. Se consultaron únicamente los nombres para
el informe, sin registrar ni mostrar sus valores. No se encontró un proveedor
de correo configurado mediante esas variables; la autora confirmó que no tiene
Mailgun, SendGrid ni Postmark. No se crearon cuentas ni se conectó otro servicio.

Una alternativa a evaluar es un reenvío del bloque mediante un proveedor que
admita el formato MIME necesario. Requiere que la autora cree y verifique una
cuenta y configure las credenciales del proveedor en un entorno seguro. Después
debe repetirse la prueba de descifrado antes de autorizar producción. El proveedor
no debe recibir los cuatro campos originales en texto plano. No basta con volver
a enviar la misma notificación HTML de Netlify.

Referencias oficiales:

- https://proton.me/support/pgp-mime-pgp-inline
- https://docs.netlify.com/manage/forms/notifications/
- https://docs.netlify.com/extend/install-and-use/setup-guides/email-integration/
- https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-sandbox
