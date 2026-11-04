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
 "shellEl.classList.toggle('is-full',!!G || !!librarySubject)",
 "librarySubject=st.subject||null",
 'pendingSaveTimers = new Map()'
] as $required) {
    if (!str_contains($js,$required))
        throw new RuntimeException('Subject library regression: '.$required);
}
foreach ([
 '.cg-shell.is-full .cg-side{display:none!important}',
 '.cg-library-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}',
 '@media(max-width:640px){.cg-library-grid{grid-template-columns:minmax(0,1fr)}'
] as $required) {
    if (!str_contains($css,$required))
        throw new RuntimeException('Responsive layout regression: '.$required);
}
if (str_contains($js,"sidebarGroupsOpen") || str_contains($js,"cg-subject-items"))
    throw new RuntimeException('Cramped expand-all sidebar has returned.');
echo "Subject-count sidebar, full-width unit tile library, plan navigation, autosave and mobile styling found.\n";
