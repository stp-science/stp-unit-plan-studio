import {validateOverview,validateOverviewStage,validateOverviewTerm} from './shared.js';

// A wall-clock deadline also settles stalled fetch/body promises, rather than
// depending on fetch to honour an abort signal or a background-tab active timer.
export async function generationRequest(body,{signal,timeoutMs=225000,fetcher=fetch}={}){
 const controller=new AbortController();let timer,onAbort;
 const aborted=new Promise((_,reject)=>{
  onAbort=()=>{controller.abort();reject(signal?.reason||new DOMException('Cancelled','AbortError'));};
  if(signal?.aborted)return onAbort();
  signal?.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>{controller.abort();reject(new DOMException('AI generation took too long. Completed years and saved guides have been kept. Try again to resume.','TimeoutError'));},timeoutMs);
 });
 try{return await Promise.race([aborted,(async()=>{
  const res=await fetcher('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,stream:true}),signal:controller.signal});
  let data;if((res.headers.get('Content-Type')||'').includes('application/x-ndjson')){const reader=res.body.getReader(),decoder=new TextDecoder();let pending='';const consume=line=>{if(!line.trim())return;const item=JSON.parse(line);if(item.type==='error')throw Error(item.error);if(item.type==='result')data=item;};try{while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let end;while((end=pending.indexOf('\n'))>=0){consume(pending.slice(0,end));pending=pending.slice(end+1);}}pending+=decoder.decode();if(pending.trim())consume(pending);}finally{reader.releaseLock();}if(!data)throw Error('The generation connection ended early. Completed years and guides have been kept. Try again to resume.');}else{const text=await res.text();try{data=JSON.parse(text);}catch{throw Error('The generation service did not return a complete response. Completed years and saved guides have been kept. Try again to resume.');}}
  if(!res.ok)throw Error(data.error||'AI generation could not finish. Your saved work has been kept.');
  if(controller.signal.aborted)throw signal?.reason||new DOMException('Cancelled','AbortError');
  return data.result;
 })()]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}

export async function overviewFingerprint(p){
 const {overviewDraft,guides,mapping,mappingStale,schoolStandardVersion,...inputs}=p;
 const json=JSON.stringify(inputs);
 // A change detector, not a security token. Works in HTTP previews too.
 const hashes=[2166136261,2246822519,3266489917,668265263],primes=[16777619,2246822519,3266489917,374761393];
 for(let i=0;i<json.length;i++)for(let j=0;j<4;j++)hashes[j]=Math.imul(hashes[j]^json.charCodeAt(i),primes[j]);
 return json.length+':'+hashes.map(h=>(h>>>0).toString(16).padStart(8,'0')).join('');
}

export async function stagedOverview({programme,request,save=()=>{},onProgress=()=>{},signal,termChunks=false}){
 if(termChunks)return stagedTermOverview({programme,request,save,onProgress,signal});
 const fingerprint=await overviewFingerprint(programme);
 if(programme.overviewDraft?.fingerprint!==fingerprint)programme.overviewDraft={fingerprint,years:{}};
 const draft=programme.overviewDraft;
 for(const year of [7,8,9,10]){
  if(signal?.aborted)throw signal.reason;
  if(draft.years[year]){try{validateOverviewStage(draft.years[year],year);continue;}catch{delete draft.years[year];}}
  const previous=Object.values(draft.years).flatMap(stage=>stage.units);
  onProgress(year,Object.keys(draft.years).length);
  const result=validateOverviewStage(await request(year,previous),year);
  if(signal?.aborted)throw signal.reason;
  // IDs returned by separate calls can overlap. Prefix units consistently;
  // statement IDs remain local to their unit, with exact wording preserved.
  draft.years[year]={...result,units:result.units.map(u=>({...u,id:'y'+year+'-'+u.id}))};
  await save();
 }
 const units=[7,8,9,10].flatMap(year=>draft.years[year].units);
 const warnings=[...new Set([7,8,9,10].flatMap(year=>(draft.years[year].warnings||[]).map(w=>'Year '+year+': '+w)))];
 return validateOverview({units,warnings});
}

// Outline first, then fill one term per request. Completed terms survive failures.
async function stagedTermOverview({programme,request,save,onProgress,signal}){
 const fingerprint=await overviewFingerprint(programme);
 if(programme.overviewDraft?.fingerprint!==fingerprint)programme.overviewDraft={fingerprint,years:{}};
 const draft=programme.overviewDraft;draft.outlines??={};draft.terms??={};
 for(const year of [7,8,9,10]){
  if(signal?.aborted)throw signal.reason;
  if(draft.years[year]){validateOverviewStage(draft.years[year],year);continue;}
  const previous=Object.values(draft.years).flatMap(s=>s.units);
  if(!draft.outlines[year]){
   onProgress(year,Object.keys(draft.years).length,{stage:'outline'});
   const outline=validateOverviewStage(await request(year,previous,{overviewStage:'outline'}),year);
   if(signal?.aborted)throw signal.reason;
   draft.outlines[year]={...outline,units:outline.units.map(u=>({...u,id:'y'+year+'-'+u.id,knowledge:[],practices:[],selectedKnowledge:[],selectedPractices:[]}))};
   await save();
  }
  const outline=draft.outlines[year];draft.terms[year]??={};
  for(const term of [1,2,3,4]){
   if(signal?.aborted)throw signal.reason;
   const planned=outline.units.filter(u=>u.term===term);
   if(!planned.length)continue;
   if(draft.terms[year][term]){validateOverviewTerm(draft.terms[year][term],year,term,outline.units);continue;}
   onProgress(year,Object.keys(draft.years).length,{stage:'term',term});
   const completed=Object.values(draft.terms[year]).flatMap(s=>s.units);
   const current=outline.units.map(u=>completed.find(c=>c.id===u.id)||u);
   const result=validateOverviewTerm(await request(year,[...previous,...current],{overviewStage:'term',overviewTerm:term}),year,term,outline.units);
   if(signal?.aborted)throw signal.reason;
   draft.terms[year][term]=result;await save();
  }
  const units=outline.units.map(u=>draft.terms[year][u.term].units.find(c=>c.id===u.id));
  const warnings=[...new Set([...outline.warnings,...Object.values(draft.terms[year]).flatMap(s=>s.warnings)])];
  draft.years[year]=validateOverviewStage({units,warnings},year);await save();
 }
 return validateOverview({units:[7,8,9,10].flatMap(y=>draft.years[y].units),warnings:[...new Set([7,8,9,10].flatMap(y=>draft.years[y].warnings.map(w=>'Year '+y+': '+w)))]});
}
