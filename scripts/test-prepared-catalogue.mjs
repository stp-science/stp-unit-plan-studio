import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {librarySources,prepareStoredLibrary,storedLibraryRecords,validateStoredBank} from '../worker/statement-library.js';
import {providerConfig} from '../worker/ai-provider.js';
const index=JSON.parse(await readFile('curriculum-catalogue/index.json','utf8'));
const prepared=JSON.parse(await readFile('curriculum-library/catalogue-banks.json','utf8'));
const docs=index.documents.filter(d=>d.availableForAi&&d.availableForCurriculum);
const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('A prepared catalogue must not call AI or external services');};let count=0,total=0;
for(const d of docs)for(const year of [7,8,9,10]){
 const p={subjects:d.subject||d.learningArea,learningArea:d.learningArea,catalogueIds:[d.id],sources:[],units:[],guides:{}};
 const source=(await librarySources(p))[0];const ready=await prepareStoredLibrary(p,year,{},providerConfig({ANTHROPIC_API_KEY:'fake',CLAUDE_MODEL:'test'}));assert(ready.sources.every(s=>s.cacheHit));const bank=await storedLibraryRecords(p,year,{});assert(bank.records.some(r=>r.kind==='knowledge'));assert(bank.records.some(r=>r.kind==='practice'));
 if(d.id!=='science-aug-2026'){const b=prepared[d.id+':'+(d.learningArea==='Learning Languages'?0:year)];validateStoredBank(b,source,year);assert(b.records.every(r=>r.sourceCell.length===4));if(d.learningArea==='Learning Languages')assert.deepEqual([...new Set(b.records.map(r=>r.proficiencyStage))].sort(),['Novice 1','Novice 2','Novice 3']);}
 count++;total+=bank.records.length;
}
for(const discipline of ['Dance','Drama','Music','Visual Arts'])for(const year of [7,8,9,10]){const b=await storedLibraryRecords({catalogueIds:['arts-sep-2026'],disciplines:[discipline]},year,{});assert(b.records.length>0);assert(b.records.every(r=>r.subject===discipline));}
const a=prepared['arts-sep-2026:7'],b=prepared['arts-sep-2026:8'];for(const r of a.records.filter(r=>r.sharedYears.includes(8)))assert(b.records.some(s=>s.text===r.text&&s.page===r.page&&s.kind===r.kind),'Merged cells must be available in both labelled years');
assert(prepared['maths-2025:7'].records.some(r=>r.text.includes('10⁴')),'Superscripts must retain their meaning');
globalThis.fetch=original;console.log(`Prepared catalogue: ${docs.length} sources, ${count} subject/year combinations, all Arts disciplines, language stages and shared cells checked; zero AI/network calls.`);
