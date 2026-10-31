"""Extract junior curriculum tables by PDF geometry; no API calls.
Year-spanning cells apply to each labelled year they span. Language examples stay out
of official K/P records. Retain source cells and coordinates for reproducible review.
"""
import argparse,json,re,hashlib,statistics
from pathlib import Path
import pdfplumber
arg=argparse.ArgumentParser();arg.add_argument('pdf_directory');arg.add_argument('--source',action='append');args=arg.parse_args()
root=Path('curriculum-catalogue');index=json.loads((root/'index.json').read_text());banks=json.loads(Path('curriculum-library/catalogue-banks.json').read_text()) if args.source else {};audit=[]
clean=lambda s:re.sub(r'\s+',' ',s).strip()
bullet=re.compile(r'^[\uf096\u2022\u25aa\u25cf\u25e6\u2023\u25ab\uf0a7]\s*')
def notation_line(line):
 chars=line['chars'];sizes=[c.get('size',10) for c in chars if c.get('text','').strip()]
 if not sizes:return line['text']
 base=statistics.median(sizes);normal=[c for c in chars if c.get('size',10)>=base*.9];top=statistics.median(c['top'] for c in normal) if normal else 0
 supers=str.maketrans('0123456789+-−=()n','⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ⁿ');out='';last=None
 for c in sorted(chars,key=lambda c:c['x0']):
  value=c['text']
  if last is not None and c['x0']-last>base*.22 and not out.endswith(' '):out+=' '
  if c.get('size',10)<base*.85 and c['top']<top-1:value=value.translate(supers)
  out+=value;last=c['x1']
 return out
