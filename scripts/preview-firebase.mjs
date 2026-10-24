import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAppCheckConfig } from '../assets/js/study-app-check.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = ['apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId'];
const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const within = (directory, target) => {
  const child = relative(directory, target);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

export function parseArguments(args) {
  const options = { port: 1314, serve: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--config', '--project', '--port', '--serve'].includes(flag) || seen.has(flag)) throw Error(`Argumento desconocido o repetido: ${flag}`);
    seen.add(flag);
    if (flag === '--serve') options.serve = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw Error(`Falta un valor para ${flag}.`);
      options[flag.slice(2)] = value;
    }
  }
  if (!options.config || !options.project) throw Error('Se requieren --config y --project del proyecto Spark de pruebas separado. No se activó ni construyó nada.');
  if (!/^\d+$/.test(String(options.port)) || Number(options.port) < 1024 || Number(options.port) > 65535) throw Error('--port debe ser un entero entre 1024 y 65535.');
  options.port = Number(options.port);
  return options;
}

export function validateConfig(input, project, production) {
  if (!projectPattern.test(project) || project.startsWith('demo-')) throw Error('--project debe identificar un proyecto Firebase real de pruebas (6–30 caracteres); demo- queda reservado a los emuladores.');
  if (!object(production) || ['projectId', 'apiKey', 'appId'].some(key => typeof production[key] !== 'string' || !production[key]) || project === production.projectId) throw Error('La vista de prueba no admite el proyecto de producción. Creá un proyecto Spark separado, sin facturación.');
  if (!object(input)) throw Error('La configuración debe ser un objeto JSON público de Firebase.');
  let config = input;
  if (Object.hasOwn(input, 'firebase')) {
    if (Object.keys(input).some(key => !['enabled', 'firebase', 'appCheck'].includes(key)) || input.enabled !== false) throw Error('El envoltorio solo admite enabled: false, firebase y appCheck opcional.');
    config = input.firebase;
    validateAppCheckConfig(input.appCheck, config?.projectId);
  }
  if (!object(config) || Object.keys(config).some(key => !allowed.includes(key))) throw Error(`Solo se admiten campos públicos: ${allowed.join(', ')}. No ingreses claves privadas, cuentas de servicio ni tokens.`);
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (typeof config[key] !== 'string' || !config[key] || config[key].length > 200) throw Error(`Campo público faltante o inválido: ${key}.`);
  }
  if (config.projectId !== project || config.authDomain !== `${project}.firebaseapp.com`) throw Error('projectId, --project y authDomain deben corresponder al mismo proyecto de pruebas.');
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(config.apiKey)) throw Error('apiKey debe tener el formato de una API key web pública de Firebase.');
  const app = /^1:([0-9]{1,20}):web:([a-f0-9]{16,64})$/.exec(config.appId);
  if (!app) throw Error('appId debe identificar una app web de Firebase.');
  if (config.apiKey === production.apiKey || config.appId === production.appId || app[1] === production.appId.split(':')[1]) throw Error('La configuración mezcla datos de pruebas con credenciales públicas del proyecto de producción. Copiá todos los valores desde la app web del proyecto de pruebas.');
  if (config.messagingSenderId !== undefined && (typeof config.messagingSenderId !== 'string' || config.messagingSenderId !== app[1])) throw Error('messagingSenderId debe coincidir con el número de proyecto de appId.');
  return Object.fromEntries(allowed.filter(key => config[key] !== undefined).map(key => [key, config[key]]));
}

export function previewToml(source, port, appCheckEnabled = false) {
  let output = source;
  const replacements = {
    baseURL: `"http://localhost:${port}/"`,
    lucas_sync_enabled: 'false',
    study_sync_enabled: 'true',
    study_sync_provider: '"firebase"',
    study_app_check_enabled: String(appCheckEnabled === true),
    study_private_storage: 'true'
  };
  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`^([ \\t]*${key}[ \\t]*=[ \\t]*)[^\\r\\n]+`, 'gm');
    if ([...output.matchAll(pattern)].length !== 1) throw Error(`La configuración Hugo cambió: se esperaba una sola definición de ${key}. No se construyó la vista.`);
    output = output.replace(pattern, (_, prefix) => `${prefix}${value}`);
  }
  return output;
}

