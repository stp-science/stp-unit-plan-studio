<?php
declare(strict_types=1);
// Offline regression for mapped-unit drafting failures. This deliberately
// makes no HTTP or AI requests and does not read or modify saved maps/plans.
$base=dirname(__DIR__).'/public';
$api=(string)file_get_contents($base.'/curriculum_studio_api.php');
$js=(string)file_get_contents($base.'/assets/curriculum_studio/v5/guide.js');
$lib=(string)file_get_contents($base.'/curriculum_studio_lib.php');
foreach ([
    "cm_unit_context(\$pdo, \$schoolId, \$teacherId,",
    "cm_get_statements(\$pdo, \$schoolId",
    "if (!\$knowledge && !\$practices) \$fail(",
    "selectedCurriculumYears",
    "The selected statements are the contract",
    "\$requestPhase = 'reading the linked department curriculum map'",
    "\$requestPhase = 'reading the selected curriculum statements'",
    "\$requestPhase = 'validating selected curriculum statements'",
    "try {\n                \$senior = cs_senior_future(",
    "optional senior curriculum context",
    "Reference: '.\$requestId",
    "get_class(\$e).': '.\$e->getMessage()",
] as $required) {
    if (!str_contains($api,$required))
        throw new RuntimeException('Mapped-unit drafting safety check missing: '.$required);
}
if (!str_contains($js,"banner = {kind: 'err'") ||
    !str_contains($js,"retry: e.noRetry ? null : () => run(title, stages, fn)") ||
    !str_contains($js,"G.plan = normalisePlan(r); save(); view = 'guide'"))
    throw new RuntimeException('Retry would not preserve the current draft and selections.');
if (!str_contains($lib,'function cs_senior_future('))
    throw new RuntimeException('Senior curriculum helper missing.');
// Social Sciences is the reported subject. Its senior context is optional;
// do not let a missing senior catalogue stop drafting the selected Y10 unit.
require_once $base.'/curriculum_studio_lib.php';
$links=cs_senior_future('Social Sciences','Migration and cultural change',
    'social and political systems cultural perspectives population migration historical changes');
if (!is_array($links)) throw new RuntimeException('Unexpected senior context shape for Social Sciences.');
echo "PASS: mapped-unit statement authority, preserved selections, optional senior context and diagnostic failure reference.\n";
