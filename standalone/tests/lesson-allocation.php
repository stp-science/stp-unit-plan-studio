<?php
declare(strict_types=1);
require dirname(__DIR__) . '/public/curriculum_studio_lib.php';
$focuses = [['lessonScope' => 'brief', 'lessonCount' => 3], ['lessonScope' => 'standard', 'lessonCount' => 2]];
if (cs_lesson_counts($focuses, 20) !== [1, 2]) throw new RuntimeException('Spare time must not inflate a short unit.');
if (cs_lesson_counts([['lessonScope' => 'brief', 'lessonCount' => 4]], 6) !== [1]) throw new RuntimeException('Brief context must stay short.');
if (cs_lesson_counts([[]], null) !== [1]) throw new RuntimeException('Missing count must not default to three.');
$reduced = cs_lesson_counts([['lessonScope' => 'brief', 'lessonCount' => 1], ['lessonScope' => 'extended', 'lessonCount' => 5]], 4);
if ($reduced !== [1, 3]) throw new RuntimeException('A smaller time limit should reduce substantive focuses.');
echo "Passed brief-focus cap, no padding into spare weeks, safe default and reduced-time checks. No AI calls.\n";
