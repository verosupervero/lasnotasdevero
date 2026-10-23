import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithCredential, GoogleAuthProvider, deleteUser } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, terminate } from 'firebase/firestore';

// Fail before initializing any SDK if the test runner isn't attached to demo emulators.
const projectId = 'demo-lasnotasdevero';
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw Error('Only the explicitly configured loopback demo emulators may run these tests');
const catalog = JSON.parse(await readFile('../../firebase/generated/catalog.json','utf8')).lucas;
const classId = Object.keys(catalog)[0], question = catalog[classId].questions[0];
const generation = '00000000-0000-4000-8000-000000000001', secondGeneration = '00000000-0000-4000-8000-000000000002';
let env;
const claims = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const db = (uid, extra = claims) => env.authenticatedContext(uid, extra).firestore();
const headRef = (database, uid = 'student-a', course = 'lucas') => doc(database, 'students', uid, 'guides', course);
const classRef = (database, uid = 'student-a', id = classId) => doc(database, 'students', uid, 'guides', 'lucas', 'classes', id);
const header = (values = {}) => ({ schema: 1, generation, revision: 1, resetCount: 0, deleted: false, updatedAt: serverTimestamp(), ...values });
const lesson = (values = {}) => ({ schema: 1, generation, blocks: { [question]: { value: true, updatedAt: Date.now() } }, ...values });
async function create(database, uid = 'student-a', h = header(), c = lesson()) { const batch = writeBatch(database); batch.set(headRef(database,uid),h); batch.set(classRef(database,uid),c); return batch.commit(); }
before(async () => { env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('../../firebase/firestore.rules','utf8') } }); });
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await env?.cleanup(); });

