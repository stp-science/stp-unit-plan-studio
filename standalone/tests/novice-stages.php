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
    echo $doc['subject'] . ": Novice 1 / 2 / 3 verified.\n";
}
echo "All five language curricula passed. No API requests.\n";
