import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildCurriculumPlan,defaultPracticeIds,assertCurriculumPreserved,preserveAssessment} from '../unit-plan-builder/curriculum.js';
import {focusContent} from '../unit-plan-builder/focus-content.js';
import {profiles} from '../unit-plan-builder/planning-profiles.js';
import {checkSources,assessmentOptions,normaliseAssessmentOptions} from '../unit-plan-builder/model.js';
const c=JSON.parse(fs.readFileSync(new URL('../unit-plan-builder/science-curriculum.json',import.meta.url)));
assert.equal(c.units.length,44);assert.equal(c.units.reduce((n,u)=>n+u.knowledge.length,0),326);
const meta={title:'Test unit',duration:'12 lessons',whakatauki:'Confirmed department wording'};
for(const u of c.units){
 for(const subset of [false,true]){
 const k=subset?u.knowledge.slice(0,1):u.knowledge,p=subset?u.practices.slice(-1):u.practices;
 const sel={knowledge:k.map(s=>s.id),practices:p.map(s=>s.id)};
 const {plan,source}=buildCurriculumPlan(c,u,sel,meta);
 assert.equal(plan.resources,'');assert.equal(plan.assessment,'');assert.equal(plan.descriptors,'');assert.equal(plan.reporting,'');
 assert.ok(!plan.knowledgeSummary.includes('selected Ministry knowledge statements'));assert.ok(!/diagnostic|eliciting|short diagnostic|concept map/i.test(plan.prior));assert.ok(/Year [4-9]|primary Science/.test(plan.prior));
 assert.equal(plan.year,`Year ${u.year}`);assert.equal(source.unitId,u.id);
 for(const key of ['knowledge','practices']){const actual=new Set(plan.focuses.flatMap(f=>f[key].split('\n').filter(Boolean)));assert.deepEqual(actual,new Set((key==='knowledge'?k:p).map(s=>s.text)));}
 assert.deepEqual(checkSources(plan,source).filter(s=>!s.includes('add the Ministry practice')),[]);
 for(const f of plan.focuses){for(const key of ['objectives','vocabulary','misconceptions','checks'])assert.ok(f[key]);assert.ok(!f.objectives.includes('using the selected scientific ideas'));assert.ok(!f.checks.includes('one selected concept'));}
 const changed=structuredClone(plan);changed.focuses[0].knowledge+=' invented Ministry text';assert.throws(()=>assertCurriculumPreserved(plan,changed,source));
 const refined=structuredClone(plan);refined.focuses[0].objectives='Adapted for our class';assert.doesNotThrow(()=>assertCurriculumPreserved(plan,refined,source));
 }
 assert.ok(defaultPracticeIds(u).every(id=>u.practices.some(s=>s.id===id)));
}
const water=c.units.find(u=>u.title==='The water cycle');assert.ok(water.practices.filter(p=>defaultPracticeIds(water).includes(p.id)).every(p=>!p.text.includes('tectonic')));
const evo=c.units.find(u=>u.id==='science-y8-evolution');const result=buildCurriculumPlan(c,evo,{knowledge:evo.knowledge.map(s=>s.id),practices:evo.practices.map(s=>s.id)},meta);
assert.equal(result.plan.focuses.length,8);assert.deepEqual(checkSources(result.plan,result.source),[]);
const ai=structuredClone(result.plan);ai.resources='Invented resource';ai.assessment='Invented task';ai.descriptors='Invented grading';ai.reporting='Invented reporting';preserveAssessment(result.plan,ai);assert.equal(ai.resources,'');assert.equal(ai.assessment,'');assert.equal(ai.descriptors,'');assert.equal(ai.reporting,'');
const options=normaliseAssessmentOptions({...result.plan,descriptors:'Junior Assessment Framework\nInvented prose',reporting:'Portal only'});assert.equal(options.descriptors,'Junior Assessment Framework');assert.equal(options.reporting,'Portal only');
assert.equal(assessmentOptions.descriptors.length,3);assert.equal(assessmentOptions.reporting.length,6);
assert.throws(()=>buildCurriculumPlan(c,evo,{knowledge:[],practices:[]},meta));
const app=fs.readFileSync(new URL('../unit-plan-builder/app.js',import.meta.url),'utf8');assert.ok(!app.includes("createElement('details')"));assert.ok(!app.includes("createElement('summary')"));assert.ok(app.includes("createElement('li')"));
for(const [topic,p]of Object.entries(profiles))if(topic!=='Evolution')for(const [,title]of p.groups)assert.ok(focusContent[topic]?.[title],topic+' / '+title);
console.log('Passed: 44 topics, 326 knowledge statements, 88 full/subset drafts; exact selected text, year scope and AI edit protection.');
