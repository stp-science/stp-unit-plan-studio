import {curriculumError, readCurriculumResult, createCurriculumQueue} from './ai-request.js';
const curriculumAi = createCurriculumQueue();
// Curriculum map front end. A department's year -> term -> topic overview: view it, edit it, build one, or import one.
const CM = window.CM;
const PALETTE = ['#a9df82', '#fff176', '#d9cce9', '#ffcc80', '#90caf9', '#f48fb1', '#80deea', '#e6ee9c', '#bcaaa4', '#cfd8dc'];
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), v => v.toString(16).padStart(2, '0')).join('');
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
};
const ago = iso => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(iso).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}); };

const S = {review: false, view: 'map', stmtCounts: {}, importStmts: null, importResult: null, match: {}, run: null, lastRun: null, onlyAttn: false, open: new Set(), stmtAll: null, stmtDirty: false, depts: [], isManager: false, dept: null, map: null, version: 0, updatedAt: '', updatedBy: '', edit: false, draft: false, source: '', saveState: 'saved', conflict: false, working: null, banner: null, loading: true};
let root, toastEl, toastTimer = 0, saveTimer = 0;

// ---------------------------------------------------------------- api
async function get(params) {
  const r = await fetch(CM.api + '?' + new URLSearchParams({...params, _: Date.now()}), {credentials: 'same-origin', cache: 'no-store'});   // never answered from a cache
  return r.json();
}
async function post(action, body) {
  const r = await fetch(CM.api + '?action=' + action, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...body, csrf: CM.csrf})});
  const packet = await r.json().catch(() => ({ok: false, error: 'The server did not answer. Your saved work is kept.'}));
  if (!r.ok && !packet.ok && !packet.code) Object.assign(packet, {code: r.status === 429 ? 'rate_limit' : r.status >= 500 ? 'service' : 'error', retryable: r.status === 429 || r.status >= 500, retryAfter: Number(r.headers.get('retry-after')) || 0});
  return packet;
}
async function load(deptId, view) {
  const keepView = view || (['start', 'upload'].includes(S.view) ? S.view : 'map');
  if (S.run) S.run.stop = true;
  S.loading = true; S.failed = false; render();
  try {
    const d = await get({action: 'state', department_id: deptId || ''});
    if (!d.ok) throw Error(d.error || 'load failed');
    Object.assign(S, {review: false, view: keepView, stmtAll: null, stmtDirty: false, stmtCounts: d.stmtCounts || {}, depts: d.departments, isManager: d.isManager, dept: d.department, map: d.map, version: d.version, updatedAt: d.updatedAt, updatedBy: d.updatedBy, edit: false, draft: false, saveState: 'saved', conflict: false, banner: null});
  } catch (e) { S.banner = {kind: 'err', text: 'The curriculum map could not be loaded (' + e.message + '). Refresh to try again; nothing has been changed.'}; S.failed = true; }
  S.loading = false; S.match = {}; S.onlyAttn = false; S.lastRun = null; syncUrl(); render();
  if (S.dept && S.map) { const id = S.dept.id; get({action: 'match-status', department_id: id}).then(r => { if (r.ok && S.dept?.id === id) { S.match = r.match || {}; paintAllBars(); paintStrip(); } }).catch(() => {}); }
}
const toast = msg => { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400); };

