// Topic Guide Studio front end. One teacher, their own guides.
// Flow: Topic -> Outline (tick the Ministry statements) -> Guide (edit, export to Word).
import {createWord} from './export.js';
import {capabilities, assessmentOptions} from './model.js';

const CS = window.CS;
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2, '0')).join('');
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
};

const JUNIOR = [7, 8, 9, 10];
// Department names that sit inside a broader Ministry learning area, so Art finds the Visual Arts document, Geography the Social Sciences one, and so on.
const SUBJECT_ALIAS = {
  'visual arts': ['art', 'visual art', 'art: design', 'art: photography', 'art design', 'art photography', 'painting', 'printmaking', 'design'],
  'technology': ['design and visual communication', 'digital technology', 'fashion design', 'food', 'product design', 'resistant materials', 'hospitality', 'textiles'],
  'social sciences': ['religious education', 'geography', 'history', 'geospatial technology', 'theology and philosophy', 'tourism studies', 'psychology', 'sociology'],
  'health and physical education': ['physical education and health', 'health studies', 'human performance', 'outdoor education', 'physical education', 'health'],
};
const subjectAlias = name => { const n = String(name || '').trim().toLowerCase(); return Object.keys(SUBJECT_ALIAS).find(k => SUBJECT_ALIAS[k].includes(n)) || ''; };

let guides = [], G = null, docs = [], view = 'topic', work = null, banner = null, saveTimer = 0, saveState = 'saved', closed = new Set(), toastTimer = 0;
let root, listEl, mainEl, toastEl;

const blank = () => ({id: uid(), topic: '', subject: '', year: 7, docId: '', discipline: '', duration: '', notes: '', pasted: '',
  statements: {knowledge: [], practices: []}, selected: {knowledge: [], practices: []}, plan: null, mapRef: null});
const hasStatements = g => g && g.statements.knowledge.length + g.statements.practices.length > 0;
const hue = s => { let x = 0; for (const c of String(s || 'x')) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const colour = s => `hsl(${hue(s)} 55% 46%)`;
const ago = iso => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

// ---------------------------------------------------------------- server
async function post(action, body) {
  const r = await fetch(CS.api + '?action=' + action, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...body, csrf: CS.csrf})});
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw Error(d.error || 'Could not reach Liveweave.');
  return d;
}

async function stream(action, body, signal) {
  const r = await fetch(CS.api + '?action=' + action, {method: 'POST', credentials: 'same-origin', signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...body, csrf: CS.csrf})});
  if (!(r.headers.get('Content-Type') || '').includes('ndjson')) {
    const d = await r.json().catch(() => ({}));
    const err = Error(d.error || 'Could not reach Liveweave.'); err.noRetry = r.status < 500; throw err;
  }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', result = null;
  const line = s => { if (!s.trim()) return; const o = JSON.parse(s); if (o.type === 'error') { const err = Error(o.error); err.code = o.code || ''; throw err; } if (o.type === 'result') result = o.result; };
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buf += dec.decode(value, {stream: true});
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  line(buf);
  if (!result) throw Error('The connection ended early. Your unit plan is unchanged; please try again.');
  return result;
}

function save() {
  G.updated = new Date().toISOString();
  setSave('busy');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!G) return;
    try {
      await post('save', {guide: G});
      syncMap(G);
      if (!guides.some(x => x.id === G.id)) guides.unshift(G);
      renderList(); setSave('saved');
    } catch (e) { setSave('bad', e.message); }
  }, 700);
}
function setSave(state, text) {
  saveState = state;
  document.querySelectorAll('.cg-save').forEach(el => { el.className = 'cg-save ' + state; el.textContent = state === 'busy' ? 'Saving…' : state === 'bad' ? 'Not saved – ' + text : 'All changes saved'; });
}
const saveBadge = () => h('span', {class: 'cg-save ' + saveState}, saveState === 'busy' ? 'Saving…' : saveState === 'bad' ? 'Not saved' : 'All changes saved');

function toast(t) {
  toastEl.textContent = t; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------- sidebar
function renderList() {
  listEl.replaceChildren(...(guides.length ? guides.map(g => h('button', {type: 'button', class: 'cg-item' + (G && g.id === G.id ? ' on' : ''), onclick: () => open(g.id), style: '--c:' + colour(g.subject || g.docId)},
    h('span', {class: 'cg-dot', style: 'background:' + colour(g.subject || g.docId)}),
    h('span', {style: 'min-width:0'}, h('b', {}, g.topic || 'Untitled unit plan'), h('small', {}, [g.subject, 'Year ' + g.year, ago(g.updated)].filter(Boolean).join(' · '))),
    h('span', {class: 'cg-tag' + (g.plan ? ' done' : '')}, g.plan ? 'Drafted' : hasStatements(g) ? 'Outline' : 'New'))) : [h('p', {class: 'cg-empty-list'}, 'Your unit plans will appear here.')]));
}

function open(id) {
  G = guides.find(g => g.id === id) || null;
  banner = null; view = !G ? 'topic' : G.plan ? 'guide' : hasStatements(G) ? 'outline' : 'topic';
  renderList(); renderMain(true);
  if (G && G.mapRef) {
    const g = G, had = !!g.plan;
    pullMapStatements(g).then(changed => {
      if (G !== g) return;
      if (!lastPull.ok) banner = {kind: 'err', text: lastPull.error + ' Press “Use the statements from the curriculum map” to try again.'};
      if (changed && had) banner = {kind: 'note', text: 'The statements ticked on the curriculum map have changed since this unit plan was drafted. Open “Curriculum outline” and redraft the unit plan so it matches.'};
      if (!g.plan) view = hasStatements(g) ? 'outline' : 'topic';
      renderList(); renderMain();
    });
  }
}
function newGuide() { G = blank(); banner = null; view = 'topic'; renderList(); renderMain(true); setTimeout(() => document.querySelector('.cg-topic')?.focus(), 50); }

// ---------------------------------------------------------------- timing rules in plain English, with suggestions to click
const TIMING_IDEAS = ['3 lessons a week', '2 lessons a week', '50-minute lessons', '60-minute lessons', 'about 6 weeks', 'about 14 lessons in total', 'an end-of-unit test in the last lesson', 'one lesson for feedback and reteaching', 'a practical in the middle of the unit', 'fewer lessons in the last week because of events'];
function timingField() {
  const ta = area(G.duration, v => { G.duration = v; save(); }, 2);
  ta.placeholder = 'Say it as you would to a colleague, for example: We get 3 lessons a week for about 6 weeks, 50 minutes each, with a test in the last lesson.';
  const add = t => { const v = (G.duration || '').trim().replace(/[.\s]+$/, ''); G.duration = (v ? v + '. ' : '') + t.charAt(0).toUpperCase() + t.slice(1) + '.'; ta.value = G.duration; fit(ta); save(); };
  return h('div', {class: 'cg-f'}, h('span', {}, 'Timing and rules'), ta,
    h('small', {}, 'In plain English. The AI works out the total number of lessons and spreads them across the learning focuses. Leave it blank and the AI suggests a sensible number of lessons for each focus. Click a suggestion to add it.'),
    h('div', {class: 'cg-sugg'}, TIMING_IDEAS.map(t => h('button', {type: 'button', class: 'cg-sg', onclick: () => add(t)}, '+ ' + t))));
}

// ---------------------------------------------------------------- bits
function field(label, input, hint) { return h('label', {class: 'cg-f'}, h('span', {}, label), input, hint ? h('small', {}, hint) : null); }
function text(value, on, attrs = {}) { return h('input', {type: 'text', value: value || '', oninput: e => on(e.target.value), ...attrs}); }
function fit(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 560) + 'px'; }
function area(value, on, rows = 3) {
  const t = h('textarea', {rows: 1, oninput: e => { on(e.target.value); fit(t); }}); t.value = value || '';
  requestAnimationFrame(() => fit(t)); setTimeout(() => fit(t), 120); return t;
}
const bannerEl = () => banner ? h('div', {class: 'cg-banner ' + banner.kind, role: banner.kind === 'err' ? 'alert' : 'status'}, h('span', {}, banner.text),
  banner.retry ? h('button', {type: 'button', class: 'cg-retry', onclick: () => { const again = banner.retry; banner = null; again(); }}, 'Try again') : null, h('button', {type: 'button', 'aria-label': 'Dismiss', onclick: () => { banner = null; renderMain(); }}, '×')) : null;

