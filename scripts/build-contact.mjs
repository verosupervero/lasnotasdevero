import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('static/js', { recursive: true });
await mkdir('static/styles', { recursive: true });
await build({
  entryPoints: ['assets/js/contact.js'],
  outfile: 'static/js/contact.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
});

// Host the same font families and weights locally so the contact page preserves
// the theme typography without contacting a font service.
const fontDirectory = 'static/fonts/contact';
await mkdir(fontDirectory, { recursive: true });
const fontFaces = [];
for (const { slug, family, weights } of [
  { slug: 'open-sans', family: 'Open Sans', weights: [400, 600, 700, 800] },
  { slug: 'poppins', family: 'Poppins', weights: [400, 600, 700] },
]) {
  const packageDirectory = `node_modules/@fontsource/${slug}`;
  await copyFile(`${packageDirectory}/LICENSE`, `${fontDirectory}/${slug}.LICENSE.txt`);
  for (const weight of weights) {
    const filename = `${slug}-latin-${weight}-normal.woff2`;
    await copyFile(`${packageDirectory}/files/${filename}`, `${fontDirectory}/${filename}`);
    fontFaces.push(`@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('/fonts/contact/${filename}') format('woff2');
}`);
  }
}

// Reuse the theme CSS without external imports on the contact page only.
// The original stylesheet and all other pages keep their existing presentation.
const baseCss = await readFile('static/styles/main.css', 'utf8');
const contactCss = baseCss
  .replace(/@import\s+[^;]+;/g, '')
  // The inherited texture is absent from the project; retain its other layers.
  .replaceAll('url("images/bg01.png")', 'none');
await writeFile('static/styles/contact-base.css', `${fontFaces.join('\n\n')}\n\n${contactCss}`);
await writeFile('static/js/contact-openpgp.LICENSE.txt', await readFile('node_modules/openpgp/LICENSE'));
