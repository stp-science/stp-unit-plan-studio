const xml=s=>String(s??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const paragraph=(text,style='',options={})=>`<w:p><w:pPr>${style?`<w:pStyle w:val="${style}"/>`:''}${options.center?'<w:jc w:val="center"/>':''}${options.keep?'<w:keepNext/>':''}</w:pPr><w:r><w:rPr>${options.bold?'<w:b/>':''}${options.white?'<w:color w:val="FFFFFF"/>':''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
const reviewLabel=p=>p.reviewStatus||'Draft for department review';
const sortedUnits=p=>[...p.units].sort((a,b)=>a.year-b.year||a.term-b.term);
const topicCell=(content,width,fill)=>`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/>${fill?`<w:shd w:fill="${fill}"/>`:''}</w:tcPr>${content||paragraph('No topics mapped','Small')}</w:tc>`;
const borders=['top','left','bottom','right','insideH','insideV'].map(edge=>`<w:${edge} w:val="single" w:sz="6" w:color="D9D9D9"/>`).join('');
export async function overviewWord(p){
 let body=paragraph('Curriculum topic overview','Title')+paragraph(p.name,'Subtitle')+paragraph([p.subjects,reviewLabel(p)].filter(Boolean).join('  |  '),'Small')+paragraph('Topics are shown in teaching order within each term. Review the full knowledge and practice statements in the companion document.','Small');
 if(p.teachingTime)body+=paragraph('Teaching time  '+p.teachingTime,'Small');
 const widths=[1100,3216,3216,3217,3217];
 const header='<w:tr><w:trPr><w:tblHeader/></w:trPr>'+['Year','Term 1','Term 2','Term 3','Term 4'].map((t,i)=>topicCell(paragraph(t,'TableHead',{bold:true,white:true,center:i===0}),widths[i],'273641')).join('')+'</w:tr>';
 const rows=[7,8,9,10].map((year,i)=>'<w:tr><w:trPr><w:cantSplit/></w:trPr>'+topicCell(paragraph('Year '+year,'TableText',{bold:true,center:true}),widths[0],i%2?'F1F4F6':'FFFFFF')+[1,2,3,4].map((term,j)=>topicCell(p.units.filter(u=>u.year===year&&u.term===term).map(u=>paragraph(u.title,'TableText',{bold:true})).join(''),widths[j+1],i%2?'F1F4F6':'FFFFFF')).join('')+'</w:tr>').join('');
 body+=`<w:tbl><w:tblPr><w:tblW w:w="13966" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="145" w:type="dxa"/><w:left w:w="145" w:type="dxa"/><w:bottom w:w="145" w:type="dxa"/><w:right w:w="145" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${header}${rows}</w:tbl>`;
 body+=paragraph('Review the sequence, workload and curriculum coverage before confirming the programme. Assessment decisions remain with staff.','Small');
 if(p.overviewWarnings?.length)body+=paragraph(p.overviewWarnings.length+' review note(s) are included in the full statement document.','Small');
 return wordPackage(body,true);
}
export async function statementsWord(p){
 let body=paragraph('Curriculum knowledge and practice statements','Title')+paragraph(p.name,'Subtitle')+paragraph([p.subjects,reviewLabel(p)].filter(Boolean).join('  |  '),'Small')+paragraph('This document lists the full mapped statements for every topic. Check wording, sources, coverage and sequence before approving the programme. Statements may appear in more than one topic where they are revisited purposefully.','Normal');
 if(p.teachingTime)body+=paragraph('Teaching time  '+p.teachingTime);
 for(const year of [7,8,9,10]){
  const units=sortedUnits(p).filter(u=>u.year===year);body+=paragraph('Year '+year,'Heading1');
  if(!units.length){body+=paragraph('No topics mapped for this year.');continue;}
  for(const term of [1,2,3,4]){const topics=units.filter(u=>u.term===term);if(!topics.length)continue;body+=paragraph('Term '+term,'Heading2');
   for(const u of topics){body+=paragraph(u.title,'Heading3')+paragraph([u.subject||p.subjects,u.duration].filter(Boolean).join('  |  '),'Small',{keep:true});if(u.rationale)body+=paragraph(u.rationale);
    for(const [key,title]of [['knowledge','Knowledge statements'],['practices','Practice statements']]){body+=paragraph(title,'Heading4');if(!u[key].length)body+=paragraph('No statements mapped. Review this topic before generating its guide.','Small');for(const s of u[key])body+=paragraph('• '+s.text,'Statement',{keep:true})+paragraph([s.subject||u.subject||p.subjects,s.source||'Source not supplied — check before approval'].filter(Boolean).join('  |  '),'Source');}
   }
  }
 }
 if(p.overviewWarnings?.length){body+=paragraph('Department review notes','Heading1');for(const warning of p.overviewWarnings)body+=paragraph(warning);}
 return wordPackage(body,false);
}
async function wordPackage(body,landscape){
 const zip=new JSZip(),type='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
 zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/_rels/document.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
 const size=landscape?'<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>':'<w:pgSz w:w="12240" w:h="15840"/>';
 zip.file('word/document.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr>'+size+'<w:pgMar w:top="936" w:right="936" w:bottom="936" w:left="936"/></w:sectPr></w:body></w:document>');
 const styles=[['Title',32,true,0,160],['Subtitle',25,true,0,140],['Heading1',28,true,260,120],['Heading2',25,true,200,100],['Heading3',23,true,180,80],['Heading4',22,true,120,60],['Normal',22,false,0,120],['Small',19,false,0,100],['Statement',22,false,0,30],['Source',17,false,0,130],['TableHead',22,true,0,0],['TableText',21,false,0,80],['TableSmall',18,false,0,120]];
 zip.file('word/styles.xml','<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'+styles.map(([name,size,bold,before,after])=>`<w:style w:type="paragraph" w:styleId="${name}"><w:name w:val="${name}"/><w:pPr>${name.startsWith('Heading')?'<w:keepNext/>':''}<w:spacing w:before="${before}" w:after="${after}"/></w:pPr><w:rPr>${bold?'<w:b/>':''}<w:color w:val="000000"/><w:sz w:val="${size}"/></w:rPr></w:style>`).join('')+'</w:styles>');
 return zip.generateAsync({type:'blob',mimeType:type});
}