const STEPS = [['topic', 'Unit'], ['outline', 'Curriculum outline'], ['guide', 'Your unit plan']];
function stepper() {
  const reach = {topic: true, outline: hasStatements(G), guide: !!G.plan};
  return h('div', {class: 'cg-stephead'}, h('button', {class: 'cg-ghost cg-backin', type: 'button', onclick: goBack}, '← Back'), h('nav', {class: 'cg-stepper', 'aria-label': 'Steps'}, STEPS.map(([k, label], i) => h('button', {type: 'button', class: 'cg-step' + (view === k ? ' on' : '') + (reach[k] && view !== k && i < STEPS.findIndex(s => s[0] === view) ? ' done' : ''),
    disabled: !reach[k] || !!work, 'aria-current': view === k ? 'step' : null, onclick: () => { view = k; renderMain(true); }}, h('i', {}, i + 1), label))));
}

// ---------------------------------------------------------------- main
// Every step of a unit plan (and each unit plan opened) is a history entry, so the browser's Back button and the page's Back buttons return to what you were doing.
let restoring = false;
function syncHistory() {
  if (restoring) return;
  const key = (G ? G.id : '') + '|' + view, st = history.state;
  if (!st || !st.cg) { history.replaceState({cg: 1, key, gid: G ? G.id : '', view, idx: 0}, ''); return; }
  if (st.key === key) return;
  history.pushState({cg: 1, key, gid: G ? G.id : '', view, idx: (st.idx || 0) + 1}, '', location.href);
}
function goBack() {
  if (history.state && history.state.cg && (history.state.idx || 0) > 0) history.back();
  else location.href = mapUrl();
}
addEventListener('popstate', e => {
  const st = e.state;
  if (!st || !st.cg || work) return;
  restoring = true;
  G = st.gid ? (guides.find(g => g.id === st.gid) || null) : null;
  view = st.view || 'topic';
  if (!G) view = 'topic'; else if (view === 'guide' && !G.plan) view = hasStatements(G) ? 'outline' : 'topic'; else if (view === 'outline' && !hasStatements(G)) view = 'topic';
  banner = null;
  renderList(); renderMain(true);
  restoring = false;
});

function renderMain(top) {
  mainEl.classList.toggle('cg-animate', !!top);
  mainEl.replaceChildren(...build().filter(Boolean));
  if (top) window.scrollTo?.({top: 0}), mainEl.closest('.workspace')?.scrollTo?.({top: 0});
  const mb = document.querySelector('.cg-mapbtn'); if (mb && mb.lastChild) mb.lastChild.textContent = G && G.mapRef ? ' Back to the curriculum map' : ' Back to start';
  syncHistory();
}

function build() {
  if (!G) return [h('section', {class: 'cg-card cg-hero'}, h('h2', {}, 'Build a unit plan in minutes'),
    h('p', {}, 'Pick your subject, year and unit. The official Ministry curriculum gives the outline, and your department’s curriculum map gives the sequence.'),
    h('button', {class: 'cg-btn lg', type: 'button', onclick: newGuide}, 'Start a new unit plan  →'),
    h('div', {class: 'cg-pills'}, ['Ministry wording kept exactly', 'Exports to your Word template', 'Private to you'].map(t => h('span', {class: 'cg-pill'}, '✓ ' + t))))];
  if (work) return [stepper(), workCard()];
  if (G.mapRef && !hasStatements(G) && !G.plan && view !== 'topic') return [stepper(), bannerEl(), h('section', {class: 'cg-card'}, h('h2', {}, 'No statements ticked on the map yet'), h('p', {class: 'lead'}, 'This unit plan is built from the statements you tick for “' + G.topic + '” on the curriculum map. Open the unit on the map, tick the statements it teaches, then come back.'), h('div', {class: 'cg-actions'}, h('a', {class: 'cg-btn lg', href: mapUrl()}, '← Go to the curriculum map')))];
  return [stepper(), bannerEl(), view === 'topic' ? topicCard() : view === 'outline' && hasStatements(G) ? outlineCard() : G.plan ? guideView() : topicCard()];
}

