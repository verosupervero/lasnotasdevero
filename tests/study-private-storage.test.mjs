import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateStorage, progressDelta, uncoveredChanges, hasChanges } from '../static/js/study-private-storage.js';
import { emptyProgress, updateProgress, mergeProgress } from '../static/js/study-progress.js';

const baseKey = 'synthetic-study-progress';
const state = (question, value = true, time = 10) => updateProgress(emptyProgress(), 'lesson', 'block', value, time, question);
function fixture() {
  const map = new Map(), mutations = [];
  const storage = { get length() { return map.size; }, key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem(key, value) { map.set(key, value); mutations.push(['set', key]); },
    removeItem(key) { map.delete(key); mutations.push(['remove', key]); }
  };
  const actor = tabId => createPrivateStorage({ storage, baseKey, tabId });
  return { map, storage, mutations, actor };
}

test('two writers persist UID, generation, snapshot and pending atomically in separate keys', () => {
  const f = fixture(), a = f.actor('a'), b = f.actor('b');
  assert.equal(a.save('alice', 'epoch', state('q1'), state('q1')), true);
  assert.equal(b.save('alice', 'epoch', state('q2'), state('q2')), true);
  assert.notEqual(a.key('alice'), b.key('alice'));
  assert.deepEqual(a.entries('alice').map(({ record }) => record.generation), ['epoch', 'epoch']);
  assert.equal(a.entries('bob').length, 0);
  for (const raw of f.map.values()) {
    const record = JSON.parse(raw);
    assert.equal(record.version, 2); assert.equal(record.uid, 'alice');
    assert.ok(record.snapshot.classes.lesson); assert.ok(record.pending.classes.lesson);
  }
});

test('normal acknowledgments and cleanup never write or remove an active peer queue', () => {
  const f = fixture(), a = f.actor('a'), b = f.actor('b');
  b.save('alice', 'epoch', state('q2'), state('q2'));
  const original = f.map.get(b.key('alice'));
  a.save('alice', 'epoch', state('q1'), emptyProgress()); a.removeOwn('alice');
  assert.equal(f.map.get(b.key('alice')), original);
  assert.equal(f.mutations.filter(([action, key]) => key === b.key('alice')).length, 1);
});

test('delta records only changed leaves and retains explicit unchecking', () => {
  const before = mergeProgress(state('q1'), state('q2'));
  const after = updateProgress(before, 'lesson', 'block', false, 20, 'q1');
  const delta = progressDelta(before, after);
  assert.deepEqual(Object.keys(delta.classes.lesson.blocks), ['q1']);
  assert.equal(delta.classes.lesson.blocks.q1.value, false);
  assert.equal(delta.classes.lesson.blocks.q2, undefined);
  assert.equal(hasChanges(progressDelta(before, before)), false);
});

test('acknowledgment removes covered leaves while retaining edits made during an upload', () => {
  const sent = state('q1', true, 10), during = mergeProgress(sent, state('q2', false, 20));
  const pending = uncoveredChanges(during, sent);
  assert.equal(pending.classes.lesson.blocks.q1, undefined);
  assert.equal(pending.classes.lesson.blocks.q2.value, false);
  assert.equal(hasChanges(uncoveredChanges(during, during)), false);
});

test('equal-clock ACK coverage uses the provider tie break independently of property order', () => {
  for (const reversed of [false, true]) for (const pendingValue of [false, true]) {
    const record = value => reversed ? { updatedAt: 10, value } : { value, updatedAt: 10 };
    const pending = emptyProgress(), confirmed = emptyProgress();
    pending.classes.lesson = { blocks: { q1: record(pendingValue) } };
    confirmed.classes.lesson = { blocks: { q1: record(true) } };
    assert.equal(hasChanges(uncoveredChanges(pending, confirmed)), false);
  }
  assert.equal(uncoveredChanges(state('q1', false, 20), state('q1', true, 10)).classes.lesson.blocks.q1.value, false);
});

test('corrupt, foreign, missing-epoch and oversized records never become recoverable queues', () => {
  const f = fixture(), a = f.actor('a'), valid = { version: 2, uid: 'alice', generation: 'epoch', snapshot: state('q1'), pending: state('q1') };
  for (const record of [{ ...valid, uid: 'bob' }, { ...valid, generation: undefined }, { ...valid, snapshot: {} }, { ...valid, pending: {} }, { ...valid, version: 3 }, { ...valid, generation: {} }, { ...valid, secret: 'synthetic' }]) {
    assert.equal(a.parse(JSON.stringify(record), 'alice'), undefined);
  }
  assert.equal(a.parse('x'.repeat(98305), 'alice'), undefined);
  assert.equal(a.parse('{', 'alice'), undefined);
});

test('capacity and write failures preserve memory but cannot claim durable pending storage', () => {
  const f = fixture(), actor = f.actor('new');
  for (let index = 0; index < 64; index++) f.map.set(`${baseKey}:private:v2:alice:old-${index}`, '{}');
  assert.equal(actor.save('alice', 'epoch', state('q1'), state('q1')), false);
  assert.equal(actor.persisted('alice', 'epoch', state('q1')), false);
  assert.equal(actor.entries('alice').at(-1).record.pending.classes.lesson.blocks.q1.value, true);
  assert.equal(f.map.size, 64);
  const broken = createPrivateStorage({ storage: { getItem: () => null, setItem() { throw Error('synthetic-quota'); } }, baseKey, tabId: 'broken' });
  assert.equal(broken.save('alice', 'epoch', state('q1'), state('q1')), false);
  assert.equal(broken.persisted('alice', 'epoch', state('q1')), false);
});

