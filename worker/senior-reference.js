import {seniorCatalogue,readSeniorSource} from './senior-catalogue-data.js';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function relevantSeniorDocuments(programme,unit=null){
 const names=[...(programme.disciplines||[]),programme.languageSubject,unit?.subject,programme.subjects].filter(Boolean).map(norm);
 const area=programme.learningArea||'';
 return seniorCatalogue.documents.filter(d=>d.availableForProgression&&(d.learningArea===area||names.some(n=>n===norm(d.learningArea)||norm(d.subject).includes(n)||n.includes(norm(d.subject)))))
 .filter(d=>{if(d.learningArea==='Learning Languages')return names.some(n=>n===norm(d.subject));if(d.learningArea==='The Arts'&&(programme.disciplines||[]).length)return programme.disciplines.some(s=>norm(d.subject).startsWith(norm(s)));return true;});
}
export async function seniorProgressionEvidence(programme,unit=null){
 const docs=relevantSeniorDocuments(programme,unit);if(!docs.length)return [];
 const words=new Set(norm([unit?.title,unit?.subject,programme.subjects,...(unit?.knowledge||[]).map(s=>s.text),...(unit?[]:(programme.units||[]).map(u=>u.title))].join(' ')).match(/[a-z]{4,}/g)||[]);
 for(const w of ['curriculum','knowledge','practices','students','their','these','learning','years','science','sciences','social','technology','mathematics','statistics','languages','arts','subject','understand','using','school','education','about','different','which','through','with','from','that','this'])words.delete(w);
 const ranked=[];
 for(const d of docs){const body=await readSeniorSource(d.id);const pages=body.pages.filter(p=>p.page>2).map(p=>({p,score:[...words].filter(w=>norm(p.text).includes(w)).length})).sort((a,b)=>b.score-a.score||a.p.page-b.p.page);ranked.push({d,pages,score:(d.years.includes(11)?8:0)+[...words].filter(w=>norm(d.subject).includes(w)).length*20+(pages[0]?.score||0)*3});}
 ranked.sort((a,b)=>b.score-a.score);
 let budget=90000;const result=[];
 for(const {d,pages:rankedPages}of ranked.slice(0,4)){const pages=[];for(const {p}of rankedPages.slice(0,3)){if(p.text.length>budget)continue;budget-=p.text.length;pages.push(p);}if(pages.length)result.push({metadata:d,scope:'Senior source excerpts for connections to future learning ONLY. Not Years 7–10 requirements; not an assessment specification. Excerpts are partial and do not describe every senior pathway.',pages:pages.sort((a,b)=>a.page-b.page)});}
 return result;
}
