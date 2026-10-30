import assert from 'node:assert/strict';
import {api,overviewCatalogueEvidence} from '../worker/api.js';
import {ministryContent} from '../worker/catalogue-data.js';
import {generationRequest} from '../programme/generation.js';
import {readGeminiStream} from '../worker/generation-stream.js';
import {providerConfig} from '../worker/ai-provider.js';

const env={AI_PROVIDER:'gemini',GEMINI_API_KEY:'fake-google-key',GEMINI_MODEL:'gemini-3.8-flash',ANTHROPIC_API_KEY:'unused-claude-key',CLAUDE_MODEL:'unused-model'};
const knowledge='All matter is made up of sub-microscopic particles.';
const unit={id:'unit',title:'Particles',subject:'Science',year:7,term:1,duration:'6 lessons',knowledge:[{id:'k',text:knowledge,subject:'Science',source:'Supplied Ministry source'}],practices:[],selectedKnowledge:['k'],selectedPractices:[]};
const p={subjects:'Science',name:'Gemini trial',units:[unit],guides:{},catalogueIds:[],sources:[],overviewSources:[]};
const plan={subject:'Science',year:'Year 7',phase:'Phase 3',title:'Particles',duration:'6 lessons',whakatauki:'',purpose:'Explain everyday matter using particles.',prior:'',future:'',knowledgeSummary:'Students use a particle model.',practicesSummary:'',resources:'Leave manual',assessment:'Leave manual',descriptors:'Leave manual',reporting:'Leave manual',capabilities:['Thinkers'],focuses:[{title:'Particle model',knowledge,practices:'',objectives:'Describe matter in terms of particles.',priorities:'',vocabulary:'particle',misconceptions:'Particles are visible.',checks:'Explain a particle diagram.'}]};
const req=data=>new Request('https://trial.test/api/generate',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://trial.test'},body:JSON.stringify(data)});
assert.equal(providerConfig(env).id,'gemini');assert.throws(()=>providerConfig({...env,GEMINI_MODEL:'../invalid'}),/invalid/);
assert.equal((await api(req({}),{...env,GEMINI_API_KEY:''})).status,503,'An available Claude key must not mask missing Gemini configuration');
const state=await(await api(new Request('https://trial.test/api/status'),env)).json();assert.equal(state.provider,'gemini');assert.equal(state.configured,true);
const originalFetch=globalThis.fetch;let body,calls=0;
const responseFor=(value,finishReason='STOP')=>({candidates:[{content:{parts:[{thought:true,text:'Do not export reasoning.'},{text:JSON.stringify(value)}]},finishReason}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:200}});
globalThis.fetch=async(url,options)=>{calls++;assert(url.startsWith('https://generativelanguage.googleapis.com/'));assert(!url.includes(env.GEMINI_API_KEY));assert.equal(options.headers['x-goog-api-key'],env.GEMINI_API_KEY);assert(!options.headers['x-api-key']);body=JSON.parse(options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert(!body.generationConfig.responseJsonSchema);assert(body.contents[0].parts.at(-1).text.includes('JSON schema'));assert(body.systemInstruction.parts[0].text.includes('not equal counts'));return Response.json(responseFor(plan));};
let res=await api(req({operation:'guide',programme:p,unitId:'unit'}),env);assert.equal(res.status,200);let out=await res.json();assert.equal(out.result.focuses[0].knowledge,knowledge);assert.equal(out.result.assessment,'');assert.equal(out.result.resources,'');assert.deepEqual(out.result.capabilities,[]);
p.guides.unit={plan:{...plan,assessment:'Teacher assessment',resources:'Teacher resources',capabilities:['Communicators']},confirmedPriorities:[]};
res=await api(req({operation:'guide',programme:p,unitId:'unit'}),env);out=await res.json();assert.equal(out.result.assessment,'Teacher assessment');assert.equal(out.result.resources,'Teacher resources');assert.deepEqual(out.result.capabilities,['Communicators']);
plan.focuses[0].knowledge='Paraphrased statement';res=await api(req({operation:'guide',programme:p,unitId:'unit'}),env);assert.equal(res.status,502);plan.focuses[0].knowledge=knowledge;
globalThis.fetch=async()=>Response.json(responseFor(plan,'MAX_TOKENS'));res=await api(req({operation:'guide',programme:p,unitId:'unit'}),env);assert.equal(res.status,502);
const overview={units:[unit],warnings:[]};globalThis.fetch=async(url,options)=>{body=JSON.parse(options.body);return Response.json(responseFor(overview));};
res=await api(req({operation:'overview',overviewYear:7,programme:{...p,sources:[{name:'Ministry.pdf',type:'pdf',data:'JVBERg=='}]}}),env);assert.equal(res.status,200);assert(body.contents[0].parts.some(part=>part.inlineData?.mimeType==='application/pdf'&&part.inlineData.data==='JVBERg=='));assert(body.contents[0].parts.at(-1).text.includes('return ONLY Year 7'));

assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'low');
res=await api(req({operation:'overview',overviewYear:7,overviewStage:'outline',programme:{...p,curriculumText:knowledge}}),env);assert.equal(res.status,200);assert.equal(body.generationConfig.maxOutputTokens,6000);assert(body.contents[0].parts.at(-1).text.includes('OUTLINE STEP OVERRIDE'));
res=await api(req({operation:'overview',overviewYear:7,overviewStage:'term',overviewTerm:1,programme:{...p,curriculumText:knowledge}}),env);assert.equal(res.status,200);assert.equal(body.generationConfig.maxOutputTokens,14000);assert(body.contents[0].parts.at(-1).text.includes('TERM DETAIL STEP OVERRIDE'));
res=await api(req({operation:'overview',overviewYear:7,overviewStage:'term',overviewTerm:2,programme:{...p,curriculumText:knowledge}}),env);assert.equal(res.status,400,'A term cannot overwrite units in another term');
res=await api(req({operation:'overview',overviewYear:7,overviewStage:'term',overviewTerm:9,programme:{...p,curriculumText:knowledge}}),env);assert.equal(res.status,400);

const sse=chunks=>new Response(chunks.map(value=>'data: '+JSON.stringify(value)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
globalThis.fetch=async(url,options)=>{assert(url.endsWith(':streamGenerateContent?alt=sse'));const text=JSON.stringify(plan);return sse([{candidates:[{content:{parts:[{thought:true,text:'Private reasoning'},{text:text.slice(0,37)}]}}]},{candidates:[{content:{parts:[{text:text.slice(37)}]},finishReason:'STOP'}]}]);};
const result=await generationRequest({operation:'guide',programme:p,unitId:'unit'},{fetcher:async(path,options)=>api(new Request('https://trial.test'+path,{...options,headers:{...options.headers,Origin:'https://trial.test'}}),env)});assert.equal(result.assessment,'Teacher assessment');assert.equal(result.focuses[0].knowledge,knowledge);
calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{status:'RESOURCE_EXHAUSTED',message:'Quota reached'}},{status:429});};
res=await api(req({operation:'guide',programme:p,unitId:'unit'}),env);assert.equal(res.status,502);assert.match((await res.json()).error,/Gemini.*quota/);assert.equal(calls,1,'Quota failure must not retry or charge through Claude');
await assert.rejects(readGeminiStream(sse([{candidates:[{content:{parts:[{text:'incomplete'}]}}]}])),/ended unexpectedly/);
globalThis.fetch=originalFetch;
console.log('Passed Gemini provider isolation, secure headers, PDF inputs, JSON schema, exact curriculum text, preserved teacher decisions, truncation, streaming and quota handling. No live provider called.');

