<?php
declare(strict_types=1);
/** Minimal, self-contained 2-sheet XLSX export for the school audit. */
function cm_audit_xlsx(array $report): string
{
    if(!class_exists('ZipArchive'))throw new RuntimeException('The ZIP PHP extension is needed to export Excel.');
    $safe=static fn($value):string=>htmlspecialchars((string)$value,ENT_XML1|ENT_QUOTES,'UTF-8');
    $cell=static function(int $row,int $col,$value,int $style=0) use($safe):string{
        $letters='';$n=$col;
        while($n>0){$n--; $letters=chr(65+$n%26).$letters;$n=intdiv($n,26);}
        $address=$letters.$row;
        if(is_int($value)||is_float($value))return '<c r="'.$address.'" s="'.$style.'"><v>'.$value.'</v></c>';
        return '<c r="'.$address.'" s="'.$style.'" t="inlineStr"><is><t xml:space="preserve">'.$safe($value).'</t></is></c>';
    };
    $build=static function(array $rows,array $widths,bool $filter=true) use($cell):string {
        $out='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
        $out.='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
        $out.='<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
        $out.='<cols>';
        foreach($widths as $idx=>$width)$out.='<col min="'.($idx+1).'" max="'.($idx+1).'" width="'.$width.'" customWidth="1"/>';
        $out.='</cols><sheetData>';
        foreach($rows as $i=>$data){
            $r=$i+1;$out.='<row r="'.$r.'">';
            foreach($data as $j=>$value)$out.=$cell($r,$j+1,$value,$r===1?1:($value==='Missing'?2:($value==='Covered'?3:0)));
            $out.='</row>';
        }
        $out.='</sheetData>';
        if($filter&&count($rows)>1){
            $max=count($rows[0]);$letters='';
            while($max>0){$max--;$letters=chr(65+$max%26).$letters;$max=intdiv($max,26);}
            $out.='<autoFilter ref="A1:'.$letters.count($rows).'"/>';
        }
        return $out.'</worksheet>';
    };
    $totals=[];
    foreach(($report['rows']??[]) as $entry){
        $name=(string)$entry['source'];
        $totals[$name]??=['source'=>$name,'total'=>0,'covered'=>0,'missing'=>0];
        $totals[$name]['total']++;
        if($entry['status']==='Covered')$totals[$name]['covered']++;
        else $totals[$name]['missing']++;
    }
    foreach(($report['pending']??[]) as $pending){
        $name=$pending['display'];
        $totals[$name]??=['source'=>$name,'total'=>0,'covered'=>0,'missing'=>0,'pending'=>true];
        $totals[$name]['pending']=true;
    }
    ksort($totals);
    $overview=[['Curriculum source','Total statements','Included in units','Missing','Audit status']];
    foreach($totals as $item)$overview[]=[
        $item['source'],$item['total'],$item['covered'],$item['missing'],
        !empty($item['pending'])?'Source not fully loaded':'Source ready'
    ];
    $overview[]=['TOTAL',($report['summary']['total']??0),($report['summary']['covered']??0),
        ($report['summary']['missing']??0),($report['summary']['complete']??false)?'All selected sources loaded':'Incomplete source lists — not a full audit'];
    $overview[]=['Scope',implode(', ',(array)($report['scope']??[])),'','',''];
    $overview[]=['What counts','Only official statements actually selected in units. AI suggestions alone are excluded.','','',''];
    $overview[]=['Important','Planned coverage, not evidence of teaching or statutory compliance.','','',''];
    $checklist=[['Ministry source','Type','Official Ministry statement','Status','Where it is included','Source reference']];
    foreach(($report['rows']??[]) as $r){
        $units=array_map(static fn($u)=>(string)$u['display'],(array)$r['units']);
        $checklist[]=[
            $r['source'],$r['kind']==='practice'?'Practice':'Knowledge',$r['text'],$r['status'],
            implode('; ',$units),$r['citation']
        ];
    }
    $sheet1=$build($overview,[41,19,20,14,47]);
    $sheet2=$build($checklist,[34,14,95,16,65,75]);
    $types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
    $rootRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    $workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Statement checklist" sheetId="2" r:id="rId2"/></sheets></workbook>';
    $wbRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    $styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF001733"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFEDF0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>';
    $tmp=tempnam(sys_get_temp_dir(),'cm-audit-');
    if($tmp===false)throw new RuntimeException('Could not create temporary export.');
    $zip=new ZipArchive();
    if($zip->open($tmp,ZipArchive::CREATE|ZipArchive::OVERWRITE)!==true){@unlink($tmp);throw new RuntimeException('Cannot create audit workbook.');}
    $closed=false;
    try{
        foreach([
            '[Content_Types].xml'=>$types,
            '_rels/.rels'=>$rootRels,
            'xl/workbook.xml'=>$workbook,
            'xl/_rels/workbook.xml.rels'=>$wbRels,
            'xl/styles.xml'=>$styles,
            'xl/worksheets/sheet1.xml'=>$sheet1,
            'xl/worksheets/sheet2.xml'=>$sheet2,
        ] as $p=>$xml)$zip->addFromString($p,$xml);
        if(!$zip->close())throw new RuntimeException('Could not complete Excel export.');
        $closed=true;
        $data=file_get_contents($tmp);
        if(!is_string($data))throw new RuntimeException('Could not read completed Excel workbook.');
        return $data;
    }finally{if(!$closed)$zip->close();@unlink($tmp);}
}
