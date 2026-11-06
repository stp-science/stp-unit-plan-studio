<?php
declare(strict_types=1);
// Food Technology's curriculum shape is not a generic four-term sequence.
// Keep this separate from the Ministry statement bank and saved map tables.
function cm_is_food_technology(string $department): bool
{
    return (bool)preg_match('/^(food(?:\s*technology|\s*tech)?|food\s*&\s*hospitality)$/iu', trim($department));
}
function cm_food_technology_block_counts(array $groups): array
{
    $known=['Year 7'=>5,'Year 8'=>5,'Year 9'=>4,'Year 10'=>4];
    $counts=[];
    foreach ($groups as $group)
        if (isset($known[$group])) $counts[$group]=$known[$group];
    return $counts;
}
function cm_food_technology_notes(): string
{
    return 'Food Technology programme: Year 7 uses five teaching rotations (14 weeks per class, three 55-minute lessons weekly), with induction, practical skills and portfolio assessment. Year 8 uses five rotations/technology areas, approximately 10 lessons each, three lessons per seven-day cycle; a linked project continues as classes change technology areas. Brief, make, design, innovate and outcome form the process; outcome and portfolio are assessed. A 5-lesson introduction, 10-lesson context and 5-lesson conclusion were also proposed; confirm these timings with staff rather than treating them as 10 lessons per rotation. Year 9 is four terms: Pasta, Breads, with Terms 3–4 undecided; practical and portfolio assessment at the end of each topic. Year 10 is four terms: Burger competition, Sports nutrition, Desserts (functional ingredients and hospitality), and Future food (food systems and future pathways); practical and portfolio assessment at the end of each topic.';
}
function cm_food_technology_rules(bool $import): string
{
    $shared = <<<'RULES'
FOOD TECHNOLOGY DEPARTMENT - SCHOOL-SUPPLIED STRUCTURE (takes priority over generic four-term school-year assumptions):
- Year 7: FIVE rotations, NOT five consecutive 14-week terms per student. Each class attends a 14-week rotation, with three 55-minute lessons per week. Assessment: induction assessment, practical skills and portfolio. Do not invent names for the five teaching areas when none are provided.
- Year 8: FIVE rotations across technology areas; each area is described as approximately TEN lessons, with three lessons in a seven-day timetable cycle. There are five groups over the school year. A connected project follows students when they move between technology areas: do not treat each area as a wholly unrelated project. Brief, make, design, innovate and outcome describe project stages; assess the outcome and portfolio. Staff also described a FIVE-lesson introduction, TEN-lesson context and FIVE-lesson ending. These timings do not directly reconcile with ten lessons per rotation; preserve both as provisional context and do not falsely equate the totals or make up a timetable.
- Year 9: whole-year Food Technology, FOUR terms and FOUR topic slots (one per term). Known topics: Pasta and Breads. Term 3 and Term 4 topics have NOT been decided. Do not assert or invent their titles as settled units. Practical and portfolio assessment at the end of each topic.
- Year 10: whole-year Food Technology, FOUR terms, with one topic in each: Burger competition; Sports nutrition; Desserts (functional ingredients and hospitality); Future food (food systems and future pathways). Practical and portfolio assessment at the end of each topic.
- For Years 7–8 use block labels Rotation 1, Rotation 2, etc.; for Years 9–10 use Term 1, Term 2, etc. Each group has its OWN block count; do not use the same count across all selected years.
- Keep Year 7–8 rotations as schedule slots, not invented or repeated named subject units. A rotation with no known specific unit may contain an empty topics list.
- Preserve the school's real unit titles and curriculum statements. Assessments and project stages do not become extra disconnected topics merely because they are listed here. Keep teacher or owner empty.
RULES;
    return "\n\n".$shared.($import
        ? "\nFor uploaded documents, the actual source sequence and titles take precedence where explicit. Use these rules to interpret rotations, linked projects and assessments, not to overwrite or duplicate topics in documents. Where the documents contradict the planning notes, preserve the documents and flag the discrepancy in map notes. Never invent missing uploads."
        : "\nFor a new generated overview, use EXACTLY five blocks for each requested Year 7 and Year 8 and four blocks for each requested Year 9 and Year 10. Keep unnamed rotations and undecided Year 9 Term 3/4 units empty rather than fabricating names. Do not insert generic filler topics. Return the above teaching and assessment constraints concisely in the map notes so future unit planning can use them.");
}
/** Normalise generated block counts/labels without deleting any genuine topic. */
function cm_food_technology_normalise_generated(array $data, string $teacherNotes = ''): array
{
    $knownTitles=[
        'Year 9'=>['Pasta','Breads'],
        'Year 10'=>[
            'Burger competition',
            'Sports nutrition',
            'Desserts (functional ingredients and combined hospitality)',
            'Future food (food systems and future pathways)',
        ],
    ];
    foreach ($data['years'] ?? [] as &$year) {
        $label=trim((string)($year['label']??''));
        $counts=cm_food_technology_block_counts([$label]);
        if (!isset($counts[$label])) continue;
        $needed=$counts[$label];
        $blocks=(array)($year['blocks']??[]);
        if (count($blocks)>$needed)
            throw new CsInvalid($label.' Food Technology must use '.$needed.' rotation/term slots. AI returned extra slots, so no incorrect map was saved.');
        while (count($blocks)<$needed) $blocks[]=['label'=>'','topics'=>[]];
        foreach ($blocks as $i=>&$block) {
            $block['label']=($label==='Year 7'||$label==='Year 8'?'Rotation ':'Term ').($i+1);
            // User-supplied year 9 and 10 topic names are definitive for
            // these slots. Preserve model-proposed strands and assessments,
            // but never change the programme's actual unit names.
            if (isset($knownTitles[$label][$i])) {
                if (count((array)($block['topics']??[]))>1)
                    throw new CsInvalid($label.' Term '.($i+1).' must contain one Food Technology topic, not several.');
                $topic=(array)($block['topics'][0]??[]);
                $block['topics']=[array_replace([
                    'title'=>'','strand'=>'','assess'=>'','owner'=>'',
                    'optional'=>false,
                ],$topic,['title'=>$knownTitles[$label][$i],'owner'=>''])];
            }
            // Staff have NOT agreed Year 9 Term 3/4 titles. Keep them
            // unassigned unless their own notes specify a corresponding term.
            if ($label==='Year 9' && $i>=2) {
                $term=$i+1;
                $termLabel='/(?:\\bterm\\s*'.$term.'\\b|\\bt'.$term.'\\b|\\b'.($term===3?'third':'fourth').'\\s+term\\b)/iu';
                if (!preg_match($termLabel,$teacherNotes))
                    $block['topics']=[];
            }
        }
        unset($block);
        $year['blocks']=$blocks;
    }
    unset($year);
    return $data;
}
