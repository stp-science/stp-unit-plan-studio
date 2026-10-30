import assert from 'node:assert/strict';
import {generationRequest,stagedOverview} from '../programme/generation.js';
import {readClaudeStream,generationStream} from '../worker/generation-stream.js';

// A failed or stalled body must not leave the UI awaiting fetch indefinitely.
await assert.rejects(generationRequest({}, {timeoutMs:10,fetcher:()=>new Promise(()=>{})}),e=>e.name==='TimeoutError');
await assert.rejects(generationRequest({}, {timeoutMs:10,fetcher:async()=>({headers:new Headers(),text:()=>new Promise(()=>{})})}),e=>e.name==='TimeoutError');
await assert.rejects(generationRequest({}, {fetcher:async()=>new Response('<html>Gateway timeout</html>',{status:502})}),/complete response/);
const controller=new AbortController();const cancelled=generationRequest({}, {signal:controller.signal,fetcher:()=>new Promise(()=>{})});controller.abort();await assert.rejects(cancelled,e=>e.name==='AbortError');
assert.deepEqual(await generationRequest({}, {fetcher:async()=>Response.json({result:{ok:true}})}),{ok:true});

const p={name:'Science',subjects:'Science',units:[],guides:{},sources:[],overviewSources:[],brief:'Original brief'};
const stage=year=>({units:[{id:'repeated-id',title:'Unit '+year,year,term:1,knowledge:[{id:'k',text:'Exact supplied statement '+year,subject:'Science',source:'Source p.1'}],practices:[],selectedKnowledge:['k'],selectedPractices:[]}],warnings:[]});
let calls=[],saved=0;
await assert.rejects(stagedOverview({programme:p,save:()=>saved++,request:async year=>{calls.push(year);if(year===8)throw Error('Temporary service failure');return stage(year);}}),/Temporary service/);
assert.deepEqual(calls,[7,8]);assert.equal(saved,1);assert.equal(p.units.length,0,'Partial drafts must not replace accepted units');
calls=[];const result=await stagedOverview({programme:p,request:async(year,previous)=>{calls.push(year);assert(previous.some(u=>u.year===7));return stage(year);}});
assert.deepEqual(calls,[8,9,10]);assert.equal(new Set(result.units.map(u=>u.id)).size,4);assert.equal(result.units[0].knowledge[0].text,'Exact supplied statement 7');
p.brief='Changed source instructions';calls=[];await stagedOverview({programme:p,request:async year=>{calls.push(year);return stage(year);}});assert.deepEqual(calls,[7,8,9,10],'Changed planning inputs must invalidate saved stages');
p.brief='New run';await assert.rejects(stagedOverview({programme:p,request:async()=>stage(8)}),/different year/);
console.log('Passed stalled fetch/body deadlines, cancellation, non-JSON errors, year checkpoints, resume, source invalidation and exact statement retention.');

const events=[{type:'message_start',message:{usage:{input_tokens:10}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'{"title":"Māori"}'}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:12}},{type:'message_stop'}];
const eventBytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));
const response=new Response(new ReadableStream({start(c){for(const byte of eventBytes)c.enqueue(Uint8Array.of(byte));c.close();}}));
const decoded=await readClaudeStream(response);assert.equal(decoded.content[0].text,'{"title":"Māori"}');assert.equal(decoded.stop_reason,'end_turn');
assert.deepEqual(await generationRequest({}, {fetcher:async()=>generationStream(async()=>({ready:true}))}),{ready:true});
await assert.rejects(generationRequest({}, {fetcher:async()=>generationStream(async()=>{throw Error('Service interruption');})}),/Service interruption/);
await assert.rejects(readClaudeStream(new Response('data: {"type":"message_stop"}\n\n')),/ended unexpectedly/);
console.log('Passed streamed Unicode fragments, validated final results, streamed errors and incomplete-stream rejection.');

const chunked={name:'Term checkpoint test',subjects:'Drama',units:[],guides:{},sources:[],overviewSources:[]};
const outline=y=>({units:[1,2].map(term=>({...stage(y).units[0],id:'topic-'+term,title:'Topic '+term,term,knowledge:[],selectedKnowledge:[]})),warnings:[]});
let stepCalls=[];
const termRequest=async(y,previous,step)=>{stepCalls.push(y+':'+step.overviewStage+':'+(step.overviewTerm||0));if(step.overviewStage==='outline')return outline(y);return {units:previous.filter(u=>u.year===y&&u.term===step.overviewTerm).map(u=>({...u,knowledge:stage(y).units[0].knowledge,selectedKnowledge:['k']})),warnings:[]};};
await assert.rejects(stagedOverview({programme:chunked,termChunks:true,request:async(y,previous,step)=>{if(y===7&&step.overviewTerm===2)throw Error('Term timeout');return termRequest(y,previous,step);}}),/Term timeout/);
assert(chunked.overviewDraft.terms[7][1]);assert(!chunked.overviewDraft.years[7]);assert.equal(chunked.units.length,0);
stepCalls=[];const complete=await stagedOverview({programme:chunked,termChunks:true,request:termRequest});assert.equal(stepCalls[0],'7:term:2');assert(!stepCalls.includes('7:outline:0'));assert(!stepCalls.includes('7:term:1'));assert.equal(complete.units.length,8);assert.equal(new Set(complete.units.map(u=>u.id)).size,8);assert.equal(complete.units[0].knowledge[0].text,'Exact supplied statement 7');
const bad={...chunked,brief:'Changed inputs',overviewDraft:undefined};await assert.rejects(stagedOverview({programme:bad,termChunks:true,request:async(y,previous,step)=>{const r=await termRequest(y,previous,step);if(step.overviewStage==='term')r.units[0].title='Unexpected replacement';return r;}}),/changed the planned units/);
console.log('Passed per-term failure recovery, unchanged-outline reuse, source wording retention and unit identity protection.');

const {applyTermMapping}=await import('../programme/shared.js');
const trusted=[{...stage(7).units[0],id:'fixed-a',title:'Thermal Energy',subject:'Science',duration:'8 lessons'},{...stage(7).units[0],id:'fixed-b',title:'Cells',term:2}];
const mapped={units:[{unitRef:1,title:'THERMAL energy',term:4,year:9,knowledge:trusted[0].knowledge,practices:[]}],warnings:[]};
const kept=applyTermMapping(mapped,7,1,trusted);assert.equal(kept.units[0].title,'Thermal Energy');assert.equal(kept.units[0].term,1);assert.equal(kept.units[0].year,7);assert.equal(kept.units[0].duration,'8 lessons');assert.equal(kept.units[0].knowledge[0].text,trusted[0].knowledge[0].text);assert.deepEqual(kept.units[0].selectedKnowledge,[kept.units[0].knowledge[0].id]);
assert.throws(()=>applyTermMapping({...mapped,units:[{...mapped.units[0],unitRef:2}]},7,1,trusted),/unknown/);
assert.throws(()=>applyTermMapping({...mapped,units:[]},7,1,trusted),/every planned unit/);
assert.throws(()=>applyTermMapping({...mapped,units:[mapped.units[0],mapped.units[0]]},7,1,[trusted[0],{...trusted[0],id:'another'}]),/repeated/);
console.log('Passed trusted topic metadata retention and numeric references with missing, duplicate and cross-term unit rejection.');
