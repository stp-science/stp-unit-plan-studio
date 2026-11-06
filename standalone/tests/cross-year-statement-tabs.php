<?php
declare(strict_types=1);
// Offline checks for Year 7–10 statement tabs. No API calls, no DB mutations.
require_once dirname(__DIR__) . '/public/curriculum_studio_lib.php';
$areas = [
  'Science' => ['science-aug-2026', ''],
  'English' => ['english-2025', ''],
  'Mathematics' => ['maths-2025', ''],
  'Health & PE' => ['health-pe-2026', ''],
  'Social Sciences' => ['social-sciences-2026', ''],
  'Technology' => ['technology-2026', ''],
  'Drama' => ['arts-sep-2026', 'Drama'],
  'Music' => ['arts-sep-2026', 'Music'],
  'Dance' => ['arts-sep-2026', 'Dance'],
  'Visual Arts' => ['arts-sep-2026', 'Visual Arts'],
];
$tested = 0;
foreach ($areas as $name => [$source, $discipline]) {
  foreach ([7,8,9,10] as $year) {
    $rows = cs_year_statement_bank($source, $year, $discipline);
    if (!$rows) throw new RuntimeException("$name Year $year has no source statements for its tab.");
    foreach ($rows as $row) {
      if (!in_array(($row['kind'] ?? ''), ['knowledge','practice'], true) || empty($row['text']) || empty($row['source']))
        throw new RuntimeException("$name Year $year has an invalid entry.");
      if ($discipline !== '' && ($row['subject'] ?? '') !== $discipline)
        throw new RuntimeException("$name Year $year includes a different Arts discipline.");
    }
    $tested++;
  }
}
$js = file_get_contents(dirname(__DIR__) . '/public/assets/curriculum_studio/v5/guide.js');
$css = file_get_contents(dirname(__DIR__) . '/public/assets/curriculum_studio/v5/guide.css');
foreach ([
 'async function switchStatementYear(year)',
 "year:String(year)",
 'curriculumYear:year',
 'const yearBankLoaded',
 'const statementsForYear',
 'role:\'tablist\'',
 "if (G.mapRef) await mapSavePromise",
] as $token) {
 if (!str_contains($js, $token)) throw new RuntimeException('Missing year-tab feature: ' . $token);
}
if (!str_contains($css, '.cg-year-tablist')) throw new RuntimeException('Missing year-tab styles.');
echo "Passed $tested subject/year bank combinations, separate tab controls, provenance, selection persistence and map-save guards. No AI calls.\n";