function workCard() {
  const el = h('section', {class: 'cg-card cg-work', 'aria-live': 'polite'}, h('div', {class: 'cg-orb'}), h('h2', {}, work.title), h('p', {id: 'cg-stage'}, work.stages[0]),
    h('div', {class: 'cg-skel'}, h('i'), h('i'), h('i'), h('i')), h('div', {class: 'cg-timer', id: 'cg-timer'}, '0s'),
    h('div', {class: 'cg-actions', style: 'justify-content:center'}, h('button', {class: 'cg-ghost', type: 'button', onclick: () => work.ctl.abort()}, 'Cancel')));
  return el;
}

function topicCard() {
  const yd = docs.filter(d => (d.years || JUNIOR).includes(G.year));
  // The subject filters the document list: a Science guide only offers the Science document (clear the subject to see everything).
  const subj = (G.subject || '').trim().toLowerCase();
  const names = d => [d.subject, d.learningArea, d.title, ...(d.subjects || [])].map(x => String(x || '').toLowerCase()).filter(Boolean);
  const pick = q => { if (!q) return []; const ex = yd.filter(d => names(d).some(n => n === q)); return ex.length ? ex : (q.length >= 4 ? yd.filter(d => names(d).some(n => n.includes(q))) : []); };
  const matches = pick(subj).length ? pick(subj) : pick(subjectAlias(subj));
  const shown = matches.length ? matches : yd;
  if (matches.length && G.docId && !matches.some(d => d.id === G.docId)) { G.docId = ''; }
  if (matches.length === 1 && G.docId !== matches[0].id) {
    G.docId = matches[0].id;
    const arts = ['Dance', 'Drama', 'Music', 'Visual Arts'].find(a => a.toLowerCase() === (subjectAlias(subj) || subj));
    if (matches[0].learningArea === 'The Arts' && arts) G.discipline = arts;
    save();
  }
  const subjectNames = [...new Set(yd.flatMap(d => [d.subject, ...(d.subjects || [])]).filter(Boolean))].sort();
  const areas = [...new Set(shown.map(d => d.learningArea))].sort();
  const doc = docs.find(d => d.id === G.docId);
  const isArts = doc && doc.learningArea === 'The Arts';
  const found = hasStatements(G);
  const ready = G.topic.trim() && (G.docId || G.pasted.trim());
  const go = G.mapRef
    ? h('button', {class: 'cg-btn lg', type: 'button', onclick: async e => {
      e.target.disabled = true; e.target.textContent = 'Reading the curriculum map…';
      await pullMapStatements(G);
      if (!lastPull.ok) banner = {kind: 'err', text: lastPull.error + ' Your unit plan is unchanged.', retry: () => { renderMain(true); document.querySelector('.cg-card .cg-btn.lg')?.click(); }};
      else if (!lastPull.onMap) banner = {kind: 'err', text: 'This unit plan was linked to a unit that is no longer on the curriculum map. Open the unit on the map and choose “Open unit plan” again.'};
      else if (hasStatements(G)) { view = 'outline'; banner = null; }
      else banner = {kind: 'note', text: lastPull.total ? 'This unit has ' + lastPull.total + ' statement' + (lastPull.total === 1 ? '' : 's') + ' on the map, but none are ticked. Open the unit on the map and tick the ones it teaches.' : 'No statements have been added to this unit on the curriculum map yet. Open the unit on the map and tick the statements it teaches (or use Match all units).'};
      renderMain(true); window.scrollTo({top: 0, behavior: 'smooth'});
    }}, 'Use the statements from the curriculum map  →')
    : h('button', {class: 'cg-btn lg', type: 'button', disabled: !ready, onclick: find}, found ? 'Find statements again  →' : 'Find curriculum statements  →');
  const sync = () => { go.disabled = !(G.topic.trim() && (G.docId || G.pasted.trim())); };
  return h('section', {class: 'cg-card'},
    h('h2', {}, 'What are you teaching?'), h('p', {class: 'lead'}, 'Start with the unit. We will find the matching Ministry statements next.'),
    h('input', {class: 'cg-topic', type: 'text', value: G.topic, placeholder: 'e.g. Forces and motion', 'aria-label': 'Unit', oninput: e => { G.topic = e.target.value; save(); sync(); }}),
    h('div', {style: 'margin-top:20px'}, h('span', {class: 'cg-f'}, h('span', {style: 'display:block;font-weight:620;font-size:13px;margin-bottom:6px'}, 'Year group')),
      h('div', {class: 'cg-seg', role: 'group', 'aria-label': 'Year'}, [7, 8, 9, 10, 11, 12, 13].map(y => h('button', {type: 'button', class: y === G.year ? 'on' : '', 'aria-pressed': y === G.year ? 'true' : 'false', onclick: () => { G.year = y; if (G.docId && !(docs.find(d => d.id === G.docId)?.years || JUNIOR).includes(y)) G.docId = ''; save(); renderMain(); }}, 'Year ' + y)))),
    h('div', {class: 'cg-grid'},
      field('Subject', h('div', {}, h('input', {type: 'text', list: 'cg-subjects', value: G.subject || '', placeholder: 'e.g. Science', 'aria-label': 'Subject', onchange: e => { G.subject = e.target.value; save(); renderMain(); }}),
        h('datalist', {id: 'cg-subjects'}, subjectNames.map(n => h('option', {value: n})))), matches.length ? 'Showing the Ministry documents for ' + G.subject + '. Clear this to see every subject.' : subj ? 'No Ministry document matches “' + G.subject + '”, so all are shown. You can also paste your own curriculum text below.' : 'Shown on the unit plan. Pick one to filter the curriculum documents.'),
      field('Curriculum document', (() => h('select', {onchange: e => { G.docId = e.target.value; const d = docs.find(x => x.id === G.docId); if (d && !G.subject.trim()) G.subject = d.subject; G.discipline = ''; save(); renderMain(); }}, h('option', {value: ''}, 'Choose a document…'),
        ...areas.map(a => h('optgroup', {label: a}, ...shown.filter(d => d.learningArea === a).map(d => h('option', {value: d.id, selected: d.id === G.docId}, d.title))))))(), doc && doc.status ? doc.status : 'Official Ministry text, kept word for word.'),
      isArts ? field('Arts subject', h('select', {onchange: e => { G.discipline = e.target.value; save(); }}, h('option', {value: ''}, 'All'), ...['Dance', 'Drama', 'Music', 'Visual Arts'].map(s => h('option', {value: s, selected: s === G.discipline}, s)))) : null,
      ),
    timingField(),
    h('details', {class: 'cg-more', open: !!(G.notes || G.pasted)},
      h('summary', {}, 'Add context or paste your own curriculum text'),
      field('Anything the AI should know', area(G.notes, v => { G.notes = v; save(); }, 2), 'Equipment, what students already know, local focus…'),
      field('Paste curriculum text (if your subject is not listed)', area(G.pasted, v => { G.pasted = v; save(); sync(); }, 4), 'Paste the official knowledge and practice statements for this year. They are checked against exactly what you paste.')),
    h('div', {class: 'cg-actions'}, go, found ? h('button', {class: 'cg-ghost', type: 'button', onclick: () => { view = 'outline'; renderMain(true); }}, 'Back to my outline') : null,
      h('span', {style: 'margin-left:auto'}, resetLink())));
}

