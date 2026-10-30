export async function readClaudeStream(response,onProgress=()=>{}){
 const reader=response.body.getReader(),decoder=new TextDecoder(),blocks=new Map();let pending='',stopReason,usage={};
 function event(packet){
  const raw=packet.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!raw)return;
  const e=JSON.parse(raw);
  if(e.type==='error')throw Error('Claude’s service interrupted generation. Completed years and guides have been kept. Try again to resume.');
  if(e.type==='message_start')usage=e.message?.usage||{};
  if(e.type==='content_block_start'&&e.content_block?.type==='text')blocks.set(e.index,e.content_block.text||'');
  if(e.type==='content_block_delta'&&e.delta?.type==='text_delta'){blocks.set(e.index,(blocks.get(e.index)||'')+e.delta.text);onProgress();}
  if(e.type==='message_delta'){stopReason=e.delta?.stop_reason||stopReason;usage={...usage,...e.usage};}
 }
 try{while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let boundary;while((boundary=/\r?\n\r?\n/.exec(pending))){event(pending.slice(0,boundary.index));pending=pending.slice(boundary.index+boundary[0].length);}}
  pending+=decoder.decode();if(pending.trim())event(pending);
 }finally{reader.releaseLock();}
 if(!stopReason)throw Error('Claude’s response ended unexpectedly. Completed years and guides have been kept. Try again to resume.');
 return {stop_reason:stopReason,usage,content:[...blocks].sort((a,b)=>a[0]-b[0]).map(([,text])=>({type:'text',text}))};
}

export function generationStream(generate){
 const encoder=new TextEncoder(),abort=new AbortController();let active=true,timer;
 const stream=new ReadableStream({
  start(controller){
   const send=data=>{if(active)controller.enqueue(encoder.encode(JSON.stringify(data)+'\n'));};
   send({type:'started'});timer=setInterval(()=>send({type:'heartbeat'}),10000);
   let lastProgress=0;const progress=()=>{if(Date.now()-lastProgress>1500){lastProgress=Date.now();send({type:'progress'});}};
   Promise.resolve().then(()=>generate(progress,abort.signal)).then(result=>send({type:'result',result})).catch(e=>send({type:'error',error:e.name==='TimeoutError'?'Claude took too long on this year. Completed years and guides have been kept. Try again to resume.':e.message||'Generation could not finish. Your saved work has been kept.'})).finally(()=>{clearInterval(timer);if(active){active=false;controller.close();}});
  },
  cancel(){active=false;clearInterval(timer);abort.abort();}
 });
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff'}});
}
