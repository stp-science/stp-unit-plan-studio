<?php
declare(strict_types=1);
/**
 * Read-only curriculum coverage audit, plus a strictly validated single-
 * statement assignment. Uses verbatim Ministry banks, not AI topic guesses.
 */
require_once __DIR__ . '/curriculum_map_lib.php';

function cm_audit_is_language(string $name): ?array
{
    $n = mb_strtolower(trim($name));
    $language = [
        'french'=>'languages-french-sep-2026',
        'spanish'=>'languages-spanish-sep-2026',
        'japanese'=>'languages-japanese-sep-2026',
        'chinese'=>'languages-chinese-mandarin-sep-2026',
        'mandarin'=>'languages-chinese-mandarin-sep-2026',
        'chinese (mandarin)'=>'languages-chinese-mandarin-sep-2026',
        'te reo māori'=>'languages-te-reo-maori-sep-2026',
        'te reo maori'=>'languages-te-reo-maori-sep-2026',
        'māori'=>'languages-te-reo-maori-sep-2026'
    ];
    return isset($language[$n]) ? [$language[$n],['Novice 1','Novice 2','Novice 3']] : null;
}
function cm_audit_years(array $map): array
{
    $out=[];
    foreach (($map['years']??[]) as $group)
        if (preg_match('/^Year\s*(7|8|9|10|11|12|13)$/i',trim((string)($group['label']??'')),$m)) $out[(int)$m[1]]=true;
    ksort($out);
    return array_keys($out);
}
function cm_audit_specs(string $department, array $map): array
{
    $name=mb_strtolower(trim($department));
    $years=array_values(array_filter(cm_audit_years($map),static fn($v)=>$v>=7&&$v<=10));
    $specs=[];
    $add=function(string $doc,int $year,string $label,string $subject='',string $level='',string $disc='') use (&$specs):void {
        $key=implode('|',[$doc,$year,$subject,$level,$disc]);
        $specs[$key]=['doc_id'=>$doc,'year'=>$year,'label'=>$label,'subject'=>$subject,'level'=>$level,'discipline'=>$disc];
    };
    $junior=function(string $doc,string $label,string $subject='',string $disc='') use (&$add,$years):void {
        foreach ($years as $year)$add($doc,$year,$label,'', '',$disc);
    };
    if ($name==='prep') {
        $yrs=array_values(array_filter($years,static fn($y)=>in_array($y,[7,8],true)));
        foreach ($yrs as $yr)foreach([
            ['english-2025','English',''],
            ['social-sciences-2026','Social Studies',''],
            ['maths-2025','Maths',''],
            ['health-pe-2026','Health','Health']
        ] as [$doc,$label,$subject])$add($doc,$yr,$label,$subject);
        foreach (['Novice 1','Novice 2','Novice 3'] as $level)$add('languages-te-reo-maori-sep-2026',7,'Te Reo Māori','',$level);
    } elseif ($name==='english as an additional language'||$name==='eal') {
        foreach (['Stage 1','Stage 2','Stage 3','Stage 4','Stage 5'] as $level)
            $add('english-as-an-additional-language-stages-2026',11,'EAL','',$level);
    } elseif ($language=cm_audit_is_language($name)) {
        foreach ($language[1] as $level)$add($language[0],7,$department,'',$level);
    } elseif (in_array($name,['science','junior science'],true))$junior('science-aug-2026','Science');
    elseif ($name==='english')$junior('english-2025','English');
    elseif (preg_match('/^math(s|ematics)( and statistics)?$/',$name))$junior('maths-2025','Mathematics');
    elseif (in_array($name,['social studies','social sciences','history','geography'],true))$junior('social-sciences-2026','Social Sciences');
    elseif ($name==='health') {
        foreach($years as $year)$add('health-pe-2026',$year,'Health','Health');
    } elseif (in_array($name,['physical education','pe'],true)) {
        foreach($years as $year)$add('health-pe-2026',$year,'Physical Education','Physical Education');
    } elseif (in_array($name,['health and physical education','health & pe','hpe'],true))$junior('health-pe-2026','Health and Physical Education');
    elseif (str_contains($name,'technology')||in_array($name,['dvc','digital technology','food technology','design technology'],true))
        $junior('technology-2026','Technology');
    elseif (in_array($name,['music','dance','drama','visual arts'],true))
        $junior('arts-sep-2026',ucwords($name),'',ucwords($name));
    elseif (in_array($name,['the arts','arts','art'],true))$junior('arts-sep-2026','The Arts');
    else {
        // Do not invent a curriculum source. Name must match a verified
        // catalogue learning area, subject or exact curriculum document.
        foreach ((cs_catalogue()['documents']??[]) as $doc) {
            if (($doc['kind']??'')!=='curriculum')continue;
            $candidates=array_map('mb_strtolower',array_filter([
                (string)($doc['subject']??''),(string)($doc['learningArea']??'')
            ]));
            if (in_array($name,$candidates,true)){
                $junior((string)$doc['id'],(string)($doc['subject']??$doc['learningArea']??$department));
                break;
            }
        }
    }
    return array_values($specs);
}
function cm_audit_key(string $doc,string $kind,string $text): string
{
    return $doc.'|'.$kind.'|'.cm_norm_stmt($text);
}
function cm_audit_statement_id(array $spec,array $record): string
{
    return substr(hash('sha256',implode('|',[
        $spec['doc_id'],$spec['year'],$spec['level'],$record['kind'],cm_norm_stmt((string)$record['text'])
    ])),0,28);
}
function cm_audit_source(PDO $pdo,array $spec): array
{
    $doc=(string)$spec['doc_id'];$year=(int)$spec['year'];$level=(string)$spec['level'];
    if ($level==='' && $year>=7 && $year<=10 && empty(cs_catalogue_doc($doc)['senior'])) {
        $records=cs_year_statement_bank($doc,$year,(string)$spec['discipline']);
        if((string)$spec['subject']!=='')$records=array_values(array_filter($records,
            static fn($r)=>mb_strtolower(trim((string)($r['subject']??'')))===mb_strtolower($spec['subject'])));
        return $records?['ready'=>true,'items'=>$records]:
            ['ready'=>false,'items'=>[],'reason'=>'Official statement list not available for this source.'];
    }
    [$keyYear,$keyDisc]=cm_bank_key($year,(string)$spec['discipline'],$level);
    $bank=cm_bank_get($pdo,$doc,$keyYear,$keyDisc);
    $prepared=cm_bank_prepare($doc,$year,(string)$spec['discipline'],$level);
    if(is_string($prepared))return ['ready'=>false,'items'=>[],'reason'=>$prepared];
    $total=count($prepared[1]);
    if(!$total||!$bank['complete']||$bank['done']<$total||!$bank['items'])
        return ['ready'=>false,'items'=>[],'reason'=>'Official statement list needs preparing.',
            'total'=>$total,'done'=>$bank['done']];
    return ['ready'=>true,'items'=>$bank['items']];
}
function cm_audit_report(PDO $pdo,int $schoolId,int $deptId,string $department,array $map): array
{
    $specs=cm_audit_specs($department,$map);
    $topics=[];
    foreach (($map['years']??[]) as $group)
        foreach (($group['blocks']??[]) as $block)
            foreach (($block['topics']??[]) as $topic)
                $topics[$topic['id']]=[
                    'id'=>$topic['id'],'year'=>(string)$group['label'],
                    'title'=>(string)$topic['title'],
                    'display'=>trim((string)$group['label'].' · '.(string)$topic['title'])
                ];
    $assigned=[];
    foreach (cm_get_statements($pdo,$schoolId,$deptId,null,true) as $statement) {
        if(empty($statement['selected'])||!isset($topics[$statement['topic_id']]))continue;
        $doc=(string)$statement['doc_id'];
        $key=cm_audit_key($doc,(string)$statement['kind'],(string)$statement['text']);
        $assigned[$key][$statement['topic_id']]=$topics[$statement['topic_id']];
        // Older imports have no source identifier, but can still be matched
        // by exact wording and type; the source ambiguity remains reviewable.
        if($doc==='')$assigned[cm_audit_key('*',(string)$statement['kind'],(string)$statement['text'])][$statement['topic_id']]=$topics[$statement['topic_id']];
    }
    $rows=[];$pending=[];$seen=[];
    foreach($specs as $spec) {
        $bank=cm_audit_source($pdo,$spec);
        $sourceLabel=$spec['label'].' · '.($spec['level']?:'Year '.$spec['year']);
        if(!$bank['ready']){
            $pending[]=$spec+['display'=>$sourceLabel,'reason'=>$bank['reason']??'Source unavailable',
                'total'=>(int)($bank['total']??0),'done'=>(int)($bank['done']??0)];
            continue;
        }
        foreach($bank['items'] as $record){
            $kind=(string)($record['kind']??'');
            $text=trim((string)($record['text']??''));
            if(!in_array($kind,['knowledge','practice'],true)||$text==='')continue;
            if($spec['subject']!==''&&mb_strtolower(trim((string)($record['subject']??'')))!==mb_strtolower($spec['subject']))continue;
            $id=cm_audit_statement_id($spec,['kind'=>$kind,'text'=>$text]);
            if(isset($seen[$id]))continue;
            $seen[$id]=true;
            $key=cm_audit_key($spec['doc_id'],$kind,$text);
            $matches=$assigned[$key]??[];
            // In imported overviews source IDs can be absent. This exact
            // wording match is transparent; it never uses AI similarity.
            foreach(($assigned[cm_audit_key('*',$kind,$text)]??[]) as $tid=>$topic)$matches[$tid]=$topic;
            $rows[]=[
                'id'=>$id,'source'=>$sourceLabel,
                'doc_id'=>$spec['doc_id'],'year'=>$spec['year'],'level'=>$spec['level'],
                'kind'=>$kind,'text'=>$text,'citation'=>(string)($record['source']??''),
                'status'=>$matches?'Covered':'Missing','units'=>array_values($matches)
            ];
        }
    }
    usort($rows,static function($a,$b){
        $v=strcmp($a['status'],$b['status']);
        return $v!==0?$v:strcmp($a['source'],$b['source'])?:strcmp($a['kind'],$b['kind'])?:strcmp($a['text'],$b['text']);
    });
    $total=count($rows);$covered=count(array_filter($rows,static fn($x)=>$x['status']==='Covered'));
    return [
        'ok'=>true,'department'=>$department,'rows'=>$rows,'pending'=>$pending,
        'sources'=>array_values(array_unique(array_column($rows,'source'))),
        'topics'=>array_values($topics),'scope'=>array_values(array_unique(array_merge(
            array_column($rows,'source'),array_column($pending,'display')))),
        'summary'=>['total'=>$total,'covered'=>$covered,'missing'=>$total-$covered,
            'pending'=>count($pending),'complete'=>count($pending)===0&&count($specs)>0&&$total>0,
            'sourceCount'=>count($specs)]
    ];
}
function cm_audit_add_to_unit(PDO $pdo,int $schoolId,int $deptId,int $teacherId,
    array $map,string $department,string $rowId,string $topicId): array
{
    if(!isset(cm_topic_ids($map)[$topicId]))throw new CsInvalid('Select a unit on this curriculum overview.');
    $report=cm_audit_report($pdo,$schoolId,$deptId,$department,$map);
    $entry=null;
    foreach($report['rows'] as $r)if($r['id']===$rowId){$entry=$r;break;}
    if(!$entry)throw new CsInvalid('The statement was not found in the verified official list. Reload the audit.');
    $kind=$entry['kind'];$text=$entry['text'];
    // A single verified action never replaces other ticked statements. An
    // existing unticked record is changed to selected on confirmation.
    $hash=sha1($kind.'|'.cm_norm_stmt($text));
    $pdo->beginTransaction();
    try {
        $count=$pdo->prepare('SELECT COUNT(*) FROM mis_map_statements WHERE school_id=? AND department_id=? AND topic_id=? AND selected=1');
        $count->execute([$schoolId,$deptId,$topicId]);
        if((int)$count->fetchColumn()>=150){
            throw new CsInvalid('This unit already has 150 selected statements. Review it before adding more.');
        }
        $sql='INSERT INTO mis_map_statements (school_id,department_id,topic_id,hash,kind,stmt,source,doc_id,confidence,selected,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,1,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE selected=1,updated_by=VALUES(updated_by),updated_at=UTC_TIMESTAMP()';
        $stmt=$pdo->prepare($sql);
        $stmt->execute([$schoolId,$deptId,$topicId,$hash,$kind,$text,
            mb_substr($entry['citation']?:$entry['source'],0,255),
            $entry['doc_id'],$teacherId]);
        $pdo->commit();
    }catch(Throwable $error){if($pdo->inTransaction())$pdo->rollBack();throw $error;}
    return ['ok'=>true,'message'=>'Official statement added to the selected unit.'];
}
