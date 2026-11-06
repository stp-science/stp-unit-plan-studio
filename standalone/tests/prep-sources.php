<?php
declare(strict_types=1);
// Prep integration check: official curriculum data for the four year-based
// subjects and all three Te Reo Māori novice stages. No AI calls or DB writes.
require_once dirname(__DIR__) . '/public/curriculum_studio_lib.php';
require_once dirname(__DIR__) . '/public/curriculum_map_lib.php';
$sources = [
 'English' => 'english-2025',
 'Social Studies' => 'social-sciences-2026',
 'Maths' => 'maths-2025',
 'Health' => 'health-pe-2026',
];
$tested = 0;
foreach ($sources as $label => $source) {
  foreach ([7,8] as $year) {
    $rows = cs_year_statement_bank($source,$year);
    if (!$rows) throw new RuntimeException("$label Year $year has no official statements.");
    if ($label === 'Health') $rows = array_values(array_filter($rows,
      static fn($s) => ($s['subject'] ?? '') === 'Health'));
    if (!$rows) throw new RuntimeException("$label Year $year is empty after subject filtering.");
    foreach ($rows as $s) if (!in_array(($s['kind'] ?? ''),['knowledge','practice'],true)
      || empty($s['text']) || empty($s['source']))
      throw new RuntimeException("$label Year $year has an invalid curriculum statement.");
    echo "$label Year $year: " . count($rows) . " statements.\n";
    $tested++;
  }
}
$doc=cs_catalogue_doc('languages-te-reo-maori-sep-2026');
if (!$doc || ($doc['learningArea'] ?? '') !== 'Learning Languages')
  throw new RuntimeException('Te Reo Māori official curriculum source not found.');
$levels=cm_doc_levels($doc);
foreach (['Novice 1','Novice 2','Novice 3'] as $level) {
  if (empty($levels[$level])) throw new RuntimeException("Te Reo Māori $level not indexed.");
  $prepared=cm_bank_prepare('languages-te-reo-maori-sep-2026',7,'',$level);
  if (is_string($prepared) || empty($prepared[1]))
    throw new RuntimeException("Te Reo Māori $level statement extraction not available.");
  echo "Te Reo Māori $level: official source indexed.\n";
  $tested++;
}
$js=(string)file_get_contents(dirname(__DIR__) . '/public/assets/curriculum_studio/v5/guide.js');
$api=(string)file_get_contents(dirname(__DIR__) . '/public/curriculum_studio_api.php');
foreach (['function prepTopicCard()', 'function prepOutlineCard()', 'async function openPrepTab(',
  'source.novice?NOVICE:[7,8]', "s.subject==='Health'", 'prepLoaded',
  "doc_id:source.id,stage:level"] as $token) {
  if (!str_contains($js,$token)) throw new RuntimeException('Prep UI is missing: '.$token);
}
if (!str_contains($api,'prepInterdisciplinary') || !str_contains($api,'PREP UNITS:'))
  throw new RuntimeException('Prep generation guidance is missing.');
echo "Passed $tested official curriculum-source and proficiency checks, plus Prep UI and generation checks. No AI calls.\n";