export function run(command, args, options) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? accept() : reject(Error(`La construcción falló (${command}, código ${code}).`)));
  });
}

export async function buildPreview(options, { repository = root, execute = run } = {}) {
  // Validate everything before running builds or creating an enabled configuration.
  const sourcePath = resolve(repository, options.config);
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size > 8192) throw Error('La configuración debe ser un archivo JSON de hasta 8 KiB.');
  let input;
  try { input = JSON.parse(await readFile(sourcePath, 'utf8')); }
  catch { throw Error('El archivo debe contener JSON válido, sin const, comentarios ni código JavaScript.'); }
  const production = JSON.parse(await readFile(resolve(repository, 'static/config/firebase.json'), 'utf8'));
  const firebase = validateConfig(input, options.project, production?.firebase);
  const appCheck = validateAppCheckConfig(input.appCheck, firebase.projectId);
  const toml = previewToml(await readFile(resolve(repository, 'config/_default/config.toml'), 'utf8'), options.port, !!appCheck);
  const base = resolve(repository, '.contact-test-output/firebase-preview');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(resolve(base, `${options.project}-`));
  const destination = resolve(directory, 'site');
  if (!within(base, destination)) throw Error('La salida de prueba debe permanecer en .contact-test-output/firebase-preview.');
  const configPath = resolve(directory, 'preview.toml');
  const configDirectory = resolve(directory, 'empty-config');
  await mkdir(configDirectory);
  await writeFile(configPath, toml);
  // Do not allow Hugo environment overrides to redirect output or override safety flags.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('HUGO_')));
  const executionOptions = { cwd: repository, env };
  await execute(process.execPath, [resolve(repository, 'scripts/build-firebase.mjs')], executionOptions);
  await execute('hugo', ['--config', configPath, '--configDir', configDirectory, '--destination', destination, '--baseURL', `http://localhost:${options.port}/`, '--minify'], executionOptions);
  await mkdir(resolve(destination, 'config'), { recursive: true });
  await writeFile(resolve(destination, 'config/firebase.json'), JSON.stringify({ enabled: true, firebase, ...(appCheck ? { appCheck } : {}) }, null, 2) + '\n');
  return destination;
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

export function previewHandler(boundary, port) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(request.headers.host)) { response.writeHead(403); response.end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    try {
      // Never expose the surrounding temporary folder, source files or directory listings.
      const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..' || part === '.')) throw Error('Invalid path');
      const candidate = resolve(boundary, `.${pathname}`, ...(pathname.endsWith('/') ? ['index.html'] : []));
      if (!within(boundary, candidate)) throw Error('Invalid path');
      let file = await realpath(candidate);
      if (!within(boundary, file)) throw Error('Invalid path');
      if ((await stat(file)).isDirectory()) {
        file = await realpath(resolve(file, 'index.html'));
        if (!within(boundary, file)) throw Error('Invalid path');
      }
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('No encontrado');
    }
  };
}

export async function servePreview(directory, port) {
  const boundary = await realpath(directory);
  const server = createServer(previewHandler(boundary, port));
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  return server;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const destination = await buildPreview(options);
  console.log(`Vista de prueba: ${destination}\nProducción permanece desactivada. No se publicaron reglas ni archivos.`);
  if (options.serve) {
    const server = await servePreview(destination, options.port);
    console.log(`Abrí http://localhost:${options.port}/estudios/guia-estudio-lucas/ (solo esta computadora). Ctrl+C para detener.`);
    const stop = () => server.close(() => process.exit(0));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } else console.log('Para construir y servir la vista local, repetí el comando con --serve.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
