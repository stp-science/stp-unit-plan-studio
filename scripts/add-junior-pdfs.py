"""Install the supplied junior PDFs into the shared source catalogue without duplicates."""
import argparse,pathlib,json,subprocess,hashlib
p=argparse.ArgumentParser();p.add_argument('source_directory');a=p.parse_args();directory=pathlib.Path(a.source_directory);root=pathlib.Path('curriculum-catalogue');index=json.loads((root/'index.json').read_text());documents=index['documents'];byid={d['id']:d for d in documents};bodies={d['id']:json.loads((root/d['contentPath']).read_text()) for d in documents if d.get('contentPath')}
rows=[
('health-pe-2026','Health and Physical Education','Health and Physical Education','Health-and-PE-0-10-15Sep26.pdf','September 2026','curriculum'),
('social-sciences-2026','Social Sciences','Social Sciences','Social-Sciences-0-10_15Sep26.pdf','September 2026','curriculum'),
('technology-2026','Technology','Technology','Technology-0-10-15Sep26.pdf','September 2026','curriculum'),
('science-aug-2026','Science','Science','Science-Y0-10-12Aug26 (2)(1).pdf','August 2026','curriculum'),
('arts-sep-2026','The Arts','The Arts','The-Arts-0-10-14Sep26 (1).pdf','September 2026','curriculum'),
('english-2025','English','English','English–Oct-2025.pdf','2025 statement; supplied October 2025 PDF','curriculum'),
('maths-2025','Mathematics and Statistics','Mathematics and Statistics','-Mathematics–and–Statistics.pdf','2025 statement; supplied PDF','curriculum'),
('languages-2026','Learning Languages','Learning Languages overview','Learning-Languages-0-10-Overview.pdf','September 2026 collection; overview','overview'),
('languages-spanish-sep-2026','Learning Languages','Spanish','Learning-Languages-0-10_Spanish-9Sep26.pdf','September 2026','curriculum'),
('languages-chinese-mandarin-sep-2026','Learning Languages','Chinese (Mandarin)','Learning-Languages-0-10_ChineseMandarin-9Sep26.pdf','September 2026','curriculum'),
('languages-french-sep-2026','Learning Languages','French','Learning-Languages-0-10_French-9Sep26.pdf','September 2026','curriculum'),
('languages-japanese-sep-2026','Learning Languages','Japanese','Learning-Languages-0-10_Japanese-9Sep26.pdf','September 2026','curriculum'),
('languages-te-reo-maori-sep-2026','Learning Languages','Te Reo Māori','Learning-Languages-0-10_TeReoMāori-9Sep26.pdf','September 2026','curriculum'),
('languages-conceptual-map','Learning Languages','Learning Languages conceptual map','Learning-Languages-0-10-Conceptual-mapping.pdf','Version date not stated on cover','supporting-document'),
('pe-activities-y0-10','Health and Physical Education','Physical Education activities','Physical-Education-Activities-for-Years-0-10.pdf','Version date not stated on cover','supporting-document')]
duplicates=[]
for id,area,subject,filename,version,kind in rows:
 f=directory/filename;raw=f.read_bytes();sha=hashlib.sha256(raw).hexdigest();old=byid.get(id);source=old.get('sourceUrl') if old else byid['languages-2026']['sourceUrl'] if area=='Learning Languages' else byid['health-pe-2026']['sourceUrl']
 if old and old.get('sha256Original')==sha:
  old['suppliedFilenames']=sorted(set(old.get('suppliedFilenames',[])+[filename]));old['kind']='curriculum';old['availableForCurriculum']=True;old['coreLearningArea']=True;old['acquisition']='Supplied Ministry PDF; matching source checksum verified.';duplicates.append(filename);continue
 pages=subprocess.check_output(['pdftotext','-layout',str(f),'-']).decode().split('\f')
 if not pages[-1].strip():pages.pop()
 if any(not page.strip() for page in pages):raise ValueError('Empty extracted page: '+filename)
 body={'format':'PDF page text with column spacing retained','extractionNote':'Preserve official wording and page citations. Column spacing is retained; check the original PDF when year/stage column associations are uncertain. Images and logos are excluded.','pages':[{'page':i+1,'text':text.rstrip()} for i,text in enumerate(pages)]}
 title='The New Zealand Curriculum — '+subject+' Years 0–10' if kind=='curriculum' else subject
 doc={**(old or {}),'id':id,'learningArea':area,'title':title,'subject':subject,'subjects':old.get('subjects',[subject]) if old and area!='Learning Languages' else [subject],'sourceUrl':source,'status':'ready','version':version,'checkedOn':'2026-10-30','yearRange':'Years 0–10','kind':kind,'availableForAi':True,'availableForCurriculum':kind=='curriculum','coreLearningArea':id in {'health-pe-2026','social-sciences-2026','technology-2026','science-aug-2026','arts-sep-2026','english-2025','maths-2025','languages-2026'},'sourceFormat':'PDF text','sourceFilename':filename,'acquisition':'Ministry PDF supplied by the user','pageCount':len(pages),'sha256Original':sha,'attribution':'Ministry of Education, Crown copyright','licence':'CC BY-NC 4.0 unless otherwise specified','licenceUrl':'https://newzealandcurriculum.tahurangi.education.govt.nz/copyright','contentPath':id+'.json'}
 if old and old.get('phaseUrls'):doc['htmlCompanionUrls']=old['phaseUrls']
 for key in ['availabilityNote','phaseCount','phaseUrls','extractedCharacters']:doc.pop(key,None)
 if area=='Learning Languages' and kind=='curriculum':doc['progressionBasis']='Novice 1, Novice 2 and Novice 3; do not equate stages with fixed year levels.';doc['publicationStatus']='Supplied September 2026 language teaching sequence; proposed curriculum statement.'
 elif kind=='curriculum':doc['publicationStatus']='Supplied 2025 curriculum statement.' if id in ['english-2025','maths-2025'] else 'Published Ministry teaching content; document states proposed National Curriculum Statement.'
 else:doc['publicationStatus']='Supporting source; not a complete teaching sequence or list of mandatory statements.'
 byid[id]=doc;bodies[id]=body
