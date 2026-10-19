# Contacto cifrado: preparación, activación y verificación

## Implementación reservada para el futuro

La autora decidió suspender esta integración el 19 de octubre de 2026 y usar
únicamente un enlace a `mailto:lasnotasdevero@protonmail.com` en Contacto.
El formulario no está presente en la página activa. Se conservaron copias de su
plantilla y contenido en `docs/contacto-openpgp-pendiente/`, además del código y
las pruebas existentes. El despliegue borrador del formulario se retiró de Netlify
y su URL devuelve 404. No se publicó ningún cambio en el sitio principal.

Lo que sigue documenta el ensayo histórico, no una integración habilitada.

Estado: **envío cifrado recibido en Netlify y notificación recibida en Proton;
el navegador de Proton muestra el bloque sin descifrar; integración incompleta**.
No publicar ni declarar la integración finalizada hasta recuperar los cuatro campos
originales con la clave privada correspondiente en un entorno seguro de la autora.
El 19 de octubre de 2026 se realizó un único envío ficticio autorizado a un
proyecto de Netlify independiente, con notificación configurada a Proton. Netlify
lo clasificó inicialmente como spam; se verificó manualmente esa única prueba.
La autora confirmó posteriormente que recibió la notificación, pero que muestra
el bloque `BEGIN PGP MESSAGE`, no los campos descifrados. Solo utiliza Proton
en el navegador y no tiene una cuenta de proveedor de correo transaccional.
El sitio principal no se modificó. Consultar el ensayo documentado en
`docs/contacto-verificacion.md`.

## Flujo y límites

El navegador reúne exclusivamente `{name, email, subject, message}` y cifra ese
objeto JSON con OpenPGP.js. Solo después prepara una petición URL-encoded con:

- `form-name=contacto-cifrado`
- `bot-field` vacío (honeypot)
- `encrypted_message`, con el bloque `BEGIN PGP MESSAGE` completo

Los campos legibles no tienen `name`, no pertenecen a un elemento HTML `form` y
el botón es `type=button`. Sin JavaScript o sin una clave verificada, permanece
desactivado. La CSP bloquea envíos HTML nativos (`form-action 'none'`), mientras
que permite el POST cifrado mediante `fetch` al mismo origen.

La plantilla contiene un formulario técnico oculto reconocido por Netlify Forms,
con esos tres nombres de campo únicamente. No se usa `FormData` para el mensaje.
El endpoint anterior `/api/contacto` devuelve 410 sin leer, registrar, guardar o
reenviar el cuerpo. Se retiró el flujo de Formspree.

Los valores legibles permanecen temporalmente en los controles y en memoria del
navegador para cifrarlos y permitir reintentos. No hay almacenamiento del mensaje
en localStorage, sessionStorage, URLs, analíticas o registros de la aplicación.
La página de contacto no carga scripts, fuentes o estilos externos: reutiliza
localmente los estilos del tema y las fuentes Open Sans y Poppins. Las demás
páginas conservan su comportamiento. La CSP de Contacto permite solo recursos y
conexiones del mismo origen; bloquea scripts inline, evaluaciones dinámicas,
formularios nativos, iframes y workers.

El cifrado no proporciona anonimato ni oculta IP, tiempos, tamaño del bloque,
identificadores de la clave u otros datos técnicos. El código servido por el sitio
y el navegador deben ser confiables: una modificación maliciosa del JavaScript
antes del cifrado puede comprometer los datos. La CSP reduce posibilidades de
inyección, pero no protege contra un servidor que entregue código modificado.

## Clave pública incorporada

La autora proporcionó el archivo público exportado de Proton. El 19 de octubre de
2026 se contrastó mediante HTTPS con la clave publicada por el servidor oficial de
Proton para `lasnotasdevero@protonmail.com`:

`https://mail-api.proton.me/pks/lookup?op=get&search=lasnotasdevero%40protonmail.com`

La huella primaria completa coincide exactamente:

`8B01 4957 FE23 CDB9 4C3D D38E FD95 DCB9 2610 0449`

Ambas claves pasaron las comprobaciones de identidad certificada y capacidad de
cifrado de OpenPGP.js. Se conservó el archivo público original en
`static/keys/contact-public.asc`, y su ruta y huella están fijadas en
`data/contact.json`. No se solicitó, descargó ni almacenó la clave privada. Esta
comparación confirma la coincidencia con la clave que publica Proton, pero no
demuestra por sí sola que la autora pueda descifrar los envíos: esa prueba sigue
pendiente. La publicación para visitantes continúa pendiente. Posteriormente se
autorizó el despliegue independiente y el envío ficticio documentados al comienzo.

