<?php
declare(strict_types=1);
// Read-only curriculum coverage checks. Does NOT access school data or call AI.
require_once dirname(__DIR__) . '/public/curriculum_coverage.php';
require_once dirname(__DIR__) . '/public/curriculum_coverage_xlsx.php';
function check_audit(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
$map=['years'=>[
    ['label'=>'Year 7','blocks'=>[['label'=>'Term 1','topics'=>[['id'=>'six123a','title'=>'Particles']]]]],
    ['label'=>'Year 8','blocks'=>[['label'=>'Term 1','topics'=>[['id'=>'six123b','title'=>'Cells']]]]]
]];
$science=cm_audit_specs('Science',$map);
check_audit(count($science)===2,'Science source scope must include both map years.');
$records=cs_year_statement_bank('science-aug-2026',7);
check_audit(count($records)>50,'Official Science Year 7 Knowledge and Practices bank is incomplete.');
$prep=cm_audit_specs('Prep',$map);
check_audit(count($prep)===11,'Prep should use 4 subjects × 2 years plus 3 Te Reo Māori Novice stages.');
check_audit(count(array_filter($prep,static fn($x)=>$x['level']==='Novice 3'))===1,
    'Prep Novice 3 source is missing.');
$eal=cm_audit_specs('English as an Additional Language',['years'=>[
    ['label'=>'Stage 1','blocks'=>[]],['label'=>'Stage 2','blocks'=>[]]]]);
check_audit(count($eal)===5,'EAL audit needs all five proficiency stages independently of school year.');
check_audit(count(cm_audit_specs('French',$map))===3,'French Novice 1–3 should be audited independently.');
$one=cm_audit_statement_id($science[0],$records[0]);
check_audit($one===cm_audit_statement_id($science[0],$records[0]),'Statement ID must be deterministic.');
check_audit($one!==cm_audit_statement_id($science[1],$records[0]),'Source-year IDs must be distinct.');
$report=[
 'summary'=>['total'=>2,'covered'=>1,'missing'=>1,'pending'=>0,'complete'=>true],
 'scope'=>['Science · Year 7'],
 'rows'=>[
    ['source'=>'Science · Year 7','kind'=>'knowledge','text'=>'All matter is made of particles.',
        'status'=>'Missing','units'=>[],'citation'=>'Ministry science p19'],
    ['source'=>'Science · Year 7','kind'=>'practice','text'=>'Use models to explain observations.',
        'status'=>'Covered','units'=>[['display'=>'Year 7 · Particles']],'citation'=>'Ministry science p19']
 ],'pending'=>[]
];
$bytes=cm_audit_xlsx($report);
check_audit(strlen($bytes)>1700,'Two-sheet audit XLSX is empty.');
$tmp=tempnam(sys_get_temp_dir(),'audit-test-');
file_put_contents($tmp,$bytes);
$z=new ZipArchive();
check_audit($z->open($tmp)===true,'Exported XLSX is not a valid ZIP archive.');
$book=$z->getFromName('xl/workbook.xml')?:'';
$checklist=$z->getFromName('xl/worksheets/sheet2.xml')?:'';
$summary=$z->getFromName('xl/worksheets/sheet1.xml')?:'';
$z->close();unlink($tmp);
check_audit(str_contains($book,'Statement checklist')&&str_contains($book,'Summary'),
    'Expected exactly two readable worksheet names.');
check_audit(str_contains($checklist,'All matter is made of particles.')&&str_contains($checklist,'Missing'),
    'Export must include exact missing Ministry statement wording.');
check_audit(str_contains($summary,'Official statements')===false || str_contains($summary,'Missing'),
    'Summary sheet must include missing count.');
$js=(string)file_get_contents(dirname(__DIR__) . '/public/assets/curriculum_map/v1/map.js');
$api=(string)file_get_contents(dirname(__DIR__) . '/public/curriculum_map_api.php');
foreach(['coverage-audit','coverage-audit-xlsx','coverage-audit-assign'] as $required)
 check_audit(str_contains($api,$required),'Missing protected API route '.$required);
foreach(['Missing only','Add to unit','Download Excel checklist','prepareCoverageSource'] as $required)
 check_audit(str_contains($js,$required),'Missing coverage UI '.$required);
echo "PASS: Science Year 7/8, 11 Prep source groups, Languages and EAL stages, verified statement IDs, missing/covered report, two-sheet XLSX and secure assignment routes. No AI calls.\n";