// ---------------------------------------------------------------- saving
function changed() {
  render();
  if (S.draft) return;
  S.saveState = 'saving'; paintSave();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 900);
}
async function save(explicit) {
  clearTimeout(saveTimer);
  if (S.conflict) return;
  S.saveState = 'saving'; paintSave();
  const r = await post('save', {department_id: S.dept.id, map: S.map, version: S.version});
  if (r.ok) {
    S.version = r.version; S.saveState = 'saved'; S.draft = false; S.updatedAt = new Date().toISOString(); S.updatedBy = 'you';
    if (S.importStmts) await persistImport();
    if (explicit) { S.banner = null; toast('Saved to the department'); render(); } else paintSave();
  } else if (r.conflict) { S.conflict = true; S.saveState = 'error'; render(); }
  else { S.saveState = 'error'; S.banner = {kind: 'err', text: r.error || 'Could not save.'}; render(); }
}
function paintSave() {
  const el = document.querySelector('.cm-save'); if (!el) return;
  el.className = 'cm-save ' + (S.saveState === 'saved' ? 'ok' : S.saveState === 'error' ? 'err' : '');
  el.textContent = S.saveState === 'saved' ? 'Saved' : S.saveState === 'saving' ? 'Saving…' : 'Not saved. Click to retry';
}
addEventListener('beforeunload', e => { if (S.saveState === 'saving' || S.draft) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- navigation
// Every screen (start, map, coverage) has its own history entry and address, so Back always returns to what you were just doing,
// and a page opened from the browser's history comes back as it was.
const BASE = location.pathname.split('/').pop() || 'curriculum_studio.php';
const viewUrl = (view, deptId) => BASE + (view === 'start' ? '' : '?department=' + (deptId || S.dept?.id || 0) + (['coverage', 'upload'].includes(view) ? '&view=' + view : ''));
function syncUrl() {   // keep the current entry's address and state accurate after a load or department change
  const idx = history.state?.cm ? history.state.idx || 0 : 0;
  history.replaceState({cm: 1, view: S.view, dept: S.dept?.id || 0, idx}, '', viewUrl(S.view));
}
function showView(view) {
  S.view = view; S.banner = null;
  const idx = (history.state?.cm ? history.state.idx || 0 : 0) + 1;
  history.pushState({cm: 1, view, dept: S.dept?.id || 0, idx}, '', viewUrl(view));
  render(); scrollTo({top: 0});
}
// Back one screen. With no earlier screen of ours in the history (a page opened directly) it goes to the fallback screen instead.
function goBack(fallback) {
  if (history.state?.cm && (history.state.idx || 0) > 0) history.back();
  else { S.view = fallback; syncUrl(); render(); scrollTo({top: 0}); }
}
addEventListener('popstate', async e => {
  const st = e.state;
  if (!st || !st.cm || S.loading) return;
  if (st.dept && S.dept && st.dept !== S.dept.id) await load(st.dept, st.view); else { S.view = st.view; }
  S.view = st.view;
  if (S.view === 'coverage') { cov = {rows: null, q: '', kind: '', sort: 'used', err: ''}; fetchCoverage(); }
  render();
});

// ---------------------------------------------------------------- helpers on the map
const strandOf = id => S.map.strands.find(s => s.id === id);
const typeOf = code => S.map.assessTypes.find(t => t.code === code);
const yearNum = label => { if (/^\s*Novice\s*[123]\s*$/i.test(label || '')) return ''; const m = /\d+/.exec(label || ''); return m ? m[0] : ''; };
const noviceOf = label => { const m = /^\s*Novice\s*([123])\s*$/i.exec(label || ''); return m ? 'Novice ' + m[1] : ''; };
const isLanguageDept = () => /french|spanish|japanese|chinese|mandarin|te reo|māori|maori|language|german|italian|samoan|korean/i.test(S.dept?.name || '');
const yearOf = label => noviceOf(label) ? 7 : (parseInt(yearNum(label), 10) || 0);
function findTopic(id) {
  for (const y of S.map.years) for (const b of y.blocks) { const i = b.topics.findIndex(t => t.id === id); if (i >= 0) return {y, b, i, t: b.topics[i]}; }
  return null;
}
function guideUrl(y, t) {
  return CM.guide + '?' + new URLSearchParams({guide: '1', new: '1', subject: S.dept.name, year: String(yearOf(y.label)), stage: noviceOf(y.label), topic: t.title, dept: S.dept.id, mt: t.id});
}
function counts() {
  const core = {}, opt = {};
  for (const y of S.map.years) for (const b of y.blocks) for (const t of b.topics) if (t.assess) { const o = t.optional ? opt : core; o[t.assess] = (o[t.assess] || 0) + 1; }
  const fmt = o => { const parts = S.map.assessTypes.filter(t => o[t.code]).map(t => o[t.code] + ' ' + t.code); return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0] || ''; };
  return {core: fmt(core), opt: fmt(opt)};
}
function rangeText() {
  const stages = S.map.years.map(y => noviceOf(y.label)).filter(Boolean);
  if (stages.length === S.map.years.length) return 'across ' + stages.join(', ');
  const ys = S.map.years.map(y => yearNum(y.label)).filter(Boolean);
  return ys.length > 1 && ys.length === S.map.years.length ? 'across Years ' + ys[0] + '–' + ys.at(-1) : 'across all groups';
}
const termName = (y, b) => (b.label && !/^(block|term)\s*\d+$/i.test(b.label.trim())) ? b.label : 'Term ' + (y.blocks.indexOf(b) + 1);
function blockNumber(yi, bi) { let n = 0; for (let i = 0; i < yi; i++) n += S.map.years[i].blocks.length; return n + bi + 1; }

// ---------------------------------------------------------------- modals (they close with their buttons or Escape, never by clicking outside)
let modalEl = null;
function closeModal() { modalEl?.remove(); modalEl = null; if (S.stmtDirty) { S.stmtDirty = false; render(); } }
function openModal(title, body, actions, wide) {
  closeModal();
  modalEl = h('div', {class: 'cm-veil', role: 'dialog', 'aria-modal': 'true', 'aria-label': title}, h('div', {class: 'cm-modal' + (wide ? ' wide' : '') + (wide === 'xl' ? ' xl' : '')}, h('h3', {}, title), body, h('div', {class: 'acts'}, ...actions)));
  root.append(modalEl);
  modalEl.querySelector('input,select,textarea,button')?.focus();
}
addEventListener('keydown', e => { if (e.key === 'Escape' && modalEl) closeModal(); });
const field = (label, input, hint) => h('label', {class: 'f'}, h('span', {}, label), input, hint ? h('span', {class: 'hint'}, hint) : null);

// ---------------------------------------------------------------- curriculum statements linked to topics
const confClass = c => c == null ? 'na' : c >= 85 ? 'hi' : c >= 60 ? 'mid' : 'lo';
const confBadge = c => h('span', {class: 'cm-conf ' + confClass(c), title: c == null ? 'No score recorded' : 'How directly the AI judged this statement to be taught in the unit'}, c == null ? '—' : c + '%');
let catalogue = null;
async function getCatalogue() {
  if (!catalogue) { const r = await fetch(CM.studio + '?action=catalogue', {credentials: 'same-origin'}).then(x => x.json()); catalogue = r.ok ? r.documents : []; }
  return catalogue;
}
// Department names that sit inside a broader Ministry learning area, so Art finds the Visual Arts document, Geography the Social Sciences one, and so on.
const SUBJECT_ALIAS = {
  'visual arts': ['art', 'visual art', 'art: design', 'art: photography', 'art design', 'art photography', 'painting', 'printmaking', 'design'],
  'technology': ['design and visual communication', 'digital technology', 'fashion design', 'food', 'product design', 'resistant materials', 'hospitality', 'textiles'],
  'social sciences': ['religious education', 'geography', 'history', 'geospatial technology', 'theology and philosophy', 'tourism studies', 'psychology', 'sociology'],
  'health and physical education': ['physical education and health', 'health studies', 'human performance', 'outdoor education', 'physical education', 'health'],
};
const subjectAlias = name => { const n = String(name || '').trim().toLowerCase(); return Object.keys(SUBJECT_ALIAS).find(k => SUBJECT_ALIAS[k].includes(n)) || ''; };
function docFor(name, year, docs) {
  const names = d => [d.subject, d.learningArea, d.title, ...(d.subjects || [])].map(x => String(x || '').toLowerCase()).filter(Boolean);
  const find = q => { const n = q.trim().toLowerCase(); if (!n) return null; const ok = d => (d.years || [7, 8, 9, 10]).includes(year); return docs.find(d => ok(d) && names(d).some(x => x === n)) || (n.length >= 4 ? docs.find(d => ok(d) && names(d).some(x => x.includes(n))) : null); };
  return find(name) || find(subjectAlias(name));
}
async function loadStatements(topicId) {
  const r = await get({action: 'statements', department_id: S.dept.id, topic_id: topicId});
  if (!r.ok) throw Error(r.error || 'Could not load the statements');
  return r.statements;
}
async function saveStatements(topicId, rows) {
  const r = await post('set-statements', {department_id: S.dept.id, topic_id: topicId, statements: rows});
  if (!r.ok) throw Error(r.error || 'Could not save the statements');
  S.stmtCounts[topicId] = rows.filter(x => x.selected).length;
  S.stmtDirty = true; paintBar(topicId, true); paintStrip();
  if (S.stmtAll) S.stmtAll = S.stmtAll.filter(x => x.topic_id !== topicId).concat(rows.filter(x => x.selected).map(x => ({...x, topic_id: topicId})));
}
// Every ticked statement in this department, loaded once, for the expandable topic boxes.
async function deptStatements() {
  if (!S.stmtAll) { const r = await get({action: 'statements', department_id: S.dept.id}); S.stmtAll = r.ok ? (r.statements || []).filter(x => x.selected) : []; }
  return S.stmtAll;
}
const streamResult = readCurriculumResult;

// ---- automatic matching: state of each topic, the batch runner, and the strip above the map
const tiles = new Map();
let paintStripLater = () => {};
const recordMatch = (id, status, found, note) => {
  S.match[id] = {status, found, note: note || ''};
  paintBar(id, true); paintStrip();
  return post('match-mark', {department_id: S.dept.id, topic_id: id, status, found, note: note || ''}).catch(() => {});
};
const eligible = y => !!noviceOf(y.label) || (yearOf(y.label) >= 7 && yearOf(y.label) <= 13);
const allTopics = () => S.map.years.flatMap(y => y.blocks.flatMap(b => b.topics.map(t => ({y, b, t}))));
function tileState(id) {
  const k = tiles.get(id);
  if (S.run?.active.has(id)) return 'run';
  if (S.run?.queue.has(id)) return 'queue';
  if (k && !eligible(k.y)) return 'na';
  const rec = S.match[id];
  if ((S.stmtCounts[id] || 0) > 0 || rec?.status === 'done') return 'ok';
  return rec ? 'attn' : 'todo';
}
const MICON = {ok: '✓', attn: '!', run: '…', queue: '·', todo: '○', na: ''};
function barText(id) {
  const n = S.stmtCounts[id] || 0, cnt = n + (n === 1 ? ' statement' : ' statements'), st = tileState(id);
  return st === 'run' ? 'Matching…' : st === 'queue' ? 'Waiting to match' : st === 'attn' ? cnt + ' · needs attention' : st === 'todo' ? 'Not matched yet' : cnt;
}
function paintBar(id, refill) {
  const k = tiles.get(id); if (!k) return;
  const st = tileState(id), open = S.open.has(id);
  k.bar.className = 'cm-tbar ' + st + (open ? ' open' : '');
  k.bar.replaceChildren(h('span', {class: 'cm-car', 'aria-hidden': 'true'}, '▸'), h('span', {class: 'cm-mi', 'aria-hidden': 'true'}, MICON[st]), h('span', {}, barText(id)));
  k.wrap.classList.toggle('dim', S.onlyAttn && st !== 'attn' && st !== 'todo');
  if (refill && open && !k.body.hidden) fillTopicStatements(k.body, k.y, k.b, k.t);
}
const paintAllBars = () => { for (const id of tiles.keys()) paintBar(id); };
function matchCounts() {
  const c = {ok: 0, attn: 0, todo: 0, run: 0};
  if (!S.map) return c;
  for (const {t} of allTopics()) { const st = tileState(t.id); if (st === 'na') continue; c[st === 'queue' ? 'run' : st]++; }
  return c;
}
function paintStrip(el) {
  el = el || document.getElementById('cm-mstrip'); if (!el) return;
  const c = matchCounts(), total = c.ok + c.attn + c.todo + c.run;
  if (!total) { el.replaceChildren(); el.hidden = true; return; }
  el.hidden = false;
  if (S.run) {
    const r = S.run, pct = Math.round(100 * r.done / r.total);
    el.replaceChildren(h('div', {class: 'cm-mrun'},
      h('div', {class: 'cm-mtop'}, h('b', {}, 'Matching curriculum statements: ' + r.done + ' of ' + r.total + ' units'),
        h('button', {class: 'cm-btn sm', type: 'button', disabled: r.stop, onclick: () => { r.stop = true; paintStrip(); }}, r.stop ? 'Stopping…' : 'Stop')),
      h('div', {class: 'cm-prbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct)}, h('i', {style: 'width:' + pct + '%'})),
      h('p', {class: 'hint'}, r.waiting || 'Units are matched one at a time and saved as they finish. Temporary failures are retried automatically. Keep this page open; completed matches are kept if you stop.')));
    return;
  }
  const chip = (cls, txt, on, tip) => h(on ? 'button' : 'span', {class: 'cm-mchip ' + cls + (on ? ' btn' : ''), type: on ? 'button' : null, title: tip || null, onclick: on || null}, txt);
  const todo = c.todo, attn = c.attn;
  el.replaceChildren(h('div', {class: 'cm-mrow'},
    h('div', {class: 'cm-mchips'},
      chip('ok', '✓ ' + c.ok + ' matched'),
      attn ? chip('attn', '! ' + attn + ' need attention', () => { S.onlyAttn = !S.onlyAttn; paintAllBars(); paintStrip(); if (S.onlyAttn) firstNeeding(); }, 'Show only the units that need attention') : null,
      todo ? chip('todo', '○ ' + todo + ' not matched yet') : null,
      S.onlyAttn ? h('button', {class: 'cm-btn sm', type: 'button', onclick: () => { S.onlyAttn = false; paintAllBars(); paintStrip(); }}, 'Show all units') : null),
    h('div', {class: 'cm-macts'},
      attn ? h('button', {class: 'cm-btn sm', type: 'button', onclick: () => { S.onlyAttn = true; paintAllBars(); paintStrip(); reviewNext(); }}, 'Review units needing attention') : null,
      c.ok ? h('a', {class: 'cm-btn sm', href: CM.guide, title: 'Open the Unit Plan Studio'}, 'Unit plans →') : null,
      todo ? h('button', {class: 'cm-btn pri sm', type: 'button', onclick: () => matchAll(allTopics().filter(x => tileState(x.t.id) === 'todo').map(x => x.t.id))}, '✨ Match all units automatically (' + todo + ')')
        : attn ? h('button', {class: 'cm-btn sm', type: 'button', onclick: () => matchAll(allTopics().filter(x => tileState(x.t.id) === 'attn').map(x => x.t.id))}, 'Retry the ' + attn + ' needing attention') : null)),
    S.lastRun ? h('p', {class: 'hint cm-mlast'}, S.lastRun) : h('p', {class: 'hint cm-mlast'}, todo ? 'The AI reads the curriculum for each unit’s year group and ticks the statements it is confident belong. You can then review and change any of them.' : attn ? 'These units have no statements ticked. Open one to choose statements yourself, or mark it as done if none apply.' : 'Every unit has its statements. Open a unit to change them.'));
}
function firstNeeding() { const k = [...tiles.values()].find(k => k.wrap.isConnected && ['attn', 'todo'].includes(tileState(k.t.id))); k?.wrap.scrollIntoView({block: 'center', behavior: 'smooth'}); }
function reviewNext() {
  const k = [...tiles.values()].filter(k => k.wrap.isConnected && tileState(k.t.id) === 'attn').sort((a, b) => (a.wrap.compareDocumentPosition(b.wrap) & 4) ? -1 : 1)[0];
  if (!k) { toast('No units need attention.'); return; }
  S.open.add(k.t.id); k.body.hidden = false; paintBar(k.t.id, true); k.wrap.scrollIntoView({block: 'center', behavior: 'smooth'});
}
async function matchOne({y, t}, deptId, run) {
  const year = yearOf(y.label), stage = noviceOf(y.label); let status = 'attention', found = 0, note = '';
  try {
    if (!(year >= 7 && year <= 13)) throw Error('Statements are available for Years 7 to 13.');
    const info = await resolveDoc(year);
    if (!info) throw Error('No Ministry curriculum document matches “' + S.dept.name + '” for Year ' + year + '.');
    const rows = await loadStatements(t.id);
    const {res, otherLevel} = await findFor(info, year, t.title, topicContext(y, t), {
      stage, shouldContinue: () => !run.stop && S.dept?.id === deptId,
      onWait: ({seconds}) => { run.waiting = 'Waiting ' + seconds + ' seconds before retrying “' + t.title + '”…'; paintStrip(); }
    });
    run.waiting = '';
    if (otherLevel) for (const arr of [res.knowledge, res.practices]) for (const x of arr) x.source = (x.source || '') + ' · from a level not mapped to this year';
    if (S.dept?.id !== deptId) return;
    for (const [kind, arr] of [['knowledge', res.knowledge], ['practice', res.practices]]) for (const x of arr) {
      const conf = x.confidence ?? null, key = flatTxt(x.text), row = rows.find(r => flatTxt(r.text) === key);
      if (row) { row.confidence = conf; row.selected = row.selected || (conf ?? 0) >= 60; }
      else rows.push({kind, text: x.text, source: x.source || '', doc_id: info.doc.id, confidence: conf, selected: (conf ?? 0) >= 60});
    }
    await saveStatements(t.id, rows.filter(r => r.selected || r.confidence != null));
    found = rows.filter(r => r.selected).length;
    status = found ? 'done' : 'attention';
    note = found ? '' : ((res.warnings || []).join(' ') || 'The AI found no statement it was confident enough to tick (60% or more).');
  } catch (e) {
    run.waiting = '';
    if (e.code === 'cancelled') return null;
    note = e.message || 'The AI could not match this unit.';
    if (['rate_limit', 'quota', 'settings'].includes(e.code)) { run.stop = true; run.reason = note; }
  }
  if (S.dept?.id !== deptId) return;
  await recordMatch(t.id, status, found, note);
  return status === 'done';
}
async function matchAll(ids) {
  if (S.run || !ids.length) return;
  const deptId = S.dept.id, list = allTopics().filter(x => ids.includes(x.t.id) && eligible(x.y));
  if (!list.length) return;
  curriculumAi.resetBlock();
  const run = S.run = {total: list.length, done: 0, stop: false, ok: 0, waiting: '', reason: '', active: new Set(), queue: new Set(list.map(x => x.t.id))};
  S.lastRun = null; paintAllBars(); paintStrip();
  let next = 0;
  const worker = async () => {
    while (!run.stop && next < list.length) {
      const x = list[next++]; run.queue.delete(x.t.id); run.active.add(x.t.id); paintBar(x.t.id);
      const ok = await matchOne(x, deptId, run).catch(() => false);
      run.active.delete(x.t.id); if (ok !== null) { run.done++; if (ok) run.ok++; } paintBar(x.t.id, true); paintStrip();
    }
  };
  await worker(); // preserve each result before starting the next unit
  S.run = null;
  S.lastRun = (run.stop ? 'Paused. ' : 'Finished. ') + run.ok + ' of ' + run.done + ' units matched' + (run.done - run.ok ? '; ' + (run.done - run.ok) + ' need attention.' : '.');
  if (run.reason) S.lastRun += ' ' + run.reason + ' Remaining units have not been marked as failed.';
  if (list.length === 1 && !run.ok && !run.reason && S.match[list[0].t.id]) S.lastRun = 'Still no match for “' + list[0].t.title + '”. ' + (S.match[list[0].t.id].note || '');
  paintAllBars(); paintStrip();
  toast(S.lastRun);
  if (list.length === 1) { S.open.add(list[0].t.id); paintBar(list[0].t.id, true); }
}
addEventListener('beforeunload', e => { if (S.run) { e.preventDefault(); e.returnValue = ''; } });

// ---- the statement bank: every official statement for a year and subject, listed for ticking by hand (no AI needed)
// statements that differ only in spacing, punctuation or capitals are the same statement (matches the server's cm_norm_stmt)
const flatTxt = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const bankCache = {}, bankJobs = {};
async function resolveDoc(year) {
  const docs = await getCatalogue(), doc = docFor(S.dept.name, year, docs);
  if (!doc) return null;
  const arts = ['Dance', 'Drama', 'Music', 'Visual Arts'].find(a => a.toLowerCase() === (subjectAlias(S.dept.name) || S.dept.name.trim().toLowerCase())) || '';
  return {doc, disc: doc.learningArea === 'The Arts' ? arts : ''};
}
// Loads one stored bank (a year column, proficiency level, or document). AI work shares the paced matching queue.
async function loadBank(params, onProgress) {
  const key = JSON.stringify(params);
  if (bankCache[key]) return bankCache[key];
  const job = bankJobs[key] || (bankJobs[key] = {listeners: [], run: (async () => {
    let b = await get({action: 'bank', ...params});
    if (!b.ok) throw Error(b.error || 'Could not load the statements');
    if (!b.complete) {
      let next = 0, done = b.done;
      const worker = async () => {
        while (next < b.total) {
          const i = next++;
          const r = await curriculumAi(async () => {
            const result = await post('bank-build', {...params, chunk: i});
            if (!result.ok) throw curriculumError(result);
            return result;
          });
          done++; job.listeners.forEach(f => f({done: Math.min(done, b.total), total: b.total}));
        }
      };
      await worker();
      b = await get({action: 'bank', ...params});
      if (!b.ok || !b.complete) throw Error('Some of the curriculum could not be read. Try again.');
    }
    return bankCache[key] = b;
  })()});
  if (onProgress) job.listeners.push(onProgress);
  try { return await job.run; } finally { delete bankJobs[key]; }
}
// How this department's document is organised for a year: by year group, by proficiency level (for example Novice 1 to 3), or not at all.
const levelsCache = {};
async function getLevels(info, year) {
  const key = info.doc.id + '|' + year + '|' + info.disc;
  if (!levelsCache[key]) { const r = await get({action: 'levels', department_id: S.dept.id, doc_id: info.doc.id, year, discipline: info.disc}); if (!r.ok) throw Error(r.error || 'Could not check how this curriculum is organised'); levelsCache[key] = r; }
  return levelsCache[key];
}
// Statements for a year. Frameworks with year columns load that column; proficiency-based ones load the levels this department maps to the year
// (and the whole document when it has neither), so statements are available even when the document never names a year group.
async function ensureBank(year, onProgress, all, stage = '') {
  const info = await resolveDoc(year);
  if (!info) return {info: null, bank: null};
  const base = {department_id: S.dept.id, doc_id: info.doc.id, year, discipline: info.disc};
  if (stage) return {info: {...info, mode: 'novice', active: [stage]}, bank: await loadBank({...base, level:stage}, onProgress)};
  const lv = await getLevels(info, year);
  if (lv.mode === 'years') return {info: {...info, mode: 'years'}, bank: await loadBank(base, onProgress)};
  const items = [], names = all && lv.mode === 'levels' ? lv.levels.map(l => l.name) : lv.active;
  for (const n of names) {
    const bk = await loadBank({...base, level: n}, onProgress);
    for (const it of bk.items) items.push(lv.mode === 'levels' ? {...it, heading: n + (it.heading ? ' · ' + it.heading : '')} : it);
  }
  return {info: {...info, mode: lv.mode, levels: lv, active: names}, bank: {items, complete: true}};
}
// Asks the AI for the statements that fit a topic. A level-based curriculum is searched in the levels mapped to the year first, then in every level, so a topic
// the department placed in Year 9 is still found when the curriculum teaches it at another level. Returns {res, otherLevel}.
function topicContext(y, t) {
  const strand = S.map?.strands.find(s => s.id === t.strand)?.name;
  return ['Department: ' + S.dept.name, 'Target year: ' + y.label, strand ? 'Strand: ' + strand : '', S.map?.notes ? 'Overview notes: ' + S.map.notes : ''].filter(Boolean).join('\n').slice(0, 2000);
}
async function findFor(info, year, title, notes = '', options = {}) {
  const stage = options.stage || '';
  const lv = stage ? {mode:'levels',active:[stage],levels:[{name:stage}]} : await getLevels(info, year);
  const inLevels = lv.mode === 'levels' ? lv.active : [], all = stage ? inLevels : lv.mode === 'levels' ? lv.levels.map(l => l.name) : [];
  const call = levels => curriculumAi(() => fetch(CM.studio + '?action=find', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({csrf: CM.csrf, year, stage, topic: title, docId: info.doc.id, discipline: info.disc, levels, notes, pasted: '', pacedRetry: true})}).then(streamResult), options);
  const miss = e => /No matching curriculum statements/i.test(e.message || '');
  try { return {res: await call(inLevels), otherLevel: false}; }
  catch (e) {
    if (!miss(e)) throw e;
    if (all.length > inLevels.length) {
      try { return {res: await call(all), otherLevel: true}; } catch (e2) { if (!miss(e2)) throw e2; }
    }
    throw Error('The curriculum has no statements that fit “' + title + '”' + (all.length ? ' in any level (' + all.join(', ') + ')' : ' for Year ' + year) + '. The unit may be wider or more specific than the curriculum. Rename it closer to the curriculum wording, choose statements by hand, or mark it as done.');
  }
}
// Which levels a find request should be limited to (none for year-based documents).
async function levelsForFind(info, year) { const lv = await getLevels(info, year); return lv.mode === 'levels' ? lv.active : []; }

// The department confirms or edits which year groups use which proficiency level. A level can cover several years; a year can use several levels.
function levelsEditor(lv, doc, reopen) {
  const mapYears = S.map.years.map(y => parseInt(yearNum(y.label), 10)).filter(n => n >= 7 && n <= 13);
  const years = [...new Set([...mapYears, ...(lv.docYears || [])])].filter(n => n >= 7 && n <= 13).sort((a, b) => a - b);
  const state = lv.levels.map(l => ({name: l.name, years: new Set(l.years)}));
  const body = h('div', {}, h('p', {class: 'hint', style: 'margin:0 0 12px'}, 'This curriculum is organised by proficiency level, not by year group. Tick the year groups that use each level. A level can cover several year groups, and a year group can use more than one level.'),
    ...state.map(l => h('div', {class: 'cm-lvrow'}, h('b', {}, l.name),
      h('div', {class: 'cm-lvyears'}, ...years.map(y => { const cb = h('input', {type: 'checkbox'}); cb.checked = l.years.has(y); cb.onchange = () => { cb.checked ? l.years.add(y) : l.years.delete(y); };
        return h('label', {class: 'cm-lvy'}, cb, 'Year ' + y); })))));
  const save = h('button', {class: 'cm-btn pri', type: 'button', onclick: async () => {
    save.disabled = true; save.textContent = 'Saving…';
    const r = await post('levels-save', {department_id: S.dept.id, doc_id: doc.id, levels: state.map(l => ({name: l.name, years: [...l.years].sort((a, b) => a - b)}))});
    if (!r.ok) { save.disabled = false; save.textContent = 'Save mapping'; toast(r.error || 'Could not save the mapping.'); return; }
    Object.keys(levelsCache).forEach(k => delete levelsCache[k]);
    toast('Level mapping saved'); reopen();
  }}, 'Save mapping');
  openModal('Proficiency levels and year groups', body, [h('button', {class: 'cm-btn', type: 'button', onclick: reopen}, 'Cancel'), save]);
}

const words = t => new Set(flatWords(t));
const flatWords = t => String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);   // every word counts, numbers included, so different statements are never merged
function sameStatement(a, b) {
  const x = flatTxt(a), y = flatTxt(b);
  if (x === y) return true;
  const A = words(a), B = words(b); if (!A.size || !B.size) return false;
  let both = 0; for (const w of A) if (B.has(w)) both++;
  const jac = both / (A.size + B.size - both);
  return jac >= 0.85 || (jac >= 0.7 && (x.includes(y) || y.includes(x)));
}
// Statements brought in from an uploaded document keep the department's wording until they clearly match an official one, then take the official text and source.
async function relinkImported(year, info, items) {
  let linked = 0;
  for (const {y, t} of allTopics()) {
    if (parseInt(yearNum(y.label), 10) !== year || !(S.stmtCounts[t.id] > 0)) continue;
    const rows = await loadStatements(t.id), imp = rows.filter(r => /^Imported/.test(r.source || ''));
    if (!imp.length) continue;
    let touched = false;
    for (const r of imp) {
      const hit = items.find(i => i.kind === r.kind && sameStatement(r.text, i.text));
      if (hit) { Object.assign(r, {text: hit.text, source: hit.source, doc_id: info.doc.id, confidence: 100}); touched = true; linked++; }
    }
    if (touched) await saveStatements(t.id, rows);
  }
  return linked;
}
// After a map is imported or generated, get the statements ready for every year on it, quietly.
async function prefetchBanks() {
  const stages = [...new Set((S.map?.years || []).map(y => noviceOf(y.label)).filter(Boolean))];
  const years = [...new Set((S.map?.years || []).map(y => parseInt(yearNum(y.label), 10)).filter(n => n >= 7 && n <= 13))];
  let ready = 0;
  let linked = 0;
  for (const stage of stages) { try { const r = await ensureBank(7, null, false, stage); if (r.bank) ready++; } catch(e) { if (['rate_limit','quota','settings'].includes(e.code)) break; } }
  for (const yr of years) { try { const r = await ensureBank(yr); if (r.bank) { ready++; linked += await relinkImported(yr, r.info, r.bank.items).catch(() => 0); } } catch (e) { if (['rate_limit', 'quota', 'settings'].includes(e.code)) break; /* retry other failures on demand */ } }
  if (linked) toast('Matched ' + linked + ' imported statement' + (linked === 1 ? '' : 's') + ' to the official Ministry wording.');
  else if (ready) toast('Curriculum statements are ready to tick for ' + ready + ' year group' + (ready > 1 ? 's' : '') + '.');
}

// The statements a topic uses. All statements for the year and subject are listed under Knowledge and Practices with checkboxes;
// the AI can suggest ticks (optional), and anything it cannot match stays one click away.
function statementsPanel(y, t) {
  const box = h('div', {class: 'cm-stm'}), head = h('div', {class: 'cm-stmh'}), info = h('div', {class: 'cm-stmi'}), tools = h('div', {class: 'cm-stmt'}), list = h('div', {class: 'cm-bank'});
  box.append(head, info, tools, list);
  const others = new Map(), acked = new Set();   // statement text -> other topics using it; statements the teacher agreed to reuse
  let allLevels = false, rows = null, ctx = null, bank = null, busy = '', note = '', prog = '', q = '', show = 'all', timer = 0;
  const year = yearOf(y.label), stage = noviceOf(y.label);
  const rowFor = text => (rows || []).find(r => flatTxt(r.text) === flatTxt(text));
  const reopen = () => { closeModal(); const f = findTopic(t.id); if (f) (S.edit ? topicEditor(f.y, f.b, f.t, false) : topicDetails(f.y, f.b, f.t)); };
  const persist = () => { clearTimeout(timer); timer = setTimeout(() => saveStatements(t.id, rows.filter(r => r.selected || r.confidence != null)).then(paintHead).catch(e => toast(e.message)), 600); };
  const used = () => rows ? rows.filter(r => r.selected).length : 0;

  const paintHead = () => {
    const n = used();
    head.replaceChildren(h('h4', {}, 'Curriculum statements'), rows ? h('span', {class: 'cm-n'}, n + ' selected') : '',
      ctx ? h('span', {class: 'cm-for'}, y.label + ' · ' + (ctx.disc || ctx.doc.subject || S.dept.name) + ' · ' + (bank?.items || []).length + ' available') : '',
      rows && used() ? h('button', {class: 'cm-btn sm', type: 'button', title: 'Untick every statement for this unit', onclick: askClear}, 'Clear selection') : null,
      h('button', {class: 'cm-btn sm', type: 'button', disabled: !!busy || !ctx, title: 'Optional: the AI ticks the statements that best match this unit. You can still tick any others yourself.', onclick: suggest}, '✨ Suggest with AI (optional)'));
    const lvNote = () => {
      if (ctx?.mode === 'novice') return [h('p', {class: 'hint'}, 'Showing official ' + stage + ' language statements, rather than statements allocated to a school year.')];
      if (ctx?.mode === 'whole') return [h('p', {class: 'hint'}, 'This curriculum is not divided by year group, so every statement is offered for ' + y.label + '.')];
      if (ctx?.mode !== 'levels') return [];
      const lv = ctx.levels, ok = lv.levels.filter(l => ctx.active.includes(l.name)).every(l => l.confirmed);
      return [h('div', {class: 'cm-lvl' + (ok && !lv.noneMapped ? '' : ' warn')},
        h('span', {}, 'This curriculum is organised by proficiency level, not year group. ' + (allLevels ? 'Showing every level, whatever year group it is mapped to.' : lv.noneMapped ? 'No level is mapped to ' + y.label + ' yet, so every level is shown.' : y.label + ' uses ' + ctx.active.join(' and ') + '.') + (ok && !lv.noneMapped ? '' : ' This is a suggestion, so please check it.')),
        h('span', {class: 'cm-acts'}, h('button', {class: 'cm-btn sm', type: 'button', onclick: () => { allLevels = !allLevels; loadBankNow(); }}, allLevels ? 'Show mapped levels only' : 'Show all levels'),
          h('button', {class: 'cm-btn sm', type: 'button', onclick: () => levelsEditor(lv, ctx.doc, reopen)}, ok && !lv.noneMapped ? 'Change' : 'Check mapping')))];
    };
    info.replaceChildren(
      ...lvNote(),
      ...(prog ? [h('p', {class: 'hint cm-prog'}, prog)] : []), ...(busy ? [h('p', {class: 'hint'}, busy)] : []), ...(note ? [h('p', {class: 'hint', style: 'color:var(--warn)'}, note)] : []));
  };
  const askClear = () => {
    if (box.querySelector('.cm-clear')) return;
    head.after(h('div', {class: 'cm-warn cm-clear', role: 'alert'}, h('span', {}, 'Clear all ' + used() + ' selected statements for “' + t.title + '”? You would need to tick them again.'),
      h('span', {class: 'cm-acts'}, h('button', {class: 'cm-btn sm', type: 'button', onclick: e => e.target.closest('.cm-warn').remove()}, 'Keep them'),
        h('button', {class: 'cm-btn danger sm', type: 'button', onclick: async e => {
          const bar = e.target.closest('.cm-warn'); rows.forEach(r => { r.selected = false; r.confidence = null; }); clearTimeout(timer);
          try { await saveStatements(t.id, []); await post('match-mark', {department_id: S.dept.id, topic_id: t.id, status: 'reset'}); delete S.match[t.id]; paintBar(t.id, true); paintStrip(); rows = []; bar.remove(); paintHead(); paintList(); toast('Selection cleared'); }
          catch (err) { toast(err.message); }
        }}, 'Clear selection'))));
  };
  const paintTools = () => {
    const search = h('input', {type: 'search', placeholder: 'Search statements', value: q, 'aria-label': 'Search statements', oninput: e => { q = e.target.value; paintList(); }});
    const seg = h('div', {class: 'cm-seg', role: 'group', 'aria-label': 'Show'}, ...[['all', 'All'], ['on', 'Selected'], ['off', 'Not selected']].map(([k, label]) =>
      h('button', {type: 'button', class: show === k ? 'on' : '', 'aria-pressed': show === k ? 'true' : 'false', onclick: () => { show = k; paintTools(); paintList(); }}, label)));
    tools.replaceChildren(search, seg);
  };
  const card = (it, r) => {
    const key = flatTxt(it.text), usedIn = others.get(key) || [];
    const cb = h('input', {type: 'checkbox'}); cb.checked = !!r?.selected;
    const lab = h('label', {class: 'cm-sr' + (cb.checked ? ' on' : '') + (usedIn.length ? ' used' : '')}, cb,
      h('div', {}, h('p', {}, it.text), h('small', {}, it.source || ''), usedIn.length ? h('small', {class: 'cm-usedin'}, 'Already used in: ' + usedIn.map(u => u.title + ' (' + u.where + ')').join(', ')) : ''),
      r && r.confidence != null ? confBadge(r.confidence) : h('span', {}));
    const wrap = h('div', {class: 'cm-swr'}, lab);
    const apply = on => {
      let row = rowFor(it.text);
      if (!row) { row = {kind: it.kind, text: it.text, source: it.source || '', doc_id: ctx?.doc.id || '', confidence: null, selected: false}; rows.push(row); }
      row.selected = on; cb.checked = on; lab.classList.toggle('on', on); paintHead(); persist();
      if (show !== 'all') paintList();
    };
    cb.onchange = () => {
      if (cb.checked && usedIn.length && !acked.has(key)) {
        cb.checked = false;
        if (wrap.querySelector('.cm-warn')) return;
        wrap.append(h('div', {class: 'cm-warn', role: 'alert'},
          h('span', {}, '⚠ This statement is already used in ' + usedIn.map(u => u.title + ' (' + u.where + ')').join(', ') + '. Use it in this unit as well?'),
          h('span', {class: 'cm-acts'}, h('button', {class: 'cm-btn sm', type: 'button', onclick: e => e.target.closest('.cm-warn').remove()}, 'Cancel'),
            h('button', {class: 'cm-btn pri sm', type: 'button', onclick: e => { acked.add(key); e.target.closest('.cm-warn').remove(); apply(true); }}, 'Use it here too'))));
        return;
      }
      apply(cb.checked);
    };
    return wrap;
  };
  const paintList = () => {
    if (rows === null) { list.replaceChildren(h('p', {class: 'hint'}, 'Loading…')); return; }
    const isOn = it => !!rowFor(it.text)?.selected;
    const match = it => (!q.trim() || flatTxt(it.text + ' ' + (it.heading || '')).includes(flatTxt(q))) && (show === 'all' || (show === 'on') === isOn(it));
    const empty = show === 'on' ? 'Nothing selected here yet.' : show === 'off' ? 'Everything here is selected.' : 'No statements match your search.';
    const cols = [];
    const section = (title, kind) => {
      const items = (bank?.items || []).filter(i => i.kind === kind), shown = items.filter(match);
      if (!items.length) return;
      const ticked = items.filter(isOn).length, col = h('div', {class: 'cm-col'});
      col.append(h('h5', {class: 'cm-sec'}, title, h('span', {}, ticked + ' of ' + items.length + ' selected')));
      let last = null;
      shown.forEach(it => { if ((it.heading || '') !== last) { last = it.heading || ''; if (last) col.append(h('div', {class: 'cm-hd'}, last)); } col.append(card(it, rowFor(it.text))); });
      if (!shown.length) col.append(h('p', {class: 'hint'}, empty));
      cols.push(col);
    };
    section('Knowledge', 'knowledge'); section('Practices', 'practice');
    const out = [];
    // statements saved earlier (or suggested by the AI) whose wording is not in the list above stay available
    const inBank = new Set((bank?.items || []).map(i => flatTxt(i.text)));
    const extra = rows.filter(r => !inBank.has(flatTxt(r.text)) && (!q.trim() || flatTxt(r.text).includes(flatTxt(q))) && (show === 'all' || (show === 'on') === !!r.selected));
    if (extra.length) {
      const col = h('div', {class: 'cm-col wide'}, h('h5', {class: 'cm-sec'}, bank ? 'Other linked statements' : 'Linked statements', h('span', {}, extra.length)));
      extra.forEach(r => col.append(card({kind: r.kind, text: r.text, source: (r.kind === 'practice' ? 'Practice' : 'Knowledge') + (r.source ? ' · ' + r.source : '')}, r)));
      cols.push(col);
    }
    if (!cols.length && !prog) out.push(h('p', {class: 'hint'}, ctx ? 'No statements found for this year.' : 'No statements to show yet.'));
    list.classList.toggle('one', cols.length < 2);
    list.replaceChildren(...cols, ...out);
  };
  async function suggest() {
    if (!ctx) return;
    curriculumAi.resetBlock();
    busy = 'The AI is choosing the best matches. You can keep ticking while it works…'; note = ''; paintHead();
    try {
      const {res, otherLevel} = await findFor(ctx, year, t.title, topicContext(y, t), {stage});
      if (otherLevel) for (const arr of [res.knowledge, res.practices]) for (const x of arr) x.source = (x.source || '') + ' · from a level not mapped to this year';
      for (const [kind, arr] of [['knowledge', res.knowledge], ['practice', res.practices]]) for (const s of arr) {
        const conf = s.confidence ?? null, row = rowFor(s.text);
        if (row) { row.confidence = conf; row.selected = row.selected || (conf ?? 0) >= 60; }
        else rows.push({kind, text: s.text, source: s.source || '', doc_id: ctx.doc.id, confidence: conf, selected: (conf ?? 0) >= 60});
      }
      note = (res.warnings || []).join(' ');
      await saveStatements(t.id, rows.filter(r => r.selected || r.confidence != null));
      recordMatch(t.id, used() ? 'done' : 'attention', used(), used() ? '' : (note || 'The AI found no statement it was confident enough to tick (60% or more).'));
    } catch (e) { note = e.message; }
    busy = ''; paintHead(); paintList();
  }
  async function loadBankNow() {
    try {
      const r = await ensureBank(year, p => { prog = 'Reading the curriculum for ' + y.label + ': part ' + p.done + ' of ' + p.total + '. This only happens once per source and stage.'; paintHead(); }, allLevels, stage);
      prog = ''; ctx = r.info; bank = r.bank;
      if (!ctx) note = 'No Ministry curriculum document matches “' + S.dept.name + '” for ' + y.label + '. Open the unit plan to paste your own curriculum text.';
    } catch (e) { prog = ''; note = e.message; }
    paintHead(); paintList();
  }
  paintHead(); paintTools(); paintList();
  (async () => {
    try { rows = await loadStatements(t.id); } catch (e) { rows = []; note = e.message; }
    paintHead(); paintList();
    try {   // where else each statement is already used in this department
      const names = {};
      for (const yy of S.map.years) for (const bb of yy.blocks) for (const tt of bb.topics) names[tt.id] = {title: tt.title, where: yy.label + ' · ' + termName(yy, bb)};
      const all = await get({action: 'statements', department_id: S.dept.id});
      for (const r of all.statements || []) if (r.selected && r.topic_id !== t.id && names[r.topic_id]) { const k = flatTxt(r.text); if (!others.has(k)) others.set(k, []); others.get(k).push(names[r.topic_id]); }
    } catch (e) { /* the list still works without the used-in hints */ }
    paintList();
    if (!(year >= 7 && year <= 13)) { note = 'Use a Year 7–13 label or a language Novice 1–3 label to find curriculum statements.'; paintHead(); return; }
    await loadBankNow();
  })();
  return box;
}

const stageLabel = y => noviceOf(y.label) ? 'Proficiency stage' : 'Year';
function topicDetails(y, b, t) {
  const st = strandOf(t.strand), ty = typeOf(t.assess);
  openModal(t.title, h('div', {class: 'cm-det'},
    h('div', {}, h('span', {}, stageLabel(y)), h('b', {}, y.label + ' · ' + termName(y, b))),
    st ? h('div', {}, h('span', {}, 'Strand'), h('span', {class: 'cm-pill', style: '--c:' + st.color}, st.name)) : null,
    t.assess ? h('div', {}, h('span', {}, 'Assessment'), h('span', {}, h('span', {class: 'cm-code'}, t.assess), ' ', ty?.label || '')) : null,
    t.owner ? h('div', {}, h('span', {}, 'Taught by'), h('b', {}, t.owner)) : null,
    t.optional ? h('div', {}, h('span', {}, 'Status'), h('span', {}, 'Optional, if time allows')) : null),
  [h('button', {class: 'cm-btn', type: 'button', onclick: () => { closeModal(); render(); }}, 'Close'),
   h('a', {class: 'cm-btn pri', href: guideUrl(y, t)}, 'Open unit plan')], 'xl');
  modalEl.querySelector('.cm-det').after(statementsPanel(y, t));
}

function topicEditor(y, b, t, isNew) {
  const title = h('input', {type: 'text', value: t.title, maxlength: '120', placeholder: 'Unit name'});
  const strand = h('select', {}, h('option', {value: ''}, 'No strand'), ...S.map.strands.map(s => h('option', {value: s.id, selected: s.id === t.strand}, s.name)));
  const assess = h('select', {}, h('option', {value: ''}, 'None'), ...S.map.assessTypes.map(a => h('option', {value: a.code, selected: a.code === t.assess}, a.code + (a.label ? ' · ' + a.label : ''))));
  const owner = h('input', {type: 'text', value: t.owner, maxlength: '24', placeholder: 'e.g. KENH'});
  const optional = h('input', {type: 'checkbox'}); optional.checked = !!t.optional;
  const where = h('select', {}, ...S.map.years.flatMap((yy, yi) => yy.blocks.map((bb, bi) => h('option', {value: yy.id + '|' + bb.id, selected: bb.id === b.id}, yy.label + ' · ' + termName(yy, bb)))));
  openModal(isNew ? 'Add a unit' : 'Edit unit', h('div', {},
    field('Unit', title),
    h('div', {class: 'cm-row2'}, field('Strand', strand), field('Assessment', assess)),
    h('div', {class: 'cm-row2'}, field('Taught by', owner, 'Initials or name'), field('Where', where)),
    h('label', {class: 'f', style: 'display:flex;gap:8px;align-items:center'}, optional, 'Optional, only if time allows'),
    isNew ? null : statementsPanel(y, t)),
  [!isNew ? h('button', {class: 'cm-btn danger', type: 'button', style: 'margin-right:auto', onclick: () => { b.topics = b.topics.filter(x => x.id !== t.id); closeModal(); changed(); }}, 'Delete') : null,
   !isNew ? h('a', {class: 'cm-btn', href: guideUrl(y, t)}, 'Unit plan') : null,
   h('button', {class: 'cm-btn', type: 'button', onclick: closeModal}, 'Cancel'),
   h('button', {class: 'cm-btn pri', type: 'button', onclick: () => {
     const name = title.value.trim(); if (!name) { title.focus(); return; }
     Object.assign(t, {title: name, strand: strand.value, assess: assess.value, owner: owner.value.trim(), optional: optional.checked});
     const [yid, bid] = where.value.split('|');
     const ty = S.map.years.find(q => q.id === yid), tb = ty?.blocks.find(q => q.id === bid);
     const target = tb || b;
     if (!(target === b && b.topics.includes(t))) { b.topics = b.topics.filter(x => x.id !== t.id); target.topics.push(t); }
     closeModal(); changed();
   }}, isNew ? 'Add unit' : 'Save')], isNew ? true : 'xl');
}

function strandsEditor() {
  const strands = S.map.strands.map(s => ({...s})), types = S.map.assessTypes.map(a => ({...a}));
  const wrap = h('div', {});
  const paint = () => {
    wrap.replaceChildren(
      h('p', {class: 'hint', style: 'margin:0 0 10px'}, 'Strands colour the units (for example Biology, Chemistry, Physics).'),
      ...strands.map((s, i) => h('div', {class: 'cm-srow'},
        h('div', {class: 'cm-sw'}, ...PALETTE.map(c => h('button', {type: 'button', 'aria-label': 'Colour ' + c, class: s.color === c ? 'on' : '', style: '--c:' + c, onclick: () => { s.color = c; paint(); }}))),
        h('input', {type: 'text', value: s.name, maxlength: '40', 'aria-label': 'Strand name', oninput: e => { s.name = e.target.value; }}),
        h('button', {class: 'cm-btn sm danger', type: 'button', onclick: () => { strands.splice(i, 1); paint(); }}, 'Remove'))),
      h('button', {class: 'cm-btn sm', type: 'button', onclick: () => { strands.push({id: uid(), name: '', color: PALETTE[strands.length % PALETTE.length]}); paint(); }}, '＋ Add strand'),
      h('p', {class: 'hint', style: 'margin:18px 0 10px'}, 'Assessment types appear as a badge on each unit (for example T = End-of-unit test).'),
      ...types.map((a, i) => h('div', {class: 'cm-trow'},
        h('input', {type: 'text', value: a.code, maxlength: '3', 'aria-label': 'Code', oninput: e => { a.code = e.target.value.toUpperCase(); }}),
        h('input', {type: 'text', value: a.label, maxlength: '60', 'aria-label': 'Meaning', placeholder: 'What it means', oninput: e => { a.label = e.target.value; }}),
        h('button', {class: 'cm-btn sm danger', type: 'button', onclick: () => { types.splice(i, 1); paint(); }}, 'Remove'))),
      h('button', {class: 'cm-btn sm', type: 'button', onclick: () => { types.push({code: '', label: ''}); paint(); }}, '＋ Add type'));
  };
  paint();
  openModal('Strands and key', wrap, [
    h('button', {class: 'cm-btn', type: 'button', onclick: closeModal}, 'Cancel'),
    h('button', {class: 'cm-btn pri', type: 'button', onclick: () => {
      const keep = strands.filter(s => s.name.trim()), ids = new Set(keep.map(s => s.id)), codes = new Set(types.filter(a => a.code.trim()).map(a => a.code.trim().toUpperCase()));
      for (const y of S.map.years) for (const b of y.blocks) for (const t of b.topics) { if (!ids.has(t.strand)) t.strand = ''; if (!codes.has(t.assess)) t.assess = ''; }
      S.map.strands = keep.map(s => ({...s, name: s.name.trim()}));
      S.map.assessTypes = types.filter(a => a.code.trim()).map(a => ({code: a.code.trim().toUpperCase(), label: a.label.trim()}));
      closeModal(); changed();
    }}, 'Save')]);
}

// Two destructive options, each needing the word typed in capitals so nothing is lost by a stray click.
function resetMapDialog() {
  const total = Object.values(S.stmtCounts).reduce((a, b) => a + b, 0), topics = Object.values(S.stmtCounts).filter(n => n > 0).length;
  let mode = 'statements', typed = '';
  const body = h('div', {}), word = () => mode === 'statements' ? 'RESET' : 'DELETE';
  const confirmBtn = h('button', {class: 'cm-btn danger', type: 'button', disabled: true}, '');
  const paint = () => {
    const opt = (k, label, text) => h('label', {class: 'cm-opt' + (mode === k ? ' on' : '')}, h('input', {type: 'radio', name: 'cm-reset', checked: mode === k, onchange: () => { mode = k; typed = ''; paint(); }}), h('div', {}, h('b', {}, label), h('small', {}, text)));
    const box = h('input', {type: 'text', value: typed, placeholder: 'Type ' + word(), 'aria-label': 'Type ' + word() + ' to confirm', autocomplete: 'off', oninput: e => { typed = e.target.value; confirmBtn.disabled = typed.trim() !== word(); }});
    body.replaceChildren(
      opt('statements', 'Reset the curriculum statements', total ? 'Unticks and removes all ' + total + ' selected statement' + (total === 1 ? '' : 's') + ' across ' + topics + ' unit' + (topics === 1 ? '' : 's') + ' and clears the matching progress. The map and its units stay. Unit plans you have already drafted keep their text. A copy of the statements is kept for recovery.' : 'There are no selected statements to reset yet.'),
      opt('map', 'Delete the whole map', 'Removes the ' + S.dept.name + ' map (every year, term and unit) and its statements for the whole department. A copy of the map is kept in its history and the statements are copied aside, so an administrator can recover them. Unit plans you have drafted keep their text.'),
      h('label', {class: 'f', style: 'margin-top:12px'}, h('span', {}, 'To confirm, type ' + word()), box));
    confirmBtn.textContent = mode === 'statements' ? 'Reset statements' : 'Delete the map'; confirmBtn.disabled = typed.trim() !== word();
  };
  confirmBtn.onclick = async () => {
    if (typed.trim() !== word()) return;
    confirmBtn.disabled = true; confirmBtn.textContent = 'Working…';
    const id = S.dept.id;
    const r = await post('reset-statements', {department_id: id});
    if (!r.ok) { toast(r.error || 'Could not reset the statements.'); confirmBtn.disabled = false; paint(); return; }
    S.stmtCounts = {}; S.match = {}; S.stmtAll = null; S.lastRun = null; S.onlyAttn = false;
    if (mode === 'map') {
      const d = await post('delete', {department_id: id});
      if (!d.ok) { S.banner = {kind: 'err', text: d.error || 'The statements were reset but the map could not be deleted.'}; closeModal(); render(); return; }
      S.map = null; S.version = 0; S.edit = false; S.draft = false; S.review = false; S.banner = null; closeModal(); render(); toast('Map deleted');
    } else { closeModal(); render(); toast('Statements reset'); }
  };
  paint();
  openModal('Reset or delete', body, [h('button', {class: 'cm-btn', type: 'button', onclick: closeModal}, 'Cancel'), confirmBtn]);
}

function confirmModal(title, text, label, fn) {
  openModal(title, h('p', {style: 'margin:0 0 12px'}, text), [
    h('button', {class: 'cm-btn', type: 'button', onclick: closeModal}, 'Cancel'),
    h('button', {class: 'cm-btn pri', type: 'button', onclick: () => { closeModal(); fn(); }}, label)]);
}

// ---------------------------------------------------------------- map rendering
function chip(y, b, t) {
  const st = strandOf(t.strand);
  const el = h('button', {type: 'button', class: 'cm-chip' + (t.optional ? ' opt' : ''), draggable: S.edit ? 'true' : false,
    onclick: () => S.edit ? topicEditor(y, b, t, false) : topicDetails(y, b, t),
    title: S.edit ? 'Edit or drag to another term' : 'Open details'},
    h('b', {}, t.title),
    t.assess || t.owner || t.optional ? h('small', {}, t.assess ? h('span', {class: 'cm-code'}, t.assess) : null, t.owner ? h('span', {}, t.owner) : null, t.optional ? h('span', {}, 'if time') : null) : null);
  if (S.edit) {
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; });
  }
  const open = S.open.has(t.id), body = h('div', {class: 'cm-tx', id: 'cm-tx-' + t.id, hidden: !open});
  const bar = h('button', {type: 'button', class: 'cm-tbar', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'cm-tx-' + t.id, title: 'Show the statements for this unit',
    onclick: () => {
      const now = !S.open.has(t.id); now ? S.open.add(t.id) : S.open.delete(t.id);
      bar.setAttribute('aria-expanded', now ? 'true' : 'false'); body.hidden = !now; paintBar(t.id);
      if (now) fillTopicStatements(body, y, b, t);
    }});
  const wrap = h('div', {class: 'cm-tw', 'data-t': t.id, style: st ? '--c:' + st.color : ''}, el, bar, body);
  tiles.set(t.id, {y, b, t, bar, body, wrap});
  paintBar(t.id);
  if (open) fillTopicStatements(body, y, b, t);
  return wrap;
}
// The expanded box: only the statements ticked for the topic, grouped Knowledge / Practices.
function fillTopicStatements(body, y, b, t) {
  body.replaceChildren(h('p', {class: 'cm-txn'}, 'Loading…'));
  deptStatements().then(all => {
    if (body.hidden) return;
    const mine = all.filter(x => x.topic_id === t.id), state = tileState(t.id), rec = S.match[t.id];
    const group = (title, kind) => {
      const list = mine.filter(x => (x.kind === 'practice' ? 'practice' : 'knowledge') === kind);
      return list.length ? [h('div', {class: 'cm-txh'}, title, h('span', {}, list.length)), ...list.map(x => h('div', {class: 'cm-txi'}, h('i', {'aria-hidden': 'true'}, '✓'), h('span', {}, x.text, /^Imported/.test(x.source || '') ? h('span', {class: 'cm-imp', title: x.source}, 'from your document') : null), x.confidence != null ? confBadge(x.confidence) : h('span', {})))] : [];
    };
    const open = () => S.edit ? topicEditor(y, b, t, false) : topicDetails(y, b, t);
    const acts = [h('button', {type: 'button', class: 'cm-txe', onclick: open}, mine.length ? 'Review and change' : 'Choose statements')];
    if (mine.length) acts.push(h('a', {class: 'cm-txe cm-txg', href: guideUrl(y, t), title: 'Start the unit plan for this unit from these statements'}, 'Draft unit plan →'));
    if (state === 'todo' && eligible(y)) acts.push(h('button', {type: 'button', class: 'cm-txe', disabled: !!S.run, onclick: () => matchAll([t.id])}, '✨ Match with AI'));
    if (state === 'attn') acts.push(h('button', {type: 'button', class: 'cm-txe', disabled: !!S.run, onclick: () => matchAll([t.id])}, 'Try the AI again'), h('button', {type: 'button', class: 'cm-txe', onclick: () => recordMatch(t.id, 'done', 0, 'Reviewed: no statements apply.')}, 'None apply: mark as done'));
    body.replaceChildren(
      ...(state === 'attn' ? [h('p', {class: 'cm-txn warn'}, '! Needs attention. ' + (rec?.note || 'No statements are ticked for this unit.'))] : []),
      ...(state === 'ok' && !mine.length ? [h('p', {class: 'cm-txn'}, 'Reviewed: no statements apply to this unit.')] : []),
      ...(state === 'run' || state === 'queue' ? [h('p', {class: 'cm-txn'}, 'The AI is matching this unit…')] : []),
      ...(mine.length ? [...group('Knowledge', 'knowledge'), ...group('Practices', 'practice')] : state === 'todo' ? [h('p', {class: 'cm-txn'}, 'Not matched yet.')] : []),
      h('div', {class: 'cm-txa'}, ...acts));
  }).catch(() => body.replaceChildren(h('p', {class: 'cm-txn'}, 'Could not load the statements.')));
}
function cell(y, b) {
  const el = h('div', {class: 'cm-cell'}, ...b.topics.map(t => chip(y, b, t)),
    !b.topics.length && !S.edit ? h('div', {class: 'cm-empty-cell'}, '—') : null,
    S.edit ? h('button', {class: 'cm-add', type: 'button', onclick: () => topicEditor(y, b, {id: uid(), title: '', strand: '', assess: '', owner: '', optional: false}, true)}, '＋ Unit') : null);
  if (S.edit) {
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('over');
      const f = findTopic(e.dataTransfer.getData('text/plain')); if (!f || f.b === b) return;
      f.b.topics.splice(f.i, 1); b.topics.push(f.t); changed();
    });
  }
  return el;
}
function yearRow(y, yi) {
  const n = Math.max(1, y.blocks.length);
  const head = h('div', {class: 'cm-yh'},
    S.edit ? h('input', {type: 'text', value: y.label, maxlength: '40', 'aria-label': stageLabel(y) + ' label', oninput: e => { y.label = e.target.value; clearTimeout(saveTimer); if (!S.draft) { S.saveState = 'saving'; paintSave(); saveTimer = setTimeout(save, 900); } }}) : y.label,
    S.edit ? h('div', {style: 'display:flex;gap:4px;flex-wrap:wrap'},
      yi > 0 ? h('button', {class: 'cm-btn sm', type: 'button', 'aria-label': 'Move year up', onclick: () => { [S.map.years[yi - 1], S.map.years[yi]] = [S.map.years[yi], S.map.years[yi - 1]]; changed(); }}, '↑') : null,
      yi < S.map.years.length - 1 ? h('button', {class: 'cm-btn sm', type: 'button', 'aria-label': 'Move year down', onclick: () => { [S.map.years[yi + 1], S.map.years[yi]] = [S.map.years[yi], S.map.years[yi + 1]]; changed(); }}, '↓') : null,
      h('button', {class: 'cm-btn sm danger', type: 'button', onclick: () => confirmModal('Remove ' + (y.label || 'this year') + '?', 'Its terms and units will be removed from the map.', 'Remove', () => { S.map.years.splice(yi, 1); changed(); })}, 'Remove')) : null);
  const row = h('section', {class: 'cm-year', style: '--n:' + n, 'aria-label': y.label}, head);
  y.blocks.forEach((b, bi) => {
    row.append(h('div', {}, h('div', {class: 'cm-bh'},
      S.edit ? h('input', {type: 'text', value: /^(block|term)\s*\d+$/i.test((b.label || '').trim()) ? '' : b.label, maxlength: '40', placeholder: 'Term ' + (bi + 1), 'aria-label': 'Term label', oninput: e => { b.label = e.target.value; clearTimeout(saveTimer); if (!S.draft) { S.saveState = 'saving'; paintSave(); saveTimer = setTimeout(save, 900); } }}) : termName(y, b),
      S.edit ? h('button', {class: 'cm-btn sm danger', type: 'button', 'aria-label': 'Remove term', onclick: () => confirmModal('Remove this term?', 'Its units will be removed from the map.', 'Remove', () => { y.blocks.splice(bi, 1); changed(); })}, '✕') : null), cell(y, b)));
  });
  if (!y.blocks.length) row.append(h('div', {class: 'cm-empty-cell'}, 'No terms yet'));
  if (S.edit) row.append(h('div', {class: 'cm-addblk'}, h('button', {class: 'cm-add', type: 'button', style: 'width:100%', onclick: () => { y.blocks.push({id: uid(), label: '', topics: []}); changed(); }}, '＋ Add a term to ' + (y.label || 'this group'))));
  return row;
}