Para una futura renovación, la autora puede obtener la clave desde su cuenta de Proton:

1. Entrar en Proton Mail: Configuración → Todas las configuraciones → Cifrado y
   claves → Claves de cifrado del correo.
2. Seleccionar exactamente `lasnotasdevero@protonmail.com`.
3. Exportar la **clave pública** activa correspondiente. No elegir la opción
   de exportar clave privada. El archivo público empieza por
   `-----BEGIN PGP PUBLIC KEY BLOCK-----`.
4. Confirmar la huella digital completa de esa misma clave en la información de
   claves de Proton y facilitar la huella junto con el archivo público. Comparar
   esa huella con la que calcula OpenPGP.js. Calcular una huella del archivo, sin
   contrastarla con un dato confiable de la autora, no verifica su procedencia.

Nunca solicitar ni adjuntar claves privadas, contraseñas de Proton o códigos de
recuperación. La aplicación no admite ni necesita una clave privada.

Solo tras verificar procedencia, identidad y huella se puede incorporar el archivo
público en `static/keys/` y configurar su ruta local y huella completa en
`data/contact.json`. No se descarga una clave de un servidor externo durante el uso
del formulario. La biblioteca exige una única clave pública, la huella fijada y un
UID certificado para el correo esperado, y comprueba caducidad, revocación y
capacidad de cifrado. Revalida al enviar. No hay fallback de envío en claro.

## Empaquetado y mantenimiento

`package.json` fija OpenPGP.js 6.3.2 y esbuild 0.28.2; `package-lock.json` incluye
las integridades. Los archivos de entrada son `assets/js/contact.js` y
`assets/js/contact-crypto.js`. `scripts/build-contact.mjs` produce el bundle local
`static/js/contact.js`, sin sourcemaps, conserva los avisos de licencia y genera
`static/js/contact-openpgp.LICENSE.txt`. También genera el CSS local de Contacto a
partir del tema, eliminando sus importaciones de fuentes externas. Copia siete
fuentes WOFF2 desde los paquetes `@fontsource/open-sans` y `@fontsource/poppins`
5.3.0 a `static/fonts/contact/`, junto con sus licencias, y genera sus declaraciones
`@font-face`. No es necesario permitir Google Fonts en la CSP.

```powershell
npm ci --ignore-scripts --include=dev
npm run build:contact
npm run test:contact
hugo --minify
```

Después del build, `npm run test:contact:browser` ejecuta la prueba local de red,
descifrado y navegador. Requiere un navegador Chromium local, configurable con
`CONTACT_BROWSER`; en Windows usa Edge por defecto. Intercepta todas las peticiones
de la página y no envía a Netlify ni Proton. Los resultados y capturas sintéticas
se guardan en `.contact-test-output/`, fuera de `public/` y excluidos de Git. Estas
pruebas usan únicamente claves temporales de laboratorio y no modifican el bundle
de producción ni incorporan una clave destinataria.

La prueba comprueba también las tres hojas de estilo, la decodificación de imágenes,
las siete fuentes y las familias tipográficas realmente utilizadas para el título y
el texto. Recoge violaciones de CSP: la única permitida en la prueba es el bloqueo
intencionado de un envío HTML nativo. Los POST cifrados mediante JavaScript siguen
la directiva `connect-src 'self'`, por lo que `form-action 'none'` no los bloquea.

Netlify utiliza el mismo procedimiento en `netlify.toml`, con Node 22 y la versión
Hugo ya declarada por el proyecto. El build prepara archivos; no activa Forms ni
configura un destinatario por sí mismo.

Antes de publicar y periódicamente, revisar `npm audit --omit=dev`, `npm outdated`
y los avisos oficiales de OpenPGP.js. Actualizar versiones y lockfile de manera
revisada; volver a empaquetar y repetir pruebas de cifrado, red y descifrado. No
cargar versiones flotantes o un CDN en el navegador. No editar el bundle generado
a mano ni conservar copias desactualizadas del flujo de contacto anterior.

## Netlify Forms y notificaciones: acciones pendientes

Con autorización para un despliegue de prueba, después de verificar
la clave:

