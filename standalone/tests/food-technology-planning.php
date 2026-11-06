<?php
declare(strict_types=1);
// Offline regression for the St Peter's Food Technology-specific overview shape.
// No database, credentials, AI service or live data are required.
class CsInvalid extends RuntimeException {}
require_once dirname(__DIR__).'/public/curriculum_map_food_technology.php';

$check=static function (bool $ok,string $message):void {
    if (!$ok) throw new RuntimeException('Food Technology test failed: '.$message);
};
$check(cm_is_food_technology('Food Technology'),'recognises Food Technology');
$check(cm_is_food_technology('Food Tech'),'recognises Food Tech');
$check(cm_is_food_technology('Food'),'recognises Food');
$check(!cm_is_food_technology('Science'),'does not affect Science');
$check(!cm_is_food_technology('Digital Technology'),'does not affect Digital Technology');
$check(cm_food_technology_block_counts(['Year 7','Year 8','Year 9','Year 10'])===
    ['Year 7'=>5,'Year 8'=>5,'Year 9'=>4,'Year 10'=>4],'five rotations and four terms');
$check(cm_food_technology_block_counts(['Year 8'])===['Year 8'=>5],'one-year overview');

$sample=['years'=>[
    ['label'=>'Year 7','blocks'=>[['label'=>'','topics'=>[]]]],
    ['label'=>'Year 8','blocks'=>[['label'=>'','topics'=>[]]]],
    ['label'=>'Year 9','blocks'=>[
        ['label'=>'','topics'=>[['title'=>'Pasta dish','strand'=>'','assess'=>'','owner'=>'','optional'=>false]]],
        ['label'=>'','topics'=>[['title'=>'Bread making','strand'=>'','assess'=>'','owner'=>'','optional'=>false]]],
        ['label'=>'','topics'=>[['title'=>'Invented term 3','strand'=>'','assess'=>'','owner'=>'','optional'=>false]]],
    ]],
    ['label'=>'Year 10','blocks'=>[['label'=>'','topics'=>[]]]],
]];
$normal=cm_food_technology_normalise_generated($sample);
$years=$normal['years'];
$check(array_map(static fn($y)=>count($y['blocks']),$years)===[5,5,4,4],'group-specific block counts');
$check($years[0]['blocks'][0]['label']==='Rotation 1' &&
    $years[1]['blocks'][4]['label']==='Rotation 5','rotation labels');
$check($years[2]['blocks'][3]['label']==='Term 4' &&
    $years[3]['blocks'][3]['label']==='Term 4','term labels');
$check($years[2]['blocks'][0]['topics'][0]['title']==='Pasta' &&
    $years[2]['blocks'][1]['topics'][0]['title']==='Breads','known Year 9 topics preserved');
$check(!$years[2]['blocks'][2]['topics'] && !$years[2]['blocks'][3]['topics'],
    'undecided Year 9 terms stay blank');
$expected10=[
    'Burger competition',
    'Sports nutrition',
    'Desserts (functional ingredients and combined hospitality)',
    'Future food (food systems and future pathways)',
];
$check(array_map(static fn($b)=>$b['topics'][0]['title'],$years[3]['blocks'])===$expected10,
    'four Year 10 topics are accurate');
$check(cm_food_technology_normalise_generated($sample)['years'][0]['blocks'][4]['topics']===[],
    'unknown rotations not invented');
$withTerm3=cm_food_technology_normalise_generated($sample,'Year 9 Term 3: Food preservation');
$check($withTerm3['years'][2]['blocks'][2]['topics'][0]['title']==='Invented term 3',
    'teacher-provided Term 3 scope is not automatically removed');
try {
    cm_food_technology_normalise_generated(['years'=>[
        ['label'=>'Year 7','blocks'=>array_fill(0,6,['topics'=>[]])],
    ]]);
    throw new RuntimeException('Too many rotation slots was not rejected');
} catch (CsInvalid $expected) {}
$rules=cm_food_technology_rules(false);
$check(str_contains($rules,'FIVE rotations') && str_contains($rules,'connected project') &&
    str_contains($rules,'TEN lessons') && str_contains($rules,'NOT been decided'),
    'AI instructions include rotations, linked project and uncertainty');
$check(str_contains(cm_food_technology_notes(),'14 weeks per class') &&
    str_contains(cm_food_technology_notes(),'5-lesson introduction') &&
    str_contains(cm_food_technology_notes(),'10 lessons each'),
    'programme notes retain timing and year 8 ambiguity');

$public=dirname(__DIR__).'/public';
$api=(string)file_get_contents($public.'/curriculum_map_api.php');
$js=(string)file_get_contents($public.'/assets/curriculum_map/v1/map.js');
foreach ([
    "require_once __DIR__ . '/curriculum_map_food_technology.php'",
    'cm_food_technology_block_counts($groups)',
    'cm_food_technology_rules(false)',
    'cm_food_technology_rules(true)',
    'cm_food_technology_normalise_generated(',
] as $required)
    $check(str_contains($api,$required),'API integrated: '.$required);
foreach ([
    'const isFoodTechDept =',
    'const FOOD_TECH_BLOCKS =',
    'function foodTechProfile()',
    'makeFoodTechYear(label,per)',
    'FOOD_TECH_TOPICS[label]',
    'function makeFoodTechYear(label,fallback=4)',
    'isFoodTechDept() && foodTechCount(label) ? makeFoodTechYear(label,fallback)',
    'isFoodTechDept()?foodTechProfile()',
] as $required)
    $check(str_contains($js,$required),'client integrated: '.$required);
echo "PASS: Food Technology 5/5 rotations, 4/4 terms, topics, flexible groups, linked project, and both overview workflows.\n";