test('Google verified owner writes and reads only own known guide', async () => {
 const a = db('student-a'); await assertSucceeds(create(a));
 assert.equal((await assertSucceeds(getDoc(headRef(a)))).data().revision,1);
 assert.equal((await assertSucceeds(getDoc(classRef(a)))).data().blocks[question].value,true);
});
test('anonymous, unverified and non-Google providers cannot write', async () => {
 await assertFails(create(env.unauthenticatedContext().firestore()));
 await assertFails(create(db('student-a',{...claims,email_verified:false})));
 await assertFails(create(db('student-a',{email_verified:true,firebase:{sign_in_provider:'password'}})));
});
test('student B cannot read, list, overwrite or delete student A even with forged path UID', async () => {
 const a = db('student-a'), b = db('student-b'); await create(a);
 for (const operation of [()=>getDoc(headRef(b)),()=>getDoc(classRef(b)),()=>getDocs(collection(b,'students')),()=>setDoc(headRef(b),header({revision:2})),()=>deleteDoc(classRef(b)),()=>deleteDoc(headRef(b))]) await assertFails(operation());
});
test('closed schemas reject user IDs, emails, answers and unknown course/class/question IDs', async () => {
 const a = db('student-a');
 await assertFails(create(a,'student-a',header({email:'student@example.invalid'})));
 await assertFails(create(a,'student-a',header(),lesson({answer:'private answer'})));
 await assertFails(setDoc(headRef(a,'student-a','unknown-course'),header()));
 const b = writeBatch(a); b.set(headRef(a),header());b.set(classRef(a,'student-a','unknown-class'),lesson()); await assertFails(b.commit());
 await assertFails(create(a,'student-a',header(),lesson({blocks:{unknown:{value:true,updatedAt:Date.now()}}})));
});
test('strict leaf fields, scalar types, long strings and future clocks are rejected', async () => {
 const a=db('student-a');
 for (const value of [ {value:'yes',updatedAt:Date.now()}, {value:true,updatedAt:Date.now(),email:'x'}, {value:true,updatedAt:Date.now()+3600000}, {value:true,updatedAt:-1} ]) await assertFails(create(a,'student-a',header(),lesson({blocks:{[question]:value}})));
 await assertFails(create(a,'student-a',header({selected:{value:'x'.repeat(40000),updatedAt:Date.now()}})));
 await assertFails(create(a,'student-a',header(),lesson({lastPoint:{value:'unknown-anchor',updatedAt:Date.now()}})));
});
test('revision and generation transitions cannot roll back or skip', async () => {
 const a=db('student-a');await create(a);
 for (const h of [header({revision:1}),header({revision:3}),header({revision:2,generation:secondGeneration}),header({revision:2,resetCount:1})]) await assertFails(setDoc(headRef(a),h));
 await assertSucceeds(setDoc(headRef(a),header({revision:2})));
});
test('class updates require a new header in the same atomic commit', async () => {
 const a=db('student-a'); await create(a);
 await assertFails(setDoc(classRef(a),lesson({complete:{value:true,updatedAt:Date.now()}})));
 await assertSucceeds(create(a,'student-a',header({revision:2}),lesson({complete:{value:true,updatedAt:Date.now()}})));
});
test('reset clears classes atomically and stale generations cannot resurrect them', async () => {
 const a=db('student-a');await create(a);
 const b=writeBatch(a);b.set(headRef(a),header({revision:2,resetCount:1,generation:secondGeneration,deleted:true}));b.delete(classRef(a)); await assertSucceeds(b.commit());
 await assertFails(create(a,'student-a',header({revision:3,resetCount:1,generation}),lesson()));
 await assertFails(setDoc(classRef(a),lesson()));
 await assertSucceeds(create(a,'student-a',header({revision:3,resetCount:1,generation:secondGeneration}),lesson({generation:secondGeneration})));
});
test('normal users cannot delete the header and remove reset protection', async () => { const a=db('student-a');await create(a);await assertFails(deleteDoc(headRef(a))); });
test('immutable erasure lock blocks stale tokens from creating any progress', async () => {
 const a=db('student-a');await create(a);
 const marker=doc(a,'students','student-a');await assertSucceeds(setDoc(marker,{schema:1,erasedAt:serverTimestamp()}));
 await assertFails(create(a,'student-a',header({revision:2})));
 await assertFails(setDoc(marker,{schema:1,erasedAt:serverTimestamp()}));await assertFails(deleteDoc(marker));
 await assertSucceeds(deleteDoc(classRef(a)));await assertSucceeds(deleteDoc(headRef(a)));
 await assertFails(create(a));
});
test('erasure markers cannot contain personal fields or be written for another user', async () => {
 const a=db('student-a');await assertFails(setDoc(doc(a,'students','student-a'),{schema:1,erasedAt:serverTimestamp(),email:'x'}));
 await assertFails(setDoc(doc(a,'students','student-b'),{schema:1,erasedAt:serverTimestamp()}));
});
test('all nine classes and all 63 registered question leaves fit actual rules budget', async () => {
 const a=db('student-a'),b=writeBatch(a);b.set(headRef(a),header());
 for(const [id,value] of Object.entries(catalog)) b.set(classRef(a,'student-a',id),lesson({blocks:Object.fromEntries(value.questions.map(q=>[q,{value:true,updatedAt:Date.now()}]))}));
 await assertSucceeds(b.commit());
});
test('real Auth emulator Google sessions enforce A/B isolation and own data cleanup', async () => {
 const fixtures=[];
 try {
  for(const id of ['emulator-google-a','emulator-google-b']) {
   const app=initializeApp({projectId,apiKey:'demo-not-a-real-key',authDomain:`${projectId}.firebaseapp.com`},id);
   const auth=initializeAuth(app,{persistence:inMemoryPersistence});connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
   const database=getFirestore(app);connectFirestoreEmulator(database,'127.0.0.1',8085);
   const jwt=[{alg:'none',typ:'JWT'},{sub:id,email:`${id}@example.invalid`,email_verified:true,aud:projectId,iss:'https://accounts.google.com',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.';
   const result=await signInWithCredential(auth,GoogleAuthProvider.credential(jwt));
   fixtures.push({app,auth,database,uid:result.user.uid});
  }
  const [a,b]=fixtures;await assertSucceeds(create(a.database,a.uid));
  await assertFails(getDoc(headRef(b.database,a.uid)));
  await assertFails(setDoc(headRef(b.database,a.uid),header({revision:2})));
  await assertFails(deleteDoc(classRef(b.database,a.uid)));
  await assertSucceeds(setDoc(doc(a.database,'students',a.uid),{schema:1,erasedAt:serverTimestamp()}));
  await assertSucceeds(deleteDoc(classRef(a.database,a.uid)));await assertSucceeds(deleteDoc(headRef(a.database,a.uid)));
  await deleteUser(a.auth.currentUser);
  assert.equal(a.auth.currentUser,null);
 } finally { for(const value of fixtures){await terminate(value.database);await deleteApp(value.app);} }
});
