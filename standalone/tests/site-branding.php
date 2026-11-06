<?php
declare(strict_types=1);
// Offline regression: school-wide branding, bundled logo and grouped unit plans.
// No database access, external network calls or AI credits.
$public = dirname(__DIR__) . '/public';
$theme = file_get_contents($public . '/assets/stp-brand.css');
$crest = file_get_contents($public . '/assets/stp-crest.svg');
if (!$theme || !$crest) throw new RuntimeException('Missing shared theme or crest.');
foreach (['curriculum-map', 'curriculum-studio'] as $page) {
    if (!str_contains($theme, 'body[data-page="' . $page . '"]')) {
        throw new RuntimeException('Missing ' . $page . ' page theme.');
    }
}
foreach (['#001733', '#cf082b', '#82adbf', '#ede8e3'] as $hex) {
    if (!str_contains($theme, $hex)) throw new RuntimeException('Missing school colour: ' . $hex);
}
foreach (['curriculum_map.php', 'curriculum_studio.php'] as $name) {
    $page = file_get_contents($public . '/' . $name);
    if (!$page || !str_contains($page, 'assets/stp-brand.css')
        || !str_contains($page, 'assets/stp-crest.svg')
        || !str_contains($page, 'stp-nav-name')) {
        throw new RuntimeException($name . ' is missing site-wide branding.');
    }
}
if (!preg_match('~data:image/webp;base64,([A-Za-z0-9+/=]+)~', $crest, $m)) {
    throw new RuntimeException('Local crest is not embedded in the SVG.');
}
$webp = base64_decode($m[1], true);
if (!is_string($webp) || substr($webp, 0, 4) !== 'RIFF' || substr($webp, 8, 4) !== 'WEBP') {
    throw new RuntimeException('The school crest image is damaged.');
}
$sidebar = file_get_contents($public . '/assets/curriculum_studio/v5/guide.js');
if (!str_contains($sidebar, 'function guideSubject(g)')
    || !str_contains($sidebar, 'cg-subject-select')
    || !str_contains($sidebar, 'assets/stp-crest.svg')) {
    throw new RuntimeException('Subject-grouped plan sidebar lost its branding or filtering.');
}
echo "Passed map/landing, unit-plan/settings, school palette, local crest and subject sidebar checks. No network/API calls.\n";
