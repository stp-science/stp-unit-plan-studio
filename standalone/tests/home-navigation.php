<?php
declare(strict_types=1);
// Offline check of the three independent homepage modes and curriculum-design
// resources. No authentication, server writes or external/API requests.
$public=dirname(__DIR__) . '/public';
$routes=[
 'Single unit plan' => 'curriculum_studio.php?guide=1&amp;blank=1',
 'Curriculum overview' => 'curriculum_studio.php?mode=overview&amp;department=',
 'Existing overview' => 'curriculum_studio.php?mode=existing&amp;department='
];
foreach (['curriculum_map.php','curriculum_studio.php'] as $page) {
 $html=(string)file_get_contents($public.'/'.$page);
 foreach ($routes as $label=>$route) {
  if (!str_contains($html,'href="'.$route) || !str_contains($html,'>'.$label.'</a>'))
   throw new RuntimeException("$page does not link to mode: $label");
 }
 if (str_contains($html,'>Start</a>') || str_contains($html,'>Unit plans</a>'))
  throw new RuntimeException("$page still contains the old duplicated header links.");
}
$map=(string)file_get_contents($public.'/assets/curriculum_map/v1/map.js');
$css=(string)file_get_contents($public.'/assets/curriculum_map/v1/map.css');
foreach ([
 "requestedMode === 'overview'",
 "requestedMode === 'existing'",
 "navigationMode='overview'",
 "navigationMode='existing'",
 'Principles of a knowledge-rich curriculum',
 'https://newzealandcurriculum.tahurangi.education.govt.nz/',
 'cm-knowledge-principle',
 'Check understanding as you teach',
 'Build a coherent sequence'
] as $required) {
 if (!str_contains($map,$required)) throw new RuntimeException('Missing mode routing or homepage guidance: '.$required);
}
if (!str_contains($css,'.cm-knowledge-grid')) throw new RuntimeException('Missing homepage guidance layout.');
echo "Passed three distinct header modes on both pages, home routing, Ministry link and knowledge-rich curriculum guidance. No API calls.\n";
