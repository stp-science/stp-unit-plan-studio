import pdfplumber,re,json,hashlib,argparse
from pathlib import Path
parser=argparse.ArgumentParser(description='Extract year-specific Ministry Science statements from the August 2026 PDF.')
parser.add_argument('pdf',type=Path)
parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'unit-plan-builder/science-curriculum.json')
parser.add_argument('--audit',type=Path)
args=parser.parse_args()
PDF=args.pdf
B='\uf096'
# Verified table row boundaries in the published A3 PDF; four columns are year-specific K,K,P,P.
rows={19:[(163.7,507.7),(532.1,723),(747.5,796.8)],20:[(110.2,372),(410,778.6)],21:[(197.2,628),(652.3,775.2)],22:[(110.2,343.5),(367.9,669.5)],24:[(158.8,759.7)],25:[(134.6,521.3)],26:[(139.3,697.1),(721.4,796.3)],27:[(110.2,508.1),(557.4,785.2)],28:[(110.2,468.6)],29:[(159.1,769)],30:[(134.6,620.2)],31:[(134.6,483.8)]}
cols={19:[113.7,372.2,630.9,889.3,1147.3],20:[113.7,372.2,630.9,889.3,1147.3],21:[113.7,373.9,634.3,894.5,1154.6],22:[113.8,373.9,634.3,894.5,1154.6],24:[114.8,371.4,631.6,889.9,1147.8],25:[114.8,373.2,631.6,889.9,1147.8],26:[114.8,373.2,631.6,889.9,1147.8],27:[114.8,373.2,631.6,889.9,1147.8],28:[114.9,373.2,631.6,889.9,1147.8],29:[113.7,371,628.7,886,1143.6],30:[113.7,371,628.7,886,1143.6],31:[113.7,371,628.7,886,1143.6]}
units=[];last={};practice_count={};knowledge_count={};audit=[]
def norm(s):return re.sub(r'\s+',' ',re.sub(r'(?<!\w)o(?!\w)', '', s)).strip()
def slug(s):return re.sub('[^a-z0-9]+','-',s.lower()).strip('-')
with pdfplumber.open(PDF) as pdf:
 for pn,regions in rows.items():
  p=pdf.pages[pn-1]
  for ri,(top,bottom) in enumerate(regions):
   texts=[]
   for c in range(4):
    crop=p.crop((cols[pn][c]+.3,top+.2,cols[pn][c+1]-.3,bottom-.2))
    lines=crop.extract_text_lines(layout=False,return_chars=True)
    texts.append(lines)
   for yr_index in [0,1]:
    year=(7 if pn<23 else 9)+yr_index;strand='Biological Science'if pn in [21,22,29,30,31]else'Physical Science'
    plines=texts[yr_index+2];practices=[];current=None;category='';
    for line in plines:
     s=line['text'].strip()
     if not s:continue
     if s.endswith('by:'):
      if current:practices.append(current);current=None
      category=s[:-1];continue
     if s.startswith(B):
      if current:practices.append(current)
      key=(year,pn);practice_count[key]=practice_count.get(key,0)+1
      current={'id':f'SCI-2026-Y{year}-P{pn}-P{practice_count[key]:02d}','category':category,'text':s[1:].strip(),'page':pn}
     elif current:current['text']+=' '+s
    if current:practices.append(current)
    for s in practices:s['text']=norm(s['text'])
    klin=texts[yr_index];current=None;unit=last.get(year);row_units=[]
    for line in klin:
     s=line['text'].strip()
     if not s:continue
     chars=[c for c in line['chars']if c.get('text','').strip()]
     bold=bool(chars)and sum('Bold'in c.get('fontname','')for c in chars)/len(chars)>.8
     if s.startswith(B):
      if current:unit['knowledge'].append(current)
      if not unit:raise ValueError('No heading '+str((pn,year,s)))
      if unit not in row_units:row_units.append(unit)
      key=(year,pn);knowledge_count[key]=knowledge_count.get(key,0)+1
      current={'id':f'SCI-2026-Y{year}-P{pn}-K{knowledge_count[key]:02d}','text':s[1:].strip(),'page':pn}
     elif bold and not s.startswith(('Note:','(See')):
      if current:unit['knowledge'].append(current);current=None
      # Some two-line bold headings continue onto the next line.
      if unit and not unit['knowledge']and unit in row_units:
       unit['title']+=' '+s;unit['id']=f'science-y{year}-'+slug(unit['title'])
      else:
       unit={'id':f'science-y{year}-'+slug(s),'title':s,'year':year,'phase':3 if year<9 else 4,'strand':strand,'knowledge':[],'practices':[],'pages':[pn]};units.append(unit);row_units.append(unit);last[year]=unit
     elif current:
      if s.startswith(('Note:','(See')):
       # These are curriculum notes, retained separately rather than appended to a statement.
       unit.setdefault('notes',[]).append(s)
      else:current['text']+=' '+s
    if current:unit['knowledge'].append(current)
    if not row_units and unit and klin:row_units=[unit]
    for u in row_units:
     u['practices'].extend(s for s in practices if s['id']not in {p['id']for p in u['practices']})
     if pn not in u['pages']:u['pages'].append(pn)
     for s in u['knowledge']:s['text']=norm(s['text'])
    audit.append({'page':pn,'row':ri,'year':year,'units':[u['title']for u in row_units],'knowledge_bullets':sum(l['text'].strip().startswith(B)for l in klin),'practices_bullets':sum(l['text'].strip().startswith(B)for l in plines)})
# The Year 10 water-cycle cell continues with a plate-tectonics subtopic on page 28.
# Practices are shared across the parent row, so inherit them for continuation subtopics.
for u in units:
 if not u['practices']:
  preceding=[x for x in units if x['year']==u['year']and x['strand']==u['strand']and x['practices']and max(x['pages'])<=min(u['pages'])]
  if preceding and u['title']=='Plate tectonics':u['practices']=preceding[-1]['practices'].copy();u['practiceScopeNote']='Practices are shared across the Year 10 Earth and Space section; select those relevant to this unit.'
unitsource={'documentId':'science-august-2026','title':'The New Zealand Curriculum — Science Years 0–10','version':'August 2026 (published 12th August 2026)','publisher':'Ministry of Education','ministryUrl':'https://newzealandcurriculum.tahurangi.education.govt.nz/nzc---science-phases-1-4-years-0-10/5637290855.p','mirrorUrl':'https://www.bayscience.nz/post/curriculum-implementation-timeline-science-putaiao','sha256':hashlib.sha256((PDF).read_bytes()).hexdigest(),'license':'Crown copyright. Text reused under CC BY-NC 4.0, with attribution to the Ministry of Education.','licenseUrl':'https://newzealandcurriculum.tahurangi.education.govt.nz/copyright','retrieved':'2026-10-23','units':units}
args.output.write_text(json.dumps(unitsource,ensure_ascii=False,indent=2))
if args.audit:args.audit.write_text(json.dumps(audit,ensure_ascii=False,indent=2))
print('UNITS',len(units),'KNOWLEDGE',sum(len(u['knowledge'])for u in units))
for u in units:print(u['year'],u['title'],len(u['knowledge']),len(u['practices']),u['pages'])
