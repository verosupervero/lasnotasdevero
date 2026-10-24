# App Check: preparación y ensayo

Estado al 24 de octubre de 2026: App Check del cliente está habilitado en producción `lnv-data`, despliegue `6adc3e9fa00c0635b0b49e56`, listo, publicado y verificado por HTTP. La titular confirmó el número de proyecto `303954316495`, API habilitada y registro de la clave terminada en `T9W2F`. Tanto el preflight como el diagnóstico con la configuración ya publicada obtuvieron un token válido y HTTP 200, sin login, consultas a Firestore, registro de tokens ni cambios IAM. No se modificó la exigencia remota de App Check. La causa precisa de los rechazos anteriores no se determinó; una demora en aplicar cambios es una hipótesis. Falta probar un guardado autenticado en el dominio principal. Ver [revisión de preparación](production-readiness.md). Lo siguiente conserva el historial de ensayos anteriores.

Despliegue de ensayo: `6adc2401e92863b31c3aa4c2`, en la [misma guía de prueba](https://lucas-firebase-test-20261023--lasnotasdevero.netlify.app/estudios/guia-estudio-lucas/). Netlify confirmó `ready`, sin build remoto, Functions ni Edge Functions y sin modificar la publicación principal. HTTP comprobó proyecto, proveedor, clave pública coincidente y CSP con los orígenes adicionales. Esa comprobación no obtiene un token ni demuestra que Google acepte la atestación; eso requiere iniciar sesión y probar el progreso desde el navegador real. La consola remota de Firebase no se consultó con acceso administrativo: el estado de exigencia se basa en la confirmación de la titular.

### Diagnóstico del primer ensayo

**Resultado posterior a la corrección:** la titular confirmó que guardó la clave nueva en Firebase App Check. El primer intento inmediato conservó el rechazo anterior; tras dejar un margen, el siguiente obtuvo un token válido y el intercambio `exchangeRecaptchaEnterpriseToken` devolvió HTTP 200. La prueba usó un perfil temporal, sin login, lecturas/escrituras Firestore ni registro de tokens. No requirió cambios IAM. El resultado es compatible con que el cambio recién guardado tardara en reflejarse, pero no se determina un plazo de propagación garantizado. Quedan pendientes las pruebas autenticadas del progreso y cualquier ensayo futuro de exigencia, que continúa sin habilitarse desde esta implementación. No confundir los rechazos históricos relatados abajo con el estado final de esta comprobación.

Actualización posterior del 24 de octubre: la titular confirmó que la API ya muestra «Administrar» y que la clave anterior no aparecía al seleccionar `lnv-test`. Entregó una nueva clave pública, terminada en `QjZxG`. Se reemplazó únicamente en la configuración ignorada del ensayo y se publicó el borrador `6adc28d99a488f646fae86a7`; Hugo generó 320 páginas, la revisión verificó aislamiento de proyectos y HTTP confirmó recursos reales con producción apagada. Una comprobación adicional sin login ni Firestore sigue devolviendo HTTP 400 / `FAILED_PRECONDITION`. Queda confirmar que la titular reemplazó y guardó también la clave en el proveedor reCAPTCHA Enterprise de la aplicación web de Firebase App Check; cambiar la clave del cliente no modifica ese registro remoto. No se considera resuelto el fallo.

La titular informó que el ingreso Google funciona pero falla la comprobación del avance. Dos intentos de diagnóstico de App Check desde un perfil temporal, sin login ni consultas Firestore, reprodujeron el rechazo antes de consultar progreso. El segundo permitió recuperar el cuerpo de error: HTTP 400, `FAILED_PRECONDITION`, con el mensaje de Google: `Unable to call the reCAPTCHA Enterprise CreateAssessment method; ensure that the reCAPTCHA Enterprise API is enabled and that the site key is from the same project as the one containing this app.`

El intercambio llegó a `content-firebaseappcheck.googleapis.com` para la app de `lnv-test`. No se observó un bloqueo CSP de reCAPTCHA/App Check en esa reproducción. La API exige habilitar reCAPTCHA Enterprise en el mismo proyecto y que la clave pertenezca a ese proyecto; el mensaje no permite decidir cuál de esas dos condiciones falta. Debe comprobarlo la titular en su consola antes de repetir el ensayo. No se modificaron reglas, planes ni datos de estudiantes. El aviso de CSS por el recurso antiguo `font-awesome.min.css` es independiente de este rechazo.

## Configuración que realiza la titular

1. Seleccionar **lnv-test**, confirmar **Spark** y ninguna cuenta de facturación vinculada. No seleccionar `lnv-data`.
2. En Google Cloud → reCAPTCHA/Fraud Defense, crear una clave para sitio web **basada en puntuación**, sin casilla de desafío. Si solicita vincular facturación, detenerse y revisar el mensaje; no aceptarla.
3. Autorizar únicamente `lucas-firebase-test-20261023--lasnotasdevero.netlify.app`, sin protocolo ni ruta. No habilitar todos los dominios ni agregar dominios ajenos.
4. En Firebase → App Check → aplicación web de `lnv-test`, registrar la clave con el proveedor **reCAPTCHA Enterprise**. Mantener inicialmente el TTL predeterminado de una hora; no reducirlo para acelerar el ensayo.
5. Dejar **desactivada la exigencia para Firestore**. No activar protección de Authentication u otros productos durante este ensayo.
6. Enviar al responsable del código únicamente la **clave pública de sitio** y confirmar Spark, ausencia de facturación y exigencia desactivada. No enviar claves secretas, tokens de depuración ni cuentas de servicio.

El procedimiento se apoya en la [configuración oficial de App Check para web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider). La interfaz de consola puede cambiar; los nombres anteriores identifican las funciones, no garantizan una ubicación exacta de menú.

## Configuración del código

La configuración de vista previa admite este campo junto a `firebase`, fuera de su objeto:

```json
{
  "appCheck": {
    "enabled": true,
    "provider": "recaptcha-enterprise",
    "siteKey": "CLAVE_PUBLICA_REAL_DEL_SITIO"
  }
}
```

Es un fragmento explicativo, no un archivo listo para publicar ni una clave válida. No se incluye una clave ficticia en un despliegue. El objeto completo sigue necesitando `enabled` y la configuración pública Firebase. La implementación solo acepta los IDs exactos `lnv-test` y `lnv-data`; la herramienta de preview se limita a `lnv-test`. `study_app_check_enabled = false` continúa siendo el valor de la configuración Hugo base y todos los flags de producción siguen en `false`.

`assets/js/study-app-check.js` carga el SDK al realizar la primera operación autenticada sobre datos, solicita un token y permite reutilizarlo mediante el SDK. La renovación automática periódica propia de App Check está desactivada. Solicitudes simultáneas comparten la misma obtención en curso. No hay token de depuración ni bypass en el build real. Los errores HTTP 429 reconocidos se tratan como cuota; los 403 como rechazo de acceso; los fallos de red conservan el manejo local de recuperación. Esto no es un limitador de solicitudes del lado del servidor.

La CSP incorpora los orígenes precisos de reCAPTCHA y App Check solamente en el build habilitado. Ni esta preparación ni la publicación de los recursos estáticos activa servicios, modifica reglas remotas o impone verificación de tokens en Firebase.

## Ensayo antes de exigir App Check

- Publicar únicamente en la misma URL de ensayo, con `lnv-test`. Verificar que producción conserva `enabled: false` y que no se desplegaron Functions.
- Con las dos cuentas de prueba, comprobar ingreso, combinación de avances, actualización, F5, cambio de dispositivo, exportación/importación y borrado. Usar perfiles de prueba; nunca automatizar contra datos de estudiantes.
- Revisar errores del navegador y las métricas de App Check de Firestore. Confirmar solicitudes válidas en los navegadores/dispositivos usados. Las métricas pueden tardar en aparecer.
- Probar fallos de red y bloqueadores: se conserva el avance local y no se hacen reintentos ilimitados. Un fallo no debe interpretarse como una cuenta sin progreso.
- Observar consumo de Firestore y evaluaciones de reCAPTCHA durante un período representativo. No agotar deliberadamente cuotas para probar el límite.
- Mantener la exigencia desactivada hasta revisar resultados. Cuando se autorice un ensayo de exigencia, comprobar en `lnv-test` que una solicitud sin token es rechazada aunque tenga identidad válida, y que la aplicación legítima sigue funcionando. Las reglas de propietario deben seguir rechazando el acceso de una cuenta al avance de otra.

Los emuladores comprueban reglas, aislamiento de cuentas y transacciones, pero no reproducen la atestación real ni la facturación/cuotas del proveedor. Los tests de App Check usan un SDK simulado y no consumen evaluaciones reales.

## Costos, límites y reversión

El nivel gratuito de reCAPTCHA contempla **10.000 evaluaciones mensuales por organización**, compartidas entre sus proyectos/sitios. Una evaluación no equivale a cada clic ni a cada lectura de Firestore: el token puede reutilizarse. Sin facturación, superar el cupo puede rechazar evaluaciones y detener la sincronización, aunque el progreso local siga funcionando. Vincular facturación puede cambiar las condiciones económicas: no hacerlo. Consultar [límites y facturación oficiales](https://docs.cloud.google.com/recaptcha/docs/billing-information).

App Check agrega una barrera frente a clientes no reconocidos; no sustituye Authentication, las reglas por UID ni una política de cuotas. No garantiza detener a un usuario legítimo malicioso ni preservar disponibilidad bajo ataque.

Si alguna vez se habilita la exigencia y hay problemas, **desactivarla primero en Firestore**; después se puede deshabilitar el cliente y reconstruir el borrador. Quitar únicamente el código mientras Firestore exige tokens bloquearía la sincronización de todos los clientes. No hay cambios de producción autorizados en este procedimiento.