for doc in index['documents']:
 if args.source and doc['id'] not in args.source:continue
 if not doc.get('availableForCurriculum') or doc['id']=='science-aug-2026':continue
 file=Path(args.pdf_directory)/doc.get('sourceFilename',{'arts-sep-2026':'The-Arts-0-10-14Sep26 (1).pdf'}.get(doc['id']));assert hashlib.sha256(file.read_bytes()).hexdigest()==doc['sha256Original'],file
 language=doc['learningArea']=='Learning Languages';peryear={};page_count=0
 with pdfplumber.open(file) as pdf:
  for pn,page in enumerate(pdf.pages,1):
   text=page.extract_text() or ''
   years=[int(n) for n in re.findall(r'During Year (\d+)',text)]
   novice=re.search(r'During Novice (\d+)',text)
   if (not language and not any(y in [7,8,9,10] for y in years)) or (language and not novice):continue
   tables=sorted(page.find_tables(),key=lambda t:len(t.cells),reverse=True)
   if not tables:raise ValueError(f'{doc["id"]} page {pn}: no curriculum table')
   for table in tables:
    cells=[]
    for cell in table.cells:
     if cell[2]-cell[0]<40 or cell[3]-cell[1]<8:continue
     crop=page.crop(cell);t=crop.extract_text() or ''
     if t.strip():cells.append((cell,t,crop))
    headers={}
    for cell,t,crop in cells:
     if clean(t.split('\n')[0]) in ['Knowledge','Practices','Language examples']:headers[clean(t.split('\n')[0])]=cell
    if not {'Knowledge','Practices'}<=headers.keys():continue
    year_cells=[(c,int(m.group(1))) for c,t,_ in cells if (m:=re.fullmatch(r'During Year (\d+)',clean(t)))]
    data_top=max([c[3] for c,y in year_cells],default=max(c[3] for c in headers.values())+12)
    subject=doc.get('subject',doc['learningArea'])
    if doc['learningArea']=='The Arts':
     hit=re.search(r'^(Dance|Drama|Music|Visual Arts)\b',text.strip());
     if hit:subject=hit.group(1)
     elif 'last_art_subject' in locals():subject=last_art_subject
     else:raise ValueError('No Arts discipline '+str(pn))
     last_art_subject=subject
    if doc['learningArea']=='Health and Physical Education':
     if text.strip().startswith('Physical Education'):last_health_subject='Physical Education'
     elif re.match(r'^Health\b',text.strip()):last_health_subject='Health'
     subject=locals().get('last_health_subject','Health')
    if language:stage='Novice '+novice.group(1)
    else:stage=''
    used=0
    for cell,t,crop in cells:
     x0,top,x1,bottom=cell
     if top<data_top-1:continue
     matches=[kind for label,kind in [('Knowledge','knowledge'),('Practices','practice')] if x0-2<=(headers[label][0]+headers[label][2])/2<=x1+2]
     if len(matches)!=1:continue # labels, full-width context and example columns
     kind=matches[0]
     applicable=[0] if language else sorted({y for c,y in year_cells if y in [7,8,9,10] and x0-2<=(c[0]+c[2])/2<=x1+2})
     if not applicable:continue
     # Derive strand/row labels from all left-side cells overlapping this cell.
     labels=[clean(v) for c,v,_ in cells if c[2]<=x0+1 and c[2]<=headers['Knowledge'][0]+2 and c[1]<bottom and c[3]>top and c[2]-c[0]>35]
     section=' / '.join(dict.fromkeys([stage,*labels])) .strip(' /')
     lines=crop.extract_text_lines();segments=[];current=[];heading=''
     def flush():
      if current:segments.append((heading,'\n'.join(current).strip()));current.clear()
     for line in lines:
      raw=(notation_line(line) if doc['id']=='maths-2025' else line['text']).strip();chars=[c for c in line['chars'] if c.get('text','').strip()];is_bold=bool(chars) and sum('bold' in c.get('fontname','').lower() for c in chars)/len(chars)>.9
      if is_bold and not bullet.match(raw) and len(raw)<160:
       flush();heading=clean(raw);continue
      if bullet.match(raw):flush();current.append(bullet.sub('',raw))
      else:current.append(raw)
     flush()
     if not segments:continue
     for local,(heading,wording) in enumerate(segments):
      wording=clean(wording)
      if not wording:continue
      # Column and table explanations are source guidance, not extra statements.
      if wording.startswith(('The facts, concepts','The skills, strategies','The three practice statements','The Design, Make, and Innovate strand')):continue
      for year in applicable:
       bank=peryear.setdefault(year,{'version':'stored-statements-v1','sourceId':doc['id'],'sourceHash':doc['sha256Original'],'year':year,'reviewRequired':True,'preparationMethod':'PDF table cell geometry; no AI extraction','records':[],'warnings':['Prepared directly from the supplied PDF tables. Check source wording, mathematical notation, shared-year requirements and curriculum coverage before confirming a plan.']})
       fullsection=' / '.join(filter(None,[section,heading]));prefix=(heading+'\n') if kind=='practice' and heading.endswith(':') else ''
       bank['records'].append({'id':f'{doc["id"]}-{year}-p{pn}-x{round(x0)}-t{round(top)}-r{local}','kind':kind,'text':prefix+wording,'subject':subject,'page':pn,'section':fullsection,'source':doc['title']+', '+doc['version']+', '+(stage if language else 'Year '+str(year))+', page '+str(pn),'sourceCell':[round(v,2) for v in cell],'sharedYears':applicable if not language else [],'proficiencyStage':stage})
     used+=1
    audit.append({'source':doc['id'],'page':pn,'years':sorted(set(years)),'stage':stage,'subject':subject,'indexedCells':used});page_count+=1
 for year,bank in peryear.items():
  assert bank['records'],(doc['id'],year)
  banks[doc['id']+':'+str(year)]=bank
 expected=[0] if language else [7,8,9,10]
 assert sorted(peryear)==expected,(doc['id'],sorted(peryear))
 print(doc['id'],{y:len(b['records']) for y,b in peryear.items()},flush=True)
Path('curriculum-library').mkdir(exist_ok=True)
Path('curriculum-library/catalogue-banks.json').write_text(json.dumps(banks,ensure_ascii=False,indent=2)+'\n')
Path('curriculum-library/preparation-audit.json').write_text(json.dumps({'method':'PDF table cell geometry','apiCalls':0,'sources':len({b['sourceId'] for b in banks.values()}),'banks':len(banks),'records':sum(len(b['records']) for b in banks.values()),'pages':([p for p in json.loads(Path('curriculum-library/preparation-audit.json').read_text())['pages'] if p['source'] not in args.source] if args.source else [])+audit},ensure_ascii=False,indent=2)+'\n')
print('Prepared',len(banks),'banks;',sum(len(b['records']) for b in banks.values()),'records; no API calls')
