<?php
declare(strict_types=1);

/**
 * Word (.docx) export of a department's curriculum map: every year group, term and topic with the curriculum
 * statements selected for it. Built by hand (WordprocessingML in a zip) so it needs no library.
 */

function cmx_esc(string $s): string
{
    return htmlspecialchars(preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}]/u', '', $s) ?? '', ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

/** One run of text. $o: b, i, color, size (half-points). */
function cmx_run(string $text, array $o = []): string
{
    $rp = '';
    if (!empty($o['b'])) $rp .= '<w:b/>';
    if (!empty($o['i'])) $rp .= '<w:i/>';
    if (!empty($o['color'])) $rp .= '<w:color w:val="' . $o['color'] . '"/>';
    if (!empty($o['size'])) $rp .= '<w:sz w:val="' . (int)$o['size'] . '"/><w:szCs w:val="' . (int)$o['size'] . '"/>';
    return '<w:r>' . ($rp ? '<w:rPr>' . $rp . '</w:rPr>' : '') . '<w:t xml:space="preserve">' . cmx_esc($text) . '</w:t></w:r>';
}

function cmx_p(string $style, string $runs, string $ppr = ''): string
{
    return '<w:p><w:pPr><w:pStyle w:val="' . $style . '"/>' . $ppr . '</w:pPr>' . $runs . '</w:p>';
}

