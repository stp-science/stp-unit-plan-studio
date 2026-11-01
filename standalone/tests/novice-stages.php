<?php
declare(strict_types=1);
// No AI calls or database changes. Check all five Ministry language sequences.
require_once dirname(__DIR__) . '/public/curriculum_map_lib.php';
$files = [
    'languages-french-sep-2026',
    'languages-spanish-sep-2026',
    'languages-japanese-sep-2026',
    'languages-chinese-mandarin-sep-2026',
    'languages-te-reo-maori-sep-2026',
];
foreach ($files as $id) {
    $doc = cs_catalogue_doc($id);
    if (!$doc || ($doc['learningArea'] ?? '') !== 'Learning Languages') throw new RuntimeException('Missing language curriculum source ' . $id);
    $levels = cm_doc_levels($doc);
    foreach (['Novice 1', 'Novice 2', 'Novice 3'] as $level) {
        if (empty($levels[$level])) throw new RuntimeException($id . ': missing ' . $level);
        $prepared = cm_bank_prepare($id, 7, '', $level);
        if (is_string($prepared) || empty($prepared[1])) throw new RuntimeException($id . ': cannot read ' . $level);
    }
    // Any two selected stages must contribute source pages to the combined
    // evidence pool. Never assume Novice 1/2/3 correspond to Year 7/8/9.
    $one = cm_doc_levels($doc)['Novice 1'];
    $two = cm_doc_levels($doc)['Novice 2'];
    $p1 = array_unique(array_map(static fn($pg) => (int)($pg['page'] ?? 0), $one));
    $p2 = array_unique(array_map(static fn($pg) => (int)($pg['page'] ?? 0), $two));
    $combined = array_unique(array_merge($p1, $p2));
    if (!$p1 || !$p2 || count($combined) < max(count($p1), count($p2))) throw new RuntimeException($id . ': Novice level pages could not be combined.');
    echo $doc['subject'] . ": Novice 1 / 2 / 3 verified.\n";
}
echo "All five language curricula passed. No API requests.\n";
