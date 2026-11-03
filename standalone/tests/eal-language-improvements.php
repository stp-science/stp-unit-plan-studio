<?php
declare(strict_types=1);
// Offline source and feature regression for October 2026 EAL + Languages.
// No school database access, HTTP requests, generation or Claude credits.
require_once dirname(__DIR__) . '/public/curriculum_map_lib.php';
$doc=cs_catalogue_doc('english-as-an-additional-language-stages-2026');
if (!$doc || ($doc['subject'] ?? '') !== 'English as an Additional Language')
    throw new RuntimeException('EAL subject is absent from the curriculum catalogue.');
if (!str_contains((string)($doc['publicationStatus'] ?? ''),'proposed'))
    throw new RuntimeException('EAL must be labelled as a proposed curriculum.');
$raw=cs_catalogue_content($doc);
if (count($raw['pages'] ?? [])!==33)
    throw new RuntimeException('EAL source has missing PDF pages.');
$expected=['Stage 1'=>[8,13],'Stage 2'=>[14,18],'Stage 3'=>[19,23],
           'Stage 4'=>[24,28],'Stage 5'=>[29,33]];
$levels=cm_doc_levels($doc);
foreach($expected as $stage=>$range){
    $pages=$levels[$stage] ?? [];
    if (!$pages || (int)$pages[0]['page']!==$range[0]
        || (int)$pages[count($pages)-1]['page']!==$range[1])
        throw new RuntimeException($stage.' was incorrectly mapped to PDF pages.');
    $prepared=cm_bank_prepare($doc['id'],11,'',$stage);
    if (is_string($prepared) || !count($prepared[1]))
        throw new RuntimeException($stage.' official statement bank cannot be accessed.');
    echo "$stage: pages ".$range[0]."–".$range[1]."; "
         .count($prepared[1])." offline extraction chunks.\n";
}
[$overview,$note]=cm_eal_evidence();
foreach(array_keys($expected) as $stage)
    if(!str_contains($overview,$stage))throw new RuntimeException('EAL overview lacks '.$stage);
$public=dirname(__DIR__).'/public';
$map=(string)file_get_contents($public.'/assets/curriculum_map/v1/map.js');
$guide=(string)file_get_contents($public.'/assets/curriculum_studio/v5/guide.js');
$export=(string)file_get_contents($public.'/assets/curriculum_studio/v5/export.js');
$mapApi=(string)file_get_contents($public.'/curriculum_map_api.php');
$guideApi=(string)file_get_contents($public.'/curriculum_studio_api.php');
$mapLib=(string)file_get_contents($public.'/curriculum_map_lib.php');
$checks=[
 ['EAL map generation',$mapApi,'EAL CURRICULUM'],
 ['EAL map import',$mapApi,'EAL IMPORT'],
 ['EAL workspace setup',$mapApi,'ensure-eal'],
 ['EAL school-wide discovery',$mapLib,'eal-setup'],
 ['EAL manual map statements',$map,'if(selectedSource.eal)'],
 ['EAL plan stage tabs',$guide,'function ealOutlineCard()'],
 ['EAL plan source data',$guide,'EAL_DOC_ID'],
 ['Language reference field',$guide,'Add Word/text reference'],
 ['No invented school links',$guideApi,"foreach (['prior','future'] as \\$key)"],
 ['Knowledge summary categories',$guideApi,'Cultural and Sociolinguistic'],
 ['Word statement bullet formatting',$export,'fillStatements(doc,targetCell,f[key])']
];
foreach($checks as [$name,$body,$needle])
    if(!str_contains($body,$needle))throw new RuntimeException('Missing '.$name);
echo "PASS: 33 page source, 5 independent stages, EAL in all three modes, two Languages summary headings, supporting references, and Word bullet formatting. No AI calls.\n";