function outlineCard() {
  const total = G.statements.knowledge.length + G.statements.practices.length;
  const n = G.selected.knowledge.length + G.selected.practices.length;
  const col = (key, title) => {
    const list = G.statements[key]; if (!list.length) return null;
    const setAll = on => { G.selected[key] = on ? list.map(s => s.id) : []; save(); renderMain(); };
    const fromMap = !!G.mapRef;
    return h('div', {}, h('div', {class: 'cg-colhead'}, h('h3', {}, title + ' ', h('span', {class: 'cg-chip'}, fromMap ? String(list.length) : G.selected[key].length + '/' + list.length)),
      fromMap ? null : h('div', {}, h('button', {type: 'button', onclick: () => setAll(true)}, 'All'), h('button', {type: 'button', onclick: () => setAll(false)}, 'None'))),
      ...list.map(s => { const on = G.selected[key].includes(s.id);
        return h('label', {class: 'cg-stmt' + (on ? ' on' : '')}, h('input', {type: 'checkbox', checked: on, disabled: fromMap, onchange: e => { G.selected[key] = e.target.checked ? [...G.selected[key], s.id] : G.selected[key].filter(x => x !== s.id); save(); renderMain(); }}),
          h('div', {}, h('p', {}, s.text), (s.why || s.confidence != null) ? h('small', {class: 'cg-why ' + (s.link === 'loose' ? 'loose' : '')}, (s.confidence != null ? s.confidence + '% match' : (s.link === 'loose' ? 'Loose match' : 'Linked')) + (s.why ? ' · ' + s.why : '')) : null, h('small', {}, s.source))); }));
  };
  return h('section', {},
    h('div', {class: 'cg-outhead'}, h('div', {}, h('h2', {style: 'margin:0 0 4px;font-size:21px'}, 'Curriculum outline'), h('p', {class: 'cg-mut', style: 'margin:0;color:var(--mut)'}, G.mapRef ? 'These are the statements you ticked for this unit on the curriculum map, word for word from the Ministry text. The unit plan is built around exactly these and the AI cannot add, remove or swap any. To change them, change the ticks on the map.' : 'Word for word from the Ministry text. Each statement shows how confident the AI is that it belongs to your unit. Those at 60% or more are ticked for you; lower ones are left unticked. Change any tick.')),
      h('div', {class: 'cg-chips'}, h('span', {class: 'cg-chip acc'}, G.topic), h('span', {class: 'cg-chip'}, 'Year ' + G.year), saveBadge())),
    h('div', {class: 'cg-cols'}, col('knowledge', 'Knowledge'), col('practices', 'Practices')),
    h('div', {class: 'cg-bar'}, h('div', {}, h('b', {}, n), G.mapRef ? ' statements from the curriculum map' : ' of ' + total + ' statements selected', G.mapRef ? h('a', {class: 'cg-link', href: mapUrl(), style: 'margin-left:12px'}, 'Change them on the map') : null),
      h('div', {class: 'cg-actions', style: 'margin:0'}, h('button', {class: 'cg-ghost', type: 'button', onclick: () => { view = 'topic'; renderMain(true); }}, '← Edit unit'),
        h('button', {class: 'cg-btn', type: 'button', disabled: !n, onclick: generate}, G.plan ? 'Redraft the unit plan  →' : 'Draft the unit plan  →'), resetLink())));
}

// Key vocabulary is written as two lists. The Word template has one Key Vocabulary cell, so the combined line is kept up to date for it.
const joinVocab = f => [String(f.vocabularyTier2 || '').trim() && 'Tier 2: ' + String(f.vocabularyTier2).trim(), String(f.vocabularyTier3 || '').trim() && 'Tier 3: ' + String(f.vocabularyTier3).trim()].filter(Boolean).join('\n');
function vocabFields(f) {
  if (String(f.vocabulary || '').trim() && f.vocabularyTier2 === undefined && f.vocabularyTier3 === undefined)   // a draft made before the split keeps its single list until it is redrafted
    return [field('Key vocabulary (earlier draft: redraft to split into Tier 2 and Tier 3)', area(f.vocabulary, v => { f.vocabulary = v; save(); }, 3))];
  const set = (k, v) => { f[k] = v; f.vocabulary = joinVocab(f); save(); };
  return [field('Tier 2 vocabulary (general academic words)', area(f.vocabularyTier2 || '', v => set('vocabularyTier2', v), 3)),
    field('Tier 3 vocabulary (subject-specific terms)', area(f.vocabularyTier3 || '', v => set('vocabularyTier3', v), 3))];
}

