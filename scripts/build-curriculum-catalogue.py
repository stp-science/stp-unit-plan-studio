"""Build a versioned, attributed curriculum source catalogue from authorised source files.
PDF originals are read locally; only text derivatives are published. Website extracts
are captured from rendered official pages with all curriculum sections expanded.
"""
import argparse,json,hashlib,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument('--science-pdf',required=True);p.add_argument('--arts-pdf',required=True);p.add_argument('--web-directory',required=True);a=p.parse_args()
root=pathlib.Path('curriculum-catalogue');root.mkdir(exist_ok=True)
base='https://newzealandcurriculum.tahurangi.education.govt.nz'
license_url=base+'/copyright'
source_date='2026-10-30'
meta=[];content={}
def entry(id,area,title,url,status,version,subjects=None):
 d={'id':id,'learningArea':area,'title':title,'sourceUrl':url,'status':status,'version':version,'checkedOn':source_date,'yearRange':'Years 0–10','subjects':subjects or [area],'attribution':'Ministry of Education, Crown copyright','licence':'CC BY-NC 4.0, unless otherwise specified','licenceUrl':license_url,'availableForAi':status=='ready'};meta.append(d);return d
def pdf(id,area,title,path,url,version,subjects=None):
 d=entry(id,area,title,url,'ready',version,subjects);raw=pathlib.Path(path).read_bytes();text=subprocess.check_output(['pdftotext','-layout',str(path),'-']).decode();pages=text.split('\f');
 if not pages[-1].strip():pages.pop()
 body={'format':'PDF page text with column spacing retained','extractionNote':'Text extraction retains page numbers and column spacing. Check the original PDF when table associations are uncertain. No logos or images are reproduced.','pages':[{'page':i+1,'text':s.rstrip()} for i,s in enumerate(pages)]}
 d.update({'sourceFormat':'PDF text','pageCount':len(pages),'sha256Original':hashlib.sha256(raw).hexdigest(),'acquisition':'Previously supplied Ministry PDF; official download section currently lists no files.','publicationStatus':'Published Ministry content; document states proposed National Curriculum Statement, pending gazettal.'})
 content[id]=body
pdf('science-aug-2026','Science','The New Zealand Curriculum — Science Years 0–10',a.science_pdf,base+'/new-zealand-curriculum-online/nzc---science-phases-1-4-years-0-10/5637290855.p','August 2026')
pdf('arts-sep-2026','The Arts','The New Zealand Curriculum — The Arts Years 0–10',a.arts_pdf,base+'/new-zealand-curriculum-online/nzc---the-arts-phases-1-4-years-0-10/5637290850.p','September 2026',['Dance','Drama','Music','Visual Arts'])
# Page ranges are from the PDF's contents and inspected page headings.
arts_ranges={'Dance':[(9,10),(16,16),(22,22),(28,29)],'Drama':[(11,11),(17,17),(23,23),(30,31)],'Music':[(12,13),(18,19),(24,25),(32,34)],'Visual Arts':[(14,14),(20,20),(26,26),(35,35)]}
for row in content['arts-sep-2026']['pages']:
 row['subjects']=[name for name,ranges in arts_ranges.items() if any(lo<=row['page']<=hi for lo,hi in ranges)]
 row['phase']=1 if 8<=row['page']<=14 else 2 if 15<=row['page']<=20 else 3 if 21<=row['page']<=26 else 4 if 27<=row['page']<=35 else None
for prefix,area,id,url in [('english','English','english-2025',base+'/new-zealand-curriculum-online/nzc---english-phases-1-4-years-0-10/5637289328.p'),('maths','Mathematics and Statistics','maths-2025',base+'/new-zealand-curriculum-online/nzc---mathematics-and-statistics-phases-1-4-years-0-10/5637289330.p')]:
 d=entry(id,area,'The New Zealand Curriculum — '+area+' Years 0–10',url,'ready','2025 statement; effective 1st January 2026')
 phases=[]
 for n,years in [(1,[0,1,2,3]),(2,[4,5,6]),(3,[7,8]),(4,[9,10])]:
  source=pathlib.Path(a.web_directory)/(prefix+'-phase'+str(n)+'.json');raw=source.read_bytes();data=json.loads(raw)
  if len(data['text'])<10000 or not data['tables']:raise ValueError('Incomplete phase extraction: '+str(source))
  phases.append({'phase':n,'years':years,'url':data['url'],'title':data['title'],'text':data['text'],'tables':data['tables'],'sha256Extract':hashlib.sha256(raw).hexdigest()})
 content[id]={'format':'Official HTML teaching sequences, Phases 1–4','extractionNote':'Expanded rendered main text and ordered table-cell text. Merged-cell spans are not encoded; confirm ambiguous year-column associations against the source page. No logos or images are reproduced.','phases':phases}
 d.update({'sourceFormat':'HTML text and table cells','phaseCount':4,'phaseUrls':[x['url'] for x in phases],'publicationStatus':'Official curriculum statement, effective 1st January 2026.','acquisition':'Extracted directly from official rendered teaching-sequence webpages.'})
