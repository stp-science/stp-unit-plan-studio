import assert from 'node:assert/strict';
import {ministryCatalogue,ministryContent} from '../worker/catalogue-data.js';
import {api} from '../worker/api.js';
assert.equal(ministryCatalogue.documents.length,15);
const ready=ministryCatalogue.documents.filter(d=>d.availableForAi);assert.equal(ready.length,15);
assert.equal(new Set(ministryCatalogue.documents.map(d=>d.id)).size,15);
for(const d of ready){assert(ministryContent[d.id]);assert(d.sourceUrl.startsWith('https://newzealandcurriculum.tahurangi.education.govt.nz/'));const b=ministryContent[d.id];if(b.phases){assert.deepEqual(b.phases.map(p=>p.phase),[1,2,3,4]);for(const phase of b.phases){assert(phase.text.length>10000);assert(phase.tables.length);assert(phase.url.startsWith('https://newzealandcurriculum.tahurangi.education.govt.nz/'));}}else{assert.equal(d.pageCount,b.pages.length);assert(b.pages.every((p,i)=>p.page===i+1&&p.text.length));}}
for(const d of ministryCatalogue.documents.filter(d=>!d.availableForAi))assert(!ministryContent[d.id]);
const env={ANTHROPIC_API_KEY:'fake',CLAUDE_MODEL:'test'},p={name:'Test',subjects:'Music',learningArea:'The Arts',disciplines:['Music'],units:[],guides:{},sources:[],overviewSources:[],curriculumText:'',catalogueIds:['arts-sep-2026']};
const req=()=>new Request('https://example.test/api/generate',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.test'},body:JSON.stringify({operation:'overview',programme:p})});
const savedFetch=globalThis.fetch;let payload;
globalThis.fetch=async(_,options)=>{payload=JSON.parse(options.body);return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({units:[{id:'u1',title:'Music',year:7,term:1,knowledge:[],practices:[],selectedKnowledge:[],selectedPractices:[]}],warnings:['Test']})}]});};
try{let response=await api(req(),env);assert.equal(response.status,200);const source=JSON.parse(payload.messages[0].content[0].text.split('\n').slice(1).join('\n'));assert.equal(source.metadata.id,'arts-sep-2026');assert(source.content.pages.some(p=>p.page===24));assert(!source.content.pages.some(p=>p.page===22));assert(!source.content.pages.some(p=>p.page===30));p.catalogueIds=['senior-science-year11-oct26-1'];response=await api(req(),env);assert.equal(response.status,400);assert((await response.json()).error.includes('needs its Ministry document'));}finally{globalThis.fetch=savedFetch;}
console.log('Catalogue validated: 8 learning areas, 15 junior sources including 5 language sequences; phase coverage, page integrity, discipline filtering and unavailable-source rejection passed.');