index.update({'version':'2026-10-30-junior-2','scope':'All eight Years 0–10 NZC learning areas are represented. Learning Languages includes teaching sequences for five supplied languages only. Supporting references are labelled separately.','learningAreaCount':8,'supportedLanguages':['Spanish','Chinese (Mandarin)','French','Japanese','Te Reo Māori'],'otherLanguagesNotSupplied':['New Zealand Sign Language','Gagana Sāmoa','Gagana Tokelau','Lea Faka-Tonga','Te Reo Māori Kūki ‘Āirani','Vagahau Niue','German','Korean'],'complete':False,'documents':sorted(byid.values(),key=lambda d:(d['learningArea'],d.get('subject',d['title'])))})
for id,body in bodies.items():(root/(id+'.json')).write_text(json.dumps(body,ensure_ascii=False,indent=2)+'\n')
(root/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
pathlib.Path('worker/catalogue-data.js').write_text('// Generated by scripts/add-junior-pdfs.py. Attributed text derivatives; no images.\nexport const ministryCatalogue = '+json.dumps(index,ensure_ascii=False)+';\nexport const ministryContent = '+json.dumps(bodies,ensure_ascii=False)+';\n')
(root/'README.md').write_text('# Junior Ministry curriculum catalogue\n\nAll eight Years 0–10 NZC learning areas are represented by supplied PDFs. Five language teaching sequences are included: Spanish, Chinese (Mandarin), French, Japanese and Te Reo Māori. Other languages are not claimed complete. Supporting PE activity examples, the languages overview and conceptual map are separate reference types, not substitutes for teaching sequences.\n\nScience (August 2026) and Arts (September 2026) duplicate uploads match the earlier PDF hashes and do not create duplicate catalogue entries. English and Mathematics and Statistics use the supplied 2025 PDFs; earlier HTML capture files are retained as archival extraction records, not mixed into the PDF source.\n\nLanguage progression uses the documents’ Novice 1/2/3 stages rather than a fixed stage-to-year mapping. Source filenames, hashes, versions and physical page numbers are retained. Source text is attributed to the Ministry of Education under its applicable copyright notice; no logos, images or website design are reproduced.\n\nSenior sources live under `senior/` and may inform future-learning connections only. They never fill junior curriculum statement gaps.\n')
print(json.dumps({'catalogueEntries':len(byid),'teachingSequences':sum(d['availableForCurriculum'] for d in byid.values()),'learningAreas':8,'languages':5,'duplicatesVerified':duplicates,'pages':sum(d.get('pageCount',0) for d in byid.values())},ensure_ascii=False))