function mapView() {
  const c = counts();
  const el = h('div', {class: 'cm-in'});
  if (S.conflict) el.append(h('div', {class: 'cm-banner err'}, h('span', {}, 'A colleague changed this map, so your latest edit was not saved.'), h('button', {class: 'cm-btn sm', type: 'button', onclick: () => load(S.dept.id)}, 'Reload the latest map')));
  if (S.banner) el.append(h('div', {class: 'cm-banner ' + S.banner.kind}, h('span', {}, S.banner.text)));
  if (S.review && !S.draft) el.append(h('div', {class: 'cm-banner info'},
    h('span', {}, (S.sourceKind === 'ai' ? 'The AI drafted this sequence. ' + (S.note || '') : S.source ? 'Imported from ' + S.source + '.' + (S.note ? ' ' + S.note : '') : 'New map created.') + ' It is saved for your department.' + (S.importResult ? ' ' + S.importResult.statements + ' statement' + (S.importResult.statements === 1 ? '' : 's') + ' from your document were kept exactly as written across ' + S.importResult.topics + ' unit' + (S.importResult.topics === 1 ? '' : 's') + '. Open any unit’s statement count to check them.' : '') + ' Check the sequence over and fix anything that is off, then you can draft the unit plans.'),
    h('span', {class: 'cm-acts'}, h('button', {class: 'cm-btn sm', type: 'button', onclick: discardMap}, 'Discard map'), h('button', {class: 'cm-btn pri sm', type: 'button', onclick: () => { S.review = false; render(); }}, 'Looks good'))));
  if (S.draft) el.append(h('div', {class: 'cm-banner info'}, h('span', {}, S.sourceKind === 'ai' ? 'The AI drafted this sequence. ' + (S.note || '') + ' Check the order, units and assessments, change anything that is off, then save it for your department.' : S.source ? 'Imported from ' + S.source + '. Check it over, fix anything that is off, then save it for your department.' : 'This is a new draft. Add your units, then save it for your department.'),
    h('span', {class: 'cm-acts'}, h('button', {class: 'cm-btn sm', type: 'button', onclick: () => confirmModal('Discard this draft?', 'It has not been saved yet, so it will be lost.', 'Discard', () => { S.map = null; S.draft = false; S.edit = false; S.banner = null; render(); })}, 'Discard'), h('button', {class: 'cm-btn pri sm', type: 'button', onclick: () => save(true)}, 'Save map'))));
  el.append(h('div', {class: 'cm-bar'},
    h('div', {style: 'min-width:0;flex:1 1 360px'},
      S.edit ? h('input', {type: 'text', value: S.map.title, maxlength: '140', placeholder: 'Map title', 'aria-label': 'Map title', style: 'font-size:22px;font-weight:750', oninput: e => { S.map.title = e.target.value; if (!S.draft) { S.saveState = 'saving'; paintSave(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 900); } }}) : h('h2', {}, S.map.title || S.dept.name + ' curriculum map'),
      S.edit ? h('input', {type: 'text', value: S.map.whakatauki || '', maxlength: '600', placeholder: 'Department whakataukī (optional), used in unit plans', 'aria-label': 'Department whakataukī', style: 'margin-top:8px', oninput: e => { S.map.whakatauki = e.target.value; if (!S.draft) { S.saveState = 'saving'; paintSave(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 900); } }}) : (S.map.whakatauki ? h('div', {class: 'cm-meta', style: 'font-style:italic'}, S.map.whakatauki) : null),
      S.updatedAt && !S.draft ? h('div', {class: 'cm-meta'}, 'Last updated ' + ago(S.updatedAt) + (S.updatedBy ? ' by ' + S.updatedBy : '')) : null),
    h('div', {class: 'cm-acts'},
      S.draft ? null : h('span', {class: 'cm-save ' + (S.saveState === 'error' ? 'err' : 'ok'), role: 'button', tabindex: '0', onclick: () => { if (S.saveState === 'error') save(); }}, S.saveState === 'error' ? 'Not saved. Click to retry' : S.saveState === 'saving' ? 'Saving…' : 'Saved'),
      S.edit && isLanguageDept() ? h('button', {class: 'cm-btn', type: 'button', onclick: () => {
        const existing = new Set(S.map.years.map(y => noviceOf(y.label)).filter(Boolean));
        const missing = ['Novice 1', 'Novice 2', 'Novice 3'].filter(n => !existing.has(n));
        if (!missing.length) { toast('All three Novice groups are already present.'); return; }
        const count = Math.min(8, Math.max(1, S.map.years[0]?.blocks.length || 4));
        for (const label of missing) S.map.years.push({id:uid(),label,blocks:Array.from({length:count},()=>({id:uid(),label:'',topics:[]}))});
        changed(); toast('Added missing Novice groups. Existing units and year rows were preserved; move units into the stages you want.');
      }}, 'Add Novice groups') : null,
      S.edit ? h('button', {class: 'cm-btn', type: 'button', onclick: strandsEditor}, 'Strands & key') : null,
      S.edit ? h('button', {class: 'cm-btn', type: 'button', onclick: () => confirmModal('Replace this map?', 'The current map is removed from the department (a copy is kept for recovery) and you can upload a different file or build a new one.', 'Replace it', async () => { const r = await post('delete', {department_id: S.dept.id}); if (r.ok) { S.map = null; S.version = 0; S.edit = false; S.draft = false; S.banner = null; render(); } else { S.banner = {kind: 'err', text: r.error || 'Could not replace the map.'}; render(); } })}, 'Replace map') : null,
      S.draft ? null : h('button', {class: 'cm-btn', type: 'button', onclick: openCoverage}, 'Curriculum coverage'),
      S.draft || S.review ? null : h('button', {class: 'cm-btn danger-o', type: 'button', onclick: resetMapDialog}, 'Reset or delete…'),
      S.draft ? null : h('a', {class: 'cm-btn', href: CM.api + '?' + new URLSearchParams({action: 'export-docx', department_id: S.dept.id}), download: '', title: 'Every year group, term and unit with its selected curriculum statements, as one Word document'}, 'Download as Word (.docx)'),
      h('button', {class: 'cm-btn', type: 'button', onclick: () => print()}, 'Print'),
      h('button', {class: 'cm-btn ' + (S.edit ? 'pri' : ''), type: 'button', onclick: () => { S.edit = !S.edit; if (!S.edit && S.saveState === 'saving') save(); render(); }}, S.edit ? 'Done editing' : 'Edit map'))));
  el.append(h('div', {class: 'cm-legend'},
    ...S.map.strands.map(s => h('span', {class: 'cm-pill', style: '--c:' + s.color}, s.name)),
    S.edit && !S.map.strands.length ? h('button', {class: 'cm-btn sm', type: 'button', onclick: strandsEditor}, '＋ Add strands (for example Biology, Chemistry, Physics)') : null,
    S.map.assessTypes.length ? h('div', {class: 'cm-key'}, ...S.map.assessTypes.map(a => h('span', {}, h('b', {}, a.code), a.label ? ' = ' + a.label : ''))) : null));
  tiles.clear();
  if (!S.draft && !S.review) { el.append(h('div', {class: 'cm-mstrip', id: 'cm-mstrip'})); }
  el.append(h('div', {class: 'cm-map'}, ...S.map.years.map(yearRow)));
  if (!S.draft && !S.review) queueMicrotask(() => paintStrip());
  if (S.edit) el.append(h('button', {class: 'cm-btn cm-addyear', type: 'button', onclick: () => {
    const last = S.map.years.at(-1), n = last ? parseInt(yearNum(last.label), 10) : NaN;
    S.map.years.push({id: uid(), label: Number.isFinite(n) ? 'Year ' + (n + 1) : 'New year', blocks: Array.from({length: Math.max(1, last?.blocks.length || 4)}, () => ({id: uid(), label: '', topics: []}))});
    changed();
  }}, '＋ Add a year'));
  el.append(h('div', {class: 'cm-foot'},
    c.core ? h('div', {}, h('b', {}, 'Core units: '), c.core + ' ' + rangeText() + '.' + (c.opt ? ' Optional units: ' + c.opt + '.' : '')) : null,
    S.edit ? h('textarea', {rows: 2, placeholder: 'Notes shown under the map (for example when it was last reviewed)', 'aria-label': 'Notes', oninput: e => { S.map.notes = e.target.value; if (!S.draft) { S.saveState = 'saving'; paintSave(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 900); } }}, S.map.notes || '')
      : (S.map.notes ? h('div', {style: 'white-space:pre-wrap'}, S.map.notes) : null),
    !c.core && !S.map.notes && !S.edit ? h('div', {}, 'Units with an assessment type are counted here.') : null));
  return el;
}