function guideView() {
  const p = G.plan;
  const set = (k, v) => { p[k] = v; save(); };
  const tick = (key, opts) => {
    const get = () => Array.isArray(p[key]) ? p[key] : String(p[key] || '').split('\n').filter(Boolean);
    return h('div', {class: 'cg-ticks'}, ...opts.map(o => h('label', {}, h('input', {type: 'checkbox', checked: get().includes(o), onchange: e => {
      const next = e.target.checked ? [...get(), o] : get().filter(x => x !== o); set(key, Array.isArray(p[key]) ? next : next.join('\n')); }}), o)));
  };
  const toc = [['sec-overview', 'Overview'], ...p.focuses.map((f, i) => ['sec-f' + i, (i + 1) + '. ' + (f.title || 'Learning focus')]), ['sec-yours', 'Yours to complete'], ['sec-export', 'Download']];
  const tocEl = h('nav', {class: 'cg-toc', 'aria-label': 'Unit plan sections'}, toc.map(([id, label]) => h('a', {href: '#' + id, 'data-id': id, onclick: e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({behavior: 'smooth', block: 'start'}); }}, label)));
  const palette = ['#8b2440', '#2563eb', '#0f8a6a', '#b45309', '#7c3aed', '#be185d', '#0e7490'];

  ensureCounts(p);
  if (p.focuses.some(f => !f.lessons && Number.isFinite(f.lessonCount))) relabel(p);
  const totalIn = h('input', {type: 'number', id: 'cg-ltot', min: String(p.focuses.length), max: '400', value: lessonTotal(p) || '', placeholder: 'Lessons', 'aria-label': 'Anticipated number of lessons',
    onchange: e => { const T = Math.max(p.focuses.length, Math.min(400, parseInt(e.target.value, 10) || 0)); fitTotal(p, T); relabel(p); save(); paintLessons(); }});
  const durIn = h('input', {type: 'text', id: 'cg-ldur', value: p.duration || '', maxlength: '300', placeholder: 'For example: 18 lessons of approximately 50 minutes', 'aria-label': 'Anticipated duration of unit', oninput: e => set('duration', e.target.value)});
  const overview = h('section', {class: 'cg-card cg-sec', id: 'sec-overview'}, h('h3', {}, 'Overview'),
    h('div', {class: 'cg-lessonbar'}, field('Anticipated number of lessons', totalIn), field('Anticipated duration of unit', durIn),
      h('small', {}, 'The AI suggests lessons for each learning focus and this total is added up from them. Change any focus below and the total updates, or change the total here and the focuses are adjusted to fit.')),
    field('Purpose – why this is worth learning', area(p.purpose, v => set('purpose', v), 3)),
    h('div', {class: 'cg-grid'}, field('Connections to prior learning', area(p.prior, v => set('prior', v), 3)), field('Connections to future learning', area(p.future, v => set('future', v), 3)),
      field('Knowledge summary', area(p.knowledgeSummary, v => set('knowledgeSummary', v), 3)), field('Practices summary', area(p.practicesSummary, v => set('practicesSummary', v), 3))),
    h('div', {class: 'cg-tickbox', style: 'margin-top:14px'}, h('b', {}, 'Capabilities this unit develops'), h('small', {style: 'display:block;color:var(--mut);margin:2px 0 6px'}, 'Suggested from the unit. Adjust as needed.'), tick('capabilities', capabilities)));

  const focuses = p.focuses.map((f, i) => {
    const key = G.id + ':' + i, c = palette[i % palette.length];
    const el = h('article', {class: 'cg-focus cg-sec' + (closed.has(key) ? ' closed' : ''), id: 'sec-f' + i, style: '--c:' + c},
      h('div', {class: 'cg-fhead', onclick: e => { if (e.target.tagName === 'INPUT') return; closed.has(key) ? closed.delete(key) : closed.add(key); el.classList.toggle('closed'); }},
        h('span', {class: 'cg-num'}, i + 1), h('label', {class: 'cg-lesn', onclick: e => e.stopPropagation()}, h('input', {type: 'number', min: '1', max: '60', class: 'cg-les', 'data-fi': String(i), value: Number.isFinite(f.lessonCount) ? f.lessonCount : '', 'aria-label': 'Number of lessons for learning focus ' + (i + 1), title: 'Approximate number of lessons. Change it and the total updates.',
          oninput: e => { const n = parseInt(e.target.value, 10); f.lessonCount = n > 0 ? Math.min(60, n) : undefined; relabel(p); save(); paintLessons(); }}), h('span', {}, 'lessons'), h('span', {class: 'cg-lrange', 'data-lrange': String(i)}, f.lessons || '')), h('input', {type: 'text', value: f.title, 'aria-label': 'Learning focus title', oninput: e => { f.title = e.target.value; save(); const a = tocEl.querySelector(`[data-id="sec-f${i}"]`); if (a) a.textContent = (i + 1) + '. ' + (f.title || 'Learning focus'); }}),
        h('button', {class: 'cg-chev', type: 'button', 'aria-label': 'Collapse or expand'}, '▾')),
      h('div', {class: 'cg-fbody'},
        h('div', {class: 'cg-grid'}, field('Curriculum knowledge', area(f.knowledge, v => { f.knowledge = v; save(); }, 3)), field('Curriculum practices', area(f.practices, v => { f.practices = v; save(); }, 3)),
          field('Specific learning objectives', area(f.objectives, v => { f.objectives = v; save(); }, 3)), ...vocabFields(f),
          field('Common misconceptions', area(f.misconceptions, v => { f.misconceptions = v; save(); }, 3)), field('Check for understanding', area(f.checks, v => { f.checks = v; save(); }, 3))),
        f.priorities !== undefined && String(f.priorities).trim() ? field('School priorities', area(f.priorities, v => { f.priorities = v; save(); }, 2)) : null));
    return el;
  });

  const yours = h('section', {class: 'cg-card cg-sec', id: 'sec-yours'}, h('h3', {}, 'Yours to complete'),
    h('p', {class: 'lead', style: 'margin-top:-4px'}, 'The AI leaves these to you, and a redraft never overwrites them.'),
    field('Resources (optional)', area(p.resources, v => set('resources', v), 2)),
    field('Assessment end point', area(p.assessment, v => set('assessment', v), 2)),
    h('div', {class: 'cg-grid', style: 'margin-top:14px'},
      h('div', {class: 'cg-tickbox'}, h('b', {}, 'Assessment descriptors'), tick('descriptors', assessmentOptions.descriptors)),
      h('div', {class: 'cg-tickbox'}, h('b', {}, 'Reporting'), tick('reporting', assessmentOptions.reporting))));

  const exportCard = h('section', {class: 'cg-card cg-export cg-sec', id: 'sec-export'}, h('h2', {}, 'Ready to take it away?'), h('p', {class: 'lead', style: 'margin-bottom:16px'}, 'Download your unit plan in the school’s Word template.'),
    h('button', {class: 'cg-btn lg', type: 'button', onclick: download}, '⬇  Download Word unit plan'));

  // scroll-spy
  setTimeout(() => {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { tocEl.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.id === e.target.id)); } }, {rootMargin: '-15% 0px -70% 0px'});
    toc.forEach(([id]) => { const n = document.getElementById(id); if (n) io.observe(n); });
  }, 50);

  return h('div', {},
    h('div', {class: 'cg-gtitle'}, h('div', {}, h('h1', {}, G.topic || 'Unit plan'), h('div', {class: 'cg-chips meta'}, h('span', {class: 'cg-chip acc'}, G.subject || 'Subject'), h('span', {class: 'cg-chip'}, 'Year ' + G.year), G.plan && G.plan.duration ? h('span', {class: 'cg-chip', id: 'cg-dchip'}, G.plan.duration) : null, saveBadge())),
      h('div', {class: 'cg-gactions'}, h('button', {class: 'cg-ghost', type: 'button', onclick: () => { view = 'outline'; renderMain(true); }}, '↻ Change statements'), h('button', {class: 'cg-btn', type: 'button', onclick: download}, '⬇ Word'), resetLink())),
    h('div', {class: 'cg-guide'}, tocEl, h('div', {}, overview, ...focuses, yours, exportCard)));
}