function cmx_cell(string $text, int $w, bool $head = false, string $fill = ''): string
{
    return '<w:tc><w:tcPr><w:tcW w:w="' . $w . '" w:type="dxa"/>' . ($fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' . $fill . '"/>' : '') . '</w:tcPr>'
        . cmx_p('TableText', cmx_run($text, $head ? ['b' => true] : [])) . '</w:tc>';
}

function cm_export_docx(array $map, array $statements, string $deptName, string $updatedAt, string $updatedBy): string
{
    $strands = [];
    foreach ($map['strands'] ?? [] as $s) $strands[(string)($s['id'] ?? '')] = (string)($s['name'] ?? '');
    $types = [];
    foreach ($map['assessTypes'] ?? [] as $a) $types[(string)($a['code'] ?? '')] = (string)($a['label'] ?? '');

    $byTopic = [];
    foreach ($statements as $r) if (!empty($r['selected'])) $byTopic[$r['topic_id']][($r['kind'] ?? '') === 'practice' ? 'practice' : 'knowledge'][] = $r;

    $years = $map['years'] ?? [];
    $nTopics = 0; $nStmts = 0; $yearStats = [];
    foreach ($years as $yi => $y) {
        $t = 0; $s = 0;
        foreach ($y['blocks'] ?? [] as $b) foreach ($b['topics'] ?? [] as $tp) {
            $t++; $s += count($byTopic[(string)$tp['id']]['knowledge'] ?? []) + count($byTopic[(string)$tp['id']]['practice'] ?? []);
        }
        $yearStats[$yi] = [$t, $s]; $nTopics += $t; $nStmts += $s;
    }

    $body = '';
    $body .= cmx_p('Title', cmx_run($deptName));
    $body .= cmx_p('Subtitle', cmx_run((string)($map['title'] ?? 'Curriculum overview')));
    $when = $updatedAt !== '' ? gmdate('j F Y', (int)strtotime($updatedAt)) : '';
    $body .= cmx_p('Meta', cmx_run($nTopics . ' units · ' . $nStmts . ' curriculum statements selected' . ($when ? ' · Map last updated ' . $when . ($updatedBy !== '' ? ' by ' . $updatedBy : '') : '') . ' · Exported ' . gmdate('j F Y')));

    // summary table
    $w = [3600, 2700, 2700];
    $tbl = '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>'
        . '<w:top w:val="single" w:sz="4" w:color="CFC9BD"/><w:left w:val="single" w:sz="4" w:color="CFC9BD"/><w:bottom w:val="single" w:sz="4" w:color="CFC9BD"/><w:right w:val="single" w:sz="4" w:color="CFC9BD"/>'
        . '<w:insideH w:val="single" w:sz="4" w:color="E3DED3"/><w:insideV w:val="single" w:sz="4" w:color="E3DED3"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>'
        . '<w:tblGrid><w:gridCol w:w="' . $w[0] . '"/><w:gridCol w:w="' . $w[1] . '"/><w:gridCol w:w="' . $w[2] . '"/></w:tblGrid>';
    $tbl .= '<w:tr><w:trPr><w:tblHeader/></w:trPr>' . cmx_cell('Year group', $w[0], true, 'EFEBE2') . cmx_cell('Units', $w[1], true, 'EFEBE2') . cmx_cell('Statements selected', $w[2], true, 'EFEBE2') . '</w:tr>';
    foreach ($years as $yi => $y) $tbl .= '<w:tr>' . cmx_cell((string)($y['label'] ?? ''), $w[0]) . cmx_cell((string)$yearStats[$yi][0], $w[1]) . cmx_cell((string)$yearStats[$yi][1], $w[2]) . '</w:tr>';
    $tbl .= '</w:tbl>';
    $body .= cmx_p('Meta', '') . $tbl;

    if (($map['whakatauki'] ?? '') !== '') $body .= cmx_p('Quote', cmx_run((string)$map['whakatauki']));

    foreach ($years as $yi => $y) {
        $body .= cmx_p('Heading1', cmx_run((string)($y['label'] ?? 'Year')) . cmx_run('   ' . $yearStats[$yi][0] . ' units · ' . $yearStats[$yi][1] . ' statements', ['size' => 20, 'color' => '6B7280', 'b' => false]), $yi === 0 ? '<w:pageBreakBefore/>' : '<w:pageBreakBefore/>');
        foreach ($y['blocks'] ?? [] as $bi => $b) {
            $label = trim((string)($b['label'] ?? ''));
            $term = ($label !== '' && !preg_match('/^(block|term)\s*\d+$/i', $label)) ? $label : 'Term ' . ($bi + 1);
            $body .= cmx_p('Heading2', cmx_run($term));
            if (empty($b['topics'])) { $body .= cmx_p('Note', cmx_run('No units in this term.', ['i' => true])); continue; }
            foreach ($b['topics'] as $tp) {
                $id = (string)$tp['id'];
                $body .= cmx_p('Heading3', cmx_run((string)($tp['title'] ?? 'Unit')));
                $bits = [];
                if (($tp['strand'] ?? '') !== '' && ($strands[$tp['strand']] ?? '') !== '') $bits[] = 'Strand: ' . $strands[$tp['strand']];
                if (($tp['assess'] ?? '') !== '') $bits[] = 'Assessment: ' . $tp['assess'] . (($types[$tp['assess']] ?? '') !== '' ? ' (' . $types[$tp['assess']] . ')' : '');
                if (($tp['owner'] ?? '') !== '') $bits[] = 'Taught by: ' . $tp['owner'];
                if (!empty($tp['optional'])) $bits[] = 'Optional, if time allows';
                $bits[] = $deptName . ' · ' . ($y['label'] ?? '');
                $body .= cmx_p('Meta', cmx_run(implode('  ·  ', $bits)));
                $k = $byTopic[$id]['knowledge'] ?? []; $pr = $byTopic[$id]['practice'] ?? [];
                if (!$k && !$pr) { $body .= cmx_p('Note', cmx_run('No curriculum statements selected yet.', ['i' => true])); continue; }
                foreach ([['Knowledge', $k], ['Practices', $pr]] as [$title, $list]) {
                    if (!$list) continue;
                    $body .= cmx_p('Label', cmx_run($title . ' (' . count($list) . ')'));
                    foreach ($list as $r) {
                        $runs = cmx_run('•', ['color' => '8A1F3D', 'b' => true]) . '<w:r><w:tab/></w:r>' . cmx_run((string)$r['text']);
                        if (($r['source'] ?? '') !== '') $runs .= cmx_run('  ' . $r['source'], ['size' => 17, 'color' => '6B7280']);
                        $body .= cmx_p('Stmt', $runs);
                    }
                }
            }
        }
    }

    $sect = '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1418" w:bottom="1134" w:left="1418" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
    $ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    $doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' . $ns . '><w:body>' . $body . $sect . '</w:body></w:document>';

    $font = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/>';
    $st = fn(string $id, string $name, string $ppr, string $rpr, string $extra = '') => '<w:style w:type="paragraph" w:styleId="' . $id . '"><w:name w:val="' . $name . '"/><w:basedOn w:val="Normal"/>' . $extra . '<w:qFormat/><w:pPr>' . $ppr . '</w:pPr><w:rPr>' . $rpr . '</w:rPr></w:style>';
    $styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' . $ns . '><w:docDefaults><w:rPrDefault><w:rPr>' . $font . '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-NZ"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        . '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        . $st('Title', 'Title', '<w:spacing w:before="0" w:after="60"/>', '<w:b/><w:color w:val="1C2230"/><w:sz w:val="56"/><w:szCs w:val="56"/>')
        . $st('Subtitle', 'Subtitle', '<w:spacing w:after="120"/>', '<w:color w:val="8A1F3D"/><w:sz w:val="30"/><w:szCs w:val="30"/>')
        . $st('Heading1', 'heading 1', '<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="8A1F3D"/></w:pBdr><w:spacing w:before="0" w:after="200"/><w:outlineLvl w:val="0"/>', '<w:b/><w:color w:val="1C2230"/><w:sz w:val="40"/><w:szCs w:val="40"/>', '<w:next w:val="Normal"/>')
        . $st('Heading2', 'heading 2', '<w:keepNext/><w:shd w:val="clear" w:color="auto" w:fill="EFEBE2"/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="1"/>', '<w:b/><w:color w:val="8A1F3D"/><w:sz w:val="28"/><w:szCs w:val="28"/>', '<w:next w:val="Normal"/>')
        . $st('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="240" w:after="20"/><w:outlineLvl w:val="2"/>', '<w:b/><w:color w:val="1C2230"/><w:sz w:val="25"/><w:szCs w:val="25"/>', '<w:next w:val="Normal"/>')
        . $st('Meta', 'Meta', '<w:spacing w:after="80"/>', '<w:color w:val="6B7280"/><w:sz w:val="19"/><w:szCs w:val="19"/>')
        . $st('Quote', 'Quote', '<w:spacing w:before="200" w:after="80"/>', '<w:i/><w:color w:val="4A5160"/>')
        . $st('Note', 'Note', '<w:spacing w:after="80"/><w:ind w:left="283"/>', '<w:color w:val="6B7280"/>')
        . $st('Label', 'Statement Label', '<w:keepNext/><w:spacing w:before="100" w:after="40"/><w:ind w:left="283"/>', '<w:b/><w:caps/><w:color w:val="4A5160"/><w:sz w:val="18"/><w:szCs w:val="18"/>')
        . $st('Stmt', 'Statement', '<w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs><w:spacing w:after="50"/><w:ind w:left="567" w:hanging="284"/>', '')
        . $st('TableText', 'Table Text', '<w:spacing w:after="0"/>', '')
        . $st('Footer', 'footer', '<w:jc w:val="center"/><w:spacing w:after="0"/>', '<w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/>')
        . '</w:styles>';

    $footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' . $ns . '><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>' . cmx_run($deptName . ' curriculum overview · page ')
        . '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';

    $ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        . '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        . '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>';
    $rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    $docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>';

    $tmp = tempnam(sys_get_temp_dir(), 'cmx');
    $zip = new ZipArchive();
    if ($zip->open($tmp, ZipArchive::OVERWRITE) !== true) throw new RuntimeException('Could not build the Word file.');
    $zip->addFromString('[Content_Types].xml', $ct);
    $zip->addFromString('_rels/.rels', $rels);
    $zip->addFromString('word/document.xml', $doc);
    $zip->addFromString('word/styles.xml', $styles);
    $zip->addFromString('word/footer1.xml', $footer);
    $zip->addFromString('word/_rels/document.xml.rels', $docRels);
    $zip->close();
    $bin = (string)file_get_contents($tmp);
    @unlink($tmp);
    return $bin;
}
