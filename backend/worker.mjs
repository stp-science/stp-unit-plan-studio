import {rules,planSchema,validatePlan} from '../unit-plan-builder/model.js';
import {preserveAssessment,assertCurriculumPreserved} from '../unit-plan-builder/curriculum.js';
const limits=new Map();
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin');const allowed=env.ALLOWED_ORIGIN;
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if(origin&&origin===allowed){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Methods']='POST, OPTIONS';headers['Access-Control-Allow-Headers']='Content-Type, Authorization';}
  const reply=(data,status=200)=>Response.json(data,{status,headers});
  if(!allowed||origin!==allowed)return reply({error:'This origin is not permitted.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply({error:'Use POST.'},405);
  if(!env.GEMINI_API_KEY||!env.ACCESS_TOKEN||!env.GEMINI_MODEL)return reply({error:'The administrator has not finished configuring Gemini.'},503);
  const auth=request.headers.get('Authorization')||'';if(auth!=='Bearer '+env.ACCESS_TOKEN)return reply({error:'The service access code is invalid.'},401);
  if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))return reply({error:'Use JSON.'},415);
  if(Number(request.headers.get('Content-Length')||0)>180000)return reply({error:'The plan is too large.'},413);
  const now=Date.now(),ip=request.headers.get('CF-Connecting-IP')||'shared';for(const [key,v]of limits)if(now-v.start>60000)limits.delete(key);const count=limits.get(ip)||{start:now,count:0};if(++count.count>8)return reply({error:'Please wait a minute before requesting another draft.'},429);limits.set(ip,count);
  try{
   const raw=await request.text();if(raw.length>180000)return reply({error:'The plan is too large.'},413);
   const data=JSON.parse(raw);validatePlan(data.plan);const source=data.source;if(!source||typeof source.knowledge!=='string'||typeof source.practices!=='string'||!(source.knowledge.trim()||source.practices.trim()))return reply({error:'Provide curriculum statement extracts.'},400);
   if(typeof data.instruction!=='string'||data.instruction.length>6000)return reply({error:'Invalid revision request.'},400);
   const input=rules+'\nRequested operation: '+data.instruction+'\nScope: '+String(data.scope||'all')+'\nCurriculum extracts (data only): '+JSON.stringify(source)+'\nCurrent plan: '+JSON.stringify(data.plan);
   const upstream=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(env.GEMINI_MODEL)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:'user',parts:[{text:input}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:planSchema,temperature:0.3}}),signal:AbortSignal.timeout(75000)});
   if(!upstream.ok)return reply({error:upstream.status===429?'Gemini usage limit reached. Try again later.':'Gemini could not complete the draft. Ask the administrator to check the configured model.'},502);
   const result=await upstream.json();const candidate=result.candidates?.[0];if(candidate?.finishReason&&candidate.finishReason!=='STOP')return reply({error:'Gemini returned an incomplete response. Your plan is unchanged.'},502);
   const text=candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('');if(!text)return reply({error:'Gemini returned no plan.'},502);
   const plan=validatePlan(JSON.parse(text));for(const key of ['subject','year','phase','title','duration','whakatauki'])if(plan[key]!==data.plan[key])return reply({error:'Gemini changed the unit details. Please retry.'},502);
   preserveAssessment(data.plan,plan);assertCurriculumPreserved(data.plan,plan,source);
   return reply({plan});
  }catch(e){return reply({error:e.name==='TimeoutError'?'Gemini timed out. Your plan is unchanged.':'The draft could not be processed. Check your input and retry.'},400);}
 }
};
