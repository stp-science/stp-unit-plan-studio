import {reviseOverview} from './overview-revision.js';
import {statementLibraryVersion,storedOverviewShape,prepareStoredLibrary,storedLibraryRecords,compactLibraryRecords,assembleStoredOverview,referenceGuideSchema,insertGuideStatements} from './statement-library.js';
import {providerConfig,generateWithProvider,schemaFromExample} from './ai-provider.js';
import {generationStream} from './generation-stream.js';
import {seniorCatalogue} from './senior-catalogue-data.js';
import {seniorProgressionEvidence} from './senior-reference.js';
import {ministryCatalogue,ministryContent} from './catalogue-data.js';
import {schoolStandard} from './school-standard.js';
import {rules,validatePlan,planSchema,capabilities} from '../unit-plan-builder/model.js';
import {programmeRules,validateOverview,validateMapping,overviewShape,selectedStatements,validateOverviewStage,validateOverviewTerm,termMappingShape,applyTermMapping} from '../programme/shared.js';
// Remove PDF layout padding and exclude explicitly identified primary phases.
// Preserve page numbers, columns (as tabs), source wording and Years 7–10 progression.
export function overviewCatalogueEvidence(body){
 if(!body.pages)return body;
 const phaseHeading=page=>/^Phase\s+([1-4])\s*\([^)]*\)\s*teaching sequence/i.exec(page.text.trim().slice(0,220).replace(/\s+/g,' '));
 const canScope=body.pages.some(page=>Number(phaseHeading(page)?.[1])>=3);let phase;
 const pages=body.pages.filter(page=>{const match=phaseHeading(page);if(match)phase=Number(match[1]);return !canScope||!phase||phase>=3;}).map(page=>({...page,text:page.text.replace(/[ \t]{2,}/g,'\t').replace(/\n{3,}/g,'\n\n')}));
 return {...body,...(canScope?{scopeNote:'Introductory guidance and Phases 3–4 retained. Explicitly identified Phase 1–2 teaching sequences excluded for this Years 7–10 programme.'}:{}),pages};
}
export async function api(request,env){
 const headers={'Cache-Control':'no-store'};const reply=(data,status=200)=>Response.json(data,{status,headers});
 const path=new URL(request.url).pathname;let provider;try{provider=providerConfig(env);}catch(e){return reply({error:e.message},503);}
 if(path==='/api/senior-curriculum-catalogue'&&request.method==='GET')return reply(seniorCatalogue);
 if(path==='/api/curriculum-catalogue'&&request.method==='GET')return reply(ministryCatalogue);
 if(path==='/api/school-config'&&request.method==='GET')return reply({priorities:schoolStandard.priorities,version:schoolStandard.version});
 if(path==='/api/status'&&request.method==='GET')return reply({configured:provider.configured,provider:provider.id,label:provider.label});
 if(request.method!=='POST')return reply({error:'Use POST.'},405);
 // Hosted Site is owner-private; platform dispatch authenticates requests before this Worker.
 const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return reply({error:'Use the Site’s own generation form.'},403);
 if(!provider.configured)return reply({error:provider.label+' is not connected yet. The administrator needs to configure the server-side API key and model. Your programme is saved; generation has not run.'},503);
 if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))return reply({error:'Use JSON.'},415);
 try{
  if(Number(request.headers.get('Content-Length')||0)>18000000)return reply({error:'Use fewer or smaller source documents for this trial.'},413);
  const text=await request.text();if(text.length>18000000)return reply({error:'Use fewer or smaller source documents for this trial.'},413);
  const data=JSON.parse(text);
  if(data.operation==='connection-check'){const start=Date.now();const response=await generateWithProvider({config:provider,content:[{type:'text',text:'Return exactly this JSON object: {"ok":true}'}],system:'Return valid JSON only.',maxTokens:512,stream:false,signal:AbortSignal.timeout(30000),thinkingLevel:'low'});const raw=response.content?.filter(b=>b.type==='text').map(b=>b.text).join('');if(response.stop_reason!=='end_turn'||JSON.parse(raw).ok!==true)throw Error('The small AI connection check did not return a valid response.');return reply({result:{ok:true,provider:provider.id,seconds:Math.round((Date.now()-start)/1000)}});}
  if(data.operation==='revise-overview'){const run=(onProgress,signal)=>reviseOverview(data.programme,data.prompt,data.history,env,provider,{stream:data.stream===true,onProgress,signal});if(data.stream===true)return generationStream(run,provider.label);return reply({result:await run()});}
  if(data.operation==='prepare-library'){if(![7,8,9,10].includes(data.overviewYear)||!data.programme||typeof data.programme.subjects!=='string')throw Error('Choose a valid source preparation year.');if(data.stream===true)return generationStream((onProgress,signal)=>prepareStoredLibrary(data.programme,data.overviewYear,env,provider,{onProgress,signal,stream:true}),provider.label);return reply({result:await prepareStoredLibrary(data.programme,data.overviewYear,env,provider,{stream:false})});}
  const p=data.programme,op=data.operation,overviewYear=data.overviewYear;if(overviewYear!==undefined&&(op!=='overview'||![7,8,9,10].includes(overviewYear)))throw Error('Choose a valid overview year.');
  if(!p||!['overview','mapping','guide'].includes(op)||!Array.isArray(p.units)||!p.guides||typeof p.subjects!=='string')return reply({error:'Invalid programme request.'},400);
  const catalogueIds=p.catalogueIds||[];if(!Array.isArray(catalogueIds)||catalogueIds.length>20)throw Error('Invalid catalogue selection.');const selectedCatalogue=[...new Set(catalogueIds)].map(id=>{const doc=ministryCatalogue.documents.find(d=>d.id===id);if(!doc?.availableForAi||!ministryContent[id])throw Error('A selected curriculum source needs its Ministry document. Upload the PDF instead.');return doc;});
  const overviewStage=data.overviewStage,overviewTerm=data.overviewTerm;
  if(overviewStage!==undefined&&(op!=='overview'||!overviewYear||!['outline','term'].includes(overviewStage)))throw Error('Invalid overview step.');
  if(overviewStage==='term'&&![1,2,3,4].includes(overviewTerm))throw Error('Choose a valid overview term.');
  const unit=p.units.find(u=>u.id===data.unitId);if(op!=='overview')validateOverview(p);
  const priorities=schoolStandard.priorities.split('\n').map(s=>s.split(':')[0].trim()).filter(Boolean);
  const storedMode=op==='overview'&&data.storedLibrary===true;if(storedMode&&!overviewYear)throw Error('Choose a year for the stored source planner.');
  const useGuideReferences=op==='guide'&&data.storedReferences===true;const guideSchema=useGuideReferences?referenceGuideSchema(planSchema):planSchema;
  const storedBank=storedMode?await storedLibraryRecords(p,overviewYear,env):null;
  let instruction,context;
  const programme={name:p.name,subjects:p.subjects,learningArea:p.learningArea,selectedDisciplines:p.disciplines||[],languageSubject:p.languageSubject||'',approach:p.approach,teachingTime:p.teachingTime,brief:p.brief,priorities:schoolStandard.priorities,capabilityGuidance:schoolStandard.capabilityGuidance,units:p.units,mapping:p.mapping,guides:Object.fromEntries(Object.entries(p.guides).map(([id,g])=>[id,{title:g.plan.title,capabilities:g.plan.capabilities,confirmedPriorities:g.confirmedPriorities,knowledgeSummary:g.plan.knowledgeSummary,assessment:g.plan.assessment}]))};
  if(op==='overview'){
   if(!(p.sources?.length||p.curriculumText?.trim()||selectedCatalogue.some(d=>d.availableForCurriculum!==false)))throw Error('Choose a subject or language teaching sequence, or upload the Ministry curriculum PDF. Overview and activity-reference documents alone do not provide the curriculum statements.');
   instruction='Create or interpret the four-year overview. For Learning Languages, use the supplied Novice 1/2/3 proficiency stages and the department’s entry points; never equate a novice stage with a fixed school year. Supporting documents and overviews are context, not mandatory curriculum statements. A grouped Ministry learning area may contain separate subjects: when selectedDisciplines is supplied, plan ONLY those disciplines (e.g. Dance, Drama, Music, Visual Arts), preserving discipline labels on units and statements. Other disciplines in the same document are outside this programme scope, not coverage gaps. Do not merge them into a generic Arts course unless multiple subjects have been selected. Preserve an existing uploaded department sequence where supplied, otherwise propose it. Include all relevant supplied Years 7–10 knowledge and practice statements; identify omitted/unallocated material in warnings. Source statements must be copied verbatim. If the complete programme is too large, flag scope limits rather than claiming completeness. Return this shape, with unique IDs and all mapped statements initially selected: '+JSON.stringify(overviewShape);
   if(overviewYear)instruction+=`\nThis is stage ${overviewYear-6} of 4: return ONLY Year ${overviewYear} units and all relevant statements for that year. Read the whole source for progression, but do not return units or duplicate statements for other years. Earlier completed years in CONTEXT show prerequisites and must not be rewritten. Preserve the uploaded department sequence for this year. Keep rationales concise and use approximately 4–12 coherent units as the content warrants, not a unit for each statement. Do not report other years as missing. If this subject is explicitly not taught in the requested year, return an empty units array and explain this in warnings; do not invent teaching provision.`;
   if(overviewStage==='outline')instruction+='\nOUTLINE STEP OVERRIDE: Plan the whole requested year’s coherent topic titles, terms, duration and concise sequencing rationales ONLY. Return empty knowledge, practices, selectedKnowledge and selectedPractices arrays for every unit. Do not copy curriculum statements in this step; a separate request will map each term. Use the full source to ensure the proposed topics can accommodate all required knowledge and practices. Respect department instructions about topic number and existing uploaded sequence.';
   if(overviewStage==='term'){
    const requested=p.units.filter(u=>u.year===overviewYear&&u.term===overviewTerm).map((u,i)=>({unitRef:i+1,title:u.title,subject:u.subject,duration:u.duration,rationale:u.rationale}));
    instruction=`Map the supplied Ministry curriculum knowledge and practices into ONLY the requested units below. Return the following compact JSON shape instead of the overview shape: ${JSON.stringify(termMappingShape)}. Return every requested unit exactly once, using its numeric unitRef. Do not return titles, years, terms, IDs or selections; the website retains those. Copy full knowledge and practice wording verbatim and include subject and source/page for every statement. Use the full year outline to allocate relevant content and preserve purposeful revisiting. Do not put all of the year’s statements into this one term. Retain subject/discipline attribution and official year boundaries. Other terms are handled separately, so do not report those as omissions. Flag content that cannot fit any of the planned topics in warnings.\nREQUESTED UNITS: ${JSON.stringify(requested)}`;
   }
   context={...programme,catalogueSources:selectedCatalogue,...(overviewYear?{requestedYear:overviewYear}: {})};
  }else if(op==='mapping'){
   if(!priorities.length)throw Error('Programme mapping will be available once the school-wide setup is complete.');
   instruction='Propose relevant capabilities and school priorities for EVERY unit. Preserve existing teacher decisions as confirmed context, and distinguish suggestions from them. Address progression and gaps across the whole programme. Return {"units":[{"unitId":"existing-id","capabilities":[{"name":"exact allowed capability","reason":"specific content connection and development"}],"priorities":[{"name":"exact priority name before colon","reason":"content connection"}]}],"gaps":["coverage gaps, missing years/terms, or unsupported opportunities"]}. Empty opportunity arrays are allowed. Do not assign equal quotas.';
   context=programme;
  }else{
   if(!unit)throw Error('Choose a valid unit.');
   if(!selectedStatements(unit,'knowledge').length&&!selectedStatements(unit,'practices').length)throw Error('Select statements first.');
   instruction=rules+'\nGenerate a topic guide for the selected unit using the complete programme and its opportunity map. Exactly preserve selected official wording; include every selected statement at least once and no unselected statement. The capabilities array MUST be empty on a new guide: teacher tick boxes are manual. School-priority opportunities may be described in focus priorities with the specific learning connection, but this is not approval of a tick box. Do not generate assessment, descriptors, reporting or resources. Preserve existing teacher entries server-side. Subject/year/title/duration must match the selected unit. Return only the plan with this JSON schema: '+JSON.stringify(guideSchema);
   if(useGuideReferences)instruction+='\nREFERENCE OUTPUT: In each learning focus return knowledgeRefs and practiceRefs as 1-based positions in selectedKnowledge and selectedPractices respectively. Do not return the statement wording. Include every selected statement in at least one focus. The website inserts its full stored wording exactly. An empty reference array is allowed when that focus does not use that statement type.';
   context={programme,unit,selectedKnowledge:selectedStatements(unit,'knowledge'),selectedPractices:selectedStatements(unit,'practices'),currentGuide:p.guides[unit.id]?.plan||null};
  }
  if(storedMode){instruction=`Organise the stored curriculum records into a coherent Year ${overviewYear} topic sequence for Terms 1–4. Respect the department brief and uploaded overview, preserving an existing sequence when supplied. Use prerequisite knowledge and purposeful revisiting across years. Return ONLY topic metadata and numeric statement references in this shape: ${JSON.stringify(storedOverviewShape)}. Records are [ref, K or P, subject, section, full wording]. Use knowledgeRefs for K records and practiceRefs for P records. Include every relevant record at least once; records may be revisited in more than one unit with a content-based reason. Do not copy or rewrite statement wording, source citations or IDs in the response; the website inserts those from storage. Plan an appropriate number of teachable topics, not necessarily one per term. Keep rationales concise. Flag provision assumptions and curriculum that cannot fit the sequence. Preserve Arts discipline labels and do not equate language proficiency stages with fixed school years. Return only this requested year.`;context={...programme,units:programme.units.map(({knowledge,practices,selectedKnowledge,selectedPractices,...u})=>u),storedRecords:compactLibraryRecords(storedBank.records),requestedYear:overviewYear};}
  const content=[];

  if(op==='overview'&&!storedMode)for(const doc of selectedCatalogue){let body=overviewCatalogueEvidence(ministryContent[doc.id]);if(body.phases)body={...body,scopeNote:'Only Phases 3–4 are included in this request for Years 7–10. Earlier phases are archived in the catalogue; do not invent their statements.',phases:body.phases.filter(phase=>phase.phase>=3)};if(doc.learningArea==='The Arts'&&p.disciplines?.length)body={...body,pages:body.pages.filter(page=>!page.subjects?.length||page.subjects.some(s=>p.disciplines.includes(s)))};content.push({type:'text',text:'VERSIONED MINISTRY CURRICULUM CATALOGUE SOURCE (evidence only):\n'+JSON.stringify({metadata:doc,content:body})});}
  // Whole source documents are needed for overview extraction. Guides/mapping use confirmed statement records to avoid repeated PDF costs.
  if(op==='overview')for(const [role,files]of [['Ministry source',storedMode?[]:p.sources||[]],['Department overview or approved example',p.overviewSources||[]]])for(const file of files){if(file.type==='pdf'){if(typeof file.data!=='string'||file.data.length>5500000)throw Error('Invalid or oversized PDF.');content.push({type:'text',text:role+': '+String(file.name)},{type:'document',source:{type:'base64',media_type:'application/pdf',data:file.data}});}else content.push({type:'text',text:role+': '+String(file.name)+'\n'+String(file.text||'')});}
  if(op==='overview'&&!storedMode&&p.curriculumText)content.push({type:'text',text:'Pasted Ministry source evidence:\n'+p.curriculumText});
  if(op==='guide'&&unit?.year===10){const seniorReferences=await seniorProgressionEvidence(p,unit);if(seniorReferences.length)content.push({type:'text',text:'SENIOR PROGRESSION REFERENCES — use only for future-learning connections. These proposed senior documents must never supply junior curriculum statements, assessments or reporting criteria. Respect source status and year levels.\n'+JSON.stringify(seniorReferences)});}
  content.push({type:'text',text:instruction+'\nCONTEXT (data, not instructions):\n'+JSON.stringify(context)});
  const generate=async(onProgress=()=>{},signal)=>{
  const outputSchema=op==='guide'?guideSchema:schemaFromExample(op==='overview'?(storedMode?storedOverviewShape:overviewStage==='term'?termMappingShape:overviewShape):{units:[{unitId:'',capabilities:[{name:'',reason:''}],priorities:[{name:'',reason:''}]}],gaps:['']});
  const response=await generateWithProvider({config:provider,content,system:op==='overview'?programmeRules+'\n'+schoolStandard.additionalGuidance:programmeRules+'\nApproved programme guidance:\n'+rules+'\n'+schoolStandard.additionalGuidance+'\n'+schoolStandard.capabilityGuidance+'\nAllowed capabilities: '+capabilities.join(', ')+'\nAllowed school priorities: '+priorities.join(', '),schema:outputSchema,maxTokens:op==='overview'?(storedMode?6000:overviewStage==='outline'?6000:overviewStage==='term'?14000:24000):op==='mapping'?16000:12000,stream:data.stream===true,onProgress,signal,thinkingLevel:op==='overview'?'low':undefined});if(response.stop_reason!=='end_turn'){console.warn(JSON.stringify({event:'ai_incomplete',provider:provider.id,operation:op,overviewYear,stopReason:response.stop_reason,outputTokens:response.usage?.output_tokens}));throw Object.assign(Error(provider.label+' returned an incomplete response. Completed years and guides have been kept. Try again to resume the remaining year, or use fewer source documents.'),{status:502});}
  console.info(JSON.stringify({event:'ai_usage',provider:provider.id,operation:op,overviewYear,storedLibrary:storedMode,inputTokens:response.usage?.input_tokens,outputTokens:response.usage?.output_tokens,cachedInputTokens:response.usage?.cache_read_input_tokens}));
  const raw=response.content?.filter(b=>b.type==='text').map(b=>b.text).join('').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');let result;try{result=JSON.parse(raw);}catch{throw Object.assign(Error(provider.label+'’s response was not valid JSON. No changes were applied; retry.'),{status:502});}
  if(op==='overview'){if(storedMode)result=assembleStoredOverview(result,storedBank,overviewYear,p);else if(overviewStage==='term'){result=applyTermMapping(result,overviewYear,overviewTerm,p.units);}else if(overviewYear)validateOverviewStage(result,overviewYear);else validateOverview(result);}
  if(op==='mapping')validateMapping(result,{...p,priorities:schoolStandard.priorities},capabilities);
  if(op==='guide'){
   if(useGuideReferences)result=insertGuideStatements(result,unit);
   validatePlan(result);
   result.subject=unit.subject||p.subjects;result.year='Year '+unit.year;result.title=unit.title;result.duration=unit.duration||'';
   const existing=p.guides[unit.id]?.plan;
   for(const k of ['assessment','descriptors','reporting','resources','whakatauki'])result[k]=existing?.[k]||'';
   result.capabilities=existing?.capabilities||[];
   for(const key of ['knowledge','practices']){
    const required=selectedStatements(unit,key).map(s=>s.text),actual=result.focuses.flatMap(f=>f[key].split('\n').map(s=>s.trim()).filter(Boolean));
    if(required.some(s=>!actual.includes(s))||actual.some(s=>!required.includes(s)))throw Object.assign(Error(provider.label+' changed or omitted selected curriculum wording. No changes were applied. Please retry.'),{status:502});
   }
   validatePlan(result);
  }
  return result;};
  if(data.stream===true)return generationStream(generate,provider.label);
  return reply({result:await generate()});
 }catch(e){return reply({error:e.name==='TimeoutError'?provider.label+' timed out. Completed years and saved guides have been kept. Try again to resume.':e instanceof SyntaxError?'Invalid JSON request.':e.message||'The request could not be processed.'},e.status||400);}
}