// ---------------------------------------------------------------- actions
async function run(title, stages, fn) {
  if (work) return;
  const ctl = new AbortController(); const t0 = Date.now();
  work = {title, stages, ctl}; banner = null; renderMain(true);
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    const t = document.getElementById('cg-timer'), st = document.getElementById('cg-stage');
    if (t) t.textContent = s + 's';
    if (st) st.textContent = stages[Math.min(stages.length - 1, Math.floor(s / 4))];
  }, 500);
  try { await fn(ctl.signal); }
  catch (e) {
    if (e.name === 'AbortError') banner = {kind: 'note', text: 'Cancelled. Nothing was changed.'};
    else {
      // Statements, notes and timing rules live in the saved guide and a failed run never writes to it, so a retry starts from exactly the same inputs.
      const offline = e instanceof TypeError || /failed to fetch|network/i.test(e.message || '');
      banner = {kind: 'err', text: offline ? 'Could not reach Liveweave. Check your internet connection. Your statements and notes are saved. Press Try again.' : e.message,
        retry: e.noRetry ? null : () => run(title, stages, fn)};
    }
  }
  finally { clearInterval(tick); work = null; renderMain(true); }
}

// A guide opened from the curriculum map uses exactly the statements ticked on the map for that topic. The map is the only place they are
// changed, so the guide and the map always agree. Returns true when the guide's statements changed.
let lastPull = {ok: true, error: '', onMap: true, total: 0};
async function pullMapStatements(guide) {
  if (!guide || !guide.mapRef) return false;
  lastPull = {ok: false, error: '', onMap: true, total: 0};
  let r = null;
  try {
    const res = await fetch('curriculum_map_api.php?' + new URLSearchParams({action: 'statements', department_id: guide.mapRef.department_id, topic_id: guide.mapRef.topic_id, _: Date.now()}), {credentials: 'same-origin', cache: 'no-store'});
    const text = await res.text();
    try { r = JSON.parse(text); } catch (e) { lastPull.error = res.status === 401 || res.status === 403 || /<html|login/i.test(text.slice(0, 400)) ? 'Your session may have expired. Refresh the page and sign in again.' : 'The curriculum map answered with something unexpected (' + res.status + ').'; return false; }
  } catch (e) { lastPull.error = 'Could not reach the curriculum map. Check your internet connection.'; return false; }
  if (!r || !r.ok) { lastPull.error = (r && r.error) || 'The curriculum map could not be read.'; return false; }
  lastPull = {ok: true, error: '', onMap: r.onMap !== false, total: r.statements.length};
  const rows = r.statements.filter(x => x.selected);
  const mk = (kind, p) => rows.filter(x => x.kind === kind).map((x, i) => ({id: p + (i + 1), text: x.text, source: x.source || '', confidence: x.confidence, link: 'strong', why: '', subject: guide.subject || ''}));
  const next = {knowledge: mk('knowledge', 'k'), practices: mk('practice', 'p')};
  const key = st => [...st.knowledge, ...st.practices].map(x => x.text).join('\n');
  const changed = key(next) !== key(guide.statements);
  guide.statements = next;
  guide.selected = {knowledge: next.knowledge.map(x => x.id), practices: next.practices.map(x => x.id)};
  if (changed) { guide.docId = guide.docId || (rows[0] && rows[0].doc_id) || ''; save(); }
  return changed;
}
const syncMap = () => {};

function find() {
  return run('Finding your curriculum statements', ['Reading the Ministry curriculum…', 'Matching statements to your unit…', 'Checking every word against the source…'], async signal => {
    const r = await stream('find', {docId: G.docId, discipline: G.discipline, year: G.year, topic: G.topic, notes: G.notes, pasted: G.pasted}, signal);
    G.statements = {knowledge: r.knowledge, practices: r.practices};
    G.selected = {knowledge: r.knowledge.filter(s => s.link !== 'loose').map(s => s.id), practices: r.practices.filter(s => s.link !== 'loose').map(s => s.id)};
    save(); view = 'outline';
    if (r.warnings && r.warnings.length) banner = {kind: 'note', text: r.warnings.join(' ')};
  });
}

function generate() {
  return run('Drafting your unit plan', ['Reading your selected statements…', 'Planning the learning focuses…', 'Checking the wording matches the curriculum…'], async signal => {
    const r = await stream('generate', {guide: {year: G.year, topic: G.topic, subject: G.subject, duration: G.duration, notes: G.notes, statements: G.statements, selected: G.selected, existingPlan: G.plan, mapRef: G.mapRef}}, signal);
    const notice = r.statementNotice; delete r.statementNotice;
    G.plan = normalisePlan(r); save(); view = 'guide'; closed.clear();
    banner = notice ? {kind: 'note', text: 'Your draft is ready. ' + notice} : {kind: 'ok', text: 'Your draft is ready. Review it, edit anything, then download it.'};
  });
}

