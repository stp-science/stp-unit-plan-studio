<?php
declare(strict_types=1);
// Offline regression check: subject counts -> full-width tile library -> plan editor.
// No network, database or user accounts needed.
$public=dirname(__DIR__) . '/public';
$js=(string)file_get_contents($public.'/assets/curriculum_studio/v5/guide.js');
$css=(string)file_get_contents($public.'/assets/curriculum_studio/v5/guide.css');
foreach ([
 'function guideGroups()',
 'function showSubjectLibrary(key)',
 'function libraryView()',
 "class:'cg-library-tile'",
 'function backToLibrary()',
 "shellEl.classList.toggle('is-full',!!G)",
 "librarySubject=st.subject||null",
 'pendingSaveTimers = new Map()',
 "class:'cg-side-subject'",
 "class:'cg-side-subjects'",
 "if (!G) return [libraryView()]",
 "class:'cg-shell'",
 "requestedSubject=guideSubject({subject:q.get('subject')})",
 "const all=selected?[...group.plans]:[...guides]"
] as $required) {
    if (!str_contains($js,$required))
        throw new RuntimeException('Subject library regression: '.$required);
}
// Validate the intended declarations rather than requiring a CSS rule to end
// immediately after grid-template-columns (the grid also has a gap property).
foreach ([
 'sidebar hidden in full-width views' => '/\\.cg-shell\\.is-full\\s+\\.cg-side\\s*\\{[^}]*display\\s*:\\s*none\\s*!important/s',
 'three-column desktop tile grid' => '/\\.cg-library-grid\\s*\\{[^}]*grid-template-columns\\s*:\\s*repeat\\(3\\s*,\\s*minmax\\(0\\s*,\\s*1fr\\)\\)/s',
 'two-column medium-screen grid' => '/@media\\s*\\(max-width\\s*:\\s*1080px\\)[^{]*\\{\\s*\\.cg-library-grid\\s*\\{[^}]*grid-template-columns\\s*:\\s*repeat\\(2\\s*,\\s*minmax\\(0\\s*,\\s*1fr\\)\\)/s',
 'single-column small-screen grid' => '/@media\\s*\\(max-width\\s*:\\s*640px\\)[^{]*\\{\\s*\\.cg-library-grid\\s*\\{[^}]*grid-template-columns\\s*:\\s*minmax\\(0\\s*,\\s*1fr\\)/s',
 'three-column sidebar subjects' => '/\\.cg-side-subjects\\s*\\{[^}]*grid-template-columns\\s*:\\s*repeat\\(3\\s*,\\s*minmax\\(0\\s*,\\s*1fr\\)\\)/s',
 'two-column mobile sidebar' => '/@media\\s*\\(max-width\\s*:\\s*470px\\)[^{]*\\{\\s*\\.cg-side-subjects\\s*\\{[^}]*grid-template-columns\\s*:\\s*repeat\\(2\\s*,\\s*minmax\\(0\\s*,\\s*1fr\\)\\)/s',
 'left column remains visible' => '/\\.cg-shell:not\\(\\.is-full\\)\\s*\\{[^}]*grid-template-columns\\s*:\\s*395px\\s+minmax\\(0\\s*,\\s*1fr\\)/s',
] as $label => $pattern) {
    if (!preg_match($pattern, $css))
        throw new RuntimeException('Responsive layout regression: '.$label);
}
// Every saved subject follows the same path; this must not be hard-coded to French.
foreach ([
 'for (const guide of guides)',
 'const name = guideSubject(guide), key = subjectKey(name)',
 'groups.get(key).plans.push(guide)',
 'const groups=guideGroups()',
 'const all=selected?[...group.plans]:[...guides]',
 'onclick:()=>showSubjectLibrary(group.key)',
 'onclick:()=>open(g.id)',
 "'english as an additional language':'English as an Additional Language'",
 "for (const name of ['Prep','English as an Additional Language',requestedSubject].filter(Boolean))"
] as $required) {
    if (!str_contains($js, $required))
        throw new RuntimeException('All-subject navigation regression: '.$required);
}
if (str_contains($js,"sidebarGroupsOpen") || str_contains($js,"cg-subject-items"))
    throw new RuntimeException('Cramped expand-all sidebar has returned.');
echo "Three-column subject sidebar, visible saved plans, selected-subject link, full-width plan editor and autosave checks passed.\n";
