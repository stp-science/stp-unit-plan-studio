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
 "shellEl.classList.add('is-full')",
 "librarySubject=st.subject||null",
 'pendingSaveTimers = new Map()',
 'function subjectDirectoryView()',
 "class:'cg-subject-card'",
 "class:'cg-subject-directory'"
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
 'three-column subject directory' => '/\\.cg-subject-directory\\s*\\{[^}]*grid-template-columns\\s*:\\s*repeat\\(3\\s*,\\s*minmax\\(0\\s*,\\s*1fr\\)\\)/s',
 'two-column subject directory' => '/@media\\s*\\(max-width\\s*:\\s*1000px\\)[^{]*\\{\\s*\\.cg-subject-directory\\s*\\{[^}]*grid-template-columns\\s*:\\s*repeat\\(2\\s*,\\s*minmax\\(0\\s*,\\s*1fr\\)\\)/s',
 'single-column mobile subjects' => '/@media\\s*\\(max-width\\s*:\\s*640px\\)[^{]*\\{\\s*\\.cg-subject-directory\\s*\\{[^}]*grid-template-columns\\s*:\\s*minmax\\(0\\s*,\\s*1fr\\)/s',
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
 'const plans=[...group.plans].sort',
 'onclick:()=>showSubjectLibrary(group.key)',
 'onclick:()=>open(g.id)',
 "'english as an additional language':'English as an Additional Language'",
 "for (const name of ['Prep','English as an Additional Language'])"
] as $required) {
    if (!str_contains($js, $required))
        throw new RuntimeException('All-subject navigation regression: '.$required);
}
if (str_contains($js,"sidebarGroupsOpen") || str_contains($js,"cg-subject-items"))
    throw new RuntimeException('Cramped expand-all sidebar has returned.');
echo "Three-column responsive subject directory, full-width unit plan tiles, navigation and autosave checks passed.\n";
