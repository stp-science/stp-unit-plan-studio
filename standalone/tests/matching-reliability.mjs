import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../public/assets/curriculum_map/v1/ai-request.js', import.meta.url), 'utf8');
const {curriculumError, readCurriculumResult, createCurriculumQueue} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

let active = 0, peak = 0;
const waits = [], request = createCurriculumQueue({wait: async ms => { waits.push(ms); }});
const results = await Promise.all([1, 2, 3].map(n => request(async () => {
  active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return n;
})));
assert.deepEqual(results, [1, 2, 3]); assert.equal(peak, 1); assert.deepEqual(waits, [1500, 1500]);

let attempts = 0;
const retryWaits = [], retry = createCurriculumQueue({wait: async ms => { retryWaits.push(ms); }});
assert.equal(await retry(async () => { if (++attempts < 3) throw curriculumError({code: 'service', retryable: true}); return 'saved'; }), 'saved');
assert.equal(attempts, 3); assert.equal(retryWaits.reduce((a, b) => a + b, 0), 12000);
let mismatchCalls = 0;
await assert.rejects(retry(async () => { mismatchCalls++; throw curriculumError({code: 'no_match', error: 'No matching curriculum statements', retryable: false}); }), e => e.code === 'no_match');
assert.equal(mismatchCalls, 1); assert.equal(await retry(async () => 'next unit'), 'next unit');

let limitedCalls = 0, queuedCalls = 0;
const limits = createCurriculumQueue({wait: async () => {}});
await assert.rejects(limits(async () => { limitedCalls++; throw curriculumError({code: 'rate_limit', retryable: true, retryAfter: 30}); }), e => e.code === 'rate_limit');
await assert.rejects(limits(async () => { queuedCalls++; }), e => e.code === 'rate_limit');
assert.equal(limitedCalls, 3); assert.equal(queuedCalls, 0);
limits.resetBlock(); assert.equal(await limits(async () => 'resumed'), 'resumed');
let continuing = true, cancelledCalls = 0;
const cancel = createCurriculumQueue({wait: async () => { continuing = false; }});
await assert.rejects(cancel(async () => { cancelledCalls++; throw new TypeError('offline'); }, {shouldContinue: () => continuing}), e => e.code === 'cancelled');
assert.equal(cancelledCalls, 1);

function response(chunks, options = {}) {
  let index = 0;
  return {ok: true, status: 200, headers: {get: () => 'application/x-ndjson'}, body: {getReader: () => ({read: async () => index < chunks.length ? {value: new TextEncoder().encode(chunks[index++]), done: false} : {done: true}})}, ...options};
}
assert.deepEqual(await readCurriculumResult(response(['{"type":"started"}\n{"type":"res', 'ult","result":{"knowledge":[],"practices":[]}}'])), {knowledge: [], practices: []});
await assert.rejects(readCurriculumResult(response(['{"type":"error","error":"busy","code":"service","retryable":true,"retryAfter":4}'])), e => e.code === 'service' && e.retryable && e.retryAfter === 4);
await assert.rejects(readCurriculumResult(response(['{"type":"started"}\n'])), e => e.code === 'incomplete' && e.retryable);
await assert.rejects(readCurriculumResult(response([], {ok: false, status: 429, headers: {get: key => key === 'retry-after' ? '45' : 'application/json'}, json: async () => ({error: 'limit'})})), e => e.code === 'rate_limit' && e.retryAfter === 45);
await assert.rejects(readCurriculumResult(response([], {ok: false, status: 403, json: async () => ({error: 'Session expired'})})), e => !e.retryable);

// Exercise the real map runner against a fake server: saved matches survive,
// transient failures recover, and a repeated limit leaves queued units untouched.
const mapSource = (await readFile(new URL('../public/assets/curriculum_map/v1/map.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');
const mapEnd = mapSource.indexOf("setInterval(() => { if (document.visibilityState");
function runner(fakeFetch) {
  const toast = {textContent: '', classList: {add() {}, remove() {}}};
  return new Function('window', 'document', 'addEventListener', 'location', 'setTimeout', 'clearTimeout', 'fetch', 'curriculumError', 'readCurriculumResult', 'createCurriculumQueue', mapSource.slice(0, mapEnd) + `
    toastEl = document.toast;
    resolveDoc = async () => ({doc: {id: 'social-sciences'}, disc: ''});
    getLevels = async () => ({mode: 'years'});
    return {S, matchAll};
  `)({CM: {api: 'map-api', studio: 'studio-api'}}, {getElementById: () => null, toast}, () => {}, {pathname: '/curriculum_map.php'}, () => 0, () => {}, fakeFetch, curriculumError, readCurriculumResult, () => createCurriculumQueue({wait: async () => {}}));
}
async function batch(limited) {
  const requests = [], saved = [], marks = [], counts = {};
  const app = runner(async (url, options) => {
    const payload = options?.body ? JSON.parse(options.body) : null;
    if (url.startsWith('studio-api')) {
      requests.push(payload.topic); counts[payload.topic] = (counts[payload.topic] || 0) + 1;
      if (payload.topic === 'B' && (limited || counts.B === 1)) return response([JSON.stringify({type: 'error', error: 'Try later', code: limited ? 'rate_limit' : 'service', retryable: true})]);
      assert(payload.notes.includes('Strand: History'));
      assert.equal(payload.pacedRetry, true);
      return response([JSON.stringify({type: 'result', result: {knowledge: [{text: 'Official ' + payload.topic, confidence: 85}], practices: [], warnings: []}})]);
    }
    if (url.includes('action=set-statements')) saved.push(payload);
    if (url.includes('action=match-mark')) marks.push(payload);
    return {ok: true, json: async () => ({ok: true, statements: []})};
  });
  const topics = ['A', 'B', 'C'].map(title => ({id: title, title, strand: 'history'}));
  Object.assign(app.S, {dept: {id: 1, name: 'Social Sciences'}, map: {strands: [{id: 'history', name: 'History'}], years: [{label: 'Year 9', blocks: [{topics}]}]}});
  await app.matchAll(topics.map(t => t.id));
  assert.equal(saved[0].statements[0].text, 'Official A');
  assert.equal(saved[0].statements[0].selected, true);
  if (limited) {
    assert.deepEqual(requests, ['A', 'B', 'B', 'B']);
    assert(!marks.some(p => p.topic_id === 'C'));
    assert(app.S.lastRun.startsWith('Paused.'));
    assert(app.S.lastRun.includes('Remaining units have not been marked as failed.'));
  } else {
    assert.deepEqual(requests, ['A', 'B', 'B', 'C']);
    assert.equal(saved.length, 3); assert.equal(marks.filter(p => p.status === 'done').length, 3);
    assert(app.S.lastRun.startsWith('Finished. 3 of 3 units matched'));
  }
}
await batch(false);
await batch(true);
console.log('Passed paced serial requests, bounded retries, unchanged no-match review, rate-limit pause/resume, cancellation, split/unterminated streams and HTTP errors. No network or AI calls.');