// ---------------------------------------------------------------- no map yet: create or import
function startFromScratch(f) {
  const novice = isLanguageDept();
  const first = novice ? 7 : parseInt(f.first, 10), last = novice ? 9 : parseInt(f.last, 10);
  if (!(first >= 1 && last >= first && last - first < 13)) return 'Check the first and last year.';
  const per = Math.min(12, Math.max(1, parseInt(f.blocks, 10) || 4));
  let n = 0;
  const strands = f.strands.split(/[,\n]/).map(s => s.trim()).filter(Boolean).slice(0, 12).map((name, i) => ({id: uid(), name, color: PALETTE[i % PALETTE.length]}));
  const assessTypes = f.types.split(/[;\n]/).map(s => { const [code, ...rest] = s.split(/[=:]/); return {code: (code || '').trim().toUpperCase().slice(0, 3), label: rest.join('=').trim()}; }).filter(a => a.code);
  S.map = {v: 1, title: f.title.trim(), notes: '', strands, assessTypes,
    years: Array.from({length: last - first + 1}, (_, i) => ({id: uid(), label: novice ? 'Novice ' + (i + 1) : 'Year ' + (first + i), blocks: Array.from({length: per}, () => ({id: uid(), label: '', topics: []}))}))};
  S.draft = false; S.review = true; S.edit = true; S.source = ''; S.sourceKind = ''; S.version = 0; S.banner = null;
  render(); saveNew();
  return '';
}

