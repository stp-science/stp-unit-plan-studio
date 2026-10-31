import {storedLibraryRecords} from './statement-library.js';
import {generateWithProvider} from './ai-provider.js';
import {programmeRules,validateOverview} from '../programme/shared.js';

export const revisionShape={message:'What changed and why',changes:[{action:'update',unitRef:1,title:'Revised topic title',term:2,year:7,duration:'Teaching time',rationale:'Position in the sequence',knowledgeRefs:[1],practiceRefs:[2]}],warnings:['Assumptions or coverage requiring department review']};
const recordKey=s=>JSON.stringify([s.id,s.text,s.subject,s.source]);
export function revisionRecords(units,additional=[]){
 const records=[],refs=new Map();
 const add=(s,kind,year)=>{const key=recordKey(s);if(refs.has(key)){const record=records[refs.get(key)-1];if(record.kind!==kind)throw Error('A source record has conflicting knowledge and practice labels. Check the statements before revising.');if(!record.years.includes(year))record.years.push(year);return refs.get(key);}records.push({...s,kind,years:[year],section:s.section||''});refs.set(key,records.length);return records.length;};
 const currentUnits=units.map(u=>{const {knowledge,practices,selectedKnowledge,selectedPractices,...metadata}=u;return {...metadata,knowledgeRefs:knowledge.map(s=>add(s,'knowledge',u.year)),practiceRefs:practices.map(s=>add(s,'practice',u.year))};});
 for(const {record,year}of additional)add(record,record.kind,year);
 return {records,currentUnits};
}
export function applyOverviewRevision(response,programme,bank){
 if(!response||typeof response.message!=='string'||!Array.isArray(response.changes)||response.changes.length>120||!Array.isArray(response.warnings)||response.warnings.some(w=>typeof w!=='string'))throw Error('AI returned an incomplete revision. Your current plan is kept.');
 let units=structuredClone(programme.units);const changed=new Set(),warnings=[...(bank.sourceWarnings||[]),...response.warnings],existingUsed=new Set(programme.units.flatMap(u=>[...u.knowledge,...u.practices]).map(recordKey));
 for(const [editIndex,edit] of response.changes.entries()){
  const target=Number.isInteger(edit?.unitRef)?programme.units[edit.unitRef-1]?.id:edit?.unitId;const changeKey=edit?.action==='add'?'new-'+editIndex:target;
  if(!edit||!['update','add','remove'].includes(edit.action)||(edit.action!=='add'&&typeof target!=='string')||changed.has(changeKey))throw Error('AI returned an unknown or repeated topic change. Your current plan is kept.');changed.add(changeKey);
  const index=units.findIndex(u=>u.id===target);
  if(edit.action==='remove'){if(index<0)throw Error('AI tried to remove an unknown topic.');if(programme.guides?.[target])throw Error('A topic with a saved guide cannot be removed by AI. Keep it or move its statements manually.');units.splice(index,1);continue;}
  if(edit.action==='update'&&index<0)throw Error('AI tried to change an unknown topic.');
  if(edit.action==='add'&&index>=0)throw Error('AI tried to add a topic with an existing ID.');
  const u=edit.action==='add'?{id:'revision-'+crypto.randomUUID(),title:'',subject:programme.subjects,year:7,term:1,duration:'',rationale:'',knowledge:[],practices:[],selectedKnowledge:[],selectedPractices:[]}:units[index];
  const oldYear=u.year;
  for(const key of ['title','subject','duration','rationale'])if(edit[key]!==undefined){if(typeof edit[key]!=='string')throw Error('AI returned an invalid topic detail.');u[key]=edit[key];}
  for(const key of ['year','term'])if(edit[key]!==undefined)u[key]=edit[key];
  for(const [key,refs,kind,selection]of [['knowledge','knowledgeRefs','knowledge','selectedKnowledge'],['practices','practiceRefs','practice','selectedPractices']])if(edit[refs]!==undefined){
   if(!Array.isArray(edit[refs]))throw Error('AI returned invalid curriculum references.');
   u[key]=[...new Set(edit[refs])].map(ref=>{const r=bank.records[ref-1];if(!Number.isInteger(ref)||!r||r.kind!==kind)throw Error('AI selected an unknown or incorrect curriculum reference. Source wording is protected.');return {id:r.id,text:r.text,subject:r.subject,source:r.source};});u[selection]=u[key].map(s=>s.id);
  }
  if(edit.action==='add')units.push(u);
  if(oldYear!==u.year)warnings.push(u.title+': the teaching year changed. Check the source-year requirements and prerequisite learning before accepting.');
 }
 validateOverview({units});
 const used=new Set(units.flatMap(u=>[...u.knowledge,...u.practices]).map(recordKey));
 const lost=bank.records.filter(r=>existingUsed.has(recordKey(r))&&!used.has(recordKey(r)));
 if(lost.length)warnings.push(...lost.map(r=>'No longer mapped '+r.kind+': '+r.text+' — '+r.source));
 const missing=bank.records.filter(r=>!used.has(recordKey(r))&&!existingUsed.has(recordKey(r)));
 if(missing.length)warnings.push(...missing.map(r=>'Still unallocated '+r.kind+': '+r.text+' — '+r.source));
 return {units,warnings:[...new Set(warnings)],message:response.message};
}
export async function reviseOverview(programme,prompt,history,env,provider,{stream=true,onProgress=()=>{},signal}={}){
 validateOverview(programme);if(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)throw Error('Describe the changes you want using up to 4,000 characters.');
 const additional=[],sourceWarnings=[];if((programme.catalogueIds||[]).length||(programme.sources||[]).length||programme.curriculumText?.trim())for(const year of [...new Set(programme.units.map(u=>u.year))]){const bank=await storedLibraryRecords(programme,year,env);sourceWarnings.push(...bank.warnings);for(const record of bank.records)additional.push({record,year});}
 const bank={...revisionRecords(programme.units,additional),sourceWarnings};
 const messages=Array.isArray(history)?history.slice(-8).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,4000)})):[];
 const indexed=bank.records.map((r,i)=>[i+1,r.kind==='knowledge'?'K':'P',r.subject,r.years,r.section,r.text]);
 const content=[{type:'text',text:`Revise the existing overview in response to the staff request. Return a message, changes array and warnings in this shape: ${JSON.stringify(revisionShape)}. Changes are patches, not a replacement of the whole programme. Use action update or remove with the numeric unitRef from CURRENT TOPICS. Use add for a new topic without a unitRef; the server creates its ID. Never return or change internal topic IDs. Include only fields being changed. Available optional fields: title, subject, year, term, duration, rationale, knowledgeRefs and practiceRefs. New topics need a title, year, term and appropriate statement references. References are positions in the supplied statement list. Knowledge and practice references must match their type. Never generate or edit source statement wording. Do not remove a topic with a saved guide. Preserve all other units and meaningful curriculum coverage. A term can contain more than one topic. Retain applicable review notes and replace outdated ones. Flag workload assumptions, unallocated statements and any changes to official source-year placement. Use the conversation as context, with the latest request as the change to apply. If a request cannot be met from the supplied curriculum, return no changes and explain why.\nCURRENT TOPICS: ${JSON.stringify(bank.currentUnits.map(({id,...u},i)=>({...u,unitRef:i+1,savedGuide:!!programme.guides?.[id]})))}\nSTATEMENT RECORDS [ref,K/P,subject,availableYears,section,text]: ${JSON.stringify(indexed)}\nCURRENT REVIEW NOTES: ${JSON.stringify(programme.overviewWarnings||[])}\nRECENT CONVERSATION: ${JSON.stringify(messages)}\nLATEST STAFF REQUEST: ${JSON.stringify(prompt.trim())}`}];
 const response=await generateWithProvider({config:provider,content,system:programmeRules+'\nRevise only the department proposal. Teacher assessment and saved topic guides must remain unchanged. The server inserts all original statement wording.',maxTokens:7000,stream,onProgress,signal});
 console.info(JSON.stringify({event:'ai_usage',provider:provider.id,operation:'revise-overview',inputTokens:response.usage?.input_tokens,outputTokens:response.usage?.output_tokens}));
 if(response.stop_reason!=='end_turn')throw Error('AI did not finish the revision. Your existing proposal is kept.');
 let parsed;try{parsed=JSON.parse(response.content.filter(b=>b.type==='text').map(b=>b.text).join('').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('AI returned an invalid revision. Your current proposal is kept.');}
 return applyOverviewRevision(parsed,programme,bank);
}
