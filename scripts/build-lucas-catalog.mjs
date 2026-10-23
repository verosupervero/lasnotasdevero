import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('content/estudios/guia-estudio-lucas');
const catalog = Object.create(null), questions = new Set();
const attributes = source => Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const safe = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !['__proto__', 'prototype', 'constructor'].includes(id);
for (const file of (await readdir(directory)).filter(name => name.endsWith('.md')).sort()) {
  const source = await readFile(resolve(directory, file), 'utf8');
  const lessons = [...source.matchAll(/\{\{<\s*study-video\s+([^>]+)>\}\}/g)];
  if (!lessons.length) continue;
  if (lessons.length !== 1) throw Error(`Expected one study-video in ${file}`);
  const lesson = attributes(lessons[0][1]);
  if (!safe(lesson.id) || Object.hasOwn(catalog, lesson.id)) throw Error(`Invalid/duplicate class ID in ${file}`);
  const blocks = [...source.matchAll(/\{\{<\s*study-question\s+([^>]+)>\}\}/g)].map(match => attributes(match[1]));
  for (const block of blocks) {
    if (!safe(block.id) || !safe(block.anchor) || questions.has(block.id)) throw Error(`Invalid/duplicate question in ${file}`);
    questions.add(block.id);
  }
  const bibliographyAnchor = source.match(/^bibliography_anchor\s*=\s*"([^"]+)"/m)?.[1];
  catalog[lesson.id] = { questions: blocks.map(block => block.id), points: [...new Set([lesson.id, lesson.anchor, bibliographyAnchor, ...blocks.map(block => block.anchor)].filter(Boolean))] };
}
if (!Object.keys(catalog).length || Object.keys(catalog).length > 32 || questions.size > 256) throw Error('Unexpected Lucas catalog bounds');
const output = resolve('netlify/generated');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'lucas-catalog.mjs'), `// Generated from study Markdown. Do not edit.\nexport default ${JSON.stringify(catalog, null, 2)};\n`);
console.log(`Lucas catalog: ${Object.keys(catalog).length} studies, ${questions.size} question blocks`);
