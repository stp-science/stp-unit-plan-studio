// Unit Plan Studio front end. Guides are saved in the signed-in workspace.
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
// Prep is intentionally cross-curricular. Each tab comes from an independent,
// named Ministry source; Te Reo Māori follows proficiency, not age.
const PREP_SOURCES = [
  {id:'english-2025',label:'English'},
  {id:'social-sciences-2026',label:'Social Studies'},
  {id:'maths-2025',label:'Maths'},
  {id:'health-pe-2026',label:'Health'},
  {id:'languages-te-reo-maori-sep-2026',label:'Te Reo Māori',novice:true}
];
const isPrepGuide = g => String(g?.subject||'').trim().toLowerCase() === 'prep';
const prepLevelKey = (id,level) => id+':'+String(level);
let prepSourceId = PREP_SOURCES[0].id, prepActiveYear = 7, prepActiveStage = 'Novice 1';
let prepLoading = '', prepError = '';
const resetPrepView = guide => {prepSourceId=PREP_SOURCES[0].id;prepActiveYear=Number(guide?.year)||7;prepActiveStage='Novice 1';prepLoading='';prepError='';statementFilter='';};
const NOVICE = ['Novice 1', 'Novice 2', 'Novice 3'];
const EAL_DOC_ID = 'english-as-an-additional-language-stages-2026';
const EAL_STAGES = ['Stage 1','Stage 2','Stage 3','Stage 4','Stage 5'];
const isEalGuide = g => /^(english as an additional language|eal)$/i.test(String(g?.subject||'').trim());
const ealStages = g => EAL_STAGES.filter(s=>Array.isArray(g?.stages)&&g.stages.includes(s));
const planStages = g => isEalGuide(g) ? ealStages(g) : noviceStages(g);
let ealActiveStage = 'Stage 1', ealLoading = '', ealError = '';
const resetEalView = g => {ealActiveStage=ealStages(g)[0]||'Stage 1';ealLoading='';ealError='';};
const isLanguageSubject = name => /french|spanish|japanese|chinese|mandarin|te reo|māori|maori|language|german|italian|samoan|korean/i.test(String(name || ''));
// New plans store an array; legacy single-stage plans continue to open unchanged.
const noviceStages = g => Array.isArray(g.stages) ? NOVICE.filter(s => g.stages.includes(s)) : NOVICE.includes(g.stage) ? [g.stage] : [];
const guideStageLabel = g => planStages(g).length ? planStages(g).join(' + ') : 'Year ' + g.year;
// Department names that sit inside a broader Ministry learning area, so Art finds the Visual Arts document, Geography the Social Sciences one, and so on.
const SUBJECT_ALIAS = {
  'visual arts': ['art', 'visual art', 'art: design', 'art: photography', 'art design', 'art photography', 'painting', 'printmaking', 'design'],
  'technology': ['design and visual communication', 'digital technology', 'fashion design', 'food', 'product design', 'resistant materials', 'hospitality', 'textiles'],
  'social sciences': ['religious education', 'geography', 'history', 'geospatial technology', 'theology and philosophy', 'tourism studies', 'psychology', 'sociology'],
  'health and physical education': ['physical education and health', 'health studies', 'human performance', 'outdoor education', 'physical education', 'health'],
};
const subjectAlias = name => { const n = String(name || '').trim().toLowerCase(); return Object.keys(SUBJECT_ALIAS).find(k => SUBJECT_ALIAS[k].includes(n)) || ''; };

let guides = [], G = null, docs = [], view = 'topic', work = null, banner = null, pendingSaveTimers = new Map(), saveState = 'saved', closed = new Set(), focusDefaultsFor = '', toastTimer = 0;
let statementFilter = '';
let mapSavePromise = Promise.resolve();
let activeStatementYear = 7;
let statementYearLoading = 0;
let statementYearError = '';
const juniorYearTabs = guide => !!guide && JUNIOR.includes(+guide.year) && !!guide.docId && !guide.pasted && noviceStages(guide).length === 0;
// A saved suggested match may predate this feature; use the explicit source-year
// label when present, otherwise associate it with the unit's original year.
const statementSourceYear = (statement, guide) => {
  if (JUNIOR.includes(+statement.curriculumYear)) return +statement.curriculumYear;
  const match = /\bYear\s*(7|8|9|10)\b/i.exec(String(statement.source || ''));
  return match ? Number(match[1]) : Number(guide.year);
};
const yearBankLoaded = (guide, year) => (Array.isArray(guide.bankYears) && guide.bankYears.includes(year)) ||
  (year === +guide.year && guide.bankLoaded === true);
const statementsForYear = (guide, key, year) => (guide.statements[key] || []).filter(s =>
  !juniorYearTabs(guide) || statementSourceYear(s,guide) === year);
let root, listEl, mainEl, shellEl, toastEl;
let librarySubject = null, libraryQuery = '', directoryQuery = '', libraryShowAll = false, requestedSubject = '';

const blank = () => ({id: uid(), topic: '', subject: '', year: 7, stage: '', stages: [], bankYears: [], prepLoaded: [], ealLoaded: [], languageReferences: '', docId: '', discipline: '', duration: '', notes: '', pasted: '',
  statements: {knowledge: [], practices: []}, selected: {knowledge: [], practices: []}, plan: null, mapRef: null});
const hasStatements = g => g && g.statements.knowledge.length + g.statements.practices.length > 0;
const hue = s => { let x = 0; for (const c of String(s || 'x')) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const colour = s => `hsl(${hue(s)} 55% 46%)`;
const ago = iso => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

// ---------------------------------------------------------------- server
async function post(action, body) {
  const r = await fetch(CS.api + '?action=' + action, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...body, csrf: CS.csrf})});
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw Error(d.error || 'Could not reach Unit Plan Studio.');
  return d;
}