test('individual and total byte limits reject new copies without pruning existing records', () => {
  const f = fixture(), a = f.actor('a');
  const huge = emptyProgress(); huge.classes['x'.repeat(50000)] = { blocks: {} };
  assert.equal(a.save('alice', 'epoch', huge, huge), false);
  assert.equal(f.map.size, 0);
  for (let index = 0; index < 12; index++) f.map.set(`${baseKey}:private:v2:bob:${index}`, 'x'.repeat(90000));
  assert.equal(a.save('alice', 'epoch', state('q1'), state('q1')), false);
  assert.equal(f.map.size, 12);
});

test('explicit account erasure removes all its writers and blocks stale saves without touching another UID', () => {
  const f = fixture(), a = f.actor('a'), b = f.actor('b'), c = f.actor('c');
  a.save('alice', 'epoch', state('q1'), state('q1')); b.save('alice', 'epoch', state('q2'), state('q2'));
  c.save('bob', 'epoch', state('q3'), state('q3'));
  const bob = f.map.get(c.key('bob'));
  f.map.set(`${baseKey}:account:alice`, JSON.stringify(state('legacy')));
  assert.equal(a.erase('alice'), true);
  assert.equal(a.entries('alice').length, 0); assert.equal(b.entries('alice').length, 0);
  assert.equal(b.erased('alice'), true);
  assert.equal(b.save('alice', 'epoch', state('q4'), state('q4')), false);
  assert.equal(f.map.has(b.key('alice')), false); assert.equal(f.map.has(`${baseKey}:account:alice`), false);
  assert.equal(f.map.get(c.key('bob')), bob);
});

test('closing seals an immutable key and late callbacks write under a fresh identity', () => {
  const f = fixture(), a = f.actor('a');
  a.save('alice', 'epoch', state('q1'), state('q1'));
  const oldKey = a.key('alice'); a.close('alice');
  const sealed = f.map.get(oldKey);
  assert.equal(JSON.parse(sealed).closed, true); assert.notEqual(a.key('alice'), oldKey);
  a.save('alice', 'epoch', state('q2'), state('q2'));
  assert.equal(f.map.get(oldKey), sealed);
  assert.equal(JSON.parse(f.map.get(a.key('alice'))).closed, undefined);
});

test('pruning needs a durable current copy, immutable closed peer and confirmed leaf coverage', () => {
  const f = fixture(), a = f.actor('a'), b = f.actor('b'), c = f.actor('c');
  const first = state('q1'), second = state('q2'), both = mergeProgress(first, second);
  a.save('alice', 'epoch', first, first); const oldKey = a.key('alice'); a.close('alice');
  b.save('alice', 'epoch', second, second); const activeKey = b.key('alice');
  c.prune('alice', 'epoch', both); assert.equal(f.map.has(oldKey), true);
  c.save('alice', 'epoch', both, emptyProgress());
  c.prune('alice', 'epoch', second); assert.equal(f.map.has(oldKey), true);
  c.prune('alice', 'other-epoch', both); assert.equal(f.map.has(oldKey), true);
  c.prune('alice', 'epoch', both); assert.equal(f.map.has(oldKey), false);
  assert.equal(f.map.has(activeKey), true);
  assert.equal(f.map.has(c.key('alice')), true);
});

test('repeated normal reloads safely reclaim closed confirmed copies before reaching capacity', () => {
  const f = fixture(), confirmed = state('q1');
  for (let index = 0; index < 100; index++) {
    const actor = f.actor(`page-${index}`);
    assert.equal(actor.save('alice', 'epoch', confirmed, emptyProgress()), true);
    actor.prune('alice', 'epoch', confirmed);
    assert.equal(f.map.size, 1);
    actor.close('alice');
  }
});

test('terminal erasure between a writer precheck and setItem removes its late saved bytes', () => {
  const f = fixture(), eraser = f.actor('eraser'), writer = f.actor('writer');
  const bob = f.actor('bob'); bob.save('bob', 'epoch', state('q3'), state('q3'));
  const bobRaw = f.map.get(bob.key('bob'));
  const setItem = f.storage.setItem;
  let triggered = false, erased;
  f.storage.setItem = (key, value) => {
    if (!triggered && key === writer.key('alice')) { triggered = true; erased = eraser.erase('alice'); }
    setItem(key, value);
  };
  assert.equal(writer.save('alice', 'epoch', state('q1'), state('q1')), false);
  assert.equal(triggered, true); assert.equal(erased, true);
  assert.equal(f.map.has(writer.key('alice')), false);
  assert.equal(writer.entries('alice').length, 0);
  assert.equal(writer.persisted('alice', 'epoch', state('q1')), false);
  assert.equal(f.map.get(bob.key('bob')), bobRaw);
});

test('terminal erasure between close precheck and setItem cannot recreate a sealed private copy', () => {
  const f = fixture(), eraser = f.actor('eraser'), writer = f.actor('writer');
  writer.save('alice', 'epoch', state('q1'), state('q1'));
  const oldKey = writer.key('alice'), setItem = f.storage.setItem;
  let triggered = false, erased;
  f.storage.setItem = (key, value) => {
    if (!triggered && key === oldKey) { triggered = true; erased = eraser.erase('alice'); }
    setItem(key, value);
  };
  writer.close('alice');
  assert.equal(triggered, true); assert.equal(erased, true);
  assert.equal(f.map.has(oldKey), false); assert.notEqual(writer.key('alice'), oldKey);
  assert.equal(writer.entries('alice').length, 0);
  assert.equal(writer.save('alice', 'epoch', state('q2'), state('q2')), false);
  assert.equal(f.map.has(writer.key('alice')), false);
});
