<?php
declare(strict_types=1);
// Complete, non-AI fallback must work for EVERY supported junior learning area.
// No API calls, no database writes and no user accounts required.
require_once dirname(__DIR__) . '/public/curriculum_studio_lib.php';

$subjects = [
    'Science' => ['science-aug-2026', ''],
    'English' => ['english-2025', ''],
    'Mathematics and Statistics' => ['maths-2025', ''],
    'Health and Physical Education' => ['health-pe-2026', ''],
    'Social Sciences' => ['social-sciences-2026', ''],
    'Technology' => ['technology-2026', ''],
    'Drama' => ['arts-sep-2026', 'Drama'],
    'Music' => ['arts-sep-2026', 'Music'],
    'Dance' => ['arts-sep-2026', 'Dance'],
    'Visual Arts' => ['arts-sep-2026', 'Visual Arts'],
];
$counts = [];
foreach ($subjects as $name => [$id, $discipline]) {
    foreach ([7, 8, 9, 10] as $year) {
        $rows = cs_year_statement_bank($id, $year, $discipline);
        if (!$rows) throw new RuntimeException("$name Year $year has no selectable curriculum statements.");
        $seen = [];
        foreach ($rows as $s) {
            if (trim($s['text'] ?? '') === '' || trim($s['source'] ?? '') === '' || !in_array($s['kind'] ?? '', ['knowledge', 'practice'], true))
                throw new RuntimeException("$name Year $year returned an invalid curriculum statement.");
            if ($discipline !== '' && $s['subject'] !== $discipline)
                throw new RuntimeException("$name Year $year included a statement from a different Arts discipline.");
            if (isset($seen[$s['id']])) throw new RuntimeException("$name Year $year contained duplicate IDs.");
            $seen[$s['id']] = true;
        }
        $counts[$name][$year] = count($rows);
    }
}
$drama = cs_year_statement_bank('arts-sep-2026', 7, 'Drama');
$music = cs_year_statement_bank('arts-sep-2026', 9, 'Music');
$contains = static fn(array $rows, string $term): bool => count(array_filter($rows, static fn($s) => stripos($s['text'], $term) !== false)) > 0;
if (!$contains($drama, 'culture') || !$contains($drama, 'performance'))
    throw new RuntimeException('Drama fallback lacks the curriculum connections for Theatre Aotearoa.');
if (!$contains($music, 'film') || !$contains($music, 'innovation'))
    throw new RuntimeException('Music fallback lacks the curriculum connections for Film Music.');
if (cs_year_statement_bank('arts-sep-2026', 7, 'Physical Education'))
    throw new RuntimeException('Arts fallback mixed an unrelated discipline.');
if (cs_year_statement_bank('arts-sep-2026', 11, 'Drama'))
    throw new RuntimeException('Junior source was offered for a senior year.');
foreach ($counts as $name => $years) echo $name . ': ' . implode(', ', array_map(
    static fn($year, $count) => "Year $year: $count",
    array_keys($years), array_values($years))) . " statements.\n";
echo "All 40 subject/year combinations passed. Thematic Drama and Music cases passed. No API calls.\n";