// Keeps the department's own statement allocations: the statements the uploaded document listed under each topic are saved exactly as written.
async function persistImport() {
  const stm = S.importStmts; S.importStmts = null;
  const r = await post('import-statements', {department_id: S.dept.id, statements: stm, source: S.source || 'your document'});
  if (!r.ok) { S.banner = {kind: 'err', text: 'The map was saved, but the statements in your document could not be: ' + (r.error || 'unknown problem') + ' Open each unit to add them.'}; return; }
  S.stmtCounts = {...(r.counts || {})}; S.stmtAll = null; S.importResult = {topics: r.topics, statements: r.statements};
  for (const id of Object.keys(stm)) S.match[id] = {status: 'done', found: (stm[id] || []).length, note: 'Imported from your document'};
}

async function saveNew() {
  S.saveState = 'saving'; render();
  const r = await post('save', {department_id: S.dept.id, map: S.map, version: 0});
  if (r.ok) { S.version = r.version; S.updatedAt = new Date().toISOString(); S.updatedBy = 'you'; S.saveState = 'saved'; if (S.importStmts) await persistImport(); setTimeout(prefetchBanks, 300); }
  else { S.draft = true; S.review = false; S.saveState = 'error'; S.banner = {kind: 'err', text: 'The new map could NOT be saved: ' + (r.error || 'unknown problem') + ' Press Save map to try again before you leave this page.'}; }
  render();
}
function discardMap() {
  confirmModal('Discard this map?', 'It is removed from the department (a copy is kept for recovery) and you go back to the create or upload screen.', 'Discard it', async () => {
    const r = await post('delete', {department_id: S.dept.id});
    if (r.ok) { S.map = null; S.version = 0; S.edit = false; S.draft = false; S.review = false; S.banner = null; render(); } else { S.banner = {kind: 'err', text: r.error || 'Could not discard the map.'}; render(); }
  });
}

