import {validatePlan,focusFields} from './model.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children=(n,tag)=>Array.from(n.children).filter(c=>c.namespaceURI===W&&c.localName===tag);
const desc=(n,tag)=>Array.from(n.getElementsByTagNameNS(W,tag));
const text=n=>desc(n,'t').map(x=>x.textContent).join('');
function paragraph(doc,base,value,regular=false){
 const p=base?base.cloneNode(true):doc.createElementNS(W,'w:p');
 for(const c of [...p.childNodes])if(!(c.nodeType===1&&c.localName==='pPr'))p.removeChild(c);
 const original=base&&desc(base,'r')[0];const r=doc.createElementNS(W,'w:r');
 const rp=original&&children(original,'rPr')[0];if(rp)r.appendChild(rp.cloneNode(true));
 if(regular){let pr=children(r,'rPr')[0];if(!pr){pr=doc.createElementNS(W,'w:rPr');r.appendChild(pr);}for(const [tag,v]of [['sz','15'],['szCs','15'],['b','0'],['i','0'],['color','000000']]){for(const n of children(pr,tag))n.remove();const n=doc.createElementNS(W,'w:'+tag);n.setAttributeNS(W,'w:val',v);pr.appendChild(n);}for(const n of children(pr,'rFonts'))n.remove();const fonts=doc.createElementNS(W,'w:rFonts');for(const a of ['ascii','hAnsi','cs','eastAsia'])fonts.setAttributeNS(W,'w:'+a,'Lexend');pr.prepend(fonts);let pp=children(p,'pPr')[0];if(!pp){pp=doc.createElementNS(W,'w:pPr');p.prepend(pp);}for(const n of children(pp,'jc'))n.remove();const jc=doc.createElementNS(W,'w:jc');jc.setAttributeNS(W,'w:val','left');pp.appendChild(jc);for(const n of children(pp,'ind'))n.remove();}
 String(value).split('\n').forEach((line,i)=>{if(i)r.appendChild(doc.createElementNS(W,'w:br'));const t=doc.createElementNS(W,'w:t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=line;r.appendChild(t);});p.appendChild(r);return p;
}
function fill(doc,cell,value,keepHeading=false,regular=true){
 const ps=children(cell,'p');const heading=keepHeading&&ps[0]?ps[0].cloneNode(true):null;
 const base=ps.at(-1)||ps[0];
 for(const c of [...cell.childNodes])if(!(c.nodeType===1&&c.localName==='tcPr'))cell.removeChild(c);
 if(heading)cell.appendChild(heading);
 for(const line of String(value||'').split('\n'))cell.appendChild(paragraph(doc,base,line,regular));
}
function fillOptions(doc,cell,value){
 const selected=new Set(String(value||'').split('\n').filter(Boolean));
 const options=children(cell,'p').filter(p=>text(p).includes('☐')).map(p=>p.cloneNode(true));
 fill(doc,cell,'');
 for(const p of options){const label=text(p).replace('☐','').trim();if(selected.has(label))for(const t of desc(p,'t'))t.textContent=t.textContent.replace('☐','☒');cell.appendChild(p);}
}
export async function createWord(plan,templateBytes,source={}){
 validatePlan(plan);
 const zip=await JSZip.loadAsync(templateBytes);const xml=await zip.file('word/document.xml').async('string');
 const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('The Word template could not be read.');
 const body=desc(doc,'body')[0];const tables=children(body,'tbl');if(tables.length!==10)throw Error('This template version is not supported.');
 const cell=(ti,ri,ci)=>children(children(tables[ti],'tr')[ri],'tc')[ci];
 const head=cell(0,0,0);const hp=children(head,'p');
 for(const p of hp){let s=text(p),v;
  if(s.startsWith('Curriculum phase:'))v='Curriculum phase: '+plan.phase+(s.includes('Year level:')?'\nYear level: '+plan.year:'');
  else if(s.startsWith('Year level:'))v='Year level: '+plan.year;
  else if(s.startsWith('Unit title:'))v='Unit title: '+plan.title;
  else if(s.includes('whakatauk'))v="The Learning Area's whakataukii is: "+plan.whakatauki;
  if(v!==undefined)p.replaceWith(paragraph(doc,p,v));
 }
 for(const p of children(body,'p'))if(text(p).startsWith('Anticipated duration'))p.replaceWith(paragraph(doc,p,'Anticipated duration of unit: '+plan.duration));
 fill(doc,cell(1,0,0),plan.purpose);
 for(const p of desc(tables[2],'p')){const s=text(p);if(plan.capabilities.some(name=>s.includes(name+' ')))for(const t of desc(p,'t'))if(t.textContent.includes('☐'))t.textContent=t.textContent.replace('☐','☒');}
 fill(doc,cell(3,1,0),plan.prior);fill(doc,cell(3,1,1),plan.future);fill(doc,cell(3,1,2),'');
 fill(doc,cell(4,1,0),plan.knowledgeSummary);fill(doc,cell(4,1,1),plan.practicesSummary);
 // Keep the first focus's table and the original continuation table. Clone their formatted rows.
 const first=tables[5],continuation=tables[6];const [titleRow,dataRow]=children(first,'tr').map(n=>n.cloneNode(true));
 for(const row of children(first,'tr'))row.remove();for(const row of children(continuation,'tr'))row.remove();
 plan.focuses.forEach((f,i)=>{const target=i===0?first:continuation;const tr=titleRow.cloneNode(true),dr=dataRow.cloneNode(true);
  fill(doc,children(tr,'tc')[0],`Learning Focus ${i+1} – ${f.title}`,false,false);
  Object.keys(focusFields).forEach((key,j)=>fill(doc,children(dr,'tc')[j],f[key],true));
  target.append(tr,dr);
 });
 if(plan.focuses.length===1)continuation.remove();
 fill(doc,cell(7,0,0),plan.resources);fill(doc,cell(8,1,0),plan.assessment);
 // Preserve assessment and reporting options, including any manual selections in the text.
 fillOptions(doc,cell(8,1,1),plan.descriptors);fillOptions(doc,cell(8,1,2),plan.reporting);
 // Keep assessment headings with their row when a longer unit continues onto another page.
 for(const p of desc(children(tables[8],'tr')[0],'p')){let pp=children(p,'pPr')[0];if(!pp){pp=doc.createElementNS(W,'w:pPr');p.prepend(pp);}let flag=children(pp,'keepNext')[0];if(!flag){flag=doc.createElementNS(W,'w:keepNext');pp.appendChild(flag);}flag.setAttributeNS(W,'w:val','1');}
 for(const row of children(tables[8],'tr')){let pr=children(row,'trPr')[0];if(!pr){pr=doc.createElementNS(W,'w:trPr');row.prepend(pr);}if(!children(pr,'cantSplit').length)pr.appendChild(doc.createElementNS(W,'w:cantSplit'));}
 for(const p of children(body,'p'))if(['RESOURCES OPTIONAL','ASSESSMENT & REPORTING / MAU','REVIEW / NEXT STEPS / TIPU'].includes(text(p))){let pp=children(p,'pPr')[0];if(!pp){pp=doc.createElementNS(W,'w:pPr');p.prepend(pp);}let flag=children(pp,'keepNext')[0];if(!flag){flag=doc.createElementNS(W,'w:keepNext');pp.appendChild(flag);}flag.setAttributeNS(W,'w:val','1');}
 fill(doc,cell(9,0,0),'');
 zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));
 // Clear author information without changing any visible template component.
 const core=zip.file('docProps/core.xml');if(core||source.title){const c=new DOMParser().parseFromString(core?await core.async('string'):'<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"/>','application/xml');for(const n of [...c.getElementsByTagName('dc:creator'),...c.getElementsByTagName('cp:lastModifiedBy')])n.textContent='';if(source.title){let description=c.getElementsByTagName('dc:description')[0];if(!description){description=c.createElementNS('http://purl.org/dc/elements/1.1/','dc:description');c.children[0].appendChild(description);}description.textContent=`Curriculum source: Ministry of Education. ${source.title}. ${source.url||''}. ${source.license||''}`;}zip.file('docProps/core.xml',new XMLSerializer().serializeToString(c));}
 if(source.title&&!core){const rel=zip.file('_rels/.rels');if(rel){let text=await rel.async('string');if(!text.includes('metadata/core-properties'))text=text.replace('</Relationships>','<Relationship Id="rIdSTPCurriculumSource" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');zip.file('_rels/.rels',text);}const types=zip.file('[Content_Types].xml');if(types){let text=await types.async('string');if(!text.includes('/docProps/core.xml'))text=text.replace('</Types>','<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');zip.file('[Content_Types].xml',text);}}
 return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE'});
}
