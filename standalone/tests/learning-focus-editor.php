<?php
declare(strict_types=1);
// Offline regression: editable learning focuses and aligned text fields.
// Reads only local source files; no server writes, AI use or database access.
$public = dirname(__DIR__) . '/public';
$js = (string) file_get_contents($public . '/assets/curriculum_studio/v5/guide.js');
$css = (string) file_get_contents($public . '/assets/curriculum_studio/v5/guide.css');

foreach ([
    'function addLearningFocus()',
    'function deleteLearningFocus(index)',
    'p.focuses.push({',
    'p.focuses.splice(at,1)',
    "openDlg('Delete learning focus'",
    'if (p.focuses.length<=1)',
    "class:'cg-focus-remove'",
    "class:'cg-btn cg-focus-add'",
    "class:'cg-ghost cg-focus-add'",
    'reviewChecklist(), overview, focusActions, ...focuses, focusBottom',
    'closed.clear();' // reset collapsed state when removing a focus
] as $required) {
    if (!str_contains($js, $required))
        throw new RuntimeException('Learning-focus control missing: ' . $required);
}
if (substr_count($js, 'relabel(p);') < 3)
    throw new RuntimeException('Learning-focus lesson numbering may not update.');
foreach ([
    '.cg-focus .cg-fbody>.cg-grid',
    'grid-template-columns:minmax(0,1fr)',
    '.cg-focus .cg-fbody .cg-f textarea',
    'text-align:left;text-indent:0',
    '.cg-focus .cg-fhead{flex-wrap:wrap'
] as $required) {
    if (!str_contains($css, $required))
        throw new RuntimeException('Learning-focus alignment missing: ' . $required);
}
echo "Learning-focus add/delete controls, confirmation, lesson numbering and left-aligned full-width text fields: OK.\n";
