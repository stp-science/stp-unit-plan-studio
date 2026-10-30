import http from 'node:http';
import worker from '../worker/index.js';
const portArg=process.argv.indexOf('--port');
const port=Number(portArg>=0?process.argv[portArg+1]:process.env.PORT||5173);
http.createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(body.length?{body}: {})});const response=await worker.fetch(request,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end('Preview request failed');}}).listen(port,'0.0.0.0',()=>console.log('Preview listening on '+port));
