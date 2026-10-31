import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import vm from 'node:vm';
import {overviewWord,statementsWord} from '../programme/overview-export.js';
const sandbox={setImmediate,Buffer,Blob,Uint8Array,ArrayBuffer};vm.runInNewContext(await readFile('unit-plan-builder/vendor/jszip.min.js','utf8'),sandbox);globalThis.JSZip=sandbox.JSZip;
const source=JSON.parse(await readFile('unit-plan-builder/science-curriculum.json','utf8'));
const units=source.units.map((u,i)=>({...u,id:'test-'+i,title:u.title||u.name,term:u.term||i%4+1,subject:'Science',duration:u.duration||'8–9 weeks',knowledge:(u.knowledge||[]).map(s=>({...s,subject:'Science',source:'Ministry Science August 2026, page '+s.page})),practices:(u.practices||[]).map(s=>({...s,subject:'Science',source:'Ministry Science August 2026, page '+s.page}))}));
const p={name:'Junior Science 2027',subjects:'Science',units,overviewWarnings:['Review teaching time and sequence.']};
const overview=await overviewWord(p),statements=await statementsWord(p);
const unzip=async blob=>(await sandbox.JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml').async('string');
const [a,b]=await Promise.all([unzip(overview),unzip(statements)]);
assert(a.includes('landscape'));assert(!b.includes('landscape'));assert(a.includes('Term 4'));assert(b.includes('Practice statements'));
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
for(const u of units){assert(a.includes(esc(u.title)));for(const s of [...u.knowledge,...u.practices])assert(b.includes(esc(s.text)));}
if(process.env.EXPORT_QA_DIR){const dir=process.env.EXPORT_QA_DIR;await mkdir(dir,{recursive:true});await writeFile(dir+'/overview.docx',Buffer.from(await overview.arrayBuffer()));await writeFile(dir+'/statements.docx',Buffer.from(await statementsWord({...p,units:units.filter(u=>u.year===7)}).then(b=>b.arrayBuffer())));}
console.log('Both Word exports retain every topic and full stored statement; orientation and separate content checked.');
