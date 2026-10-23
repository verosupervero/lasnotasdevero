import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = name => resolve(root, name);

const coursesSource = await readFile(path('firebase/courses.json'), 'utf8');
const courses = JSON.parse(coursesSource);
if (!courses || Array.isArray(courses) || typeof courses !== 'object' || !Object.keys(courses).length || Object.values(courses).some(directory => typeof directory !== 'string' || !directory)) throw Error('Courses must map IDs to content directories');
// JSON.parse silently accepts duplicate keys; reject them before they can hide a course.
const courseNames = [...coursesSource.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(match => JSON.parse(match[1]));
if (new Set(courseNames).size !== courseNames.length) throw Error('Duplicate course ID');
const catalog = Object.create(null);
const attrs = text => Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const safeId = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/') && !['__proto__','prototype','constructor'].includes(id);
for (const [course, directory] of Object.entries(courses)) {
  if (!/^[a-z0-9-]{1,64}$/.test(course) || !safeId(course) || Object.hasOwn(catalog,course)) throw Error('Invalid or duplicate course');
  catalog[course] = Object.create(null);
  const questionIds = new Set();
  for (const file of (await readdir(path(directory))).filter(f => f.endsWith('.md')).sort()) {
    const text = await readFile(path(`${directory}/${file}`), 'utf8');
    const video = [...text.matchAll(/\{\{<\s*study-video\s+([^>]+)>\}\}/g)];
    if (!video.length) continue;
    if (video.length !== 1) throw Error(`Multiple classes: ${file}`);
    const lesson = attrs(video[0][1]);
    const blocks = [...text.matchAll(/\{\{<\s*study-question\s+([^>]+)>\}\}/g)].map(m => attrs(m[1]));
    if (!safeId(lesson.id) || Object.hasOwn(catalog[course], lesson.id)) throw Error(`Invalid or duplicate class in ${file}`);
    const bibliographyAnchor = text.match(/^bibliography_anchor\s*=\s*"([^"]+)"/m)?.[1];
    if (lesson.anchor !== undefined && !safeId(lesson.anchor) || bibliographyAnchor !== undefined && !safeId(bibliographyAnchor)) throw Error(`Invalid anchor in ${file}`);
    for (const block of blocks) {
      if (!safeId(block.id) || !safeId(block.anchor) || questionIds.has(block.id)) throw Error(`Invalid or duplicate question in ${file}`);
      questionIds.add(block.id);
    }
    catalog[course][lesson.id] = { questions: blocks.map(q => q.id), points: [...new Set([lesson.id, lesson.anchor, bibliographyAnchor, ...blocks.map(q => q.anchor)].filter(Boolean))] };
  }
}
const quoted = value => JSON.stringify(value);
const optional = (field, expression, object = 'd') => `(!('${field}' in ${object}) || (${expression}))`;
const classValidators = [], classBranches = [], headerBranches = [];
let index = 0;
for (const [course, lessons] of Object.entries(catalog)) {
  const ids = Object.keys(lessons);
  headerBranches.push(`(course == ${quoted(course)} && ${optional('selected', `stringLeaf(d.selected) && d.selected.value in ${quoted(ids)}`)})`);
  for (const [id, lesson] of Object.entries(lessons)) {
    const name = `lesson${index++}`;
    classValidators.push(`function ${name}(d) { return d.blocks.keys().hasOnly(${quoted(lesson.questions)}) && ${lesson.questions.map(q => optional(q, `boolLeaf(d.blocks[${quoted(q)}])`, 'd.blocks')).join(' && ') || 'true'} && ${optional('lastPoint', `stringLeaf(d.lastPoint) && d.lastPoint.value in ${quoted(lesson.points)}`)}; }`);
    classBranches.push(`(course == ${quoted(course)} && lesson == ${quoted(id)} && ${name}(d))`);
  }
}
const rules = `// Generated from firebase/courses.json and the unchanged study Markdown.
rules_version = '2';
service cloud.firestore {
 match /databases/{database}/documents {
  function owner(uid) { return request.auth != null && request.auth.uid == uid && request.auth.token.email_verified == true && request.auth.token.firebase.sign_in_provider == 'google.com'; }
  function unlocked(uid) { return !exists(/databases/$(database)/documents/students/$(uid)); }
  function clock(t) { return t is int && t >= 0 && t <= request.time.toMillis() + 300000; }
  function leaf(d) { return d is map && d.keys().hasOnly(['value','updatedAt']) && d.keys().hasAll(['value','updatedAt']) && clock(d.updatedAt); }
  function boolLeaf(d) { return leaf(d) && d.value is bool; }
  function numberLeaf(d) { return leaf(d) && clock(d.value); }
  function stringLeaf(d) { return leaf(d) && d.value is string && d.value.size() <= 200; }
  function generation(g) { return g is string && g.matches('^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'); }
  function known(course) { return course in ${quoted(Object.keys(catalog))}; }
  function header(d, course) { return d.keys().hasOnly(['schema','revision','generation','resetCount','deleted','updatedAt','selected','lastActivity']) && d.keys().hasAll(['schema','revision','generation','resetCount','deleted','updatedAt']) && d.schema == 1 && d.revision is int && d.revision >= 1 && d.revision <= 2147483647 && d.resetCount is int && d.resetCount >= 0 && d.resetCount <= d.revision && d.deleted is bool && generation(d.generation) && d.updatedAt == request.time && ${optional('lastActivity', 'numberLeaf(d.lastActivity)')} && (${headerBranches.join(' || ')}) && (!d.deleted || (!('selected' in d) && !('lastActivity' in d))); }
  function transition(d, old) { return d.revision == old.revision + 1 && ((d.deleted && d.resetCount == old.resetCount + 1 && d.generation != old.generation) || (!d.deleted && d.resetCount == old.resetCount && d.generation == old.generation)); }
  ${classValidators.join('\n  ')}
  function classData(d, course, lesson) { return d.keys().hasOnly(['schema','generation','blocks','complete','lastPoint','lastActivity']) && d.keys().hasAll(['schema','generation','blocks']) && d.schema == 1 && generation(d.generation) && d.blocks is map && ${optional('complete', 'boolLeaf(d.complete)')} && ${optional('lastActivity', 'numberLeaf(d.lastActivity)')} && (${classBranches.join(' || ')}); }
  match /students/{uid} {
   allow read: if owner(uid);
   allow create: if owner(uid) && request.resource.data.keys().hasOnly(['schema','erasedAt']) && request.resource.data.schema == 1 && request.resource.data.erasedAt == request.time;
   allow update, delete: if false;
   match /guides/{course} {
    allow read: if owner(uid) && known(course);
    allow create: if owner(uid) && unlocked(uid) && known(course) && header(request.resource.data, course) && request.resource.data.revision == 1 && request.resource.data.resetCount == (request.resource.data.deleted ? 1 : 0);
    allow update: if owner(uid) && unlocked(uid) && known(course) && header(request.resource.data, course) && transition(request.resource.data, resource.data);
    allow delete: if owner(uid) && !unlocked(uid);
    match /classes/{lesson} {
     allow read: if owner(uid) && known(course);
     allow create, update: if owner(uid) && unlocked(uid) && classData(request.resource.data, course, lesson) && !getAfter(/databases/$(database)/documents/students/$(uid)/guides/$(course)).data.deleted && request.resource.data.generation == getAfter(/databases/$(database)/documents/students/$(uid)/guides/$(course)).data.generation && getAfter(/databases/$(database)/documents/students/$(uid)/guides/$(course)).data.updatedAt == request.time;
     allow delete: if owner(uid) && (!unlocked(uid) || (getAfter(/databases/$(database)/documents/students/$(uid)/guides/$(course)).data.deleted && getAfter(/databases/$(database)/documents/students/$(uid)/guides/$(course)).data.updatedAt == request.time));
    }
   }
  }
 }
}
`;
await mkdir(path('firebase/generated'), { recursive: true });
await writeFile(path('firebase/generated/catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(path('firebase/firestore.rules'), rules);
await build({ entryPoints: [path('assets/js/study-firebase-provider.js')], outfile: path('static/js/study-firebase.bundle.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof', define: { __STUDY_CATALOG__: JSON.stringify(catalog) } });
await writeFile(path('static/js/study-firebase.LICENSE.txt'), await readFile(path('firebase/licenses/firebase-Apache-2.0.txt'), 'utf8'));
await mkdir(path('static/js/vendor'), { recursive: true });
await writeFile(path('static/js/vendor/html2canvas-1.4.1.min.js'), await readFile(path('node_modules/html2canvas/dist/html2canvas.min.js')));
await writeFile(path('static/js/vendor/html2canvas-1.4.1.LICENSE.txt'), await readFile(path('node_modules/html2canvas/LICENSE')));
console.log(`Firebase rules and browser bundle generated for ${Object.keys(catalog).join(', ')}`);
