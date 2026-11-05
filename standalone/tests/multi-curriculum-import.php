<?php
declare(strict_types=1);
// Offline tests for multi-document curriculum import and flexible year-group
// selections. Does not require login, database access, AI credits or uploads.
class CsInvalid extends RuntimeException {}
require_once dirname(__DIR__).'/public/curriculum_map_groups.php';
$check=static function (bool $ok,string $message):void {
    if (!$ok) throw new RuntimeException('FAILED: '.$message);
};
$expectInvalid=static function (callable $run,string $message):void {
    try {$run();}catch(CsInvalid $e){return;}
    throw new RuntimeException('FAILED: expected rejection for '.$message);
};
$check(cm_requested_overview_groups(['Year 8'],'Science')===['Year 8'],'single year');
$check(cm_requested_overview_groups(['Year 7','Year 9'],'Science')===['Year 7','Year 9'],'nonconsecutive years');
$check(cm_requested_overview_groups(['Year 11','Year 12'],'Physics')===['Year 11','Year 12'],'senior years');
$check(cm_requested_overview_groups(['Year 7'],'Prep')===['Year 7'],'Prep Year 7');
$check(cm_requested_overview_groups(['Year 8'],'Prep')===['Year 8'],'Prep Year 8');
$check(cm_requested_overview_groups(['Stage 1','Stage 3'],'English as an Additional Language')===['Stage 1','Stage 3'],'EAL stages');
$check(cm_requested_overview_groups(['Novice 1','Novice 3'],'French')===['Novice 1','Novice 3'],'French levels');
$expectInvalid(static fn()=>cm_requested_overview_groups(['Year 9'],'Prep'),'Prep Year 9');
$expectInvalid(static fn()=>cm_requested_overview_groups(['Year 11'],'English as an Additional Language'),'EAL mapped to years');
$expectInvalid(static fn()=>cm_requested_overview_groups(['Year 7'],'French'),'French mapped to years');
$expectInvalid(static fn()=>cm_requested_overview_groups(['Stage 3'],'Science'),'Science mapped to stages');
$expectInvalid(static fn()=>cm_requested_overview_groups(['Random'], 'Science'),'unsupported group');
$sample=['title'=>'Science', 'years'=>[
  ['label'=>'Year 7','blocks'=>[['topics'=>[['title'=>'Cells']]]]],
  ['label'=>'Year 8','blocks'=>[['topics'=>[['title'=>'Digestion']]]]],
  ['label'=>'Year 9','blocks'=>[['topics'=>[['title'=>'Electricity']]]]]
]];
$y8=cm_filter_import_groups($sample,['Year 8']);
$check(count($y8['years'])===1 && $y8['years'][0]['label']==='Year 8' &&
    $y8['years'][0]['blocks'][0]['topics'][0]['title']==='Digestion','filter only chosen year without losing units');
$subset=cm_filter_import_groups($sample,['Year 7','Year 9']);
$check(array_column($subset['years'],'label')===['Year 7','Year 9'],'filter nonconsecutive years');
$check(count(cm_filter_import_groups($sample,[])['years'])===3,'default keep all supplied groups');
$expectInvalid(static fn()=>cm_filter_import_groups($sample,['Year 12']),'no matching uploaded years');
$api=(string)file_get_contents(dirname(__DIR__).'/public/curriculum_map_api.php');
$ui=(string)file_get_contents(dirname(__DIR__).'/public/assets/curriculum_map/v1/map.js');
foreach ([
    "require_once __DIR__ . '/curriculum_map_groups.php'",
    "isset(\$_FILES['files'])",
    'count($uploads)>6',
    '$totalBytes>20*1024*1024',
    'foreach ($uploads as $index=>$file)',
    'cm_filter_import_groups((array)$res[\'json\'],$groups)',
    'cm_from_import($filtered,$stmts)',
    "'requestedGroups' => $groups",
    '$actualGroups !== $groups'
] as $required)
    $check(str_contains($api,$required),'server import/generate: '.$required);
foreach ([
    'multiple:true',
    "fd.append('files[]',file,file.name)",
    "fd.append('groups',JSON.stringify(chosen))",
    'function availablePlanningGroups()',
    'function groupPicker(selection',
    'function startImport(files,groups)',
    'groupPicker(f.groups)',
    'groupPicker(chosen,{allowAll:true})'
] as $required)
    $check(str_contains($ui,$required),'client multi-file / year options: '.$required);
echo "PASS: multiple-document routing, one/nonconsecutive/multiple years, Prep, EAL and Novice scopes, filtering and no invented groups.\n";
