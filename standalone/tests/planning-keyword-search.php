<?php
declare(strict_types=1);
// Regression: teachers can enter planning keywords before choosing Ministry
// statements; results move relevant official statements first without
// changing the stored statement wording, chosen ticks or curriculum bank.
// No database, AI calls, credentials or saved-plan writes are required.
$public=dirname(__DIR__).'/public';
$ui=(string)file_get_contents($public.'/assets/curriculum_studio/v5/guide.js');
$css=(string)file_get_contents($public.'/assets/curriculum_studio/v5/guide.css');
$api=(string)file_get_contents($public.'/curriculum_studio_api.php');
$check=static function (bool $ok,string $reason):void {
    if (!$ok) throw new RuntimeException('Planning keyword regression: '.$reason);
};
$check(str_contains($ui,"keywords: '', pasted: ''"),'new units save their keywords');
$check(str_contains($ui,'function planningKeywordField()'),'keyword field exists on unit setup');
$check(str_contains($ui,"'Keyword Search'"),'visible keyword heading');
$check(substr_count($ui,'planningKeywordField(),')>=3,'normal, Prep and EAL unit setup all offer keywords');
$check(str_contains($ui,"G.keywords=e.target.value.slice(0,400);save();"),'keywords are saved with the correct unit');
$check(str_contains($ui,'function statementKeywordScore(statement,keywords)'),'ranking function exists');
$check(str_contains($ui,'function rankCurriculumStatements(statements,keywords)'),'stable relevance ordering exists');
$check(str_contains($ui,'const ordered=rankCurriculumStatements(list,G.keywords);'),'ordinary outline sorts statement copies');
$check(str_contains($ui,'rankCurriculumStatements(rows,G.keywords)'),'Prep keeps its curriculum subject tabs');
$check(str_contains($ui,'rankCurriculumStatements(ealRows(G,key,stage),G.keywords)'),'EAL keeps its proficiency stage tabs');
$check(str_contains($ui,'return [...statements];'),'no keywords preserves the original statement order');
$check(str_contains($ui,'return statements.map((statement,index)'),'sorting does not mutate the source list');
$check(str_contains($ui,'const relevance=statementKeywordScore(s,G.keywords)'),'matching statements identified');
$check(str_contains($ui,"'Keyword match'"),'relevance label shown');
$check(str_contains($ui,'keywordOrderingHint('),'keyword match counts shown');
$check(str_contains($ui,"keywords: G.keywords||''"),'keyword hints sent to the official matcher');
$check(str_contains($api,"\$keywords = \$str(\$in['keywords'] ?? '', 400)"),'backend bounds keyword input');
$check(str_contains($api,'relevance hints across curriculum strands only, NOT official statements'),'keywords not treated as source evidence');
$check(str_contains($css,'.cg-planning-keywords{') && str_contains($css,'.cg-keyword-match{'),'visible and styled search and relevance tags');
echo "PASS: Keyword Search on unit setup, cross-strand relevance order, statement safety, Prep/EAL and matcher guidance.\n";