// ---- lesson allocation: each learning focus has a whole number of lessons; the labels, the total and the duration line all follow from those numbers
const lessonsLabel = (at, n) => n === 1 ? 'Lesson ' + at : 'Lessons ' + at + '–' + (at + n - 1);
function countFromLabel(t) { const m = String(t || '').match(/\d+/g); return m ? (m.length > 1 ? Math.max(1, +m[m.length - 1] - +m[0] + 1) : 1) : null; }
function ensureCounts(p) { for (const f of p.focuses) if (!Number.isFinite(f.lessonCount)) { const n = countFromLabel(f.lessons); if (n) f.lessonCount = n; } }
const lessonTotal = p => p.focuses.reduce((a, f) => a + (Number.isFinite(f.lessonCount) ? f.lessonCount : 0), 0);
function relabel(p) {
  let at = 1;
  for (const f of p.focuses) { const n = Number.isFinite(f.lessonCount) ? f.lessonCount : 0; if (n > 0) { f.lessons = lessonsLabel(at, n); at += n; } else f.lessons = ''; }
  const total = lessonTotal(p);
  if (total < 1) return;
  let d = String(p.duration || '');
  if (/\d+\s+lessons?/i.test(d)) {
    d = d.replace(/\d+(\s+lessons?)/i, (m, unit) => total + unit);
    const w = d.match(/\((\d+)\s+a week for (\d+)\s+weeks?\)/i);
    if (w && +w[1] * +w[2] !== total) d = d.replace(/\s*\(\d+\s+a week for \d+\s+weeks?\)/i, '');   // the timetable no longer explains the total
  } else if (!d.trim() || /^approximately/i.test(d)) d = 'Approximately ' + total + ' lessons, estimated from the learning focuses.';
  p.duration = d;
}
// A new total is spread across the focuses, changing the largest allocations first (every focus keeps at least one lesson).
function fitTotal(p, T) {
  let sum = lessonTotal(p);
  while (sum !== T) {
    let moved = false;
    for (const f of p.focuses.slice().sort((a, b) => (b.lessonCount || 0) - (a.lessonCount || 0))) {
      if (sum < T) { f.lessonCount = (f.lessonCount || 0) + 1; sum++; moved = true; } else if ((f.lessonCount || 0) > 1) { f.lessonCount--; sum--; moved = true; }
      if (sum === T) break;
    }
    if (!moved) break;
  }
}
function paintLessons() {
  if (!G || !G.plan) return;
  const p = G.plan;
  document.querySelectorAll('[data-lrange]').forEach(el => { const f = p.focuses[+el.dataset.lrange]; el.textContent = f ? f.lessons || '' : ''; });
  document.querySelectorAll('input.cg-les').forEach(el => { const f = p.focuses[+el.dataset.fi]; if (f && document.activeElement !== el) el.value = Number.isFinite(f.lessonCount) ? f.lessonCount : ''; });
  const t = document.getElementById('cg-ltot'); if (t && document.activeElement !== t) t.value = lessonTotal(p) || '';
  const d = document.getElementById('cg-ldur'); if (d && document.activeElement !== d) d.value = p.duration || '';
  const c = document.getElementById('cg-dchip'); if (c) c.textContent = p.duration || '';
}

function normalisePlan(p) { if (!Array.isArray(p.capabilities)) p.capabilities = []; return p; }

// ---- reset or delete: a dialog that says exactly what each choice removes, never closed by clicking outside it
let dlg = null;
const closeDlg = () => { dlg?.remove(); dlg = null; };
addEventListener('keydown', e => { if (e.key === 'Escape' && dlg) closeDlg(); });
function openDlg(title, body, actions) {
  closeDlg();
  dlg = h('div', {class: 'cg cg-veil', role: 'dialog', 'aria-modal': 'true', 'aria-label': title}, h('div', {class: 'cg-dlg'}, h('h3', {}, title), body, h('div', {class: 'cg-dacts'}, ...actions)));
  document.body.append(dlg);
  dlg.querySelector('input,button')?.focus();
}

function resetDialog() {
  if (!G || work) return;
  const saved = guides.some(g => g.id === G.id), opts = [];
  if (G.plan) opts.push({k: 'plan', label: 'Remove the drafted unit plan', text: 'Clears the drafted unit plan so you can draft it again. Your unit, statements, timing rules and notes stay exactly as they are.', btn: 'Remove the draft'});
  opts.push({k: 'start', label: 'Start this unit plan over',
    text: G.mapRef ? 'Clears the drafted unit plan, your notes, timing rules and pasted text, and reloads the statements ticked on the curriculum map. The unit, year and subject stay.'
      : 'Clears the drafted unit plan, your selected statements, notes, timing rules and pasted text. The unit, year and subject stay.', btn: 'Start over'});
  if (saved) opts.push({k: 'delete', label: 'Delete this unit plan', text: 'Removes the unit plan from your account for good. This cannot be undone.', btn: 'Delete the unit plan', typed: 'DELETE', danger: true});
  let choice = opts[0].k, typed = '', step = 1;
  const body = h('div', {}), go = h('button', {class: 'cg-btn', type: 'button'}, ''), back = h('button', {class: 'cg-ghost', type: 'button'}, 'Cancel');
  const cur = () => opts.find(o => o.k === choice);
  const paint = () => {
    const o = cur();
    if (step === 1) {
      body.replaceChildren(h('p', {class: 'cg-mut', style: 'margin:0 0 10px;color:var(--mut)'}, 'What would you like to do with “' + (G.topic || 'this unit plan') + '”?'),
        ...opts.map(x => h('label', {class: 'cg-opt' + (choice === x.k ? ' on' : '') + (x.danger ? ' danger' : '')}, h('input', {type: 'radio', name: 'cg-reset', checked: choice === x.k, onchange: () => { choice = x.k; paint(); }}), h('div', {}, h('b', {}, x.label), h('small', {}, x.text)))));
      go.textContent = 'Continue'; go.className = 'cg-btn'; go.disabled = false; back.textContent = 'Cancel';
    } else {
      body.replaceChildren(h('p', {style: 'margin:0 0 10px'}, h('b', {}, 'Are you sure? '), o.text),
        o.typed ? h('label', {class: 'cg-f', style: 'display:block'}, h('span', {style: 'display:block;font-weight:650;margin-bottom:4px'}, 'To confirm, type ' + o.typed), h('input', {type: 'text', autocomplete: 'off', 'aria-label': 'Type ' + o.typed + ' to confirm', style: 'width:100%', oninput: e => { typed = e.target.value; go.disabled = typed.trim() !== o.typed; }})) : null);
      go.textContent = o.btn; go.className = 'cg-btn' + (o.danger ? ' cg-danger' : ''); go.disabled = !!o.typed && typed.trim() !== o.typed; back.textContent = 'Back';
    }
  };
  go.onclick = async () => {
    if (step === 1) { step = 2; paint(); return; }
    const o = cur(); if (o.typed && typed.trim() !== o.typed) return;
    go.disabled = true;
    closeDlg();
    if (o.k === 'delete') return remove();
    G.plan = null; closed.clear();
    if (o.k === 'start') {
      G.notes = ''; G.duration = ''; G.pasted = ''; G.statements = {knowledge: [], practices: []}; G.selected = {knowledge: [], practices: []};
      if (G.mapRef) await pullMapStatements(G);
    }
    save(); banner = {kind: 'ok', text: o.k === 'plan' ? 'The drafted unit plan was removed. Your statements and notes are still here.' : 'This unit plan was reset.'};
    view = hasStatements(G) ? 'outline' : 'topic'; renderList(); renderMain(true);
  };
  back.onclick = () => { if (step === 2) { step = 1; typed = ''; paint(); } else closeDlg(); };
  paint();
  openDlg('Reset or delete', body, [back, go]);
}
const resetLink = () => G && (G.plan || hasStatements(G) || guides.some(g => g.id === G.id)) ? h('button', {class: 'cg-link cg-resetlink', type: 'button', onclick: resetDialog}, 'Reset or delete…') : null;