for(const [id,source] of Object.entries(ministryContent)){if(!source.pages)continue;const evidence=overviewCatalogueEvidence(source);for(const page of evidence.pages){const original=source.pages.find(p=>p.page===page.page);assert.equal(page.text.replace(/\s+/g,' ').trim(),original.text.replace(/\s+/g,' ').trim(),'Retained source wording must survive PDF whitespace compaction');}if(id==='science-aug-2026'){assert.deepEqual(evidence.pages.map(p=>p.page),[1,2,3,4,5,6,7,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]);assert(JSON.stringify(evidence).length<JSON.stringify(source).length/2);}}
const unmarked={pages:[{page:1,text:'Unmarked knowledge  with  layout spaces'}]};assert.equal(overviewCatalogueEvidence(unmarked).pages.length,1,'Unmarked sources must not be silently scoped out');
globalThis.fetch=async(url,options)=>{body=JSON.parse(options.body);assert(body.contents[0].parts[0].text.length<100);return Response.json(responseFor({ok:true}));};
res=await api(req({operation:'connection-check'}),env);assert.equal(res.status,200);assert.equal((await res.json()).result.ok,true);globalThis.fetch=originalFetch;
console.log('Passed compact evidence wording/page preservation, phase scoping and isolated connection diagnostics.');
