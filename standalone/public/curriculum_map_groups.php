<?php
declare(strict_types=1);
// Standalone helpers for precise year/stage selection in curriculum overviews.
// Whitelist overview groups by subject. Unspecified groups on an import means
// 'keep every group found in the supplied files' rather than forcing four years.
function cm_requested_overview_groups($raw, string $department): array
{
    if (!is_array($raw) || count($raw) > 7) throw new CsInvalid('Choose up to seven valid year groups or proficiency stages.');
    $dept=mb_strtolower(trim($department));
    $allowed=$dept==='english as an additional language'
      ? array_map(static fn(int $n): string => 'Stage '.$n,range(1,5))
      : ($dept==='prep' ? ['Year 7','Year 8']
        : (preg_match('/french|spanish|japanese|chinese|mandarin|te reo|māori|maori|language|german|italian|samoan|korean/i',$department)
          ? array_map(static fn(int $n): string => 'Novice '.$n,range(1,3))
          : array_map(static fn(int $n): string => 'Year '.$n,range(7,13))));
    $groups=[];
    foreach ($raw as $g) {
        if (!is_string($g) || !in_array($g,$allowed,true))
            throw new CsInvalid('One of the chosen year groups or proficiency stages is not valid for this subject.');
        if (!in_array($g,$groups,true)) $groups[]=$g;
    }
    return $groups;
}
// Keep only explicitly selected groups while leaving the unit sequence within
// each group unchanged. Empty selection means use every group actually found.
function cm_filter_import_groups(array $data, array $groups): array
{
    if (!$groups) return $data;
    $allowed=array_flip($groups);
    $data['years']=array_values(array_filter((array)($data['years']??[]),
        static fn($y) => is_array($y) && isset($allowed[trim((string)($y['label']??''))])));
    if (!$data['years'])
        throw new CsInvalid('None of the chosen groups were found in these documents. Check the year or stage labels, or choose all groups.');
    return $data;
}

