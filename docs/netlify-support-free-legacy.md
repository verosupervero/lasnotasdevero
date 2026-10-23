# Consulta preparada para Netlify Support — Free Legacy

> Borrador de la arquitectura anterior, conservado y no enviado. La decisión posterior es utilizar Firebase Spark para la sincronización, por lo que esta consulta no es un requisito de activación del proveedor nuevo.

Borrador local preparado el 23 de octubre de 2026. No enviado. No adjuntar tokens, claves, contraseñas, respaldos ni progreso de estudiantes.

**Asunto: confirmar costo adicional $0 y límites de Blobs/Functions/Identity sin salir de Free Legacy**

Nuestro sitio es `lasnotasdevero.com`, proyecto `lasnotasdevero`. La cuenta está en Free Legacy (`free-is-free`, creada antes del 4 de septiembre de 2025). No autorizamos una migración de plan, recargas automáticas, servicios de correo pagos ni complementos facturables.

Queremos evaluar una sincronización opcional de progreso de estudio con Netlify Identity, Functions y Blobs. Solo guardaríamos identificadores de clases y preguntas, estados de avance y fechas; no respuestas personales. La implementación está conservada localmente, excluida de Functions y no publicada. Necesitamos respuestas aplicables específicamente a nuestra cuenta Legacy, no a los planes actuales por créditos.

## Costos y cuotas de Blobs

1. ¿Netlify Blobs está incluido con costo adicional $0 en nuestra cuenta Free Legacy? ¿Requiere habilitar algún complemento, registrar un medio de pago o migrar de plan? ¿Hay diferencias entre disponibilidad técnica y cobertura gratuita?
2. ¿Cuáles son exactamente las cuotas gratuitas de almacenamiento total, número de objetos y stores, tamaño por objeto y cantidad mensual de lecturas, escrituras, listados y eliminaciones? ¿Se miden por sitio o por equipo y cuándo se reinician? Indiquen también las restricciones de concurrencia o solicitudes por segundo.
3. ¿Las lecturas con consistencia fuerte, `getWithMetadata`, las escrituras condicionales `onlyIfMatch`/`onlyIfNew` y sus conflictos, las claves de rate limiting y las revisiones privadas se contabilizan de forma diferente? ¿Qué costos o cuotas tienen las lecturas administrativas con el SDK para crear copias cifradas locales?
4. ¿Cómo se computa la transferencia entre Functions y Blobs y la transferencia al navegador? ¿Se comparte con los 100 GB mensuales de Legacy? ¿Existe algún cargo por solicitudes o almacenamiento independiente del cupo de transferencia?
5. ¿Blobs sigue sujeto a condiciones gratuitas de beta en nuestra cuenta? Si cambian esas condiciones, ¿con qué antelación se notifica y podemos mantener o retirar nuestros datos sin aceptar facturación ni migración automática? Faciliten la documentación contractual vigente.

## Excesos, tráfico automatizado y disponibilidad

6. Si alcanzamos una cuota de Blobs, Functions o transferencia, ¿qué ocurre exactamente en Free Legacy: se rechaza solo esa operación, se deshabilita el servicio, se pausa el sitio o se pausa todo el equipo? ¿Puede generarse algún cargo sin una aceptación expresa? ¿Cómo garantizamos un límite de gasto adicional de $0?
7. ¿Podemos fijar gratuitamente límites mensuales estrictos de invocaciones y operaciones de almacenamiento que detengan únicamente la sincronización y mantengan disponible el sitio estático? ¿Existen alertas gratuitas y suficientemente anticipadas? ¿Cuál es el alcance real de la protección contra abuso/DDoS en este plan?
8. Confirmen las 125.000 invocaciones mensuales por sitio y el límite de cómputo aplicable a nuestra cuenta. ¿Cómo se cuentan sesiones fallidas, respuestas 401/403/404/429/503, solicitudes OPTIONS/HEAD, acceso por la ruta directa `/.netlify/functions/…`, solicitudes de bots y peticiones bloqueadas por rate limiting antes de ejecutar el handler? ¿Las invocaciones en deploy previews o branch deploys comparten la cuota de producción?
9. ¿Dónde podemos consultar el consumo total actual y por función, incluidos servicios internos como `emails`, sin activar una herramienta paga? ¿Las reglas gratuitas de rate limiting tienen demora de aplicación y pueden limitar globalmente el consumo mensual, o solo tasas por IP/dominio?

## Identity y restricciones de uso

10. El panel ofrece Identity a $0. ¿Qué límites de usuarios activos, altas, sesiones, confirmaciones y recuperación de correo se aplican específicamente a nuestro Free Legacy? ¿Se pausa automáticamente al agotarlos, sin cargos? Necesitamos conservar la confirmación de correo y usar exclusivamente el correo gratuito de Netlify.
11. ¿Podemos usar Blobs privados con claves derivadas del usuario verificado en Functions para progreso educativo vinculado a una cuenta? ¿Qué garantías y restricciones aplican a autenticación, acceso administrativo, cifrado en reposo, ubicación de los datos y eliminación? ¿Cuánto retiene Netlify datos o copias internas después de borrarlos? ¿Hay un DPA disponible sin contratar un plan pago?

## Volumen que necesitamos evaluar

Como hipótesis: 100 estudiantes, 12 sesiones mensuales y 55 llamadas por sesión dan 66.000 invocaciones mensuales. Un bot lento a una solicitud por minuto agrega 43.200; ambos suman 109.200 antes de las funciones actuales. Con reintentos de escritura y ese bot el escenario adverso alcanza 289.200. Reservamos 1 segundo y 1 GiB por invocación para planificar, sujetos a medición.

Para Blobs estimamos unas 264.000 operaciones con el escenario humano sin reintentos y alrededor de 11 MiB para perfiles y revisiones de 100 estudiantes, con margen adicional por crecimiento. Estos números no pretenden definir límites máximos del tráfico externo.

12. Con esos volúmenes y las restricciones anteriores, ¿qué configuración gratuita y verificable permite evitar tanto cargos adicionales como que esta funcionalidad agote los recursos compartidos del sitio? Si Free Legacy no permite aislar ese riesgo, por favor confírmenlo expresamente. Mantendremos la sincronización desactivada y utilizaremos progreso local con exportación/importación.

Solicitamos una respuesta por escrito, sin activar ni modificar servicios o el plan durante la consulta.