// Streams a job that returns a draft map (import or AI sequence) and opens it as an unsaved draft for review.
async function mapJob({title, stages, request, source, kind}) {
  S.working = {title, text: stages[0][1], start: Date.now()}; S.banner = null; render();
  const tick = setInterval(() => {
    const s = (Date.now() - S.working.start) / 1000, stage = [...stages].reverse().find(x => s >= x[0]);
    const p = document.querySelector('.cm-work .st'); if (p) p.textContent = stage[1];
    const t = document.querySelector('.cm-work .tm'); if (t) t.textContent = Math.round(s) + ' s';
  }, 500);
  try {
    const r = await request();
    if (!r.body) throw Error('no stream');
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', result = null, err = '', note = '';
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      buf += dec.decode(value, {stream: true});
      let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; try { const o = JSON.parse(line); if (o.type === 'result') { result = o.result; note = o.note || ''; } else if (o.type === 'error') err = o.error; } catch (e) { /* ignore */ } }
    }
    if (!result && !err) err = r.ok ? 'That did not finish. Try again.' : 'That could not be completed.';
    if (err) throw Error(err);
    S.importStmts = result.importStatements && Object.keys(result.importStatements).length ? result.importStatements : null; S.importResult = null; delete result.importStatements;
    if (kind === 'import') { S.view = 'map'; syncUrl(); }
    S.map = result; S.draft = false; S.review = true; S.edit = true; S.source = source; S.sourceKind = kind; S.note = note; S.version = 0;
  } catch (e) { S.banner = {kind: 'err', text: e.message}; }
  clearInterval(tick); S.working = null; render();
  if (S.map && S.review && S.version === 0) await saveNew();
}

