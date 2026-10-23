import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress, parseProgress, updateProgress, mergeProgress, progressCounts } from '../static/js/study-progress.js';

const update = (state, id, field, value, time, block) => updateProgress(state, id, field, value, time, block);
test('canonical serialization avoids reordering-only multi-tab echoes', async () => {
  const { serializeProgress } = await import('../static/js/study-progress.js');
  const a = update(emptyProgress(), 'video-1', 'block', true, 10, 'birth');
  const b = update(emptyProgress(), 'video-2', 'block', true, 20, 'temple');
  assert.equal(serializeProgress(mergeProgress(a, b)), serializeProgress(mergeProgress(b, a)));
});
test('storage validates corrupt and future data without treating them as writable empty state', () => {
  assert.equal(parseProgress(null).status, 'ready');
  for (const raw of ['{bad', '{}', '{"version":1,"classes":{"video-1":{"blocks":{"q":true}}}}']) assert.equal(parseProgress(raw).status, 'corrupt');
  assert.equal(parseProgress('{"version":2,"classes":{}}').status, 'future');
  const state = update(emptyProgress(), 'video-1', 'block', true, 100, 'birth');
  assert.deepEqual(parseProgress(JSON.stringify(state)).state, state);
});
test('completion is explicit and false tombstones win over stale checked records', () => {
  const checked = update(emptyProgress(), 'video-1', 'block', true, 10, 'birth');
  assert.equal(checked.classes['video-1'].complete, undefined);
  const unchecked = update(checked, 'video-1', 'block', false, 20, 'birth');
  assert.equal(mergeProgress(unchecked, checked).classes['video-1'].blocks.birth.value, false);
  const completed = update(unchecked, 'video-1', 'complete', true, 25);
  const undone = update(completed, 'video-1', 'complete', false, 30);
  assert.equal(mergeProgress(undone, completed).classes['video-1'].complete.value, false);
});
test('concurrent tabs merge separate blocks, completion and resume fields independently', () => {
  const a = update(update(emptyProgress(), 'video-1', 'block', true, 10, 'birth'), 'video-1', 'complete', true, 30);
  const b = update(update(emptyProgress(), 'video-1', 'block', true, 20, 'temple'), 'video-2', 'selected', undefined, 40);
  const merged = mergeProgress(a, b);
  assert.equal(merged.classes['video-1'].blocks.birth.value, true);
  assert.equal(merged.classes['video-1'].blocks.temple.value, true);
  assert.equal(merged.classes['video-1'].complete.value, true);
  assert.equal(merged.selected.value, 'video-2');
  assert.equal(merged.classes['video-1'].lastActivity.value, 30);
  assert.equal(merged.classes['video-2'].lastActivity.value, 40);
  assert.deepEqual(mergeProgress(a, b), mergeProgress(b, a));
});
test('stable IDs survive catalog expansion, reordering, removal and subsequent return', () => {
  let state = update(emptyProgress(), 'video-1', 'block', true, 10, 'stable-question');
  state = update(state, 'video-1', 'lastPoint', 'old-heading', 11);
  state = update(state, 'video-1', 'complete', true, 12);
  state = update(state, 'future-or-removed', 'block', true, 13, 'unknown-question');
  const original = [{ id: 'video-1', kind: 'course' }];
  const expanded = [{ id: 'video-5', kind: 'course' }, ...original, { id: 'censo', kind: 'complement' }, { id: 'integracion', kind: 'integration' }];
  assert.deepEqual(progressCounts(state, original).course, { total: 1, complete: 1 });
  assert.deepEqual(progressCounts(state, expanded).course, { total: 2, complete: 1 });
  assert.deepEqual(progressCounts(state, [...expanded].reverse()), progressCounts(state, expanded));
  const merged = mergeProgress(state, update(emptyProgress(), 'video-5', 'selected', undefined, 20));
  assert.equal(merged.classes['future-or-removed'].blocks['unknown-question'].value, true);
  assert.equal(merged.classes['video-1'].lastPoint.value, 'old-heading');
});
test('overall counts only published core classes, separate from supplements and thirteen planned', () => {
  let state = emptyProgress();
  for (const id of ['v1', 'censo', 'integracion', 'unpublished']) state = update(state, id, 'complete', true, 10);
  const result = progressCounts(state, [{ id: 'v1', kind: 'course' }, { id: 'v2', kind: 'course' }, { id: 'censo', kind: 'complement' }, { id: 'integracion', kind: 'integration' }]);
  assert.deepEqual(result, { course: { total: 2, complete: 1 }, complement: { total: 1, complete: 1 }, integration: { total: 1, complete: 1 } });
});