async function remove() {
  const id = G.id;
  try { if (guides.some(g => g.id === id)) await post('delete', {id}); } catch (e) { banner = {kind: 'err', text: e.message}; return renderMain(); }
  guides = guides.filter(g => g.id !== id); G = null; renderList(); renderMain(true); toast('Unit plan deleted');
}

async function download() {
  try {
    const p = structuredClone(G.plan);
    const bytes = await (await fetch(CS.base + 'template.docx?v=ako1')).arrayBuffer();
    const blob = await createWord(p, bytes, {title: G.topic});
    const a = h('a', {href: URL.createObjectURL(blob), download: (G.topic || 'unit-plan').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.docx'});
    document.body.append(a); a.click(); a.remove();
    toast('Downloaded your Word unit plan');
  } catch (e) { banner = {kind: 'err', text: 'Word export failed: ' + e.message}; renderMain(); }
}

// ---------------------------------------------------------------- start
root = document.getElementById('cg-root');
root.className = 'cg';
listEl = h('div', {class: 'cg-list'});
mainEl = h('div', {});
toastEl = h('div', {class: 'cg-toast', role: 'status'});
const mapUrl = () => 'curriculum_studio.php' + (G && G.mapRef ? '?department=' + G.mapRef.department_id : '');
const backBar = h('div', {class: 'cg-backbar'},
  h('a', {class: 'cg-mapbtn', href: 'curriculum_studio.php', onclick: e => { e.preventDefault(); location.href = mapUrl(); }}, h('span', {'aria-hidden': 'true'}, '←'), ' Back to the curriculum map'),
  h('span', {class: 'cg-backhint'}, 'Your department’s year-by-year overview. Open any unit there to build its unit plan.'));
root.append(backBar);
root.append(h('div', {class: 'cg-shell'}, h('aside', {class: 'cg-side'}, h('h2', {}, 'My unit plans'), h('button', {class: 'cg-new', type: 'button', onclick: newGuide}, '＋ New unit plan'), listEl), mainEl), toastEl);
addEventListener('keydown', e => { if (e.key === 'Escape' && work) work.ctl.abort(); });
(async () => {
  try {
    const [a, b] = await Promise.all([fetch(CS.api + '?action=list&_=' + Date.now(), {credentials: 'same-origin', cache: 'no-store'}).then(r => r.json()), fetch(CS.api + '?action=catalogue', {credentials: 'same-origin'}).then(r => r.json())]);
    if (!a.ok || !b.ok) throw Error(a.error || b.error || 'load failed');
    guides = a.guides; docs = b.documents;
    for (const g of guides) if (g.plan) normalisePlan(g.plan);
    renderList(); renderMain();
    const q = new URLSearchParams(location.search);
    if (q.get('blank')) { history.replaceState(null, '', location.pathname + '?guide=1'); newGuide(); }
    else if (q.get('topic')) {   // arriving from the curriculum map: reopen the guide for that topic, or start one with the topic filled in
      const subj = q.get('subject') || '', yr = parseInt(q.get('year'), 10) || 7, topic = q.get('topic');
      history.replaceState(null, '', location.pathname + '?guide=1');
      const mref = q.get('dept') && q.get('mt') ? {department_id: parseInt(q.get('dept'), 10), topic_id: q.get('mt')} : null;
      const ex = guides.find(g => (g.topic || '').toLowerCase() === topic.toLowerCase() && Number(g.year) === yr && (g.subject || '').toLowerCase() === subj.toLowerCase());
      if (ex) { if (mref && (!ex.mapRef || ex.mapRef.department_id !== mref.department_id || ex.mapRef.topic_id !== mref.topic_id)) { ex.mapRef = mref; G = ex; save(); } open(ex.id); }
      else {
        newGuide(); G.topic = topic; G.subject = subj; G.year = yr; G.mapRef = mref;
        const d = docs.find(x => (x.years || JUNIOR).includes(yr) && [x.subject, x.learningArea].some(n => (n || '').toLowerCase() === subj.toLowerCase())); if (d) G.docId = d.id;
        renderMain();
        if (mref) { const g = G; pullMapStatements(g).then(() => { if (G === g) { if (!lastPull.ok) banner = {kind: 'err', text: lastPull.error + ' Press “Use the statements from the curriculum map” to try again.'}; view = hasStatements(g) ? 'outline' : 'topic'; renderList(); renderMain(); } }); }
      }
    }
  } catch (e) { banner = {kind: 'err', text: 'Your unit plans could not be loaded (' + e.message + '). Refresh to try again; nothing has been changed.'}; mainEl.replaceChildren(bannerEl()); }
})();