function startImport(file) {
  return mapJob({title: 'Reading your curriculum map', source: file.name, kind: 'import',
    stages: [[0, 'Uploading ' + file.name + '…'], [3, 'Reading your map…'], [9, 'Finding the years, terms and units…'], [18, 'Matching colours to strands and assessment types…'], [32, 'Nearly there…']],
    request: () => { const fd = new FormData(); fd.append('csrf', CM.csrf); fd.append('department_id', S.dept.id); fd.append('file', file); return fetch(CM.api + '?action=import', {method: 'POST', credentials: 'same-origin', body: fd}); }});
}

function startGenerate(f) {
  const novice = isLanguageDept();
  const first = novice ? 7 : parseInt(f.first, 10), last = novice ? 9 : parseInt(f.last, 10), per = parseInt(f.blocks, 10);
  if (!(first >= 7 && last <= 13 && last >= first)) return 'Choose years between 7 and 13.';
  if (!(per >= 1 && per <= 8)) return 'Use 1 to 8 planning blocks.';
  mapJob({title: 'Designing your curriculum sequence', source: 'AI', kind: 'ai',
    stages: [[0, 'Reading the curriculum for ' + S.dept.name + '…'], [6, novice ? 'Choosing the units for each Novice stage…' : 'Choosing the units for each year…'], [16, 'Ordering them so each one builds on the last…'], [28, 'Spreading assessments across the terms…'], [45, 'Nearly there…']],
    request: () => fetch(CM.api + '?action=generate-map', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({csrf: CM.csrf, department_id: S.dept.id, first, last, novice, blocks: per, title: f.title, strands: f.strands, types: f.types, notes: f.notes})})});
  return '';
}

function uploadState() {
  const fileInput = h('input', {type: 'file', accept: '.docx,.xlsx,.csv,.txt,.pdf,.png,.jpg,.jpeg,.webp', style: 'display:none', onchange: e => { if (e.target.files[0]) startImport(e.target.files[0]); }});
  const drop = h('div', {class: 'cm-drop', tabindex: '0', role: 'button', 'aria-label': 'Choose a file to upload',
    onclick: () => fileInput.click(), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
    ondragover: e => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) startImport(e.dataTransfer.files[0]); }},
    h('b', {}, 'Drop your file here, or click to choose'), h('small', {}, 'Word, Excel, CSV, PDF or a picture of your overview'));
  return h('div', {class: 'cm-in'},
    h('div', {class: 'cm-hero'}, h('h2', {}, 'Upload ' + S.dept.name + '’s curriculum overview'),
      h('p', {}, 'Use an overview or scheme of work you already have. AI reads the units, years and sequence. Check and edit the imported overview, then choose a unit to create its unit plan.')),
    S.banner ? h('div', {class: 'cm-banner ' + S.banner.kind}, S.banner.text) : null,
    h('div', {class: 'cm-setup'}, h('div', {class: 'cm-card'},
      h('h3', {}, 'Upload an existing overview'), drop, fileInput)));
}