1. En el proyecto de Netlify, abrir Forms y habilitar la detección de formularios.
2. Desplegar el HTML completo y confirmar que Netlify detectó `contacto-cifrado`.
   Verificar los nombres de los campos: no deben existir nombre, correo, asunto ni
   mensaje legibles como campos del formulario recibido por Netlify.
3. Configurar la notificación de nuevas consultas a
   `lasnotasdevero@protonmail.com` desde Forms / Submission notifications.
   El asunto de la notificación debe ser genérico, sin datos del visitante.
4. Conservar el honeypot y el filtrado antispam de Netlify. Comprobar en la prueba
   real que el bloque cifrado no sea clasificado como spam o truncado.
5. Comprobar la aplicación efectiva de la CSP y demás encabezados de Contacto.
   Su configuración local no demuestra por sí sola su aplicación en producción.

Una respuesta HTTP exitosa al POST es la condición de confirmación en la interfaz.
La captura en Forms debe verificarse en el ensayo real: la respuesta no demuestra
por sí sola recepción en Proton ni descifrado. Los rechazos, redirecciones, errores
de red o cifrado conservan los controles y no muestran confirmación. No hay
reintentos automáticos. Ante resultado incierto, revisar Forms antes de reenviar
para evitar duplicados.

## Descifrado de la notificación

Una notificación de Netlify que contiene un campo con texto ASCII-armored **no es
necesariamente un mensaje PGP/MIME**. No se asume que Proton lo descifre de manera
automática. Hay que probar la notificación real con la clave verificada.

Si Proton no la descifra automáticamente, el bloque cifrado puede recuperarse de
Forms o de la notificación, desde `-----BEGIN PGP MESSAGE-----` hasta
`-----END PGP MESSAGE-----`, conservando sus saltos de línea. No copiar etiquetas
HTML, entidades escapadas ni texto ajeno al bloque.

Procedimiento alternativo únicamente para un entorno local confiable de la autora
que **ya tenga acceso seguro a la clave privada correspondiente**:

1. Guardar solo el bloque cifrado como `consulta.asc` en ese entorno.
2. Usar un cliente OpenPGP local confiable. Por ejemplo, con GnuPG y su llavero ya
   configurado, ejecutar localmente `gpg --decrypt consulta.asc`.
3. Introducir cualquier autorización de la clave solo en el mecanismo local del
   cliente; no enviarla a Codex, Netlify, herramientas web o terceros.
4. Comprobar que el JSON recuperado contiene exactamente los cuatro valores.
   Evitar sincronizar o compartir la salida legible y los registros del terminal.

Este procedimiento no requiere que nos compartas la clave privada ni instrucciones
para exportarla. Si esa clave solo está disponible dentro de Proton y no funciona
el descifrado automático, el procedimiento local no está disponible: **dejar la
integración sin publicar** hasta acordar y verificar una recepción compatible.
No usar páginas web de descifrado que pidan la clave privada.

## Comprobaciones y criterios de salida

Las pruebas automatizadas generan claves sintéticas temporales, solo en memoria,
para una dirección reservada `@example.invalid`. No son claves de Proton ni se
incorporan al sitio como destinatario. Sus descifrados no prueban que la autora
pueda descifrar una consulta real.

Verificar antes de autorizar publicación:

- Build Hugo y bundle local; dependencia criptográfica sin avisos conocidos.
- Solicitudes de red con solo los tres campos permitidos y bloque cifrado.
- Ausencia de transmisión de los cuatro valores originales, cookies del navegador
  y scripts externos en Contacto.
- JavaScript deshabilitado; clave ausente, inválida, revocada, caducada o con huella
  diferente; cifrado fallido: cero solicitudes de envío.
- Validación, tamaños, errores, teclado, foco y pantallas móviles.
- Captura real en Netlify Forms y notificación en Proton tras envío autorizado.
- Descifrado real por la autora y comparación exacta de nombre, correo, asunto y
  mensaje. **Pendiente obligatorio: sin este resultado no se da por terminada la
  integración ni se publica para visitantes.**

## Documentación oficial

- https://github.com/openpgpjs/openpgpjs/releases
- https://docs.openpgpjs.org/Key.html
- https://proton.me/support/download-public-private-key
- https://proton.me/support/pgp-mime-pgp-inline
- https://docs.netlify.com/manage/forms/setup/
- https://docs.netlify.com/manage/forms/notifications/
- https://docs.netlify.com/manage/forms/spam-filters/
- https://docs.netlify.com/manage/security/content-security-policy/
