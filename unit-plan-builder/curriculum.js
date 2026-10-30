import {schoolConnections} from './school-connections.js';
import {profiles} from './planning-profiles.js';
import {focusContent} from './focus-content.js';
import {emptyFocus,validatePlan} from './model.js';
const join=items=>items.map(s=>s.text).join('\n');
const words=s=>s.toLowerCase().match(/[a-zāēīōū]{4,}/g)||[];
const stop=new Set(words('this that from with have their them into these those through about between different using developing evidence science scientific understanding explaining investigate investigation process processes common provided identify determine describe'));
export function defaultPracticeIds(unit){
 const curated={'Mixtures':[0,2,3],'Concentration and solubility':[1],'Identification tests for common substances':[3,4],'Motion and forces':[0,1,2,3,6],'Pressure in fluids':[2]};
 if(curated[unit.title])return curated[unit.title].map(i=>unit.practices[i].id);
 const keys=new Set(words(unit.title+' '+unit.knowledge.map(s=>s.text).join(' ')).filter(s=>!stop.has(s)));
 const relevant=unit.practices.filter(s=>words(s.text).filter(w=>keys.has(w)).length>=2);
 return (relevant.length?relevant:unit.practices.slice(0,1)).map(s=>s.id);
}
const stripExamples=s=>s.replace(/\([^)]*\)/g,'').replace(/\s+/g,' ').replace(/\s+([,.;:])/g,'$1').trim();
function brief(s){return stripExamples(s).split(/(?<=[.!?])\s+/)[0];}
function practiceSummary(ps){return ps.map(s=>stripExamples(s.text).replace(/^(Planning|Designing|Conducting|Using|Analysing|Interpreting|Examining|Observing|Comparing|Constructing|Measuring|Identifying|Gathering|Selecting|Testing|Making|Organising|Evaluating|Reporting|Representing|Calculating|Formulating|Predicting|Discussing|Researching|Labelling|Collecting|Presenting|Systematically making|Systematically observing)/,v=>({'Planning':'Plan','Designing':'Design','Conducting':'Conduct','Using':'Use','Analysing':'Analyse','Interpreting':'Interpret','Examining':'Examine','Observing':'Observe','Comparing':'Compare','Constructing':'Construct','Measuring':'Measure','Identifying':'Identify','Gathering':'Gather','Selecting':'Select','Testing':'Test','Making':'Make','Organising':'Organise','Evaluating':'Evaluate','Reporting':'Report','Representing':'Represent','Calculating':'Calculate','Formulating':'Formulate','Predicting':'Predict','Discussing':'Discuss','Researching':'Research','Labelling':'Label','Collecting':'Collect','Presenting':'Present','Systematically making':'Make systematically','Systematically observing':'Observe systematically'}[v]))).join(' ');}
export function preserveAssessment(before,after){for(const k of ['resources','assessment','descriptors','reporting'])after[k]=before[k]||'';return after;}
export function buildCurriculumPlan(catalogue,unit,selection,meta){
 const ks=unit.knowledge.filter(s=>selection.knowledge.includes(s.id)),ps=unit.practices.filter(s=>selection.practices.includes(s.id));
 if(!ks.length||!ps.length)throw Error('Select at least one knowledge statement and one practice statement.');
 const profile=profiles[unit.title];if(!profile)throw Error('Planning guidance for this topic is unavailable.');
 const selectedK=new Set(ks.map(s=>s.id));
 const groups=profile.groups.map(([start,title],i)=>({title,k:unit.knowledge.slice(start,profile.groups[i+1]?.[0]).filter(s=>selectedK.has(s.id)),p:[]})).filter(g=>g.k.length);
 if(unit.title==='Evolution'){
  const positions=[[1,2,3,4,5,7],[0,1],[6]];
  for(const st of ps){const allowed=new Set(positions[unit.practices.findIndex(p=>p.id===st.id)].map(i=>profile.groups[i][1]));let matched=false;for(const g of groups)if(allowed.has(g.title)){g.p.push(st);matched=true;}if(!matched)groups[0].p.push(st);}
 }else{
  for(const st of ps){const terms=words(st.text).filter(w=>!stop.has(w));const scores=groups.map(g=>{const text=(g.title+' '+join(g.k)).toLowerCase();return terms.reduce((n,w)=>n+(text.includes(w)?1:0),0);});const best=scores.indexOf(Math.max(...scores));groups[best].p.push(st);}
 }
 const evoObjectives={
  'Fossils as evidence':'Infer an organism’s structure and likely environment from fossil features.',
  'Comparing evidence for change':'Explain how fossil, shared-trait and DNA evidence supports change in populations and species.',
  'Variation and inheritance':'Distinguish variation among individuals from variation that can be passed to offspring.',
  'Selection pressures':'Identify a selection pressure and explain how it affects survival or reproduction.',
  'Natural selection and its explanation':'Explain how heritable differences affect survival and reproduction under a selection pressure; describe Darwin and Wallace’s contribution.',
  'Population change over generations':'Explain why favourable inherited traits may become more common over generations and distinguish population evolution from individual change.',
  'Speciation and extinction':'Explain how long-term divergence can produce new species and why some species become extinct.',
  'Common ancestry':'Use shared features to support an explanation that living organisms are related through common ancestry.'
 };
 const evoTeaching={
 'Fossils as evidence':['fossil; extinct; sediment','Fossils are always bones, and all fossil organisms are extinct.','Mini whiteboards: label an observation and an inference from a fossil image. Exit ticket: infer a structure and likely environment from an unfamiliar fossil.'],
 'Comparing evidence for change':['fossil record; shared trait; DNA','One piece of evidence proves every detail of evolutionary history.','Targeted questioning: connect a fossil, shared-trait or DNA comparison to a claim about change. Exit ticket: explain why independent lines of evidence strengthen an explanation.'],
 'Variation and inheritance':['trait; variation; heritable','Every difference between individuals can be inherited by their offspring.','Mini whiteboards: classify inherited and acquired variation. Hinge question: identify which difference could be passed to offspring.'],
 'Selection pressures':['selection pressure; survival; reproduction','A selection pressure causes an individual to develop the trait it needs.','Scenario hinge question: identify the selection pressure and predict which existing variation affects survival or reproduction.'],
 'Natural selection and its explanation':['natural selection; heritable variation; selection pressure','Natural selection is a conscious choice made by an organism.','Targeted questioning: sequence heritable variation, selection pressure and differential reproduction. Mini whiteboards: distinguish natural selection from a change caused by need.'],
 'Population change over generations':['trait frequency; population; generation; evolution','An individual evolves during its lifetime; all members of a population change at once.','Mini whiteboards: interpret trait counts across generations. Exit ticket: explain a population change using inheritance and differential reproduction.'],
 'Speciation and extinction':['species; speciation; extinction','Every species will adapt quickly enough to survive environmental change.','Hinge question: distinguish divergence into new species from extinction. Exit ticket: use a named environmental change to explain why a species may become extinct.'],
 'Common ancestry':['common ancestor; vertebrate; lineage','Humans evolved from the monkeys alive today rather than sharing earlier ancestors.','Annotated-diagram check: identify a shared ancestor on a branching diagram. Exit ticket: use a shared feature as evidence for relatedness without claiming one living species is the ancestor of another.']
 };
 const focuses=groups.map((g,i)=>{
  const f=emptyFocus(g.title);f.knowledge=join(g.k);f.practices=join(g.p);
  if(unit.title==='Evolution'){
   f.objectives=evoObjectives[g.title];const [terms,mis,check]=evoTeaching[g.title];f.vocabulary=`Tier 2: evidence; infer; compare; justify.\nTier 3: ${terms}.`;f.misconceptions=mis;f.checks=check;
  }else{
   const draft=focusContent[unit.title]?.[g.title];if(!draft)throw Error('Focus-specific planning is unavailable for '+unit.title+': '+g.title);
   f.objectives=draft.objectives;f.vocabulary=`Tier 2: explain; compare; interpret; justify.\nTier 3: ${draft.vocabulary}.`;f.misconceptions=draft.misconceptions;f.checks=draft.checks;
  }
  f.priorities=i===0?'Capabilities — Thinkers: distinguish claims from evidence. Communicators: explain a scientific claim and respond to a partner’s question.':'';
  return f;
 });
 const pages=[...new Set([...ks,...ps].map(s=>s.page))].sort((a,b)=>a-b);
 const school=schoolConnections[unit.title];
 const source={documentId:catalogue.documentId,unitId:unit.id,title:`${catalogue.title}, ${catalogue.version}, Year ${unit.year}, pp. ${pages.join(', ')}`,url:catalogue.ministryUrl,mirrorUrl:catalogue.mirrorUrl,knowledge:join(ks),practices:join(ps),knowledgeIds:ks.map(s=>s.id),practiceIds:ps.map(s=>s.id),pages,year:unit.year,generatorVersion:3,connectionBasis:school?'School programme links drawn from the 2026 Junior Science unit-changes guide. Confirm the sequence for the cohort being planned.':'Suggested links from the Ministry year-by-year progression; confirm against the department’s taught sequence.',license:catalogue.license};
 const fullUnit=ks.length===unit.knowledge.length;
 const summary=fullUnit?profile.summary:groups.map(g=>g.k.map(st=>brief(st.text)).join(' ')).join(' ');
 const plan={...meta,subject:'Science',year:`Year ${unit.year}`,phase:`Phase ${unit.phase}`,title:meta.title||unit.title,duration:meta.duration||'',whakatauki:meta.whakatauki||'',
  purpose:profile.purpose,
  prior:school?.prior||profile.prior,
  future:school?.future||profile.future,
  knowledgeSummary:summary,
  practicesSummary:practiceSummary(ps),
  resources:'',
  assessment:'',descriptors:'',reporting:'',
  capabilities:['Thinkers','Communicators'],focuses};
 return {plan:validatePlan(plan),source};
}
export function assertCurriculumPreserved(before,after,source){
 if(!source.documentId)return;
 for(const key of ['knowledge','practices']){
  const a=[...new Set(before.focuses.flatMap(f=>f[key].split('\n')).filter(Boolean))].sort(),b=[...new Set(after.focuses.flatMap(f=>f[key].split('\n')).filter(Boolean))].sort();
  if(JSON.stringify(a)!==JSON.stringify(b))throw Error('The proposal changed Ministry statements. Keep every selected statement with its exact wording. You may reorganise the focuses without adding or losing statements.');
 }
}
