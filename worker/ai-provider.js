import {readClaudeStream,readGeminiStream} from './generation-stream.js';

export function providerConfig(env){
 const id=env.AI_PROVIDER||'claude';
 if(!['claude','gemini'].includes(id))throw Error('The administrator needs to choose a supported AI provider.');
 const label=id==='gemini'?'Gemini':'Claude';
 const key=id==='gemini'?env.GEMINI_API_KEY:env.ANTHROPIC_API_KEY;
 const model=id==='gemini'?(env.GEMINI_MODEL||'gemini-3.8-flash'):env.CLAUDE_MODEL;
 if(model&&!/^[a-zA-Z0-9._-]+$/.test(model))throw Error('The configured AI model ID is invalid.');
 return {id,label,key,model,configured:!!(key&&model)};
}

export function schemaFromExample(value){
 if(Array.isArray(value))return {type:'array',items:schemaFromExample(value[0]??'')};
 if(value!==null&&typeof value==='object')return {type:'object',properties:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,schemaFromExample(item)])),required:Object.keys(value),additionalProperties:false};
 return {type:typeof value==='number'?(Number.isInteger(value)?'integer':'number'):'string'};
}

// Keep only non-sensitive quota fields. Never retain the provider's full error body.
export function quotaDetails(failure,headers){
 const details=Array.isArray(failure.error?.details)?failure.error.details:[];
 const violations=details.flatMap(d=>Array.isArray(d.violations)?d.violations:[]);
 const limits=violations.map(v=>{const name=String(v.quotaId||'').toLowerCase(),metric=String(v.quotaMetric||'').toLowerCase();const period=/perday|per_day|daily/.test(name)?'day':/perminute|per_minute/.test(name)?'minute':'unknown';return {period,resource:/input.*token/.test(metric+' '+name)?'input tokens':/token/.test(metric+' '+name)?'tokens':/request/.test(metric+' '+name)?'requests':'usage',...(Number.isFinite(Number(v.quotaValue))?{limit:Number(v.quotaValue)}:{})};});
 const delay=details.find(d=>/RetryInfo$/.test(String(d['@type']||'')))?.retryDelay;
 const numeric=typeof delay==='string'&&/^\d+(?:\.\d+)?s$/.test(delay)?Math.ceil(parseFloat(delay)):Number(headers?.get('retry-after'));
 const retryAfterSeconds=Number.isFinite(numeric)&&numeric>0?Math.min(86400,numeric):undefined;
 return {limits,...(retryAfterSeconds?{retryAfterSeconds}:{})};
}
export function quotaMessage(label,quota){
 const daily=quota.limits.some(q=>q.period==='day'),minute=quota.limits.some(q=>q.period==='minute');
 const resources=[...new Set(quota.limits.map(q=>q.resource))].join(' and ');
 const reason=daily?'daily '+(resources||'usage')+' allowance':minute?'per-minute '+(resources||'usage')+' limit':'request or token quota';
 const dashboard=label==='Gemini'?'Google AI Studio':label+'’s usage dashboard';
 const next=daily?'Check the daily reset in '+dashboard+'; a short pause will not reset a daily allowance.':quota.retryAfterSeconds?`Wait at least ${quota.retryAfterSeconds} seconds before resuming; other limits may still apply.`:minute?'Pause before resuming the remaining work.':'Check the rate limits in '+dashboard+' to see which allowance was reached.';
 return label+'’s '+reason+' was reached. '+next+' Completed steps and guides are saved.';
}

export async function generateWithProvider({config,content,system,schema,maxTokens,stream,onProgress,signal,thinkingLevel,effort}){
 let url,headers,body;
 if(config.id==='gemini'){
  url='https://generativelanguage.googleapis.com/v1beta/models/'+config.model+':'+(stream?'streamGenerateContent?alt=sse':'generateContent');
  headers={'Content-Type':'application/json','x-goog-api-key':config.key};
  const parts=content.map(block=>block.type==='document'?{inlineData:{mimeType:'application/pdf',data:block.source.data}}:{text:block.text});
  body={systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:maxTokens,...(thinkingLevel&&config.model==='gemini-3.8-flash'?{thinkingConfig:{thinkingLevel}}:{})}};
 }else{
  url='https://api.anthropic.com/v1/messages';
  headers={'Content-Type':'application/json','x-api-key':config.key,'anthropic-version':'2023-06-01'};
  body={model:config.model,stream,max_tokens:maxTokens,...(config.model==='claude-sonnet-5-5'?{output_config:{effort:effort||'medium'},...(effort==='low'?{thinking:{type:'between_tools'}}:{})}:{}),system,messages:[{role:'user',content}]};
 }
 // Provider selection is explicit. Never retry through a different account.
 const upstream=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(210000)]):AbortSignal.timeout(105000)});
 if(!upstream.ok){
  const failure=await upstream.json().catch(()=>({}));
  const detail=String(failure.error?.message||'').replace(/sk-ant-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+|AQ\.[A-Za-z0-9._-]+/g,'[redacted]').slice(0,500);
  const quota=upstream.status===429?quotaDetails(failure,upstream.headers):undefined;
  console.warn(JSON.stringify({event:'ai_failure',provider:config.id,status:upstream.status,errorType:failure.error?.type||failure.error?.status,...(quota?{quota}:{})}));
  let message;
  if(upstream.status===429)message=quotaMessage(config.label,quota);
  else if([401,403].includes(upstream.status))message=config.label+' rejected the API key or its permissions. Ask the administrator to check the server-side key and API access.';
  else if(upstream.status===524)message=config.label+' timed out before returning a complete response. Completed years and guides have been kept. Try again to resume.';
  else if(upstream.status>=500)message=config.label+'’s service could not finish this request. Completed years and guides have been kept. Try again to resume.';
  else if(/credit|balance|billing/i.test(detail))message=config.label+'’s API account needs credit or billing configuration. Ask school IT to check the account. Your saved work has been kept.';
  else message=config.label+' rejected this request: '+(detail||'Check the model and input size.');
  throw Object.assign(Error(message),{status:502});
 }
 if(config.id==='claude')return stream?readClaudeStream(upstream,onProgress):upstream.json();
 if(stream)return readGeminiStream(upstream,onProgress);
 const response=await upstream.json(),candidate=response.candidates?.[0];
 if(response.promptFeedback?.blockReason)throw Error('Gemini could not generate from these inputs. Review the sources; your saved work has been kept.');
 const text=(candidate?.content?.parts||[]).filter(part=>!part.thought).map(part=>part.text||'').join('');
 return {stop_reason:candidate?.finishReason==='STOP'?'end_turn':candidate?.finishReason||'incomplete',content:[{type:'text',text}],usage:response.usageMetadata||{}};
}