async function stream(action, body, signal) {
  const r = await fetch(CS.api + '?action=' + action, {method: 'POST', credentials: 'same-origin', signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...body, csrf: CS.csrf})});
  if (!(r.headers.get('Content-Type') || '').includes('ndjson')) {
    const d = await r.json().catch(() => ({}));
    const err = Error(d.error || 'Could not reach Unit Plan Studio.'); err.noRetry = r.status < 500; throw err;
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
  if (!G) return;
  const guide = G; // Keep the correct plan even if staff return to the library.
  guide.updated = new Date().toISOString();
  const checklist = document.getElementById('cg-review-checklist');
  if (checklist && guide.plan) checklist.replaceWith(reviewChecklist());
  setSave('busy');
  clearTimeout(pendingSaveTimers.get(guide.id));
  pendingSaveTimers.set(guide.id, setTimeout(async () => {
    pendingSaveTimers.delete(guide.id);
    try {
      await post('save', {guide});
      syncMap(guide);
      if (!guides.some(x => x.id === guide.id)) guides.unshift(guide);
      renderList();
      if (G === guide) setSave('saved');
      else if (!G && librarySubject === subjectKey(guideSubject(guide))) renderMain();
    } catch (e) {
      if (G === guide) setSave('bad', e.message);
      else toast('A unit plan could not be saved. Reopen the plan and try again.');
    }
  }, 700));
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

// ---------------------------------------------------------------- subject library
// Always-visible three-column subject sidebar, with saved plan tiles on the right.
function guideSubject(g) {
  const raw = String(g.subject || g.discipline || docs.find(d => d.id === g.docId)?.subject || '').trim();
  if (!raw) return 'Uncategorised';
  const n = raw.toLowerCase().replace(/\s+/g,' ');
  const canonical = {
    'maths':'Mathematics', 'math':'Mathematics', 'mathematics and statistics':'Mathematics',
    'physical education':'Health & PE', 'health and physical education':'Health & PE',
    'health & physical education':'Health & PE', 'hpe':'Health & PE',
    'visual art':'Visual Arts','art':'Visual Arts',
    'social science':'Social Sciences',
    'english as an additional language':'English as an Additional Language'
  };
  if (canonical[n]) return canonical[n];
  return raw.replace(/\b[a-z]/g,letter=>letter.toUpperCase());
}
const subjectKey = name => name.toLocaleLowerCase();
function guideGroups() {
  const groups = new Map();
  for (const guide of guides) {
    const name = guideSubject(guide), key = subjectKey(name);
    if (!groups.has(key)) groups.set(key,{key,name,plans:[]});
    groups.get(key).plans.push(guide);
  }
  // Prep/EAL remain available; a subject passed from the curriculum map
  // is also offered even when no unit plans have been created for it yet.
  for (const name of ['Prep','English as an Additional Language',requestedSubject].filter(Boolean)) {
    const key=subjectKey(name);
    if (!groups.has(key)) groups.set(key,{key,name,plans:[]});
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function returnToSubjects() {
  G=null; librarySubject=null; libraryQuery=''; directoryQuery=''; libraryShowAll=false; view='library'; banner=null;
  renderList(); renderMain(true);
}
function showSubjectLibrary(key) {
  const group=guideGroups().find(g=>g.key===key);
  if (!group) return;
  G=null; librarySubject=key; libraryQuery=''; libraryShowAll=false; view='library'; banner=null;
  renderList(); renderMain(true);
}
function startSubjectGuide(name) {
  if (name==='Prep') return newPrepGuide();
  if (name==='English as an Additional Language') return newEalGuide();
  newGuide();
  G.subject=name;
  librarySubject=subjectKey(name);
  renderList();
  renderMain(true);
}
function renderList() {
  const query=directoryQuery.trim().toLocaleLowerCase();
  const groups=guideGroups().filter(group=>!query||group.name.toLocaleLowerCase().includes(query));
  listEl.replaceChildren(...groups.map(group=>h('button',{
      type:'button',class:'cg-side-subject'+(librarySubject===group.key?' on':''),
      title:group.name+' — '+group.plans.length+' saved unit plans',
      'aria-label':'View '+group.name+': '+group.plans.length+' saved unit plans',
      'aria-pressed':String(librarySubject===group.key),
      onclick:()=>showSubjectLibrary(group.key)},
    h('span',{class:'cg-side-subject-name'},group.name),
    h('span',{class:'cg-side-subject-count'},String(group.plans.length)))));
  if (!groups.length) listEl.append(h('p',{class:'cg-subject-side-empty'},
    query?'No matching subjects.':'No subjects available yet.'));
}
function libraryView() {
  const group=librarySubject ? guideGroups().find(g=>g.key===librarySubject) : null;
  const selected=!!group;
  const all=selected?[...group.plans]:[...guides];
  all.sort((a,b)=> selected
    ? Number(a.year||0)-Number(b.year||0) || String(a.topic||'').localeCompare(String(b.topic||''))
    : String(b.updated||'').localeCompare(String(a.updated||'')));
  const title=selected?group.name+' unit plans':'Saved unit plans';
  const head=h('div',{class:'cg-library-head'},
    h('div',{},h('h1',{},title),
      h('p',{},selected
        ? group.plans.length+' saved unit plan'+(group.plans.length===1?'':'s')+'. Open any tile to view or edit the plan.'
        : 'Select a subject on the left to see its units, or open a recently updated plan below.')),
    h('button',{type:'button',class:'cg-btn',onclick:()=>selected?startSubjectGuide(group.name):newGuide()},
      '+ New unit plan'));
  const grid=h('div',{class:'cg-library-grid',id:'cg-library-grid'});
  const count=h('p',{class:'cg-library-results',role:'status'});
  const showAll=h('button',{type:'button',class:'cg-ghost cg-library-showall',
    onclick:()=>{libraryShowAll=true;paint();}},'Show all saved plans');
  const paint=()=>{
    const q=libraryQuery.trim().toLocaleLowerCase();
    const filtered=all.filter(g=>!q||[g.topic,g.subject,guideStageLabel(g)].some(v=>String(v||'').toLocaleLowerCase().includes(q)));
    const visible=!selected&&!q&&!libraryShowAll?filtered.slice(0,12):filtered;
    count.textContent=visible.length+' of '+filtered.length+' unit plans';
    grid.replaceChildren(...visible.map(g=>h('button',{type:'button',class:'cg-library-tile',
      onclick:()=>open(g.id),'aria-label':'Open '+(g.topic||'Untitled unit')+', '+guideStageLabel(g)},
      h('span',{class:'cg-library-tile-top'},
        h('span',{class:'cg-library-year'},guideStageLabel(g)),
        h('span',{class:'cg-library-status'+(g.plan?' drafted':'')},
          g.plan?'Draft created':hasStatements(g)?'Curriculum selected':'New')),
      h('strong',{},g.topic||'Untitled unit plan'),
      h('span',{class:'cg-library-tile-bottom'},
        h('small',{},(selected?'':guideSubject(g)+' · ')+'Updated '+ago(g.updated)),
        h('span',{},'Open plan →')))));
    if (!filtered.length) grid.append(h('p',{class:'cg-library-empty'},
      q?'No matching unit plans. Try another search.':selected?'No units saved for this subject yet. Select New unit plan above.':'No unit plans saved yet. Use New unit plan to begin.'));
    const more=!selected&&!q&&!libraryShowAll&&filtered.length>12;
    showAll.hidden=!more;
    if(more)showAll.textContent='Show all '+filtered.length+' saved plans';
  };
  const search=h('input',{class:'cg-library-search',type:'search',value:libraryQuery,
    placeholder:selected?'Search '+group.name+' unit plans…':'Search all saved unit plans…',
    'aria-label':'Search saved unit plans',oninput:e=>{libraryQuery=e.target.value;paint();}});
  paint();
  return h('section',{class:'cg-library-page'},head,
    h('div',{class:'cg-library-toolbar'},search,count),grid,showAll);
}
function backToLibrary() {
  if (!G) return returnToSubjects();
  const group=guideGroups().find(g=>g.key===subjectKey(guideSubject(G)));
  if (group) showSubjectLibrary(group.key);
  else returnToSubjects();
}
function editorLibraryBack() {
  return h('div',{class:'cg-editor-back'},h('button',{type:'button',class:'cg-ghost',
    onclick:backToLibrary},'← Back to '+(G?guideSubject(G)+' units':'all subjects')));
}

function open(id) {
  mapSavePromise = Promise.resolve();
  G = guides.find(g => g.id === id) || null;
  resetPrepView(G); resetEalView(G);
  activeStatementYear = G ? Number(G.year) : 7;
  statementYearLoading = 0; statementYearError = '';
  if (G) librarySubject=subjectKey(guideSubject(G));
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
function newPrepGuide() {
  newGuide(); G.subject='Prep'; G.year=7; resetPrepView(G); save(); renderMain(true);
}
function newEalGuide() {
  newGuide(); G.subject='English as an Additional Language'; G.year=11;
  G.docId=EAL_DOC_ID; resetEalView(G); save(); renderMain(true);
}
function newGuide() { resetPrepView({year:7}); resetEalView(null); activeStatementYear=7; statementYearLoading=0; statementYearError=''; librarySubject=null; libraryQuery=''; mapSavePromise = Promise.resolve(); G = blank(); banner = null; view = 'topic'; renderList(); renderMain(true); setTimeout(() => document.querySelector('.cg-topic')?.focus(), 50); }

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
  const key = (G ? G.id : 'library:'+(librarySubject||'subjects')) + '|' + view, st = history.state;
  const state={cg:1,key,gid:G?G.id:'',view,subject:librarySubject||'',idx:st?.idx||0};
  if (!st || !st.cg) { history.replaceState({...state,idx:0}, ''); return; }
  if (st.key === key) return;
  history.pushState({...state,idx:(st.idx||0)+1}, '', location.href);
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
  librarySubject=st.subject||null;
  view = st.view || 'topic';
  if (!G) view = 'library'; else if (view === 'guide' && !G.plan) view = hasStatements(G) ? 'outline' : 'topic'; else if (view === 'outline' && !hasStatements(G)) view = 'topic';
  banner = null;
  renderList(); renderMain(true);
  restoring = false;
});

function renderMain(top) {
  mainEl.classList.toggle('cg-animate', !!top);
  shellEl.classList.toggle('is-full',!!G);
  mainEl.replaceChildren(...(G&&!work?[editorLibraryBack()]:[]),...build().filter(Boolean));
  if (top) window.scrollTo?.({top: 0}), mainEl.closest('.workspace')?.scrollTo?.({top: 0});
  const mb = document.querySelector('.cg-mapbtn'); if (mb && mb.lastChild) mb.lastChild.textContent = G && G.mapRef ? ' Back to the curriculum map' : ' Back to start';
  syncHistory();
}

function build() {
  if (!G) return [libraryView()];
  if (work) return [stepper(), workCard()];
  if (G.mapRef && !isPrepGuide(G) && !isEalGuide(G) && !hasStatements(G) && !G.plan && view !== 'topic') return [stepper(), bannerEl(), h('section', {class: 'cg-card'}, h('h2', {}, 'No statements ticked on the map yet'), h('p', {class: 'lead'}, 'This unit plan is built from the statements you tick for “' + G.topic + '” on the curriculum map. Open the unit on the map, tick the statements it teaches, then come back.'), h('div', {class: 'cg-actions'}, h('a', {class: 'cg-btn lg', href: mapUrl()}, '← Go to the curriculum map')))];
  return [stepper(), bannerEl(), view === 'topic' ? topicCard() : view === 'outline' && (hasStatements(G) || isPrepGuide(G) || isEalGuide(G)) ? (isPrepGuide(G) ? prepOutlineCard() : isEalGuide(G) ? ealOutlineCard() : outlineCard()) : G.plan ? guideView() : topicCard()];
}

function workCard() {
  const el = h('section', {class: 'cg-card cg-work', 'aria-live': 'polite'}, h('div', {class: 'cg-orb'}), h('h2', {}, work.title), h('p', {id: 'cg-stage'}, work.stages[0]),
    h('div', {class: 'cg-skel'}, h('i'), h('i'), h('i'), h('i')), h('div', {class: 'cg-timer', id: 'cg-timer'}, '0s'),
    h('div', {class: 'cg-actions', style: 'justify-content:center'}, h('button', {class: 'cg-ghost', type: 'button', onclick: () => work.ctl.abort()}, 'Cancel')));
  return el;
}

function topicCard() {
  if (isPrepGuide(G)) return prepTopicCard();
  if (isEalGuide(G)) return ealTopicCard();
  const yd = docs.filter(d => (d.years || JUNIOR).includes(G.year));
  // The subject filters the document list: a Science guide only offers the Science document (clear the subject to see everything).
  const subj = (G.subject || '').trim().toLowerCase();
  const names = d => [d.subject, d.learningArea, d.title, ...(d.subjects || [])].map(x => String(x || '').toLowerCase()).filter(Boolean);
  const pick = q => { if (!q) return []; const ex = yd.filter(d => names(d).some(n => n === q)); return ex.length ? ex : (q.length >= 4 ? yd.filter(d => names(d).some(n => n.includes(q))) : []); };
  const matches = pick(subj).length ? pick(subj) : pick(subjectAlias(subj));
  const shown = matches.length ? matches : yd;
  if (matches.length && G.docId && !matches.some(d => d.id === G.docId)) {
    G.docId = ''; G.bankLoaded = false; G.bankYears = [];
  }
  if (matches.length === 1 && G.docId !== matches[0].id) {
    if (G.docId) {G.statements={knowledge:[],practices:[]};G.selected={knowledge:[],practices:[]};G.bankLoaded=false;G.bankYears=[];}
    G.docId = matches[0].id;
    const arts = ['Dance', 'Drama', 'Music', 'Visual Arts'].find(a => a.toLowerCase() === (subjectAlias(subj) || subj));
    if (matches[0].learningArea === 'The Arts' && arts) G.discipline = arts;
    save();
  }
  const subjectNames = [...new Set(['Prep','English as an Additional Language',...yd.flatMap(d => [d.subject, ...(d.subjects || [])]).filter(Boolean)])].sort();
  const areas = [...new Set(shown.map(d => d.learningArea))].sort();
  const doc = docs.find(d => d.id === G.docId);
  const isArts = doc && doc.learningArea === 'The Arts';
  const isLanguage = (doc && doc.learningArea === 'Learning Languages') || isLanguageSubject(G.subject);
  const found = hasStatements(G);
  const ready = G.topic.trim() && (G.docId || G.pasted.trim()) && (!isLanguage || noviceStages(G).length > 0);
  const go = G.mapRef
    ? h('button', {class: 'cg-btn lg', type: 'button', onclick: async e => {
      e.target.disabled = true; e.target.textContent = 'Reading the curriculum map…';
      await pullMapStatements(G);
      if (lastPull.ok && noviceStages(G).length && G.docId) {
        try { await expandNoviceStatements(G); }
        catch (error) { banner = {kind:'note',text:'The map statements are kept, but not all novice levels loaded: '+error.message}; }
      }
      if (!lastPull.ok) banner = {kind: 'err', text: lastPull.error + ' Your unit plan is unchanged.', retry: () => { renderMain(true); document.querySelector('.cg-card .cg-btn.lg')?.click(); }};
      else if (!lastPull.onMap) banner = {kind: 'err', text: 'This unit plan was linked to a unit that is no longer on the curriculum map. Open the unit on the map and choose “Open unit plan” again.'};
      else if (hasStatements(G)) { view = 'outline'; if (G.bankLoaded) banner = null; }
      else banner = {kind: 'note', text: lastPull.total ? 'This unit has ' + lastPull.total + ' statement' + (lastPull.total === 1 ? '' : 's') + ' on the map, but none are ticked. Open the unit on the map and tick the ones it teaches.' : 'No statements have been added to this unit on the curriculum map yet. Open the unit on the map and tick the statements it teaches (or use Match all units).'};
      renderMain(true); window.scrollTo({top: 0, behavior: 'smooth'});
    }}, 'Use the statements from the curriculum map  →')
    : h('button', {class: 'cg-btn lg', type: 'button', disabled: !ready, onclick: find}, found ? 'Find statements again  →' : 'Find curriculum statements  →');
  const sync = () => { go.disabled = !(G.topic.trim() && (G.docId || G.pasted.trim()) && (!isLanguage || noviceStages(G).length > 0)); };
  return h('section', {class: 'cg-card'},
    h('h2', {}, 'What are you teaching?'), h('p', {class: 'lead'}, 'Start with the unit. We will find the matching Ministry statements next.'),
    h('input', {class: 'cg-topic', type: 'text', value: G.topic, placeholder: 'e.g. Forces and motion', 'aria-label': 'Unit', oninput: e => { G.topic = e.target.value; save(); sync(); }}),
    h('div', {style: 'margin-top:20px'}, h('span', {class: 'cg-f'}, h('span', {style: 'display:block;font-weight:620;font-size:13px;margin-bottom:6px'}, isLanguage ? 'Language proficiency stage' : 'Year group')),
      isLanguage
        ? h('div', {class:'cg-novice-picker', role:'group', 'aria-label':'Novice levels — select any combination'},
            h('p', {class:'cg-mut'}, 'Tick all novice levels taught in this unit. Statements from every selected level will be available on the next screen.'),
            ...NOVICE.map(stage => h('label', {class:'cg-novice-option' + (noviceStages(G).includes(stage) ? ' on' : '')},
              h('input', {type:'checkbox', checked:noviceStages(G).includes(stage), disabled:false,
                onchange:e => {
                  const chosen = noviceStages(G);
                  const next = e.target.checked ? [...chosen,stage] : chosen.filter(s=>s!==stage);
                  G.stages = NOVICE.filter(s=>next.includes(s));
                  G.stage = G.stages[0] || '';
                  G.year = 7;
                  // Earlier drafted plans remain saved; the statement picker is refreshed
                  // to prevent old-level statements accidentally crossing stages.
                  if (!G.mapRef) {
                    G.statements = {knowledge:[], practices:[]};
                    G.selected = {knowledge:[], practices:[]};
                  }
                  G.bankLoaded = false; G.bankYears = [];
                  if (G.plan) banner = {kind:'note',text:'Your earlier draft is kept. Find statements again and redraft to use the updated novice levels.'};
                  save(); renderMain();
                }}),h('span', {},stage))),
            G.mapRef ? h('p', {class:'cg-mut'}, 'Your original map statements stay selected. On the next screen, add statements from these levels; new ticks are saved back to the curriculum map.') : null)
        : h('div', {class: 'cg-seg', role: 'group', 'aria-label': 'Year'}, [7, 8, 9, 10, 11, 12, 13].map(y => h('button', {type: 'button', class: y === G.year ? 'on' : '', 'aria-pressed': y === G.year ? 'true' : 'false', onclick: () => { G.year = y; activeStatementYear = y; G.stage = ''; G.stages = []; G.bankLoaded=false; G.bankYears=[]; G.statements={knowledge:[],practices:[]}; G.selected={knowledge:[],practices:[]}; if (G.docId && !(docs.find(d => d.id === G.docId)?.years || JUNIOR).includes(y)) G.docId = ''; save(); renderMain(); }}, 'Year ' + y)))),
    h('div', {class: 'cg-grid'},
      field('Subject', h('div', {}, h('input', {type: 'text', list: 'cg-subjects', value: G.subject || '', placeholder: 'e.g. Science', 'aria-label': 'Subject', onchange: e => {
          if (G.subject.trim().toLowerCase() !== e.target.value.trim().toLowerCase()) {
            G.prepLoaded=[]; G.ealLoaded=[]; resetPrepView(G); resetEalView(G);
            G.statements={knowledge:[],practices:[]}; G.selected={knowledge:[],practices:[]};
            G.bankYears=[]; G.bankLoaded=false; activeStatementYear=Number(G.year);
            if (G.plan) banner={kind:'note',text:'Your previous draft is kept. Find the new subject’s official statements and redraft this unit before using it.'};
          }
          G.subject = e.target.value;
          if (isPrepGuide(G)) {G.docId=''; G.discipline=''; G.year=G.year===8?8:7; G.stage=''; G.stages=[];}
          const chosenArt = ['Dance','Drama','Music','Visual Arts'].find(x=>x.toLowerCase()===(subjectAlias(G.subject.toLowerCase()) || G.subject.toLowerCase()));
          if (chosenArt) G.discipline = chosenArt;
          else if (docs.find(d=>d.id===G.docId)?.learningArea === 'The Arts') G.discipline = '';
          if (isEalGuide(G)) {
            G.year=11;G.docId=EAL_DOC_ID;G.stages=[];G.stage='';resetEalView(G);
          } else if (isLanguageSubject(G.subject)) {
            G.stages = noviceStages(G).length ? noviceStages(G) : ['Novice 1'];
            G.stage = G.stages[0]; G.year = 7;
          } else { G.stage = ''; G.stages = []; }
          save(); renderMain(); }}),
        h('datalist', {id: 'cg-subjects'}, subjectNames.map(n => h('option', {value: n})))), matches.length ? 'Showing the Ministry documents for ' + G.subject + '. Clear this to see every subject.' : subj ? 'No Ministry document matches “' + G.subject + '”, so all are shown. You can also paste your own curriculum text below.' : 'Shown on the unit plan. Pick one to filter the curriculum documents.'),
      field('Curriculum document', (() => h('select', {onchange: e => {
          if (G.docId !== e.target.value) {
            G.statements = {knowledge:[], practices:[]};
            G.selected = {knowledge:[], practices:[]};
            G.bankLoaded = false; G.bankYears = [];
            if (G.plan) banner = {kind:'note',text:'The curriculum source changed. Your earlier draft is kept; find and select the new source statements before redrafting.'};
          }
          G.docId = e.target.value; const d = docs.find(x => x.id === G.docId); if (d && !G.subject.trim()) G.subject = d.subject; G.stages = d?.learningArea === 'Learning Languages' ? (noviceStages(G).length ? noviceStages(G) : ['Novice 1']) : []; G.stage = G.stages[0] || ''; if (G.stage) G.year = 7; G.discipline = ''; save(); renderMain(); }}, h('option', {value: ''}, 'Choose a document…'),
        ...areas.map(a => h('optgroup', {label: a}, ...shown.filter(d => d.learningArea === a).map(d => h('option', {value: d.id, selected: d.id === G.docId}, d.title))))))(), doc && doc.status ? doc.status : 'Official Ministry text, kept word for word.'),
      isArts ? field('Arts subject', h('select', {onchange: e => {
        if (G.discipline !== e.target.value) {
          G.statements={knowledge:[],practices:[]};G.selected={knowledge:[],practices:[]};
          G.bankYears=[];G.bankLoaded=false;activeStatementYear=Number(G.year);
          if (G.plan) banner={kind:'note',text:'The Arts discipline changed. Find the new official statements and redraft the unit.'};
        }
        G.discipline=e.target.value;save();renderMain();
      }}, h('option', {value: ''}, 'All'), ...['Dance', 'Drama', 'Music', 'Visual Arts'].map(s => h('option', {value: s, selected: s === G.discipline}, s)))) : null,
      ),
    timingField(),
    h('details', {class: 'cg-more', open: !!(G.notes || G.pasted || G.languageReferences)},
      h('summary', {}, 'Add context, teaching references or curriculum text'),
      field('Anything the AI should know', area(G.notes, v => { G.notes = v; save(); }, 2), 'Equipment, what students already know, local focus…'),
      isLanguage ? languageReferencesField(G) : null,
      field('Paste curriculum text (if your subject is not listed)', area(G.pasted, v => { G.pasted = v; save(); sync(); }, 4), 'Paste the official knowledge and practice statements for this year. They are checked against exactly what you paste.')),
    h('div', {class: 'cg-actions'}, go,
      !G.mapRef && G.docId && !G.pasted && (JUNIOR.includes(G.year) || noviceStages(G).length) ?
        h('button', {class:'cg-ghost',type:'button',
          disabled:!G.topic.trim() || (isLanguage && !noviceStages(G).length),
          onclick:browseOfficialStatements}, 'Browse all official statements' + (noviceStages(G).length ? '' : ' · no AI')) : null,
      found ? h('button', {class: 'cg-ghost', type: 'button', onclick: () => { view = 'outline'; renderMain(true); }}, 'Back to my outline') : null,
      h('span', {style: 'margin-left:auto'}, resetLink())));
}

// ---- Prep: interdisciplinary Year 7/8 units across five official sources ----
// The unit's own year is fixed; the curriculum tabs are independent. Te Reo
// Māori uses Novice 1/2/3 and never assumes a Novice stage equals a school year.
const prepActiveSource = () => PREP_SOURCES.find(s=>s.id===prepSourceId) || PREP_SOURCES[0];
const prepActiveLevel = () => prepActiveSource().novice ? prepActiveStage : prepActiveYear;
const prepRows = (guide,key,sourceId=prepSourceId,level=prepActiveLevel()) =>
  (guide.statements[key]||[]).filter(s=>s.prepSourceId===sourceId &&
    (s.prepStage||s.curriculumYear)===level);
const prepCount = (guide,sourceId,level) =>
  ['knowledge','practices'].reduce((n,key)=>n+prepRows(guide,key,sourceId,level)
    .filter(s=>guide.selected[key].includes(s.id)).length,0);
async function openPrepTab(sourceId,level) {
  if (!G || !isPrepGuide(G) || prepLoading) return;
  const source=PREP_SOURCES.find(s=>s.id===sourceId);
  if (!source) return;
  if (source.novice) {
    if (!NOVICE.includes(level)) level='Novice 1';
    prepActiveStage=level;
  } else {
    if (![7,8].includes(Number(level))) level=Number(G.year);
    prepActiveYear=Number(level);
  }
  prepSourceId=sourceId;
  statementFilter=''; prepError='';
  const guide=G, tag=prepLevelKey(sourceId,level);
  if ((guide.prepLoaded||[]).includes(tag)) {renderMain();return;}
  prepLoading=source.label+' · '+(source.novice?level:'Year '+level);
  renderMain();
  try {
    let rows=[];
    if (source.novice) {
      const query=new URLSearchParams({action:'novice-bank',doc_id:source.id,stage:level});
      const read=async()=>{
        const response=await fetch(CS.api+'?'+query,{credentials:'same-origin',cache:'no-store'});
        const result=await response.json().catch(()=>({}));
        if (!response.ok||!result.ok) throw Error(result.error||'Could not read '+level+' official statements.');
        return result;
      };
      let bank=await read();
      for(const chunk of bank.missing||[]) {
        if (G!==guide) return;
        await post('novice-bank-build',{doc_id:source.id,stage:level,chunk});
      }
      if(!bank.complete) bank=await read();
      if(!bank.complete) throw Error('The '+level+' curriculum could not be completely loaded. Please retry.');
      rows=bank.items||[];
    } else {
      const query=new URLSearchParams({action:'statement-bank',doc_id:source.id,year:String(level)});
      const response=await fetch(CS.api+'?'+query,{credentials:'same-origin',cache:'no-store'});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok) throw Error(result.error||'Could not load the official Year '+level+' statements.');
      rows=(result.records||[]).filter(s=>source.label!=='Health'||s.subject==='Health');
    }
    if(!rows.length) throw Error('No verified statements were available for '+source.label+' '+(source.novice?level:'Year '+level)+'.');
    if(G!==guide) return;
    const seen={
      knowledge:new Set(prepRows(guide,'knowledge',sourceId,level).map(s=>s.text.trim().toLocaleLowerCase())),
      practices:new Set(prepRows(guide,'practices',sourceId,level).map(s=>s.text.trim().toLocaleLowerCase()))
    };
    for(const [i,record] of rows.entries()){
      const key=record.kind==='practice'?'practices':'knowledge';
      const text=String(record.text||'').trim();
      if(!text||seen[key].has(text.toLocaleLowerCase()))continue;
      seen[key].add(text.toLocaleLowerCase());
      const descriptor=source.label+' — '+(source.novice?level:'Year '+level);
      guide.statements[key].push({
        id:'prep:'+sourceId+':'+String(level).replace(/\s+/g,'-')+':'+key+':'+i,
        text,subject:source.label,prepSourceId:source.id,
        ...(source.novice?{prepStage:level}:{curriculumYear:Number(level)}),
        source:descriptor+(record.source?' · '+record.source:''),
        link:'unmatched',why:'Official '+descriptor+' statement; teacher selection',confidence:null
      });
    }
    guide.prepLoaded=[...new Set([...(guide.prepLoaded||[]),tag])];
    save();
  }catch(error){
    if(G===guide)prepError=error.message||'Failed to load curriculum statements.';
  }finally{
    if(G===guide){prepLoading='';renderMain();}
  }
}
// ---- English as an Additional Language (EAL), 2026 Stage 1–5 curriculum ----
// Stages are proficiency markers; never infer stage from the school year.
const ealRows=(guide,key,stage=ealActiveStage)=>(guide.statements[key]||[]).filter(s=>
  s.ealStage===stage || (s.source?.includes('Stage '+stage.slice(-1)) &&
    (s.ealStage==null||s.ealStage===stage)));
const ealCount=(guide,stage)=>['knowledge','practices'].reduce((sum,key)=>
  sum+ealRows(guide,key,stage).filter(s=>guide.selected[key].includes(s.id)).length,0);
const updateEalSelectedStages=guide=>{
  guide.stages=EAL_STAGES.filter(stage=>ealCount(guide,stage)>0);
  guide.stage=guide.stages[0]||'';
};
async function openEalStage(stage){
  if(!isEalGuide(G)||!EAL_STAGES.includes(stage)||ealLoading)return;
  ealActiveStage=stage;statementFilter='';ealError='';
  const guide=G;
  if((guide.ealLoaded||[]).includes(stage)){renderMain();return;}
  ealLoading=stage;renderMain();
  try{
    const read=async()=>{
      const query=new URLSearchParams({action:'novice-bank',doc_id:EAL_DOC_ID,stage});
      const response=await fetch(CS.api+'?'+query,{credentials:'same-origin',cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw Error(data.error||'Could not retrieve '+stage+' statements.');
      return data;
    };
    let bank=await read();
    for(const part of bank.missing||[]){
      if(G!==guide)return;
      await post('novice-bank-build',{doc_id:EAL_DOC_ID,stage,chunk:part});
    }
    if(!bank.complete)bank=await read();
    if(!bank.complete)throw Error('The '+stage+' list is incomplete; retry this stage.');
    if(G!==guide)return;
    const byKind={
      knowledge:new Set(ealRows(guide,'knowledge',stage).map(s=>s.text.trim().toLocaleLowerCase())),
      practices:new Set(ealRows(guide,'practices',stage).map(s=>s.text.trim().toLocaleLowerCase()))
    };
    for(const [i,r] of (bank.items||[]).entries()){
      const key=r.kind==='practice'?'practices':'knowledge',phrase=String(r.text||'').trim();
      if(!phrase||byKind[key].has(phrase.toLocaleLowerCase()))continue;
      byKind[key].add(phrase.toLocaleLowerCase());
      guide.statements[key].push({id:'eal:'+stage.replace(' ','-')+':'+key+':'+i,
        text:phrase,subject:'English as an Additional Language',
        ealStage:stage,source:'EAL '+stage+(r.source?' · '+r.source:''),
        why:'Official '+stage+' statement selected by the teacher',
        link:'unmatched',confidence:null});
    }
    guide.ealLoaded=[...new Set([...(guide.ealLoaded||[]),stage])];
    save();
  }catch(error){if(G===guide)ealError=error.message||'Could not read '+stage+'.';}
  finally{if(G===guide){ealLoading='';renderMain();}}
}
function languageReferencesField(guide){
  const notes=area(guide.languageReferences||'',v=>{guide.languageReferences=v.slice(0,12000);save();},5);
  notes.placeholder='Paste verified vocabulary/meaning pairs, frequency lists or brief excerpts from teaching guidance…';
  const status=h('span',{class:'cg-mut',role:'status'});
  const input=h('input',{type:'file',accept:'.docx,.txt,.csv,.tsv',
    'aria-label':'Import supporting language reference document',
    onchange:async event=>{
      const file=event.target.files?.[0];if(!file)return;
      if(file.size>2*1024*1024){status.textContent='Choose a file smaller than 2 MB.';input.value='';return;}
      status.textContent='Reading '+file.name+'…';
      try{
        let extracted='';
        if(/\.docx$/i.test(file.name)){
          if(typeof JSZip==='undefined')throw Error('Word document reader was not loaded.');
          const zip=await JSZip.loadAsync(file);
          const doc=zip.file('word/document.xml');
          if(!doc)throw Error('This does not contain a readable Word document.');
          const xml=new DOMParser().parseFromString(await doc.async('string'),'application/xml');
          if(xml.getElementsByTagName('parsererror').length)throw Error('The Word file could not be read.');
          const nodes=[...xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','p')];
          extracted=nodes.map(p=>[...p.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')]
            .map(n=>n.textContent).join('')).filter(Boolean).join('\n');
        }else if(/\.(txt|csv|tsv)$/i.test(file.name))extracted=await file.text();
        else throw Error('Use Word (.docx) or plain text; paste PDF excerpts into the box.');
        extracted=extracted.trim();
        if(!extracted)throw Error('No usable text was found.');
        const prefix='\n\n[Supporting reference: '+file.name.replace(/[\r\n\[\]]/g,'').slice(0,120)+']\n';
        const old=guide.languageReferences||'';
        if(old.length+prefix.length+extracted.length>12000)
          throw Error('This reference is too long. Select a shorter excerpt (maximum 12,000 characters across all references).');
        guide.languageReferences=(old+prefix+extracted).trim();
        notes.value=guide.languageReferences;fit(notes);save();
        status.textContent='Reference added to this unit. It has not trained or changed the AI model.';
      }catch(error){status.textContent=error.message||'Could not read this reference.';}
      input.value='';
    }});
  return field('Supporting methodology / vocabulary references',
    h('div',{class:'cg-language-sources'},
      h('p',{class:'cg-mut'},'Optional: provide teacher-approved teaching-method guidance, high-frequency vocabulary or verified language/meaning pairs. The tool uses these as reference material for this unit, not as official curriculum statements.'),
      notes,
      h('label',{class:'cg-source-upload'},'Add Word/text reference (DOCX, TXT, CSV)',input),
      status,
      h('p',{class:'cg-mut'},'PDF: paste a short relevant extract above. Do not include personal student data. References are saved with this unit; they are not used to train the underlying model.')));
}
function ealTopicCard(){
  const canStart=!!G.topic.trim();
  const begin=()=>{
    if(!G.topic.trim())return;
    G.docId=EAL_DOC_ID;view='outline';renderMain(true);openEalStage(ealActiveStage);
  };
  return h('section',{class:'cg-card'},
    h('h2',{},'English as an Additional Language (EAL)'),
    h('p',{class:'lead'},'Use the October 2026 curriculum. Browse Stage 1–5 independently of year level and combine stages for mixed-proficiency classes.'),
    h('input',{class:'cg-topic',type:'text',value:G.topic||'',placeholder:'e.g. Everyday conversations and short texts',
      'aria-label':'EAL unit title',oninput:e=>{G.topic=e.target.value;save();const button=document.getElementById('cg-eal-begin');if(button)button.disabled=!G.topic.trim();}}),
    h('div',{class:'cg-prep-unit-year'},
      h('span',{class:'cg-prep-label'},'Class year (administrative only; not an EAL stage)'),
      h('div',{class:'cg-seg',role:'group','aria-label':'Year of EAL class'},
        [9,10,11,12,13].map(y=>h('button',{type:'button',class:G.year===y?'on':'',
          'aria-pressed':G.year===y?'true':'false',onclick:()=>{G.year=y;save();renderMain();}},'Year '+y))),
      h('p',{class:'cg-mut'},'Stage selection is separate. A student may be at different stages in reading, writing, listening and speaking.')),
    timingField(),
    field('Unit context / teacher notes',area(G.notes,v=>{G.notes=v;save();},3)),
    languageReferencesField(G),
    h('div',{class:'cg-actions'},
      h('button',{id:'cg-eal-begin',class:'cg-btn lg',type:'button',disabled:!canStart,onclick:begin},
        hasStatements(G)?'Continue selecting EAL statements  →':'Choose Stage 1–5 statements  →'),
      resetLink()));
}
function ealOutlineCard(){
  const stage=ealActiveStage,busy=!!ealLoading;
  const count=G.selected.knowledge.length+G.selected.practices.length;
  const column=(key,title)=>h('div',{class:'cg-prep-column'},
    h('div',{class:'cg-colhead'},h('h3',{},title+' ',
      h('span',{class:'cg-chip'},ealRows(G,key,stage).filter(s=>G.selected[key].includes(s.id)).length+'/'+ealRows(G,key,stage).length))),
    ...ealRows(G,key,stage).filter(s=>!statementFilter||s.text.toLocaleLowerCase().includes(statementFilter))
      .map(s=>h('label',{class:'cg-stmt'+(G.selected[key].includes(s.id)?' on':'')},
        h('input',{type:'checkbox',checked:G.selected[key].includes(s.id),onchange:e=>{
          G.selected[key]=e.target.checked?[...new Set([...G.selected[key],s.id])]:
            G.selected[key].filter(id=>id!==s.id);
          updateEalSelectedStages(G);save();
          if(G.mapRef){
            const guide=G;
            mapSavePromise=mapSavePromise.catch(()=>{}).then(()=>persistMapStatements(guide));
            mapSavePromise.catch(error=>{
              if(G!==guide)return;
              banner={kind:'err',text:'Could not save EAL map statements: '+error.message};
              renderMain();
            });
          }
          renderMain();
        }}),
        h('div',{},h('p',{},s.text),h('small',{},'EAL · '+stage)),
      )));
  return h('section',{class:'cg-prep-outline cg-eal-outline'},
    h('div',{class:'cg-outhead'},
      h('div',{},h('h2',{},'EAL curriculum outline'),
        h('p',{class:'cg-mut'},'Choose official Knowledge and Practices from any of the five proficiency stages. Your selections remain checked across tabs.')),
      h('div',{class:'cg-chips'},h('span',{class:'cg-chip acc'},G.topic),
        h('span',{class:'cg-chip'},'Class Year '+G.year))),
    h('div',{class:'cg-prep-level-tabs cg-eal-tabs',role:'tablist','aria-label':'EAL stages'},
      ...EAL_STAGES.map(s=>h('button',{type:'button',role:'tab',
        'aria-selected':s===stage?'true':'false',class:'cg-year-tab'+(s===stage?' on':''),
        disabled:busy,onclick:()=>openEalStage(s)},s,
        ealCount(G,s)?h('span',{class:'cg-year-count'},String(ealCount(G,s))):null))),
    h('p',{class:'cg-prep-context'},'The selected curriculum is proficiency-based, not Year 11–13 by stage. The stages are not automatically mapped to a school year.'),
    busy?h('div',{class:'cg-year-loading',role:'status'},'Loading '+ealLoading+' official curriculum statements. Uncached sections may use Claude credits.'):null,
    ealError?h('div',{class:'cg-prep-error',role:'alert'},
      h('p',{},ealError),
      h('button',{type:'button',class:'cg-ghost',onclick:()=>openEalStage(stage)},'Try loading '+stage+' again')):null,
    !busy&&!ealError?h('input',{type:'search',class:'cg-bank-search',
      placeholder:'Search '+stage+' statements…','aria-label':'Search EAL stage',
      value:statementFilter,oninput:e=>{statementFilter=e.target.value.trim().toLocaleLowerCase();renderMain();}}):null,
    !busy&&!ealError?h('div',{class:'cg-cols'},column('knowledge','Knowledge'),column('practices','Practices')):null,
    !busy&&!ealError&&!ealRows(G,'knowledge').length&&!ealRows(G,'practices').length?
      h('div',{class:'cg-year-empty'},h('p',{},'No official '+stage+' statements loaded.'),
        h('button',{type:'button',class:'cg-ghost',onclick:()=>openEalStage(stage)},'Load this stage')):null,
    h('div',{class:'cg-bar'},
      h('div',{},h('b',{},String(count)),' selected across '+(G.stages||[]).length+' stages'),
      h('div',{class:'cg-actions',style:'margin:0'},
        h('button',{type:'button',class:'cg-ghost',onclick:()=>{view='topic';renderMain(true);}},'← Edit EAL unit'),
        h('button',{class:'cg-btn',type:'button',disabled:busy||!count,onclick:generate},
          G.plan?'Redraft EAL unit  →':'Draft EAL unit  →'),resetLink())));
}

function prepTopicCard(){
  const canStart=!!G.topic.trim();
  const choose=()=>{if(!G.topic.trim())return;view='outline';renderMain(true);openPrepTab(prepSourceId,prepActiveYear);};
  return h('section',{class:'cg-card'},
    h('h2',{},'What are you teaching in Prep?'),
    h('p',{class:'lead'},'Build one interdisciplinary unit using official curriculum statements from English, Social Studies, Maths, Health and Te Reo Māori.'),
    h('input',{class:'cg-topic',type:'text',value:G.topic||'',placeholder:'e.g. Our Community','aria-label':'Prep unit title',
      oninput:e=>{G.topic=e.target.value;save();const button=document.getElementById('cg-prep-begin');if(button)button.disabled=!G.topic.trim();}}),
    h('div',{class:'cg-prep-unit-year'},
      h('span',{class:'cg-prep-label'},'Year group for this Prep unit'),
      h('div',{class:'cg-seg',role:'group','aria-label':'Prep unit year'},
        [7,8].map(year=>h('button',{type:'button',class:G.year===year?'on':'','aria-pressed':G.year===year?'true':'false',
          onclick:()=>{G.year=year;prepActiveYear=year;save();renderMain();}},'Year '+year))),
      h('p',{class:'cg-mut'},'This is the unit’s year. You can choose statements from either Year 7 or Year 8 on the next screen, and any Te Reo Māori Novice level.')),
    timingField(),
    field('Context or special requirements',area(G.notes,v=>{G.notes=v;save();},3),
      'Learner needs, local connections, how the subjects fit together…'),
    h('div',{class:'cg-actions'},
      h('button',{id:'cg-prep-begin',class:'cg-btn lg',type:'button',disabled:!canStart,onclick:choose},
        hasStatements(G)?'Continue choosing statements  →':'Choose curriculum statements  →'),
      resetLink()));
}
function prepOutlineCard(){
  const source=prepActiveSource(),level=prepActiveLevel();
  const total=G.selected.knowledge.length+G.selected.practices.length;
  const selectedSubjects=PREP_SOURCES.filter(s=>['knowledge','practices'].some(key=>
    (G.statements[key]||[]).some(x=>x.prepSourceId===s.id&&G.selected[key].includes(x.id)))).length;
  const busy=!!prepLoading;
  const renderColumn=(key,title)=>{
    const rows=prepRows(G,key);
    return h('div',{class:'cg-prep-column'},
      h('div',{class:'cg-colhead'},h('h3',{},title+' ',h('span',{class:'cg-chip'},
        rows.filter(s=>G.selected[key].includes(s.id)).length+'/'+rows.length))),
      ...rows.filter(s=>!statementFilter||[s.text,s.source].join(' ').toLocaleLowerCase().includes(statementFilter))
        .map(s=>h('label',{class:'cg-stmt'+(G.selected[key].includes(s.id)?' on':'')},
          h('input',{type:'checkbox',checked:G.selected[key].includes(s.id),onchange:e=>{
            G.selected[key]=e.target.checked?
              [...new Set([...G.selected[key],s.id])]:G.selected[key].filter(x=>x!==s.id);
            save();
            if(G.mapRef){
              const guide=G;
              mapSavePromise=mapSavePromise.catch(()=>{}).then(()=>persistMapStatements(guide));
              mapSavePromise.catch(error=>{
                if(G!==guide)return;
                banner={kind:'err',text:'Your map selection could not be saved: '+error.message};
                renderMain();
              });
            }
            renderMain();
          }}),
          h('div',{},h('p',{},s.text),h('small',{class:'cg-level-tag'},source.label+' · '+(source.novice?level:'Year '+level)),
            h('small',{},s.source)))));
  };
  const switchTo=(s)=>openPrepTab(s.id,s.novice?prepActiveStage:prepActiveYear);
  return h('section',{class:'cg-prep-outline'},
    h('div',{class:'cg-outhead'},
      h('div',{},h('h2',{style:'margin:0 0 4px;font-size:21px'},'Prep curriculum outline'),
        h('p',{class:'cg-mut'},'Select Knowledge and Practices across all five subjects. Your choices remain ticked when you change tabs.')),
      h('div',{class:'cg-chips'},h('span',{class:'cg-chip acc'},G.topic),
        h('span',{class:'cg-chip'},'Year '+G.year+' Prep'),saveBadge())),
    h('div',{class:'cg-prep-subject-tabs',role:'tablist','aria-label':'Prep curriculum subjects'},
      ...PREP_SOURCES.map(s=>h('button',{type:'button',role:'tab',
        'aria-selected':s.id===prepSourceId?'true':'false',
        class:'cg-prep-subject'+(s.id===prepSourceId?' on':''),
        disabled:busy,onclick:()=>switchTo(s)},s.label,
        (['knowledge','practices'].reduce((n,key)=>n+(G.statements[key]||[])
          .filter(x=>x.prepSourceId===s.id&&G.selected[key].includes(x.id)).length,0)) ?
          h('span',{class:'cg-year-count'},String(['knowledge','practices'].reduce((n,key)=>n+(G.statements[key]||[])
            .filter(x=>x.prepSourceId===s.id&&G.selected[key].includes(x.id)).length,0))) : null))),
    h('div',{class:'cg-prep-level-tabs',role:'tablist',
      'aria-label':source.novice?'Te Reo Māori proficiency':'Curriculum year'},
      ...(source.novice?NOVICE:[7,8]).map(l=>h('button',{type:'button',role:'tab',
        class:'cg-year-tab'+(l===level?' on':''),
        'aria-selected':l===level?'true':'false',
        disabled:busy,onclick:()=>openPrepTab(source.id,l)},
        source.novice?l:'Year '+l,
        prepCount(G,source.id,l)?h('span',{class:'cg-year-count'},String(prepCount(G,source.id,l))):null))),
    h('p',{class:'cg-prep-context'},source.novice?
      'Te Reo Māori is organised by proficiency. Select from Novice 1, 2 and 3 independently of students’ school year.':
      'Showing '+source.label+' Year '+level+'. Both Year 7 and Year 8 can contribute to this Year '+G.year+' Prep unit.'),
    busy?h('div',{class:'cg-year-loading',role:'status'},
      'Loading '+prepLoading+' official statements'+(source.novice?' (uncached sections may use Claude credits)':'')+'…'):null,
    prepError?h('div',{class:'cg-prep-error',role:'alert'},
      h('p',{},prepError),h('button',{class:'cg-ghost',type:'button',
        onclick:()=>openPrepTab(source.id,level)},'Try loading this tab again')):null,
    !busy&&!prepError?h('input',{type:'search',class:'cg-bank-search',
      'aria-label':'Search this Prep curriculum tab',placeholder:'Search this subject and level…',
      value:statementFilter,oninput:e=>{
        statementFilter=e.target.value.toLocaleLowerCase().trim();
        document.querySelectorAll('.cg-prep-outline .cg-stmt').forEach(label=>{
          label.style.display=!statementFilter||label.textContent.toLocaleLowerCase().includes(statementFilter)?'':'none';
        });
      }}):null,
    !busy&&!prepError?h('div',{class:'cg-cols'},renderColumn('knowledge','Knowledge'),
      renderColumn('practices','Practices')):null,
    !busy&&!prepError&&!prepRows(G,'knowledge').length&&!prepRows(G,'practices').length?
      h('div',{class:'cg-year-empty'},'No statements loaded for this tab.',
        h('button',{class:'cg-ghost',type:'button',onclick:()=>openPrepTab(source.id,level)},'Load statements')):null,
    h('div',{class:'cg-bar'},
      h('div',{},h('b',{},String(total)),' statements selected across ',String(selectedSubjects),
        selectedSubjects===1?' subject':' subjects'),
      h('div',{class:'cg-actions',style:'margin:0'},
        h('button',{class:'cg-ghost',type:'button',onclick:()=>{view='topic';renderMain(true);}},'← Edit unit'),
        h('button',{class:'cg-btn',type:'button',disabled:busy||!total,onclick:generate},
          G.plan?'Redraft Prep unit plan  →':'Draft Prep unit plan  →'),resetLink())));
}

function outlineCard() {
  const crossYears = juniorYearTabs(G);
  const currentYear = crossYears && JUNIOR.includes(activeStatementYear) ? activeStatementYear : Number(G.year);
  const total = G.statements.knowledge.length + G.statements.practices.length;
  const n = G.selected.knowledge.length + G.selected.practices.length;
  const tabCount = year => ['knowledge','practices'].reduce((count,key)=>
    count+statementsForYear(G,key,year).filter(s=>G.selected[key].includes(s.id)).length,0);
  const col = (key, title) => {
    const list = crossYears ? statementsForYear(G,key,currentYear) : G.statements[key];
    if (!list.length) return null;
    // All / None affect only the active year, never ticks from other tabs.
    const setAll = on => {
      const ids = new Set(list.map(s=>s.id));
      G.selected[key] = [...G.selected[key].filter(id=>!ids.has(id)),...(on ? [...ids] : [])];
      save(); renderMain();
    };
    const fromMap = !!G.mapRef;
    const editable = !fromMap || noviceStages(G).length > 0 || (crossYears && currentYear !== Number(G.year));
    return h('div', {}, h('div', {class: 'cg-colhead'}, h('h3', {}, title + ' ', h('span', {class: 'cg-chip'}, fromMap && !editable ? String(list.length) : G.selected[key].length + '/' + list.length)),
      fromMap ? null : h('div', {}, h('button', {type: 'button', onclick: () => setAll(true)}, 'All'), h('button', {type: 'button', onclick: () => setAll(false)}, 'None'))),
      ...list.map(s => { const on = G.selected[key].includes(s.id); const show = !statementFilter || (s.text + ' ' + s.source + ' ' + (s.subject || '')).toLowerCase().includes(statementFilter);
        return h('label', {class: 'cg-stmt' + (on ? ' on' : ''), style: show ? '' : 'display:none'}, h('input', {type: 'checkbox', checked: on, disabled: !editable, onchange: e => {
          G.selected[key] = e.target.checked ? [...G.selected[key], s.id] : G.selected[key].filter(x => x !== s.id);
          save();
          if (G.mapRef) {
            const guide = G;
            mapSavePromise = mapSavePromise.catch(()=>{}).then(()=>persistMapStatements(guide));
            mapSavePromise.catch(error=>{
              if (G !== guide) return;
              banner={kind:'err',text:'Could not save this selection to the curriculum map: '+error.message+'. Your plan was not changed on the map; retry after checking the connection.'};
              renderMain();
            });
          }
          renderMain();
        }}),
          h('div', {}, h('p', {}, s.text), s.levels?.length ? h('small', {class:'cg-level-tag'}, s.levels.join(' · ')) : null, (s.why || s.confidence != null) ? h('small', {class: 'cg-why ' + (s.link === 'loose' ? 'loose' : '')}, (s.confidence != null ? s.confidence + '% match' : (s.link === 'loose' ? 'Loose match' : 'Linked')) + (s.why ? ' · ' + s.why : '')) : null, h('small', {}, s.source))); }));
  };
  return h('section', {},
    h('div', {class: 'cg-outhead'}, h('div', {}, h('h2', {style: 'margin:0 0 4px;font-size:21px'}, 'Curriculum outline'), h('p', {class: 'cg-mut', style: 'margin:0;color:var(--mut)'}, crossYears ? (G.mapRef ?
      'Your unit stays in Year ' + G.year + '. Its map statements remain selected; open another year tab to add statements from that year. Additional ticks are saved back to the map.' :
      'Your unit stays in Year ' + G.year + '. Suggested statements for its year are pre-ticked. Open any Year 7–10 tab to add official statements from another year; your selections remain ticked across tabs.') :
      G.mapRef ? (noviceStages(G).length ? 'Your map choices are pre-ticked. The full Knowledge and Practices lists from the selected novice levels are available; tick additional statements here to update the map and your unit plan together.' : 'These statements come from your department curriculum map. To customise them, change the ticks on the map before generating this plan.') :
      noviceStages(G).length ? 'Showing Knowledge and Practices from ' + guideStageLabel(G) + '. Suggested matches are pre-ticked; choose any other statements from the selected levels before generating.' :
      'Review the suggested curriculum statements and select the knowledge and practices you want in this plan.')),
      h('div', {class: 'cg-chips'}, h('span', {class: 'cg-chip acc'}, G.topic), h('span', {class: 'cg-chip'}, guideStageLabel(G)), saveBadge())),
    crossYears ? h('div', {class:'cg-year-switcher'},
      h('div', {class:'cg-year-tablist',role:'tablist','aria-label':'Curriculum statement year'},
        JUNIOR.map(year=>h('button', {type:'button',role:'tab',
          class:'cg-year-tab'+(year===currentYear?' on':'')+(year===Number(G.year)?' home':''),
          'aria-selected':year===currentYear?'true':'false',
          disabled:!!statementYearLoading,
          onclick:()=>switchStatementYear(year)},
          h('span',{},'Year '+year+(year===Number(G.year)?' · unit':'')),
          tabCount(year) ? h('span',{class:'cg-year-count'},String(tabCount(year))) : null))),
      h('p',{class:'cg-year-hint'},statementYearLoading ?
        'Loading Year '+statementYearLoading+' official statements…' :
        statementYearError ? 'Year '+currentYear+': '+statementYearError+' Click this year again to retry.' :
        currentYear===Number(G.year) ?
          'Showing your unit’s own year. Suggested matches are already selected.' :
          'Year '+currentYear+' curriculum · select any additional statements. The unit remains Year '+G.year+'.'),
      statementYearLoading ? h('div',{class:'cg-year-loading',role:'status'},'Reading the official Year '+statementYearLoading+' list…') : null
    ) : null,
    (!G.mapRef || noviceStages(G).length || crossYears) ? h('div', {class: 'cg-bank-controls'},
      h('input', {type: 'search', class: 'cg-bank-search', 'aria-label': 'Search year-level curriculum statements', placeholder: 'Search knowledge and practices…', value: statementFilter,
        oninput: e => { statementFilter = e.target.value.toLowerCase().trim(); document.querySelectorAll('.cg-stmt').forEach(label => { label.style.display = !statementFilter || label.textContent.toLowerCase().includes(statementFilter) ? '' : 'none'; }); }}),
      (noviceStages(G).length && G.docId && !G.pasted) ? h('button', {type:'button',class:'cg-ghost',disabled:!!G.bankLoaded,onclick: async e=>{
        const button=e.currentTarget; button.disabled=true;button.textContent='Loading novice statements…';
        try {const count=await expandNoviceStatements(G);banner={kind:'ok',text:count ? 'Added '+count+' official statement(s) from the selected novice levels. Existing ticks were preserved.' : 'All selected novice levels are loaded. Existing ticks were preserved.'};}
        catch(error){banner={kind:'note',text:error.message};}
        renderMain();
      }},G.bankLoaded?'All selected novice statements loaded':'Load all novice statements') : null,
      (!crossYears && JUNIOR.includes(G.year) && G.docId && !G.pasted && !noviceStages(G).length) ? h('button', {type: 'button', class: 'cg-ghost', disabled: !!G.bankLoaded, onclick: async e => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Loading Year ' + G.year + ' statements…';
        try { const count = await expandYearStatements(G); banner = {kind:'ok',text: count ? 'Added ' + count + ' further Ministry statement(s). Existing choices remain ticked.' : 'All available Ministry statements are listed. Your choices have been kept.'}; renderMain(); }
        catch(err) { banner = {kind:'note',text:err.message}; renderMain(); }
      }}, G.bankLoaded ? 'Full Year ' + G.year + ' list loaded' : 'Show all Year ' + G.year + ' statements') : null) : null,
    crossYears && !statementYearLoading && !statementsForYear(G,'knowledge',currentYear).length && !statementsForYear(G,'practices',currentYear).length ?
      h('div',{class:'cg-year-empty'},h('p',{},'No Year '+currentYear+' statements loaded.'),
        h('button',{type:'button',class:'cg-ghost',onclick:()=>switchStatementYear(currentYear)},'Load Year '+currentYear+' statements')) : null,
    (!crossYears || !statementYearLoading) ? h('div', {class: 'cg-cols'}, col('knowledge', 'Knowledge'), col('practices', 'Practices')) : null,
    h('div', {class: 'cg-bar'}, h('div', {}, h('b', {}, n), G.mapRef ? ' statements selected across the curriculum map' : ' of ' + total + ' statements selected across all years', G.mapRef ? h('a', {class: 'cg-link', href: mapUrl(), style: 'margin-left:12px'}, 'View map') : null),
      h('div', {class: 'cg-actions', style: 'margin:0'}, h('button', {class: 'cg-ghost', type: 'button', onclick: () => { view = 'topic'; renderMain(true); }}, '← Edit unit'),
        h('button', {class: 'cg-btn', type: 'button', disabled: !n || !!statementYearLoading, onclick: generate}, G.plan ? 'Redraft the unit plan  →' : 'Draft the unit plan  →'), resetLink())));
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

// Checks completeness of planning fields, not teaching quality or Ministry compliance.
// Assessment, reporting and resources deliberately remain optional.
function reviewChecklist() {
  const g=G, p=g?.plan;
  const nonblank=v=>typeof v==='string' ? v.trim().length>0 : Array.isArray(v) ? v.length>0 : !!v;
  const selected=(g?.selected?.knowledge?.length||0)+(g?.selected?.practices?.length||0);
  const focuses=Array.isArray(p?.focuses)?p.focuses:[];
  const checks=[
    {label:'Official curriculum statements selected',done:selected>0},
    {label:'Purpose, knowledge and practices summaries included',
      done:nonblank(p?.purpose)&&nonblank(p?.knowledgeSummary)&&nonblank(p?.practicesSummary)},
    {label:'Connections to prior and future learning included',done:nonblank(p?.prior)&&nonblank(p?.future)},
    {label:'Each learning focus has objectives and checks for understanding',
      done:focuses.length>0&&focuses.every(x=>nonblank(x.objectives)&&nonblank(x.checks))},
    {label:'Teacher has reviewed this draft',done:!!p?.staffReviewed}
  ];
  const done=checks.filter(x=>x.done).length;
  return h('section',{class:'cg-card cg-review cg-sec',id:'cg-review-checklist','aria-label':'Unit plan completion checklist'},
    h('div',{class:'cg-review-heading'},h('div',{},h('h2',{},'Completion checklist'),
      h('p',{},'See what needs attention before you share or download this plan.')),
      h('strong',{},done+' of '+checks.length+' checked')),
    h('ul',{class:'cg-review-list'},...checks.map(item=>
      h('li',{class:item.done?'done':'todo'},
        h('span',{'aria-hidden':'true'},item.done?'✓':'○'),h('span',{},item.label)))),
    h('label',{class:'cg-review-confirm'},
      h('input',{type:'checkbox',checked:!!p?.staffReviewed,onchange:e=>{p.staffReviewed=e.target.checked;save();}}),
      h('span',{},'I have reviewed the AI suggestions, curriculum selections and accuracy of this unit plan.')),
    h('p',{class:'cg-review-hint'},'This is a planning checklist, not proof of teaching or compliance. Assessment, reporting and resources can be completed by staff where relevant.'));
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
  // Show the first learning focus initially; others stay available on demand.
  if (focusDefaultsFor !== G.id) {
    closed = new Set(p.focuses.slice(1).map((_,i)=>G.id+':'+(i+1)));
    focusDefaultsFor = G.id;
  }
  if (p.focuses.some(f => !f.lessons && Number.isFinite(f.lessonCount))) relabel(p);
  const totalIn = h('input', {type: 'number', id: 'cg-ltot', min: String(p.focuses.length), max: '400', value: lessonTotal(p) || '', placeholder: 'Lessons', 'aria-label': 'Anticipated number of lessons',
    onchange: e => { const T = Math.max(p.focuses.length, Math.min(400, parseInt(e.target.value, 10) || 0)); fitTotal(p, T); relabel(p); save(); paintLessons(); }});
  const durIn = area(p.duration, v => set('duration', v), 2);
  durIn.id = 'cg-ldur'; durIn.maxLength = 300; durIn.placeholder = 'For example: 18 lessons of approximately 50 minutes'; durIn.setAttribute('aria-label', 'Anticipated duration of unit');
  const overview = h('section', {class: 'cg-card cg-sec', id: 'sec-overview'}, h('h3', {}, 'Overview'),
    h('div', {class: 'cg-lessonbar'}, field('Anticipated number of lessons', totalIn), field('Anticipated duration of unit', durIn),
      h('small', {}, 'The AI suggests lessons for each learning focus and this total is added up from them. Change any focus below and the total updates, or change the total here and the focuses are adjusted to fit.')),
    field('Purpose – why this is worth learning', area(p.purpose, v => set('purpose', v), 3), 'Explain the essential learning, why it matters and how it supports later learning.'),
    h('div', {class: 'cg-grid cg-overview-grid'}, field('Connections to prior learning', area(p.prior, v => set('prior', v), 3), 'Year — Topic: what students already know and how this unit builds on it.'), field('Connections to future learning', area(p.future, v => set('future', v), 3), 'Year — Topic: what students will learn later and how this unit prepares them.'),
      field('Knowledge summary', area(p.knowledgeSummary, v => set('knowledgeSummary', v), 3), 'The key concepts and subject knowledge students need to remember.'), field('Practices summary', area(p.practicesSummary, v => set('practicesSummary', v), 3), 'The disciplinary practices students will learn and apply.')),
    h('div', {class: 'cg-tickbox', style: 'margin-top:14px'}, h('b', {}, 'Capabilities this unit develops'), h('small', {style: 'display:block;color:var(--mut);margin:2px 0 6px'}, 'Suggested from the unit. Adjust as needed.'), tick('capabilities', capabilities)));

  const focuses = p.focuses.map((f, i) => {
    const key = G.id + ':' + i, c = palette[i % palette.length];
    const toggleFocus=()=>{
      if(closed.has(key))closed.delete(key);else closed.add(key);
      el.classList.toggle('closed',closed.has(key));
      el.querySelector('.cg-chev')?.setAttribute('aria-expanded',String(!closed.has(key)));
    };
    const el = h('article', {class: 'cg-focus cg-sec' + (closed.has(key) ? ' closed' : ''), id: 'sec-f' + i, style: '--c:' + c},
      h('div', {class: 'cg-fhead', onclick: e => { if (e.target.closest('input,button,label')) return; toggleFocus(); }},
        h('span', {class: 'cg-num'}, i + 1), h('label', {class: 'cg-lesn', onclick: e => e.stopPropagation()}, h('input', {type: 'number', min: '1', max: '60', class: 'cg-les', 'data-fi': String(i), value: Number.isFinite(f.lessonCount) ? f.lessonCount : '', 'aria-label': 'Number of lessons for learning focus ' + (i + 1), title: 'Approximate number of lessons. Change it and the total updates.',
          oninput: e => { const n = parseInt(e.target.value, 10); f.lessonCount = n > 0 ? Math.min(60, n) : undefined; relabel(p); save(); paintLessons(); }}), h('span', {}, 'lessons'), h('span', {class: 'cg-lrange', 'data-lrange': String(i)}, f.lessons || '')), h('input', {type: 'text', value: f.title, 'aria-label': 'Learning focus title', oninput: e => { f.title = e.target.value; save(); const a = tocEl.querySelector(`[data-id="sec-f${i}"]`); if (a) a.textContent = (i + 1) + '. ' + (f.title || 'Learning focus'); }}),
        h('button', {class: 'cg-chev', type: 'button', 'aria-expanded':String(!closed.has(key)), 'aria-controls':'cg-focus-body-'+i, 'aria-label':'Expand or collapse learning focus '+(i+1), onclick:e=>{e.stopPropagation();toggleFocus();}}, '▾')),
      h('div', {class: 'cg-fbody', id:'cg-focus-body-'+i},
        h('div', {class: 'cg-grid'}, field('Curriculum knowledge', area(f.knowledge, v => { f.knowledge = v; save(); }, 3)), field('Curriculum practices', area(f.practices, v => { f.practices = v; save(); }, 3)),
          field('Specific learning objectives', area(f.objectives, v => { f.objectives = v; save(); }, 3)), ...vocabFields(f),
          field('Common misconceptions', area(f.misconceptions, v => { f.misconceptions = v; save(); }, 3), 'Misunderstandings to anticipate and address explicitly.'), field('Check for understanding', area(f.checks, v => { f.checks = v; save(); }, 3), 'Short formative questions or tasks to reveal what students have learned, not end-point assessments.')),
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
    h('div', {class: 'cg-gtitle'}, h('div', {}, h('h1', {}, G.topic || 'Unit plan'), h('div', {class: 'cg-chips meta'}, h('span', {class: 'cg-chip acc'}, G.subject || 'Subject'), h('span', {class: 'cg-chip'}, guideStageLabel(G)), G.plan && G.plan.duration ? h('span', {class: 'cg-chip', id: 'cg-dchip'}, G.plan.duration) : null, saveBadge())),
      h('div', {class: 'cg-gactions'}, h('button', {class: 'cg-ghost', type: 'button', onclick: () => { view = 'outline'; renderMain(true); }}, '↻ Change statements'), h('button', {class: 'cg-btn', type: 'button', onclick: download}, '⬇ Word'), resetLink())),
    h('div', {class: 'cg-guide'}, tocEl, h('div', {}, reviewChecklist(), overview, ...focuses, yours, exportCard)));
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
      banner = {kind: 'err', text: offline ? 'Could not reach Unit Plan Studio. Check your internet connection. Your statements and notes are saved. Press Try again.' : e.message,
        retry: e.noRetry ? null : () => run(title, stages, fn)};
    }
  }
  finally { clearInterval(tick); work = null; renderMain(true); }
}

// A guide opened from the curriculum map uses exactly the statements ticked on the map for that topic. The map is the only place they are
// changed, so the guide and the map always agree. Returns true when the guide's statements changed.
let lastPull = {ok: true, error: '', onMap: true, total: 0};
// Persist language-stage ticks to the same map that linked plans use.
// The server remains the source of truth when drafting mapped unit plans.
async function persistMapStatements(guide) {
  if (!guide?.mapRef) return;
  const rows = ['knowledge','practices'].flatMap(key=>guide.statements[key]
    .filter(s=>guide.selected[key].includes(s.id))
    .map(s=>({kind:key==='practices'?'practice':'knowledge',text:s.text,
      source:s.source||'Ministry curriculum',doc_id:s.prepSourceId||guide.docId||'',confidence:s.confidence??null,selected:1})));
  // The curriculum map stores at most 150 statements per unit. Never
  // silently drop cross-year ticks if that limit is reached.
  if (rows.length > 150) throw Error('This map allows up to 150 statements per unit. Untick some statements before saving.');
  const response = await fetch('curriculum_map_api.php?action=set-statements',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({csrf:CS.csrf,department_id:guide.mapRef.department_id,
      topic_id:guide.mapRef.topic_id,statements:rows})
  });
  const result = await response.json().catch(()=>({}));
  if (!response.ok || !result.ok) throw Error(result.error||'The map could not be updated.');
}
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
  // Older map-linked plans may not have saved a curriculum source ID.
  // Resolve only a unique match for the selected subject, so they can also
  // access other year tabs without changing the map or guessing a source.
  let resolvedSource = false;
  if (!guide.docId && JUNIOR.includes(+guide.year) && docs.length) {
    const subject = String(guide.subject || '').toLowerCase().trim();
    const alias = subjectAlias(subject);
    const candidates = docs.filter(d => (d.years || JUNIOR).includes(+guide.year));
    const terms = [subject,alias].filter(Boolean);
    const names = d => [d.subject,d.learningArea,d.title,...(d.subjects||[])]
      .map(s=>String(s||'').toLowerCase().trim()).filter(Boolean);
    const exact = candidates.filter(d=>names(d).some(n=>terms.includes(n)));
    // Partial matching is a fallback only when exactly one Ministry source
    // matches, e.g. “Mathematics” → “Mathematics and Statistics”.
    const matches = exact.length ? exact : subject.length >= 4 ?
      candidates.filter(d=>names(d).some(n=>terms.some(t=>t.length>=4 && n.includes(t)))) : [];
    if (matches.length === 1) {
      guide.docId = matches[0].id;
      if (matches[0].learningArea === 'The Arts') {
        const art = ['Dance','Drama','Music','Visual Arts'].find(x=>x.toLowerCase() === subject || x.toLowerCase() === alias);
        if (art) guide.discipline = art;
      }
      resolvedSource = true;
    }
  }
  const rows = r.statements.filter(x => x.selected);
  const mk = (kind, p) => rows.filter(x => x.kind === kind).map((x, i) => {
    const prep = isPrepGuide(guide);
    const source = prep ? PREP_SOURCES.find(s=>s.id===x.doc_id ||
      String(x.source||'').startsWith(s.label+' — ')) : null;
    const stage = /\bNovice [123]\b/.exec(String(x.source||''))?.[0];
    const ealStage = /\bStage [1-5]\b/.exec(String(x.source||''))?.[0];
    const fromYear = /\bYear\s*(7|8)\b/i.exec(String(x.source||''))?.[1];
    return {id:p+(i+1),text:x.text,source:x.source||'',confidence:x.confidence,
      link:'strong',why:'',subject:source?.label||guide.subject||'',
      ...(source?{prepSourceId:source.id}:{}),
      ...(source?.novice && stage?{prepStage:stage}:{}),
      ...(source && !source.novice && fromYear?{curriculumYear:Number(fromYear)}:{}),
      ...(isEalGuide(guide)&&ealStage?{ealStage}: {})};
  });
  const next = {knowledge: mk('knowledge', 'k'), practices: mk('practice', 'p')};
  const selectedKey = (st,chosen) => ['knowledge','practices'].flatMap(k=>st[k].filter(x=>chosen[k].includes(x.id)).map(x=>x.text)).join('\n');
  const changed = selectedKey(next,{knowledge:next.knowledge.map(x=>x.id),practices:next.practices.map(x=>x.id)}) !== selectedKey(guide.statements,guide.selected);
  guide.statements = next;
  guide.selected = {knowledge: next.knowledge.map(x => x.id), practices: next.practices.map(x => x.id)};
  guide.bankLoaded = false; guide.bankYears = [];
  if (isPrepGuide(guide)) guide.prepLoaded = [];
  if (isEalGuide(guide)) {
    guide.docId = EAL_DOC_ID;
    guide.ealLoaded = [];
    updateEalSelectedStages(guide);
  }
  if (changed || resolvedSource) { guide.docId = guide.docId || (rows[0] && rows[0].doc_id) || ''; if (G === guide) save(); }
  return changed;
}
const syncMap = () => {};

// Load each year independently and preserve all ticks when changing tabs.
// The same statement can appear in several year tabs (with separate source
// provenance), but is deduplicated by wording when the guide is generated.
async function expandYearStatements(guide, signal, requestedYear = +guide.year) {
  const year = Number(requestedYear);
  if (!JUNIOR.includes(year) || !juniorYearTabs(guide)) return 0;
  if (yearBankLoaded(guide, year)) return 0;
  const query = new URLSearchParams({action:'statement-bank',doc_id:guide.docId,year:String(year),discipline:guide.discipline||''});
  const response = await fetch(CS.api + '?' + query, {credentials:'same-origin',signal,cache:'no-store'});
  const result = await response.json().catch(()=>({}));
  if (!response.ok || !result.ok || !Array.isArray(result.records)) throw Error(result.error || 'Year ' + year + ' Ministry statements are unavailable.');
  const norm = s => String(s||'').trim().replace(/\s+/g,' ').toLowerCase();
  let added = 0;
  for (const [key,kind] of [['knowledge','knowledge'],['practices','practice']]) {
    // Deduplicate within a year only. Year 7 and Year 8 versions of a
    // shared statement stay accessible under their respective year tabs.
    const existing = new Set(guide.statements[key]
      .filter(s => statementSourceYear(s,guide) === year).map(s=>norm(s.text)));
    for (const record of result.records) {
      if (record.kind !== kind || !record.text || existing.has(norm(record.text))) continue;
      existing.add(norm(record.text));
      guide.statements[key].push({id:record.id,text:record.text,subject:record.subject||guide.subject,
        curriculumYear:year,source:record.source||'Ministry curriculum, Year '+year,
        link:'unmatched',why:'Available in Year '+year+' curriculum; teacher selection',confidence:null});
      added++;
    }
  }
  guide.bankYears = [...new Set([...(guide.bankYears || []),year])].sort();
  if (year === +guide.year) guide.bankLoaded = true;
  if (G === guide) save();
  return added;
}
// Open only the year requested, without loading four complete curriculum
// libraries into the page simultaneously.
async function switchStatementYear(year) {
  if (!juniorYearTabs(G) || !JUNIOR.includes(year) || statementYearLoading) return;
  activeStatementYear = year;
  statementFilter = '';
  statementYearError = '';
  if (yearBankLoaded(G, year)) { renderMain(); return; }
  const guide = G;
  statementYearLoading = year;
  renderMain();
  try { await expandYearStatements(guide, undefined, year); }
  catch (error) { if (G === guide) statementYearError = error.message || 'Could not load curriculum statements.'; }
  finally {
    if (G === guide) { statementYearLoading = 0; renderMain(); }
  }
}
// Load the full official statement bank for every selected Novice level.
// Validated source wording is cached on the server, so repeat visits do not
// spend AI credits. Each level's provenance is shown beside its statements.
async function expandNoviceStatements(guide, signal) {
  const stages = noviceStages(guide);
  if (!stages.length || !guide.docId || guide.pasted) return 0;
  const norm = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const present = {
    knowledge: new Map(guide.statements.knowledge.map(s => [norm(s.text),s])),
    practices: new Map(guide.statements.practices.map(s => [norm(s.text),s]))
  };
  let added = 0;
  for (const stage of stages) {
    const params = new URLSearchParams({action:'novice-bank',doc_id:guide.docId,stage});
    const read = async () => {
      const res = await fetch(CS.api + '?' + params, {credentials:'same-origin',signal,cache:'no-store'});
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data.ok) throw Error(data.error || 'Could not load ' + stage + ' statements.');
      return data;
    };
    let bank = await read();
    for (let i = 0; i < (bank.missing || []).length; i++) {
      if (signal?.aborted) throw Error('Cancelled.');
      const section = bank.missing[i];
      const indicator = document.getElementById('cg-stage');
      if (indicator) indicator.textContent = 'Reading ' + stage + ' curriculum: section ' + (i + 1) + ' of ' + bank.missing.length + ' (first extraction uses Claude credits)…';
      await post('novice-bank-build', {doc_id:guide.docId,stage,chunk:section});
    }
    if (!bank.complete) bank = await read();
    if (!bank.complete) throw Error('The full ' + stage + ' curriculum is not yet available. Try loading the statements again.');
    for (const record of bank.items || []) {
      const key = record.kind === 'practice' ? 'practices' : 'knowledge';
      if (!record.text || !norm(record.text)) continue;
      const normalized = norm(record.text);
      let existing = present[key].get(normalized);
      if (existing) {
        existing.levels = NOVICE.filter(x => [...(existing.levels || []),stage].includes(x));
      } else {
        existing = {id:'novice-' + stage.replace(/\s/g,'-') + '-' + key + '-' + guide.statements[key].length,
          text:record.text, subject:guide.subject, source:record.source || 'Ministry curriculum, ' + stage,
          levels:[stage], link:'unmatched', why:'Available in ' + stage + '; tick if taught in this unit', confidence:null};
        present[key].set(normalized,existing);
        guide.statements[key].push(existing);
        added++;
      }
    }
  }
  guide.bankLoaded = true;
  save();
  return added;
}
// Teachers can bypass AI title matching entirely. The prepared curriculum
// library is authoritative and is available regardless of the unit title.
function browseOfficialStatements() {
  return run('Opening the official curriculum', ['Loading your subject and year…', 'Preparing Knowledge and Practices…'], async signal => {
    if (!G.docId) throw Error('Choose a curriculum source first.');
    if (noviceStages(G).length) await expandNoviceStatements(G, signal);
    else if (JUNIOR.includes(G.year)) await expandYearStatements(G, signal);
    else throw Error('The full source library is currently available for Years 7–10. For senior subjects, use the topic matcher or paste official curriculum statements.');
    if (!hasStatements(G)) throw Error('No curriculum statements were found for this source. Check the selected subject and document.');
    statementFilter = ''; activeStatementYear = Number(G.year);
    view = 'outline';
    banner = {kind:'note',text:'Official curriculum statements are ready. Nothing has been selected automatically. Tick the Knowledge and Practices this unit will teach.'};
    save();
  });
}
function find() {
  return run('Finding your curriculum statements', ['Reading the Ministry curriculum…', 'Matching statements to your unit…', 'Checking every word against the source…'], async signal => {
    const r = await stream('find', {docId: G.docId, discipline: G.discipline, year: G.year, stage: G.stage || '', stages: planStages(G), topic: G.topic, notes: G.notes, languageReferences: G.languageReferences||'', pasted: G.pasted}, signal);
    G.statements = {knowledge: r.knowledge, practices: r.practices};
    G.selected = {knowledge: r.knowledge.filter(s => s.link !== 'loose').map(s => s.id), practices: r.practices.filter(s => s.link !== 'loose').map(s => s.id)};
    G.bankLoaded = false; G.bankYears = [];
    activeStatementYear = Number(G.year);
    statementFilter = '';
    if (noviceStages(G).length && G.docId && !G.pasted && !G.mapRef) {
      try { await expandNoviceStatements(G, signal); }
      catch (error) { banner = {kind:'note',text:'Matched suggestions are shown, but the complete novice statement lists could not load: '+error.message+'. Choose “Load all novice statements” to retry.'}; }
    } else if (JUNIOR.includes(G.year) && G.docId && !G.pasted && !noviceStages(G).length) {
      try { await expandYearStatements(G, signal); }
      catch (error) { banner = {kind:'note',text:'Matched statements are available, but the full Year '+G.year+' library could not load: '+error.message}; }
    }
    save();
    if (hasStatements(G)) {
      view = 'outline';
      if (r.warnings && r.warnings.length) banner = {kind:'note',text:[...(banner ? [banner.text] : []),...r.warnings].join(' ')};
    } else {
      view = 'topic';
      banner = {kind:'note',text:'The automatic matcher could not confirm curriculum statements for this unit. Your title is fine. ' + (JUNIOR.includes(G.year) ? 'Use “Browse all official statements” to select the exact Knowledge and Practices for your year and subject.' : 'Check the source document or paste the relevant official statements in the section below.')};
    }
  });
}

function generate() {
  return run('Drafting your unit plan', ['Reading your selected statements…', 'Planning the learning focuses…', 'Checking the wording matches the curriculum…'], async signal => {
    if (G.mapRef) await mapSavePromise;
    const r = await stream('generate', {guide: {year: G.year, stage: G.stage || '', stages: noviceStages(G), topic: G.topic, subject: G.subject, duration: G.duration, notes: G.notes, languageReferences: G.languageReferences||'', statements: G.statements, selected: G.selected, prep: isPrepGuide(G), existingPlan: G.plan, mapRef: G.mapRef}}, signal);
    const notice = r.statementNotice; delete r.statementNotice;
    G.plan = normalisePlan(r); save(); view = 'guide'; closed.clear(); focusDefaultsFor = '';
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
      if (sum < T && f.lessonScope !== 'brief') { f.lessonCount = (f.lessonCount || 0) + 1; sum++; moved = true; } else if (sum > T && (f.lessonCount || 0) > 1) { f.lessonCount--; sum--; moved = true; }
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

function normalisePlan(p) {
  if (!Array.isArray(p.capabilities)) p.capabilities = [];
  if (G && !isEalGuide(G) && isLanguageSubject(G.subject)) {
    const summary=String(p.knowledgeSummary||'').trim();
    // Keep the model's distinct curriculum categories visible in the Word
    // plan even if it fails to include one required heading.
    if(summary && !/^Linguistic\s*[:\n]/im.test(summary)){
      p.knowledgeSummary='Linguistic\n'+summary+'\n\nCultural and Sociolinguistic\nNot specified in the selected statements';
    } else if(summary && !/Cultural and Sociolinguistic/i.test(summary)){
      p.knowledgeSummary=summary+'\n\nCultural and Sociolinguistic\nNot specified in the selected statements';
    }
  }
  return p;
}

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
  clearTimeout(pendingSaveTimers.get(id));
  pendingSaveTimers.delete(id);
  try { if (guides.some(g => g.id === id)) await post('delete', {id}); } catch (e) { banner = {kind: 'err', text: e.message}; return renderMain(); }
  guides = guides.filter(g => g.id !== id); G = null; view=librarySubject?'library':'topic'; renderList(); renderMain(true); toast('Unit plan deleted');
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
listEl = h('div', {class:'cg-side-subjects'});
mainEl = h('div', {});
toastEl = h('div', {class: 'cg-toast', role: 'status'});
const mapUrl = () => 'curriculum_studio.php' + (G && G.mapRef ? '?department=' + G.mapRef.department_id : '');
const backBar = h('div', {class: 'cg-backbar'},
  h('a', {class: 'cg-mapbtn', href: 'curriculum_studio.php', onclick: e => { e.preventDefault(); location.href = mapUrl(); }}, h('span', {'aria-hidden': 'true'}, '←'), ' Back to the curriculum map'),
  h('span', {class: 'cg-backhint'}, 'Your department’s year-by-year overview. Open any unit there to build its unit plan.'));
root.append(backBar);
shellEl = h('div', {class:'cg-shell'},
  h('aside',{class:'cg-side','aria-label':'Saved unit plans by subject'},
    h('div',{class:'cg-schoolbrand'},
      h('img',{src:'assets/stp-crest.svg',alt:"St Peter's Cambridge school crest",
        class:'cg-school-logo',referrerpolicy:'no-referrer',loading:'lazy'}),
      h('span',{class:'cg-schoolwordmark'},"St. Peter's"),
      h('span',{class:'cg-schoollocation'},'CAMBRIDGE, N.Z.')),
    h('h2',{},'Saved unit plans'),
    h('button',{class:'cg-new',type:'button',onclick:newGuide},'＋ New unit plan'),
    h('label',{class:'cg-side-search-label',for:'cg-side-search'},'Subjects'),
    h('input',{id:'cg-side-search',type:'search',class:'cg-side-search',
      placeholder:'Find subject…','aria-label':'Find subject',
      oninput:e=>{directoryQuery=e.target.value;renderList();}}),
    listEl),
  mainEl);
root.append(shellEl,toastEl);
addEventListener('keydown', e => { if (e.key === 'Escape' && work) work.ctl.abort(); });
(async () => {
  try {
    const [a, b] = await Promise.all([fetch(CS.api + '?action=list&_=' + Date.now(), {credentials: 'same-origin', cache: 'no-store'}).then(r => r.json()), fetch(CS.api + '?action=catalogue', {credentials: 'same-origin'}).then(r => r.json())]);
    if (!a.ok || !b.ok) throw Error(a.error || b.error || 'load failed');
    guides = a.guides; docs = b.documents;
    for (const g of guides) if (g.plan) normalisePlan(g.plan);
    renderList(); renderMain();
    const q = new URLSearchParams(location.search);
    if (q.get('subject') && !q.get('topic')) {
      requestedSubject=guideSubject({subject:q.get('subject')});
      librarySubject=subjectKey(requestedSubject);
      view='library';
      renderList(); renderMain(true);
    }
    if (q.get('new-eal')) { history.replaceState(null, '', location.pathname + '?guide=1'); newEalGuide(); }
    else if (q.get('new-prep')) { history.replaceState(null, '', location.pathname + '?guide=1'); newPrepGuide(); }
    else if (q.get('blank')) { history.replaceState(null, '', location.pathname + '?guide=1'); newGuide(); }
    else if (q.get('topic')) {   // arriving from the curriculum map: reopen the guide for that topic, or start one with the topic filled in
      const subj = q.get('subject') || '', yr = parseInt(q.get('year'), 10) || 7,
        stage = [...NOVICE,...EAL_STAGES].includes(q.get('stage')) ? q.get('stage') : '', topic = q.get('topic');
      history.replaceState(null, '', location.pathname + '?guide=1');
      const mref = q.get('dept') && q.get('mt') ? {department_id: parseInt(q.get('dept'), 10), topic_id: q.get('mt')} : null;
      const ex = guides.find(g => (g.topic || '').toLowerCase() === topic.toLowerCase() && Number(g.year) === yr && (g.stage || '') === stage && (g.subject || '').toLowerCase() === subj.toLowerCase());
      if (ex) { if (mref && (!ex.mapRef || ex.mapRef.department_id !== mref.department_id || ex.mapRef.topic_id !== mref.topic_id)) { ex.mapRef = mref; G = ex; save(); } open(ex.id); }
      else {
        newGuide(); G.topic = topic; G.subject = subj; G.year = yr; activeStatementYear = yr; G.stage = stage; G.stages = stage ? [stage] : []; G.mapRef = mref;
        if(isEalGuide(G)){G.docId=EAL_DOC_ID;G.year=yr>=9&&yr<=13?yr:11;resetEalView(G);}
        const d = docs.find(x => (x.years || JUNIOR).includes(yr) && [x.subject, x.learningArea].some(n => (n || '').toLowerCase() === subj.toLowerCase())); if (d) G.docId = d.id;
        renderMain();
        if (mref) { const g = G; pullMapStatements(g).then(() => { if (G === g) { if (!lastPull.ok) banner = {kind: 'err', text: lastPull.error + ' Press “Use the statements from the curriculum map” to try again.'}; view = hasStatements(g) ? 'outline' : 'topic'; renderList(); renderMain(); } }); }
      }
    }
  } catch (e) { banner = {kind: 'err', text: 'Your unit plans could not be loaded (' + e.message + '). Refresh to try again; nothing has been changed.'}; mainEl.replaceChildren(bannerEl()); }
})();