for id,area,slug,n,subjects in [
 ('social-sciences-2026','Social Sciences','nzc---social-sciences-phases-1-4-years-0-10','5637290851',['Social Sciences']),
 ('technology-2026','Technology','nzc-technology-phases-1-4-years-0-10','5637293836',['Technology']),
 ('health-pe-2026','Health and Physical Education','nzc---health-and-pe-phases-1-4-years-0-10','5637293829',['Health','Physical Education']),
 ('languages-2026','Learning Languages','nzc-learning-languages-novice-and-emergent','5637293835',['Te Reo Māori','New Zealand Sign Language','Gagana Sāmoa','Gagana Tokelau','Lea Faka-Tonga','Te Reo Māori Kūki ‘Āirani','Vagahau Niue','French','German','Spanish','Chinese (Mandarin)','Japanese','Korean'])]:
 d=entry(id,area,'The New Zealand Curriculum — '+area+' Years 0–10',base+'/new-zealand-curriculum-online/'+slug+'/'+n+'.p','document-needed','2026 release — source file not retrieved',subjects)
 d['availabilityNote']='Official overview found, but no complete curriculum file was available from its download section during this retrieval. Upload the Ministry PDF to use this learning area; this index entry alone is not curriculum evidence.'
 if area=='Learning Languages':d['availabilityNote']='The Ministry overview refers to separate language teaching sequences. Complete language documents were not retrieved. Upload the document for the language being planned; do not treat proficiency stages as fixed school years.'
index={'version':'2026-10-30-1','sourceIndex':base+'/new-zealand-curriculum-online/new-zealand-curriculum/learning-areas/5637165582.c','checkedOn':source_date,'scope':'Eight NZC learning areas, Years 0–10; not senior curricula, supplementary teaching resources, or Te Marautanga o Aotearoa.','complete':False,'documents':sorted(meta,key=lambda d:d['learningArea'])}
for d in index['documents']:
 if d['availableForAi']:
  body=content[d['id']];encoded=json.dumps(body,ensure_ascii=False,indent=2);(root/(d['id']+'.json')).write_text(encoded);d['extractedCharacters']=len(encoded);d['contentPath']=d['id']+'.json'
(root/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
(root/'README.md').write_text('# Ministry curriculum catalogue\n\nChecked 30th October 2026. Four of eight learning areas contain usable curriculum text. English and Mathematics and Statistics include all four official HTML teaching sequences; Science and The Arts are text derivatives of previously supplied Ministry PDFs, with page numbers and original hashes. Other entries are clearly marked document-needed and contain no invented curriculum statements. Their metadata cannot be used as teaching-sequence evidence.\n\nSource text is attributed to the Ministry of Education, Crown copyright, under the site’s CC BY-NC 4.0 notice unless otherwise specified. Images, logos and site design are excluded. Source versions are fixed; this catalogue does not automatically update when the Ministry changes a document.\n\nPDF column structure and HTML merged table cells require source checking when extracting statements. Official wording and year attribution must be reviewed before accepting a generated overview. Learning Languages uses proficiency stages; the source documents must determine the mapping rather than assuming school-year alignment.\n')
(root.parent/'worker'/'catalogue-data.js').write_text('// Generated by scripts/build-curriculum-catalogue.py. Source metadata and text only.\nexport const ministryCatalogue = '+json.dumps(index,ensure_ascii=False)+';\nexport const ministryContent = '+json.dumps(content,ensure_ascii=False)+';\n')
print('Catalogue: %s ready; %s document-needed.'%(sum(x['availableForAi'] for x in meta),sum(not x['availableForAi'] for x in meta)))
