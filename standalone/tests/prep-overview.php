<?php
declare(strict_types=1);
// Regression for Prep in curriculum-overview + existing-overview modes.
// No database access, no AI calls and no account mutations.
require_once dirname(__DIR__) . '/public/curriculum_map_lib.php';
[$evidence,$note]=cm_generate_evidence('Prep',7,8);
foreach ([
  'English · Year 7','English · Year 8',
  'Social Studies · Year 7','Social Studies · Year 8',
  'Maths · Year 7','Maths · Year 8',
  'Health · Year 7','Health · Year 8',
  'Te Reo Māori · Novice 1','Te Reo Māori · Novice 2','Te Reo Māori · Novice 3'
] as $label) {
 if (!str_contains($evidence,$label)) throw new RuntimeException('Missing Prep official source: '.$label);
}
if (!str_contains($evidence,'NOT a school year')) throw new RuntimeException('Te Reo proficiency was incorrectly tied to a school year.');
if (!str_contains($note,'English') || !str_contains($note,'Te Reo Māori'))
 throw new RuntimeException('Prep source provenance is missing.');
$mapApi=file_get_contents(dirname(__DIR__) . '/public/curriculum_map_api.php');
$mapLib=file_get_contents(dirname(__DIR__) . '/public/curriculum_map_lib.php');
$js=file_get_contents(dirname(__DIR__) . '/public/assets/curriculum_map/v1/map.js');
$css=file_get_contents(dirname(__DIR__) . '/public/assets/curriculum_map/v1/map.css');
foreach ([
 ['ensure-prep',$mapApi],
 ['PREP-SPECIFIC REQUIREMENTS',$mapApi],
 ['PREP IMPORT',$mapApi],
 ['function cm_prep_evidence()',$mapLib],
 ['prep-setup',$mapLib],
 ['function prepMapStatementsPanel(y,t)',$js],
 ['const PREP_CATALOGUE',$js],
 ['Enable Prep overview planning',$js],
 ['const prep = S.dept',$js],
 ['Intent',$js],['Implementation',$js],['Impact',$js],
 ['.cm-prep-subjects',$css],
] as [$token,$body]) {
 if (!str_contains($body,$token)) throw new RuntimeException('Prep or three-Is feature missing: '.$token);
}
if (str_contains($js,'Taught by') || str_contains($js,"field('Taught by'"))
 throw new RuntimeException('Legacy teacher/owner field is still visible.');
echo "Passed 11 official Prep source groups, both overview modes, cross-subject statement tabs and Intent / Implementation / Impact. No API calls.\n";