function emptyState() {
  if (S.view === 'upload') return uploadState();
  const novice = isLanguageDept();
  const f = {title: (S.dept.name + ' curriculum overview ' + (new Date().getFullYear() + 1)), first: '7', last: '10', blocks: '4', strands: '', notes: '', types: ''};
  const err = h('div', {class: 'hint', style: 'color:var(--err);min-height:20px'});
  const inp = (k, o = {}) => h('input', {type: 'text', value: f[k], oninput: e => { f[k] = e.target.value; }, ...o});
  return h('div', {class: 'cm-in'},
    h('div', {class: 'cm-hero'}, h('h2', {}, 'Create ' + S.dept.name + '’s curriculum overview with AI'),
      h('p', {}, novice ? 'Organise the language curriculum into Novice 1, Novice 2 and Novice 3, following the Ministry teaching sequence rather than student year levels.' : 'Choose your year groups and terms. AI uses the Ministry curriculum to propose a sequence of units, ordered so learning builds over time. You can review and edit the suggested overview.')),
    S.banner ? h('div', {class: 'cm-banner ' + S.banner.kind}, S.banner.text) : null,
    h('div', {class: 'cm-setup'},
      h('div', {class: 'cm-card'}, h('h3', {}, 'Tell us what to plan'),
        field('Title', inp('title', {maxlength: '140'})),
        novice ? h('p', {class:'hint'}, 'Proficiency groups: Novice 1 · Novice 2 · Novice 3') :
        h('div', {class: 'cm-row2'}, field('First year', inp('first', {inputmode: 'numeric'}), '7 to 13'), field('Last year', inp('last', {inputmode: 'numeric'}))),
        field(novice ? 'Planning blocks per novice stage' : 'Terms per year', inp('blocks', {inputmode: 'numeric'}), novice ? 'Units can span several school years. These are sequence blocks, not automatic year allocations.' : 'For example 4 terms, or 6 if you plan in half-terms.'),
        field('Strands (optional)', inp('strands', {placeholder: 'Enter your department’s strands'}), 'Comma separated. Leave blank and the AI suggests them.'),
        field('Assessment types (optional)', inp('types'), 'Enter your department’s own types as Code = meaning, separated by semicolons. Leave blank to choose later.'),
        field('Anything the AI should know (optional)', h('textarea', {rows: 3, placeholder: 'For example: Teach introductory units before advanced ones. Keep two units per term. Allow time for revision and assessment.', oninput: e => { f.notes = e.target.value; }})),
        err, h('div', {style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center'},
          h('button', {class: 'cm-btn pri', type: 'button', onclick: () => { err.textContent = startGenerate(f); }}, '✨ Create curriculum overview'),
          h('button', {class: 'cm-btn', type: 'button', onclick: () => { err.textContent = startFromScratch(f); }}, 'Build a blank overview manually')))));
}

function noDepartment() {
  const name = h('input', {type: 'text', placeholder: 'e.g. Science', maxlength: '140'});
  return h('div', {class: 'cm-in'}, h('div', {class: 'cm-hero'},
    h('h2', {}, 'You’re not in a department yet'),
    h('p', {}, S.isManager ? 'Add your first department to start its curriculum map. You will be its head, and you can add the other teachers afterwards.' : 'Curriculum maps belong to departments. Ask your school leader to add you to your department, then it will appear here.'),
    S.isManager ? h('div', {style: 'display:flex;gap:10px;margin-top:16px;max-width:460px'}, name,
      h('button', {class: 'cm-btn pri', type: 'button', style: 'white-space:nowrap', onclick: async () => {
        const r = await post('create-department', {name: name.value});
        if (r.ok) load(r.department_id); else { S.banner = {kind: 'err', text: r.error || 'Could not add the department.'}; render(); }
      }}, 'Add department')) : null),
    S.banner ? h('div', {class: 'cm-banner ' + S.banner.kind}, S.banner.text) : null);
}

function working() {
  return h('div', {class: 'cm-card cm-work cm-in', role: 'status'}, h('div', {class: 'cm-spin'}), h('h3', {}, S.working.title || 'Working on your curriculum map'), h('p', {class: 'st', style: 'color:var(--mut);margin:6px 0 0'}, S.working.text), h('p', {class: 'tm hint'}, '0 s'));
}

// many departments: one picker grouped by faculty instead of a row of tabs
function deptPicker() {
  const groups = new Map();
  for (const d of S.depts) { const k = d.faculty || 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  const sel = h('select', {'aria-label': 'Department', style: 'max-width:380px;font-weight:650', onchange: e => {
    const id = parseInt(e.target.value, 10); e.target.value = String(S.dept?.id);
    if (S.draft) confirmModal('Leave this draft?', 'It has not been saved yet, so it will be lost.', 'Leave', () => load(id)); else load(id);
  }}, ...[...groups].map(([f, ds]) => h('optgroup', {label: f}, ...ds.map(d => h('option', {value: d.id, selected: d.id === S.dept?.id}, d.scope === 'faculty' ? d.name + ' (whole faculty)' : d.name)))));
  return h('div', {class: 'cm-depts', style: 'align-items:center'}, h('span', {class: 'cm-meta'}, 'Department'), sel);
}

// ---------------------------------------------------------------- every statement in use, and which topics use it
let cov = {rows: null, q: '', kind: '', sort: 'used', err: ''};
function openCoverage() {
  cov = {rows: null, q: '', kind: '', sort: 'used', err: ''}; showView('coverage'); fetchCoverage();
}
function fetchCoverage() {
  get({action: 'statements', department_id: S.dept.id}).then(r => { if (!r.ok) throw Error(r.error); cov.rows = r.statements; }).catch(e => { cov.rows = []; cov.err = e.message; }).then(() => { if (S.view === 'coverage') render(); });
}
function coverageView() {
  const el = h('div', {class: 'cm-in'});
  const back = h('button', {class: 'cm-btn', type: 'button', onclick: () => goBack('map')}, '← Back');
  el.append(h('div', {class: 'cm-bar'}, h('div', {}, h('h2', {}, 'Curriculum coverage'), h('div', {class: 'cm-meta'}, S.dept.name + ': every curriculum statement in use, and the units that use it.')), h('div', {class: 'cm-acts'}, back)));
  if (cov.rows === null) { el.append(h('div', {class: 'cm-card cm-work'}, h('div', {class: 'cm-spin'}), h('p', {class: 'hint'}, 'Loading the statements…'))); return el; }
  if (cov.err) el.append(h('div', {class: 'cm-banner err'}, cov.err));
  const groups = new Map();
  for (const r of cov.rows) {
    if (!findTopic(r.topic_id)) continue;
    const k = r.kind + '|' + r.text.toLowerCase();
    if (!groups.has(k)) groups.set(k, {kind: r.kind, text: r.text, source: r.source, topics: []});
    groups.get(k).topics.push({id: r.topic_id, confidence: r.confidence});
  }
  let list = [...groups.values()];
  const topicsUsing = new Set(list.flatMap(g => g.topics.map(t => t.id)));
  const q = cov.q.trim().toLowerCase();
  list = list.filter(g => (!cov.kind || g.kind === cov.kind) && (!q || g.text.toLowerCase().includes(q) || g.topics.some(t => (findTopic(t.id)?.t.title || '').toLowerCase().includes(q))));
  list.sort((a, b) => cov.sort === 'az' ? a.text.localeCompare(b.text) : b.topics.length - a.topics.length || a.text.localeCompare(b.text));
  const mapTopics = S.map.years.reduce((n, y) => n + y.blocks.reduce((m, b) => m + b.topics.length, 0), 0);
  el.append(h('div', {class: 'cm-foot', style: 'margin:0 0 12px'}, h('b', {}, groups.size + ' statements'), ' linked across ', h('b', {}, topicsUsing.size + ' of ' + mapTopics + ' units'), '. Units with no statements yet can be filled from their details panel or by opening their unit plan.'));
  const search = h('input', {type: 'text', value: cov.q, placeholder: 'Search statements or units', 'aria-label': 'Search', style: 'max-width:300px'});
  search.addEventListener('input', e => { cov.q = e.target.value; const pos = e.target.selectionStart; render(); const n = document.querySelector('.cm-cov-f input'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
  const sel = (opts, cur, fn, label) => h('select', {'aria-label': label, style: 'width:auto', onchange: e => fn(e.target.value)}, ...opts.map(([v, l]) => h('option', {value: v, selected: v === cur}, l)));
  el.append(h('div', {class: 'cm-cov-f', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px'}, search,
    sel([['', 'Knowledge and practices'], ['knowledge', 'Knowledge only'], ['practice', 'Practices only']], cov.kind, v => { cov.kind = v; render(); }, 'Type'),
    sel([['used', 'Most used first'], ['az', 'A to Z']], cov.sort, v => { cov.sort = v; render(); }, 'Sort')));
  if (!list.length) el.append(h('p', {class: 'hint'}, groups.size ? 'Nothing matches that search.' : 'No statements are linked to units yet. Open a unit and press “Find statements with AI”, or open its unit plan.'));
  for (const g of list) el.append(h('div', {class: 'cm-cov'},
    h('div', {class: 'cm-covh'}, h('span', {class: 'cm-ktag ' + g.kind}, g.kind === 'practice' ? 'Practice' : 'Knowledge'), h('span', {class: 'cm-used'}, 'used in ' + g.topics.length + (g.topics.length === 1 ? ' unit' : ' units'))),
    h('p', {}, g.text), g.source ? h('small', {class: 'hint'}, g.source) : null,
    h('div', {class: 'cm-tchips'}, ...g.topics.map(tp => { const f = findTopic(tp.id), st = strandOf(f.t.strand);
      return h('button', {type: 'button', class: 'cm-tchip', style: st ? '--c:' + st.color : '', onclick: () => topicDetails(f.y, f.b, f.t), title: 'Open this unit'}, f.y.label + ' · ' + f.t.title, tp.confidence != null ? h('i', {}, tp.confidence + '%') : null); }))));
  return el;
}

// ---------------------------------------------------------------- main render
function render() {
  if (!root) return;
  const keep = modalEl; // modals live in root; re-attach after repaint
  const body = [];
  if (S.loading) body.push(h('div', {class: 'cm-card cm-work'}, h('div', {class: 'cm-spin'}), h('p', {class: 'hint'}, 'Loading your department…')));
  else if (S.failed) body.push(h('div', {class: 'cm-banner err'}, S.banner.text));
  else if (!S.depts.length) body.push(noDepartment());
  else {
    if (S.depts.length > 1) body.push(deptPicker());
    else if (false) body.push(h("div", {class: "cm-depts", role: 'tablist'}, ...S.depts.map(d => h('button', {type: 'button', role: 'tab', 'aria-selected': String(d.id === S.dept?.id), class: 'cm-dept' + (d.id === S.dept?.id ? ' on' : ''),
      onclick: () => { if (d.id === S.dept?.id) return; if (S.draft) confirmModal('Leave this draft?', 'It has not been saved yet, so it will be lost.', 'Leave', () => load(d.id)); else load(d.id); }}, d.name))));
    else if (S.dept) body.push(h('div', {class: 'cm-meta', style: 'margin:0 0 10px'}, 'Department: ', h('b', {}, S.dept.name)));
    if (['map', 'upload'].includes(S.view) && !S.working && !S.draft && !S.review) body.push(h('div', {class: 'cm-backrow'}, h('button', {class: 'cm-btn sm', type: 'button', onclick: () => goBack('start')}, '← Back')));
    if (S.working) body.push(working());
    else if (S.view === 'start') body.push(startView());
    else if (S.map) body.push(S.view === 'coverage' ? coverageView() : mapView());
    else body.push(emptyState());
  }
  root.replaceChildren(...body, toastEl);
  if (keep) root.append(keep);
}

// ---------------------------------------------------------------- start screen: where do you want to begin?
function startView() {
  const has = !!S.map, name = S.dept?.name || 'your department';
  const card = (cls, icon, title, text, tag, attrs) => h(attrs.href ? 'a' : 'button', {class: 'cm-start ' + cls, ...attrs, ...(attrs.href ? {} : {type: 'button'})},
    h('span', {class: 'cm-sico', 'aria-hidden': 'true'}, icon), h('b', {}, title), h('span', {class: 'cm-stext'}, text), tag ? h('span', {class: 'cm-stag'}, tag) : null);
  return h('div', {class: 'cm-in'},
    h('div', {class: 'cm-hero'}, h('h2', {}, 'What would you like to do?'), h('p', {}, 'Choose where to start. You can always come back here, and the Back button takes you to the last screen you were on.')),
    h('div', {class: 'cm-startgrid'},
      card('a', '✎', 'Create a single unit plan', 'No curriculum overview needed. Choose a subject, year and topic, then build a unit plan using the Ministry curriculum.', 'Start a unit plan', {href: CM.guide + '?guide=1&blank=1'}),
      card('b', '⇪', has ? 'Edit your department’s curriculum overview' : 'Create your department’s curriculum overview with AI', has ? name + ' already has an overview. Open it to update the sequence, units, strands or curriculum statements.' : 'Choose your year groups and terms. AI uses the Ministry curriculum to create a draft sequence of units for your department to review and edit.', has ? 'Edit your overview' : 'Create an overview with AI', {onclick: () => { S.edit = has; showView('map'); }}),
      card('c', '▶', 'Create unit plans from an existing overview', has ? 'Open your department’s overview, choose a unit and draft its unit plan using the selected curriculum statements.' : 'Upload an overview or scheme of work you already use. Check the imported units and curriculum statements, then choose a unit to create its unit plan.', has ? 'Choose a unit' : 'Upload your overview', {onclick: () => { S.edit = false; showView(has ? 'map' : 'upload'); }})),
    null);
}

// ---------------------------------------------------------------- start
setInterval(() => { if (document.visibilityState === 'visible') get({action: 'ping'}).catch(() => {}); }, 8 * 60 * 1000);   // sessions expire after about 24 idle minutes
root = document.getElementById('cm-root');
root.className = 'cm';
toastEl = h('div', {class: 'cm-toast', role: 'status'});
{
  const q = new URLSearchParams(location.search);
  // opening the app from the home screen (no department in the address) shows the start screen; links from a unit plan or the history go straight to the map
  const wantDept = CM.department || parseInt(q.get('department'), 10) || 0;
  S.view = !(wantDept > 0) && !q.get('go') ? 'start' : ['coverage', 'upload'].includes(q.get('view')) ? q.get('view') : 'map';
  if (S.view === 'coverage') cov = {rows: null, q: '', kind: '', sort: 'used', err: ''};
  load(wantDept, S.view).then(() => { if (S.view === 'coverage' && S.map) fetchCoverage(); });
}
