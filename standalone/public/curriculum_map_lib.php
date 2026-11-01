<?php
declare(strict_types=1);
// mis/curriculum_map_lib.php - department curriculum maps (2026-10-31).
// One map per department: years -> terms -> topics (strand colour, assessment type, teacher initials, optional).
// Any teacher in the department can view and edit it; it can be built from scratch or imported from an uploaded file.

require_once __DIR__ . '/curriculum_studio_lib.php';
require_once __DIR__ . '/mis_faculty_lib.php';

const CM_ASSET_VER = 'v1';
const CM_PALETTE = ['#a9df82', '#fff176', '#d9cce9', '#ffcc80', '#90caf9', '#f48fb1', '#80deea', '#e6ee9c', '#bcaaa4', '#cfd8dc'];

function cm_setup(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_curriculum_maps (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        school_id BIGINT NOT NULL,
        department_id BIGINT NOT NULL,
        data LONGTEXT NOT NULL,
        version INT NOT NULL DEFAULT 1,
        updated_by BIGINT NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uniq_cm_dept (school_id, department_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    // Safety net: periodic snapshots and one before any delete/replace.
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_curriculum_map_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        school_id BIGINT NOT NULL,
        department_id BIGINT NOT NULL,
        data LONGTEXT NOT NULL,
        saved_by BIGINT NOT NULL DEFAULT 0,
        reason VARCHAR(20) NOT NULL DEFAULT '',
        saved_at DATETIME NOT NULL,
        KEY idx_cm_hist (school_id, department_id, saved_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function cm_is_manager(PDO $pdo, int $teacherId): bool
{
    return mis_is_school_admin($pdo, $teacherId) || mis_is_leadership($pdo, $teacherId);
}

/**
 * Maps a teacher can open: [{id,name,faculty,scope}]. scope 'department' = one subject's map. scope 'faculty' = the faculty as a whole
 * (for faculties with more than one department), stored under the NEGATIVE faculty id so it never clashes with a department id.
 * Admins/leadership see everything; faculty heads see their faculties; other teachers see their departments and those faculties.
 */
function cm_departments(PDO $pdo, int $schoolId, int $teacherId): array
{
    mis_department_setup($pdo);
    mis_faculty_setup($pdo);
    $st = $pdo->prepare('SELECT d.id, d.name, d.faculty_id, f.name AS faculty, f.sort_order AS fs FROM mis_departments d LEFT JOIN mis_faculties f ON f.id = d.faculty_id WHERE d.school_id = ? AND d.is_active = 1 ORDER BY (f.id IS NULL), f.sort_order, f.name, d.sort_order, d.name');
    $st->execute([$schoolId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $isManager = cm_is_manager($pdo, $teacherId);
    $mine = []; $myFaculties = [];
    if (!$isManager) {
        $h = $pdo->prepare('SELECT department_id FROM mis_department_heads WHERE teacher_id = ? AND school_id = ?');
        $h->execute([$teacherId, $schoolId]);
        foreach ($h->fetchAll(PDO::FETCH_COLUMN) as $d) $mine[(int)$d] = true;
        $fh = $pdo->prepare('SELECT faculty_id FROM mis_faculty_heads WHERE teacher_id = ? AND school_id = ?');
        $fh->execute([$teacherId, $schoolId]);
        foreach ($fh->fetchAll(PDO::FETCH_COLUMN) as $f) $myFaculties[(int)$f] = true;
        foreach ($rows as $r) if ($r['faculty_id'] !== null && isset($myFaculties[(int)$r['faculty_id']])) $mine[(int)$r['id']] = true;
        try {
            $s = $pdo->prepare('SELECT DISTINCT ds.department_id FROM mis_department_subjects ds INNER JOIN teacher_subjects ts ON ts.subject_id = ds.subject_id WHERE ts.teacher_id = ? AND ds.school_id = ?');
            $s->execute([$teacherId, $schoolId]);
            foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $d) $mine[(int)$d] = true;
        } catch (Throwable $e) { /* teacher_subjects missing: heads only */ }
    }
    $perFaculty = [];
    foreach ($rows as $r) if ($r['faculty_id'] !== null) $perFaculty[(int)$r['faculty_id']] = ($perFaculty[(int)$r['faculty_id']] ?? 0) + 1;
    $out = []; $facDone = [];
    foreach ($rows as $r) {
        $did = (int)$r['id']; $fid = $r['faculty_id'] === null ? 0 : (int)$r['faculty_id'];
        $visible = $isManager || isset($mine[$did]);
        if (!$visible) continue;
        if ($fid && ($perFaculty[$fid] ?? 0) > 1 && !isset($facDone[$fid])) {   // the whole-faculty map comes first in its group
            $facDone[$fid] = true;
            $out[] = ['id' => -$fid, 'name' => (string)$r['faculty'], 'faculty' => (string)$r['faculty'], 'scope' => 'faculty'];
        }
        $out[] = ['id' => $did, 'name' => (string)$r['name'], 'faculty' => (string)($r['faculty'] ?? ''), 'scope' => 'department'];
    }
    return $out;
}

function cm_new_id(): string { return bin2hex(random_bytes(6)); }

function cm_str($v, int $max): string
{
    $s = is_string($v) || is_numeric($v) ? trim(preg_replace('/\s+/u', ' ', (string)$v)) : '';
    return mb_substr($s, 0, $max);
}

function cm_color($v, int $i = 0): string
{
    $s = is_string($v) ? strtolower(trim($v)) : '';
    if (preg_match('/^#?([0-9a-f]{6})$/', $s, $m)) return '#' . $m[1];
    return CM_PALETTE[$i % count(CM_PALETTE)];
}

/** Normalise and bound a map from the browser or the importer. Ids are kept when valid, otherwise minted. */
function cm_clean_map($in): array
{
    $in = is_array($in) ? $in : [];
    $id = static fn($v): string => is_string($v) && preg_match('/^[a-z0-9]{6,24}$/', $v) ? $v : cm_new_id();
    $strands = []; $seenS = [];
    foreach (array_slice(is_array($in['strands'] ?? null) ? $in['strands'] : [], 0, 12) as $i => $s) {
        if (!is_array($s)) continue;
        $name = cm_str($s['name'] ?? '', 40);
        if ($name === '') continue;
        $sid = $id($s['id'] ?? '');
        if (isset($seenS[$sid])) $sid = cm_new_id();
        $seenS[$sid] = true;
        $strands[] = ['id' => $sid, 'name' => $name, 'color' => cm_color($s['color'] ?? '', $i)];
    }
    $types = []; $seenT = [];
    foreach (array_slice(is_array($in['assessTypes'] ?? null) ? $in['assessTypes'] : [], 0, 8) as $t) {
        if (!is_array($t)) continue;
        $code = strtoupper(cm_str($t['code'] ?? '', 3));
        if ($code === '' || isset($seenT[$code])) continue;
        $seenT[$code] = true;
        $types[] = ['code' => $code, 'label' => cm_str($t['label'] ?? '', 60)];
    }
    $years = [];
    foreach (array_slice(is_array($in['years'] ?? null) ? $in['years'] : [], 0, 14) as $y) {
        if (!is_array($y)) continue;
        $blocks = [];
        foreach (array_slice(is_array($y['blocks'] ?? null) ? $y['blocks'] : [], 0, 12) as $b) {
            if (!is_array($b)) continue;
            $topics = [];
            foreach (array_slice(is_array($b['topics'] ?? null) ? $b['topics'] : [], 0, 30) as $t) {
                if (!is_array($t)) continue;
                $title = cm_str($t['title'] ?? '', 120);
                if ($title === '') continue;
                $code = strtoupper(cm_str($t['assess'] ?? '', 3));
                $topics[] = [
                    'id' => $id($t['id'] ?? ''), 'title' => $title,
                    'strand' => isset($seenS[$t['strand'] ?? '']) ? (string)$t['strand'] : '',
                    'assess' => isset($seenT[$code]) ? $code : '',
                    'owner' => cm_str($t['owner'] ?? '', 24),
                    'optional' => !empty($t['optional']),
                ];
            }
            $bl = cm_str($b['label'] ?? '', 40);
            $blocks[] = ['id' => $id($b['id'] ?? ''), 'label' => preg_match('/^(block|term)\s*\d+$/i', $bl) ? '' : $bl, 'topics' => $topics];
        }
        $years[] = ['id' => $id($y['id'] ?? ''), 'label' => cm_str($y['label'] ?? '', 40), 'blocks' => $blocks];
    }
    return ['v' => 1, 'title' => cm_str($in['title'] ?? '', 140), 'whakatauki' => mb_substr(trim((string)($in['whakatauki'] ?? '')), 0, 600), 'notes' => mb_substr(trim((string)($in['notes'] ?? '')), 0, 1200),
        'strands' => $strands, 'assessTypes' => $types, 'years' => $years];
}

function cm_load(PDO $pdo, int $schoolId, int $deptId): ?array
{
    cm_setup($pdo);
    $st = $pdo->prepare('SELECT m.data, m.version, m.updated_at, t.name AS who FROM mis_curriculum_maps m LEFT JOIN teachers t ON t.id = m.updated_by WHERE m.school_id = ? AND m.department_id = ?');
    $st->execute([$schoolId, $deptId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) return null;
    return ['map' => json_decode((string)$r['data'], true) ?: [], 'version' => (int)$r['version'], 'updatedAt' => str_replace(' ', 'T', (string)$r['updated_at']) . 'Z', 'updatedBy' => (string)($r['who'] ?? '')];
}

function cm_snapshot(PDO $pdo, int $schoolId, int $deptId, int $teacherId, string $reason, int $minGapSeconds = 0): void
{
    $cur = $pdo->prepare('SELECT data FROM mis_curriculum_maps WHERE school_id = ? AND department_id = ?');
    $cur->execute([$schoolId, $deptId]);
    $data = $cur->fetchColumn();
    if ($data === false) return;
    if ($minGapSeconds > 0) {
        $l = $pdo->prepare('SELECT COUNT(*) FROM mis_curriculum_map_history WHERE school_id = ? AND department_id = ? AND saved_at > (UTC_TIMESTAMP() - INTERVAL ? SECOND)');
        $l->execute([$schoolId, $deptId, $minGapSeconds]);
        if ((int)$l->fetchColumn() > 0) return;
    }
    $pdo->prepare('INSERT INTO mis_curriculum_map_history (school_id, department_id, data, saved_by, reason, saved_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP())')
        ->execute([$schoolId, $deptId, $data, $teacherId, $reason]);
    $pdo->prepare('DELETE FROM mis_curriculum_map_history WHERE school_id = ? AND department_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM mis_curriculum_map_history WHERE school_id = ? AND department_id = ? ORDER BY id DESC LIMIT 30) k)')
        ->execute([$schoolId, $deptId, $schoolId, $deptId]);
}

// ------------------------------------------------------------------ import: file -> text/attachment

/** Paragraph text with fill markers: "[#rrggbb text]" for shaded text, so colours survive as evidence. */
function cm_docx_para(DOMXPath $x, DOMNode $p, string $cellFill): string
{
    $W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    $pf = $x->query('w:pPr/w:shd/@w:fill', $p)->item(0);
    $pfill = $pf ? strtolower($pf->nodeValue) : '';
    if ($pfill === 'auto') $pfill = '';
    $parts = [];
    foreach ($x->query('w:r', $p) as $r) {
        $t = '';
        foreach ($x->query('w:t|w:tab|w:br', $r) as $n) $t .= $n->localName === 't' ? $n->textContent : ' ';
        if ($t === '') continue;
        $rf = $x->query('w:rPr/w:shd/@w:fill', $r)->item(0);
        $f = $rf ? strtolower($rf->nodeValue) : '';
        $parts[] = [$f === 'auto' ? '' : $f, $t];
    }
    $merged = [];   // adjacent runs with the same fill are one piece of text
    foreach ($parts as [$f, $t]) {
        $f = $f ?: $pfill;
        if ($merged && $merged[count($merged) - 1][0] === $f) $merged[count($merged) - 1][1] .= $t; else $merged[] = [$f, $t];
    }
    $out = '';
    foreach ($merged as [$f, $t]) $out .= ($f !== '' && trim($t) !== '') ? '[#' . $f . ' ' . trim($t) . ']' : $t;
    $out = trim(preg_replace('/\s+/u', ' ', $out));
    if ($out !== '' && $pfill === '' && $cellFill !== '' && !str_contains($out, '[#')) $out = '[#' . $cellFill . ' ' . $out . ']';
    return $out;
}

function cm_extract_docx(string $path): string
{
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) throw new CsInvalid('That Word file could not be opened.');
    $doc = $zip->getFromName('word/document.xml');
    if ($doc === false) throw new CsInvalid('That does not look like a Word document.');
    $foot = '';
    for ($i = 1; $i <= 3; $i++) { $f = $zip->getFromName("word/footer$i.xml"); if ($f !== false) $foot .= $f; }
    $zip->close();
    $W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    $lines = [];
    $walk = static function (DOMDocument $d, string $label) use (&$lines, $W): void {
        $x = new DOMXPath($d); $x->registerNamespace('w', $W);
        $body = $x->query('/w:document/w:body|/w:ftr|/w:hdr')->item(0);
        if (!$body) return;
        if ($label !== '') $lines[] = $label;
        foreach ($body->childNodes as $n) {
            if ($n->localName === 'p') { $t = cm_docx_para($x, $n, ''); if ($t !== '') $lines[] = $t; }
            elseif ($n->localName === 'tbl') {
                $lines[] = '[TABLE]';
                $ri = 0;
                foreach ($x->query('w:tr', $n) as $tr) {
                    $ri++; $cells = [];
                    foreach ($x->query('w:tc', $tr) as $tc) {
                        $cf = $x->query('w:tcPr/w:shd/@w:fill', $tc)->item(0);
                        $cfill = $cf ? strtolower($cf->nodeValue) : '';
                        if ($cfill === 'auto') $cfill = '';
                        $ps = [];
                        foreach ($x->query('w:p', $tc) as $p) { $t = cm_docx_para($x, $p, $cfill); if ($t !== '') $ps[] = $t; }
                        $cells[] = implode(' / ', $ps);
                    }
                    $lines[] = 'ROW ' . $ri . ': ' . implode(' || ', $cells);
                }
                $lines[] = '[/TABLE]';
            }
        }
    };
    $d = new DOMDocument(); if (@$d->loadXML($doc, LIBXML_NONET)) $walk($d, '');
    if ($foot !== '') {
        // each footer is its own root; wrap so they parse together
        foreach (preg_split('/(?=<\?xml)/', $foot) as $chunk) {
            if (trim($chunk) === '') continue;
            $d2 = new DOMDocument(); if (@$d2->loadXML($chunk, LIBXML_NONET)) $walk($d2, 'FOOTER:');
        }
    }
    return implode("\n", $lines);
}

function cm_extract_xlsx(string $path): string
{
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) throw new CsInvalid('That Excel file could not be opened.');
    $S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    $load = static function (string $name) use ($zip): ?DOMDocument {
        $raw = $zip->getFromName($name);
        if ($raw === false) return null;
        $d = new DOMDocument();
        return @$d->loadXML($raw, LIBXML_NONET) ? $d : null;
    };
    $shared = [];
    if ($d = $load('xl/sharedStrings.xml')) {
        $x = new DOMXPath($d); $x->registerNamespace('s', $S);
        foreach ($x->query('//s:si') as $si) $shared[] = trim($si->textContent);
    }
    $fills = []; $xfFill = [];
    if ($d = $load('xl/styles.xml')) {
        $x = new DOMXPath($d); $x->registerNamespace('s', $S);
        foreach ($x->query('//s:fills/s:fill') as $f) {
            $c = $x->query('s:patternFill/s:fgColor/@rgb', $f)->item(0);
            $fills[] = $c ? strtolower(substr($c->nodeValue, -6)) : '';
        }
        foreach ($x->query('//s:cellXfs/s:xf') as $xf) $xfFill[] = $fills[(int)$xf->getAttribute('fillId')] ?? '';
    }
    $names = [];
    if ($d = $load('xl/workbook.xml')) {
        $x = new DOMXPath($d); $x->registerNamespace('s', $S);
        foreach ($x->query('//s:sheets/s:sheet') as $sh) $names[] = $sh->getAttribute('name');
    }
    $out = [];
    for ($n = 1; $n <= 4; $n++) {
        if (!($d = $load("xl/worksheets/sheet$n.xml"))) break;
        $x = new DOMXPath($d); $x->registerNamespace('s', $S);
        $out[] = 'SHEET ' . ($names[$n - 1] ?? $n);
        foreach ($x->query('//s:sheetData/s:row') as $row) {
            $cells = [];
            foreach ($x->query('s:c', $row) as $c) {
                $v = $x->query('s:v', $c)->item(0);
                $is = $x->query('s:is', $c)->item(0);
                $val = $c->getAttribute('t') === 's' && $v ? ($shared[(int)$v->textContent] ?? '') : ($is ? trim($is->textContent) : ($v ? trim($v->textContent) : ''));
                if ($val === '') continue;
                $fill = $xfFill[(int)$c->getAttribute('s')] ?? '';
                $cells[] = $c->getAttribute('r') . '=' . ($fill !== '' && $fill !== '000000' && $fill !== 'ffffff' ? '[#' . $fill . ' ' . $val . ']' : $val);
            }
            if ($cells) $out[] = implode(' | ', $cells);
        }
    }
    return implode("\n", $out);
}

/** Returns ['text' => string] or ['parts' => [input parts]] for the model. Throws CsInvalid for unsupported files. */
function cm_read_upload(string $tmp, string $origName): array
{
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    $size = (int)filesize($tmp);
    if ($size <= 0) throw new CsInvalid('That file is empty.');
    if ($size > 10 * 1024 * 1024) throw new CsInvalid('That file is too large (10 MB maximum).');
    if ($ext === 'docx') return ['text' => cm_extract_docx($tmp)];
    if ($ext === 'xlsx') return ['text' => cm_extract_xlsx($tmp)];
    if (in_array($ext, ['csv', 'txt', 'tsv'], true)) {
        $t = (string)file_get_contents($tmp);
        if (!mb_check_encoding($t, 'UTF-8')) $t = mb_convert_encoding($t, 'UTF-8', 'Windows-1252');
        return ['text' => $t];
    }
    if ($ext === 'pdf' || in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) {
        $b64 = base64_encode((string)file_get_contents($tmp));
        if ($ext === 'pdf') return ['parts' => [['type' => 'input_file', 'filename' => 'curriculum-map.pdf', 'file_data' => 'data:application/pdf;base64,' . $b64]]];
        $mime = $ext === 'png' ? 'image/png' : ($ext === 'webp' ? 'image/webp' : 'image/jpeg');
        return ['parts' => [['type' => 'input_image', 'image_url' => 'data:' . $mime . ';base64,' . $b64]]];
    }
    throw new CsInvalid('Upload a Word (.docx), Excel (.xlsx), CSV, PDF or image of your map. Older .doc/.xls files: save them as .docx/.xlsx first.');
}

const CM_IMPORT_RULES = <<<'TXT'
You convert a school department's curriculum map (an overview of topics across year groups and terms) into structured data.

Rules:
- Keep EVERY topic and its wording exactly as written. Do not invent, merge, reorder or drop topics.
- Structure: years (e.g. "Year 7") each contain terms (the columns, such as Term 1 to Term 4, Block 1 to Block 4, half-terms or units), each term contains topics. For a term's label, use the label in the file, but if it is only a number such as "Block 5" or "Term 2" return an empty string.
- Topic title: just the topic name. Remove a trailing assessment code in brackets, trailing teacher initials, and "(if time)" / "(optional)" style notes from the title.
- assess: the assessment type code from a bracket such as "(T)" or "(E)"; "" if none.
- owner: the teacher initials/name that follow the topic (such as "KENH" or "AWR"), "" if none. A short all-capitals fragment (2-5 letters) on its own right after a topic, or split from the end of one, is that topic's initials, not a separate topic.
- optional: true when the topic is marked "if time", "optional" or similar; otherwise false.
- strand: the NAME of the strand/discipline the topic belongs to (for example Biology, Chemistry, Physics). Colours are given as [#rrggbb text]; use a colour key or legend in the file (for example shaded words such as "Biology") to map each colour to a strand name. Use "" if no strand can be determined. Never guess a strand from the topic's subject matter alone.
- strands: one entry per strand, with its colour as #rrggbb taken from the file's legend or topic shading. If the file has no usable colour, give a sensible light pastel.
- assessTypes: the assessment codes used with their meaning if the file explains them (for example "T = End-of-topic test"), otherwise label the code with your best short description.
- title: the document title. notes: any extra footer note worth keeping that is not a computed count (otherwise "").
- Row and column header cells (Year 7, Term 1, ...) are labels, not topics.
- Keep the department's own sequence: years, terms and topics stay in exactly the order of the document. Never regroup, resequence or generate new topics.
- statements: when the document assigns curriculum statements to a topic (for example knowledge and practice statements, learning outcomes, objectives, standards or codes), list them for that topic exactly as written and in the document's order, each as "knowledge" or "practice" ("knowledge" when it is not clear). If statements sit in a separate table or section keyed by topic name, year or code, attach each to its topic. Keep codes or numbers with the text when that is how the document refers to them. Only include statements the document itself assigns to that topic: never add, infer, paraphrase or write statements of your own. Use an empty list when a topic has none.
TXT;

function cm_import_schema(bool $withStatements = true): array
{
    $str = ['type' => 'string'];
    $obj = static fn(array $props): array => ['type' => 'object', 'additionalProperties' => false, 'required' => array_keys($props), 'properties' => $props];
    $stmt = $obj(['kind' => $str, 'text' => $str]);
    $topic = $obj(['title' => $str, 'strand' => $str, 'assess' => $str, 'owner' => $str, 'optional' => ['type' => 'boolean']] + ($withStatements ? ['statements' => ['type' => 'array', 'items' => $stmt]] : []));
    $block = $obj(['label' => $str, 'topics' => ['type' => 'array', 'items' => $topic]]);
    $year = $obj(['label' => $str, 'blocks' => ['type' => 'array', 'items' => $block]]);
    return $obj([
        'title' => $str, 'notes' => $str,
        'strands' => ['type' => 'array', 'items' => $obj(['name' => $str, 'color' => $str])],
        'assessTypes' => ['type' => 'array', 'items' => $obj(['code' => $str, 'label' => $str])],
        'years' => ['type' => 'array', 'items' => $year],
    ]);
}

/** Model output (strands by name) -> a clean stored-shape map. */
function cm_from_import(array $j, array &$stmts = []): array
{
    $strands = [];
    foreach ((array)($j['strands'] ?? []) as $i => $s) {
        $name = cm_str($s['name'] ?? '', 40);
        if ($name === '') continue;
        $strands[] = ['id' => cm_new_id(), 'name' => $name, 'color' => cm_color($s['color'] ?? '', $i)];
    }
    $byName = [];
    foreach ($strands as $s) $byName[mb_strtolower($s['name'])] = $s['id'];
    $types = [];
    foreach ((array)($j['assessTypes'] ?? []) as $t) $types[] = ['code' => $t['code'] ?? '', 'label' => $t['label'] ?? ''];
    $known = array_column($types, 'code');
    $years = [];
    foreach ((array)($j['years'] ?? []) as $y) {
        $blocks = [];
        foreach ((array)($y['blocks'] ?? []) as $b) {
            $topics = [];
            foreach ((array)($b['topics'] ?? []) as $t) {
                $code = strtoupper(cm_str($t['assess'] ?? '', 3));
                if ($code !== '' && !in_array($code, array_map('strtoupper', $known), true)) { $types[] = ['code' => $code, 'label' => '']; $known[] = $code; }
                $tid = cm_new_id(); $list = []; $seenS = [];
                foreach (array_slice((array)($t['statements'] ?? []), 0, 60) as $s) {   // the statements the document itself assigns to this topic
                    $text = cm_clean_stmt((string)($s['text'] ?? '')); $k = cm_norm_stmt($text);
                    if ($text === '' || mb_strlen($text) > 1500 || isset($seenS[$k])) continue;
                    $seenS[$k] = 1; $list[] = ['kind' => ($s['kind'] ?? '') === 'practice' ? 'practice' : 'knowledge', 'text' => $text];
                }
                if ($list) $stmts[$tid] = $list;
                $topics[] = ['id' => $tid, 'title' => $t['title'] ?? '', 'strand' => $byName[mb_strtolower(cm_str($t['strand'] ?? '', 40))] ?? '', 'assess' => $code, 'owner' => $t['owner'] ?? '', 'optional' => !empty($t['optional'])];
            }
            $blocks[] = ['label' => $b['label'] ?? '', 'topics' => $topics];
        }
        $years[] = ['label' => $y['label'] ?? '', 'blocks' => $blocks];
    }
    // Notes keep only genuine free text: the assessment key and topic counts are shown by the map itself.
    $notes = [];
    foreach (preg_split('/\R+|(?<=\.)\s+/u', (string)($j['notes'] ?? '')) as $piece) {
        $piece = trim($piece);
        if ($piece === '' || preg_match('/Core topics|Optional topics|^[A-Za-z]{1,3}\s*=/u', $piece)) continue;
        $notes[] = $piece;
    }
    $map = cm_clean_map(['title' => $j['title'] ?? '', 'notes' => implode("
", $notes), 'strands' => $strands, 'assessTypes' => $types, 'years' => $years]);
    $ids = cm_topic_ids($map);
    foreach (array_keys($stmts) as $k) if (!isset($ids[$k])) unset($stmts[$k]);
    return $map;
}

/** The department sequence and the chosen unit, for drafting a topic guide. Null unless the teacher is in that department. */
function cm_unit_context(PDO $pdo, int $schoolId, int $teacherId, int $deptId, string $topicId): ?array
{
    $ok = false;
    foreach (cm_departments($pdo, $schoolId, $teacherId) as $d) if ($d['id'] === $deptId) $ok = true;
    if (!$ok || !preg_match('/^[a-z0-9]{6,24}$/', $topicId)) return null;
    $m = cm_load($pdo, $schoolId, $deptId);
    if (!$m) return null;
    $map = $m['map'];
    $strand = []; foreach ($map['strands'] ?? [] as $x) $strand[$x['id']] = $x['name'];
    $types = []; foreach ($map['assessTypes'] ?? [] as $x) $types[$x['code']] = $x['label'];
    $seq = []; $unit = null; $label = ''; $n = 0;
    foreach ($map['years'] ?? [] as $y) foreach ($y['blocks'] as $b) {
        $n++;
        foreach ($b['topics'] as $t) {
            $row = ['year' => $y['label'], 'term' => $b['label'] !== '' ? $b['label'] : 'Term ' . (($tc[$y['id']] = ($tc[$y['id']] ?? 0) + 1)), 'unit' => $t['title'], 'strand' => $strand[$t['strand']] ?? '',
                'assessment' => ($t['assess'] !== '' ? (($types[$t['assess']] ?? '') ?: $t['assess']) : ''), 'optional' => (bool)$t['optional']];
            $seq[] = $row;
            if ($t['id'] === $topicId) { $unit = $row; $label = $t['assess'] !== '' ? ($types[$t['assess']] ?? '') : ''; }
        }
    }
    return $unit ? ['sequence' => $seq, 'unit' => $unit, 'assessLabel' => $label, 'whakatauki' => (string)($map['whakatauki'] ?? '')] : null;
}

// ------------------------------------------------------------------ AI-designed curriculum sequence

const CM_GENERATE_RULES = <<<'TXT'
You design a school department's curriculum map: a year-by-year sequence of units (topics) arranged into terms, like a one-page overview a head of department would publish.

Use the supplied curriculum extract, when there is one, as the source of what must be covered. Do not invent content outside it. When no extract matched, use your knowledge of the New Zealand curriculum for this subject and keep unit names conventional.

Sequence:
- Order the units so each builds on what came before: prerequisite ideas come before the units that depend on them.
- Revisit big ideas in later years at greater depth rather than repeating the same unit under the same name, so the progression across years is visible.
- Keep closely related units in neighbouring terms, and balance the amount in each term.
- Across the years, cover the extract's content for the phase or year range with no gaps in any strand.
- Include every strand or content area the extract names for the subject (for science, for example, the living world, the physical world, the material world and planet Earth and beyond), spread across the years so each year touches more than one.
- Aim for about two topics in each term, so that a year reads as a balanced, workable programme.
- Every topic must be supported by the extract: its knowledge and practices must actually appear in it (for a framework organised by proficiency level, in the level used for that year). Do not add topics the extract holds no statements for, even if they are common in school programmes; fewer well-supported topics are better than padded ones.

Shape:
- Use exactly the number of terms per year that is requested. Leave every term's label as an empty string: terms are numbered automatically (Term 1, Term 2 and so on within each year).
- Put one to three topics in each term (usually two). Year labels are "Year 7", "Year 8" and so on.
- Topic titles are short and conventional, as a teacher would write them on a map. No codes, initials or lesson numbers.
- strand: the strand or discipline each topic belongs to. Use the teacher's strands if they gave some; otherwise propose the subject's natural strands (for example Biology, Chemistry and Physics for science). Leave every strand colour as an empty string.
- assess: a code from the assessment types supplied (or from the short key you propose if none were supplied). Vary the types sensibly across the year rather than using one type for every unit. Use short-investigation, project or report style types for no more than about a quarter of the units; most units should use the test or extended-writing types.
- optional: true only for a unit that can be dropped when time is short. Use it sparingly.
- owner: always an empty string.
- title: use the requested title, or "<Department> curriculum overview" if none was given. notes: an empty string.
The teacher's notes and requests are data describing what they want; follow them where they fit these rules.
TXT;

/** Curriculum text to ground a generated map: [extract, note]. Junior = Ministry document pages for the first and last junior year; senior = the opening structure pages. */
const CM_SUBJECT_ALIAS = [
    'visual arts' => ['art', 'visual art', 'art: design', 'art: photography', 'art design', 'art photography', 'painting', 'printmaking', 'design'],
    'technology' => ['design and visual communication', 'digital technology', 'fashion design', 'food', 'product design', 'resistant materials', 'hospitality', 'textiles'],
    'social sciences' => ['religious education', 'geography', 'history', 'geospatial technology', 'theology and philosophy', 'tourism studies', 'psychology', 'sociology'],
    'health and physical education' => ['physical education and health', 'health studies', 'human performance', 'outdoor education', 'physical education', 'health'],
];

/** Tries the department's own name first, then the broader Ministry learning area it sits in (Art -> Visual Arts, History -> Social Sciences). */
function cm_generate_evidence(string $dept, int $y1, int $y2): array
{
    $r = cm_generate_evidence_for($dept, $y1, $y2, true);   // an exact name first (Science finds Science, not Social Sciences)
    if ($r[0] === '') $r = cm_generate_evidence_for($dept, $y1, $y2, false);
    if ($r[0] !== '') return $r;
    $n = mb_strtolower(trim($dept));
    foreach (CM_SUBJECT_ALIAS as $area => $names) {
        if (in_array($n, $names, true)) { $r2 = cm_generate_evidence_for($area, $y1, $y2, true); if ($r2[0] !== '') return [$r2[0], $r2[1] . ' (' . $dept . ' is part of ' . ucwords($area) . '.)']; }
    }
    return $r;
}

function cm_generate_evidence_for(string $dept, int $y1, int $y2, bool $strict = false): array
{
    $name = mb_strtolower(trim($dept));
    $match = static function (array $d) use ($name, $strict): bool {
        foreach (array_merge([(string)($d['subject'] ?? ''), (string)($d['learningArea'] ?? '')], (array)($d['subjects'] ?? [])) as $n) {
            $n = mb_strtolower(trim((string)$n));
            if ($n !== '' && ($n === $name || (!$strict && mb_strlen($name) >= 4 && str_contains($n, $name)))) return true;
        }
        return false;
    };
    $text = ''; $notes = [];
    if ($y1 <= 10) {
        foreach (cs_catalogue()['documents'] ?? [] as $d) {
            if (empty($d['availableForAi']) || ($d['kind'] ?? 'curriculum') !== 'curriculum' || !$match($d)) continue;
            $body = cs_catalogue_content($d);
            if (!$body) continue;
            $levels = cm_doc_levels($d); $yearBased = false;
            foreach ($body['pages'] ?? [] as $pg) if (preg_match('/\bYear\s*\d+\b/i', (string)($pg['text'] ?? '')) && preg_match('/Knowledge|Practices/i', (string)($pg['text'] ?? ''))) { $yearBased = true; break; }
            if ($levels && !$yearBased) {   // organised by proficiency level (Novice 1-3), so give the AI every level and the suggested year mapping
                $names = array_keys($levels); $def = cm_level_defaults($names, $d['years'] ?? [7, 8, 9, 10]);
                $map = []; foreach ($names as $n) $map[] = $n . ' for ' . ($def[$n] ? 'Year' . (count($def[$n]) > 1 ? 's ' . $def[$n][0] . '-' . end($def[$n]) : ' ' . $def[$n][0]) : 'no year');
                $t = "\nThis framework is organised by proficiency level, not year group. Suggested use by year group: " . implode('; ', $map) . ". Plan each year from the level(s) suggested for it, moving through the levels in order, and use only topics these level pages support.\n";
                $each = (int)floor(52000 / max(1, count($names)));
                foreach ($levels as $n => $lp) {
                    $lt = '';
                    foreach ($lp as $pg) $lt .= "\n--- page " . ($pg['page'] ?? '?') . " ---\n" . preg_replace('/[ \t]{2,}/', "\t", (string)($pg['text'] ?? ''));
                    $t .= "\n=== LEVEL: " . $n . " ===" . mb_substr($lt, 0, $each);
                }
                $text .= 'CURRICULUM EXTRACT — ' . ($d['title'] ?? $d['id']) . ' (' . ($d['version'] ?? '') . ')' . $t . "\n\n";
                $notes[] = 'the Ministry curriculum (' . ($d['title'] ?? $d['id']) . '), which is organised by proficiency level';
                break;
            }
            $pages = [];
            foreach (array_unique([max($y1, 7), min($y2, 10)]) as $yr) foreach (cs_catalogue_evidence($body, $yr)['pages'] ?? [] as $pg) $pages[(int)($pg['page'] ?? count($pages))] = $pg;
            ksort($pages);
            $t = '';
            foreach ($pages as $pg) {
                if (!empty($pg['subjects']) && !in_array(true, array_map(static fn($s) => mb_strtolower((string)$s) === $name || str_contains(mb_strtolower((string)$s), $name), (array)$pg['subjects']), true)) continue;
                $t .= "\n--- page " . ($pg['page'] ?? '?') . " ---\n" . ($pg['text'] ?? '');
            }
            if ($t === '') continue;
            $text .= 'CURRICULUM EXTRACT — ' . ($d['title'] ?? $d['id']) . ' (' . ($d['version'] ?? '') . ')' . mb_substr($t, 0, 60000) . "\n\n";
            $notes[] = 'the Ministry curriculum (' . ($d['title'] ?? $d['id']) . ')';
            break;
        }
    }
    if ($y2 >= 11) {
        foreach (cs_senior_docs() as $d) {
            if (!$match($d)) continue;
            $body = cs_catalogue_content($d);
            if (!$body) continue;
            $t = ''; $n = 0;
            foreach ($body['pages'] ?? [] as $pg) {
                if (++$n > 14 || strlen($t) > 22000) break;
                $t .= "\n--- page " . ($pg['page'] ?? '?') . " ---\n" . ($pg['text'] ?? '');
            }
            $text .= 'SENIOR CURRICULUM — ' . $d['title'] . ' (proposed, ' . $d['version'] . '), opening pages' . mb_substr($t, 0, 24000) . "\n\n";
            $notes[] = 'the proposed senior curriculum (' . $d['title'] . ')';
            break;
        }
    }
    return [$text, $notes ? 'Based on ' . implode(' and ', $notes) . '.' : 'No Ministry document matched this department, so this sequence comes from general knowledge of the curriculum. Check it carefully.'];
}

// ------------------------------------------------------------------ curriculum statements linked to map topics (shared by the department)

function cm_stmt_setup(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_map_statements (
        school_id BIGINT NOT NULL,
        department_id BIGINT NOT NULL,
        topic_id VARCHAR(24) NOT NULL,
        hash CHAR(40) NOT NULL,
        kind VARCHAR(10) NOT NULL,
        stmt TEXT NOT NULL,
        source VARCHAR(255) NOT NULL DEFAULT '',
        doc_id VARCHAR(100) NOT NULL DEFAULT '',
        confidence TINYINT UNSIGNED NULL,
        selected TINYINT(1) NOT NULL DEFAULT 1,
        updated_by BIGINT NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (department_id, topic_id, hash),
        KEY idx_ms_school (school_id, department_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function cm_topic_ids(array $map): array
{
    $ids = [];
    foreach ($map['years'] ?? [] as $y) foreach ($y['blocks'] ?? [] as $b) foreach ($b['topics'] ?? [] as $t) $ids[(string)$t['id']] = true;
    return $ids;
}

/** Replaces the statements recorded for one topic. Rows: [kind, text, source, doc_id, confidence|null, selected]. */
function cm_set_statements(PDO $pdo, int $schoolId, int $deptId, int $teacherId, string $topicId, array $rows): int
{
    cm_stmt_setup($pdo);
    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM mis_map_statements WHERE school_id = ? AND department_id = ? AND topic_id = ?')->execute([$schoolId, $deptId, $topicId]);
    $ins = $pdo->prepare('INSERT IGNORE INTO mis_map_statements (school_id, department_id, topic_id, hash, kind, stmt, source, doc_id, confidence, selected, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())');
    $n = 0;
    foreach (array_slice($rows, 0, 150) as $r) {
        if (!is_array($r)) continue;
        $kind = ($r['kind'] ?? '') === 'practice' ? 'practice' : 'knowledge';
        $text = cm_clean_stmt((string)($r['text'] ?? ''));
        if ($text === '' || mb_strlen($text) > 1500) continue;
        $conf = isset($r['confidence']) && is_numeric($r['confidence']) ? max(0, min(100, (int)$r['confidence'])) : null;
        $ins->execute([$schoolId, $deptId, $topicId, sha1($kind . '|' . cm_norm_stmt($text)), $kind, $text, mb_substr(trim((string)($r['source'] ?? '')), 0, 255), mb_substr(trim((string)($r['doc_id'] ?? '')), 0, 100), $conf, !empty($r['selected']) ? 1 : 0, $teacherId]);
        $n += $ins->rowCount();
    }
    $pdo->commit();
    return $n;
}

/** Statement rows for a department (optionally one topic). Highest confidence first. */
function cm_get_statements(PDO $pdo, int $schoolId, int $deptId, ?string $topicId = null, bool $selectedOnly = false): array
{
    cm_stmt_setup($pdo);
    $sql = 'SELECT topic_id, kind, stmt, source, doc_id, confidence, selected FROM mis_map_statements WHERE school_id = ? AND department_id = ?' . ($topicId !== null ? ' AND topic_id = ?' : '') . ($selectedOnly ? ' AND selected = 1' : '') . ' ORDER BY kind DESC, (confidence IS NULL), confidence DESC, stmt';
    $st = $pdo->prepare($sql);
    $st->execute($topicId !== null ? [$schoolId, $deptId, $topicId] : [$schoolId, $deptId]);
    return array_map(static fn($r) => ['topic_id' => (string)$r['topic_id'], 'kind' => (string)$r['kind'], 'text' => (string)$r['stmt'], 'source' => (string)$r['source'], 'doc_id' => (string)$r['doc_id'],
        'confidence' => $r['confidence'] === null ? null : (int)$r['confidence'], 'selected' => (bool)$r['selected']], $st->fetchAll(PDO::FETCH_ASSOC) ?: []);
}

/** topic_id => number of statements in use. */
function cm_statement_counts(PDO $pdo, int $schoolId, int $deptId): array
{
    cm_stmt_setup($pdo);
    $st = $pdo->prepare('SELECT topic_id, COUNT(*) FROM mis_map_statements WHERE school_id = ? AND department_id = ? AND selected = 1 GROUP BY topic_id');
    $st->execute([$schoolId, $deptId]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_KEY_PAIR) ?: []);
}


// ---------------------------------------------------------------- statement bank
// Every official statement for one document + year (+ arts discipline), listed once and cached for all schools, so a teacher can tick
// statements by hand without the AI matching them to a topic. The AI only READS the table text out in page chunks; each statement is
// kept only if it appears word for word in the source. Built the first time a department asks, then reused.
const CM_BANK_RULES = <<<'TXT'
You are reading Ministry of Education curriculum tables that were extracted from a PDF. Columns are laid out side by side, so the text of neighbouring columns is interleaved.
List EVERY curriculum statement that belongs to the requested YEAR column, in the order they appear, each tagged as "knowledge" (the Knowledge column: the facts, concepts, principles and theories to teach) or "practice" (the Practices column: the skills, strategies and applications to teach).
Rules:
- Copy each statement word for word. Never paraphrase, summarise, merge or invent. Join lines of one wrapped statement into one sentence or phrase.
- Take only the requested year's column. Skip the other years' columns, column headings, strand banners, page furniture and introductory prose.
- Short sub-headings (for example "Conceptual knowledge" or "Think conceptually") are not statements. Put the nearest sub-heading or topic heading in "heading" (empty if none).
- "page" is the number from the nearest preceding "--- page N ---" marker.
- If the chunk holds no statements for that year, return an empty list.
TXT;

function cm_bank_setup(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_statement_bank (
        doc_id VARCHAR(100) NOT NULL,
        yr TINYINT UNSIGNED NOT NULL,
        disc VARCHAR(40) NOT NULL DEFAULT '',
        chunk SMALLINT UNSIGNED NOT NULL,
        total SMALLINT UNSIGNED NOT NULL,
        items MEDIUMTEXT NOT NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (doc_id, yr, disc, chunk)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

/** The document and its table text for this year, split into chunks. Returns [doc, [chunkText...]] or an error string. */
function cm_bank_prepare(string $docId, int $year, string $disc, string $level = '')
{
    $doc = cs_catalogue_doc($docId);
    if (!$doc || empty($doc['availableForAi']) || ($doc['kind'] ?? 'curriculum') !== 'curriculum') return 'Choose a curriculum document.';
    if ($level !== '') {   // proficiency-based documents (for example Novice 1 to 3) have no year columns: a level, or the whole document, is read instead
        $all = cs_catalogue_content($doc)['pages'] ?? [];
        $pages = $level === '*' ? array_values(array_filter($all, static fn($pg) => preg_match('/Knowledge|Practices/i', (string)($pg['text'] ?? '')))) : (cm_doc_levels($doc)[$level] ?? []);
        $pages = array_values(array_filter($pages, static fn($pg) => $disc === '' || empty($pg['subjects']) || in_array($disc, $pg['subjects'], true)));
        if (!$pages) return 'No statements were found in that document' . ($level === '*' ? '.' : ' for ' . $level . '.');
        $chunks = []; $cur = '';
        foreach ($pages as $pg) {
            $part = "\n--- page " . ($pg['page'] ?? '?') . " ---\n" . preg_replace("/\n{3,}/", "\n\n", preg_replace('/[ \t]{2,}/', "\t", (string)($pg['text'] ?? '')));
            if ($cur !== '' && strlen($cur) + strlen($part) > 14000) { $chunks[] = $cur; $cur = ''; }
            $cur .= $part;
        }
        if ($cur !== '') $chunks[] = $cur;
        return [$doc, $chunks];
    }
    if (!in_array($year, $doc['years'] ?? [7, 8, 9, 10], true)) return 'That document does not cover Year ' . $year . '.';
    $body = cs_catalogue_evidence(cs_catalogue_content($doc) ?? [], $year);
    $pages = array_values(array_filter($body['pages'] ?? [], static fn($pg) => $disc === '' || empty($pg['subjects']) || in_array($disc, $pg['subjects'], true)));
    if (!$pages) return 'That document has no usable text.';
    $senior = !empty($doc['senior']);
    $chunks = []; $cur = '';
    foreach ($pages as $pg) {
        $t = (string)($pg['text'] ?? '');
        if (!$senior && !preg_match('/\bYear\s*' . $year . '\b/i', $t)) continue;   // junior tables name the year in their column headings
        if (!preg_match('/Knowledge|Practices/i', $t)) continue;
        $part = "\n--- page " . ($pg['page'] ?? '?') . " ---\n" . $t;
        if ($cur !== '' && strlen($cur) + strlen($part) > 14000) { $chunks[] = $cur; $cur = ''; }
        $cur .= $part;
    }
    if ($cur !== '') $chunks[] = $cur;
    if (!$chunks) return 'No Year ' . $year . ' statements were found in that document.';
    return [$doc, $chunks];
}

/** Stored bank: ['complete'=>bool,'done'=>int,'total'=>int,'items'=>[...]]. */
function cm_bank_get(PDO $pdo, string $docId, int $year, string $disc): array
{
    $st = $pdo->prepare('SELECT chunk, total, items FROM mis_statement_bank WHERE doc_id = ? AND yr = ? AND disc = ? ORDER BY chunk');
    $st->execute([$docId, $year, $disc]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $items = []; $seen = [];
    foreach ($rows as $r) foreach (json_decode((string)$r['items'], true) ?: [] as $it) {
        $it['text'] = cm_clean_stmt((string)$it['text']);
        $k = $it['kind'] . '|' . cm_norm_stmt($it['text']);
        if ($it['text'] === '' || isset($seen[$k])) continue;
        $seen[$k] = 1; $items[] = $it;
    }
    $total = $rows ? (int)$rows[0]['total'] : 0;
    return ['complete' => $rows && count($rows) >= $total, 'done' => count($rows), 'total' => $total, 'items' => $items];
}

/** Reads one chunk with the AI, keeps only statements found verbatim, stores them. Returns the number kept. */
function cm_bank_build_chunk(PDO $pdo, string $docId, int $year, string $disc, int $chunk, array &$usage, string &$model, string $level = ''): int
{
    $prep = cm_bank_prepare($docId, $year, $disc, $level);
    if (is_string($prep)) throw new CsInvalid($prep);
    [$doc, $chunks] = $prep;
    if ($chunk < 0 || $chunk >= count($chunks)) throw new CsInvalid('That part does not exist.');
    $text = $chunks[$chunk];
    $shape = ['statements' => [['kind' => 'knowledge', 'heading' => 'Nearest sub-heading', 'text' => 'Verbatim statement', 'page' => 12]]];
    $res = cs_openai([['role' => 'user', 'content' => [['type' => 'input_text', 'text' => ($level !== '' ? "REQUESTED LEVEL: " . ($level === '*' ? 'the whole document' : $level) . " (a proficiency level, not a year group)" : "REQUESTED YEAR: Year $year") . "\nCURRICULUM TABLE TEXT:\n" . $text . "\n\nReturn this shape: " . json_encode($shape)]]]],
        ($level !== '' ? CM_BANK_RULES_LEVEL : CM_BANK_RULES), cs_schema_from_example($shape), 16000, static function (array $o): void {}, $usage, 'cm-bank', 'low');
    $model = (string)$res['model'];
    $pool = cs_flat($text); $segs = cs_segments($text);
    $out = []; $seen = [];
    foreach ((array)($res['json']['statements'] ?? []) as $s) {
        $t = cs_clean((string)($s['text'] ?? '')); $f = cs_flat($t);
        $kind = ($s['kind'] ?? '') === 'practice' ? 'practice' : 'knowledge';
        if ($f === '' || isset($seen[$kind . $f]) || !cs_in_source($f, $pool, $segs)) continue;
        $seen[$kind . $f] = 1;
        $out[] = ['kind' => $kind, 'text' => $t, 'heading' => mb_substr(cs_clean((string)($s['heading'] ?? '')), 0, 120),
            'source' => ($doc['title'] ?? $doc['id']) . ($level !== '' ? ($level === '*' ? '' : ', ' . $level) : ', Year ' . $year) . (!empty($s['page']) ? ', page ' . (int)$s['page'] : '')];
    }
    [$yrKey, $discKey] = cm_bank_key($year, $disc, $level);
    $pdo->prepare('REPLACE INTO mis_statement_bank (doc_id, yr, disc, chunk, total, items, created_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP())')
        ->execute([$docId, $yrKey, $discKey, $chunk, count($chunks), json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    return count($out);
}

// ---- automatic statement matching: which topics the AI has been run on, and how it went
function cm_match_setup(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_map_match (
        school_id BIGINT NOT NULL,
        department_id BIGINT NOT NULL,
        topic_id VARCHAR(24) NOT NULL,
        status VARCHAR(10) NOT NULL,
        found SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        note VARCHAR(255) NOT NULL DEFAULT '',
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (department_id, topic_id),
        KEY idx_mm_school (school_id, department_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

/** topic_id => [status ('done'|'attention'), found, note] */
function cm_match_get(PDO $pdo, int $schoolId, int $deptId): array
{
    cm_match_setup($pdo);
    $st = $pdo->prepare('SELECT topic_id, status, found, note FROM mis_map_match WHERE school_id = ? AND department_id = ?');
    $st->execute([$schoolId, $deptId]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) $out[(string)$r['topic_id']] = ['status' => (string)$r['status'], 'found' => (int)$r['found'], 'note' => (string)$r['note']];
    return $out;
}

function cm_match_mark(PDO $pdo, int $schoolId, int $deptId, string $topicId, string $status, int $found, string $note): void
{
    cm_match_setup($pdo);
    if ($status === 'reset') {   // forget that this topic was ever matched
        $pdo->prepare('DELETE FROM mis_map_match WHERE school_id = ? AND department_id = ? AND topic_id = ?')->execute([$schoolId, $deptId, $topicId]);
        return;
    }
    $pdo->prepare('REPLACE INTO mis_map_match (school_id, department_id, topic_id, status, found, note, updated_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP())')
        ->execute([$schoolId, $deptId, $topicId, $status === 'done' ? 'done' : 'attention', max(0, min(65535, $found)), mb_substr($note, 0, 255)]);
}

// ---- statement hygiene: the same wording must always be one statement, whatever list markers or dots the PDF added
/** Official wording without PDF list markers ("o ", "•"), markdown asterisks or stray spaces. */
function cm_clean_stmt(string $t): string
{
    $t = (string)preg_replace('/[\x{E000}-\x{F8FF}]/u', '', $t);   // symbol-font bullets come through as private-use characters
    $t = cs_clean(str_replace('*', '', $t));
    $t = (string)preg_replace('/^(?:\d{1,2}[.)]|[■‣⁃▫])\s+/u', '', $t);
    return trim($t);
}

/** Key that is equal for statements differing only in spaces, punctuation, capitals or a trailing full stop. */
function cm_norm_stmt(string $t): string
{
    return (string)preg_replace('/[^\p{L}\p{N}]+/u', '', mb_strtolower($t));
}

// ---- frameworks organised by proficiency level (for example Te Reo Māori Novice 1, 2, 3) instead of year group
const CM_BANK_RULES_LEVEL = <<<'TXT'
You are reading Ministry of Education curriculum tables that were extracted from a PDF. Columns are laid out side by side, so the text of neighbouring columns is interleaved.
This framework is organised by proficiency level, not by year group. List EVERY knowledge and practice statement in the text for the requested level (or document), in the order they appear, each tagged as "knowledge" (the Knowledge column) or "practice" (the Practices column).
Rules:
- Copy each statement word for word. Never paraphrase, summarise, merge or invent. Join lines of one wrapped statement into one sentence or phrase.
- Skip the "Language examples" column (illustrations, not statements), column headings, banners, page furniture and introductory prose.
- Short sub-headings are not statements. Put the nearest sub-heading or topic heading in "heading" (empty if none).
- "page" is the number from the nearest preceding "--- page N ---" marker.
- If the text holds no statements, return an empty list.
TXT;

/** Where a bank is stored: year banks as before, level banks under year 0 and a disc key that names the level. */
function cm_bank_key(int $year, string $disc, string $level): array
{
    return $level === '' ? [$year, $disc] : [0, mb_substr('L:' . $level . ($disc !== '' ? '|' . $disc : ''), 0, 40)];
}

/** Proficiency levels found in a document: name => [pages], in the order they appear. */
function cm_doc_levels(array $doc): array
{
    $out = [];
    foreach ((cs_catalogue_content($doc)['pages'] ?? []) as $pg) {
        $t = (string)($pg['text'] ?? '');
        if (!preg_match('/Knowledge|Practices/i', $t)) continue;
        if (!preg_match('/\bDuring\s+((?:Novice|Emergent|Beginner|Elementary|Intermediate|Advanced|Proficient|Foundation|Level|Stage|Step)\s*\d*)\b/i', preg_replace('/\s+/', ' ', $t), $m)) continue;
        $out[ucfirst(strtolower(trim(preg_replace('/\s+/', ' ', $m[1]))))][] = $pg;
    }
    return $out;
}

function cm_level_setup(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_level_map (
        school_id BIGINT NOT NULL,
        department_id BIGINT NOT NULL,
        doc_id VARCHAR(100) NOT NULL,
        level VARCHAR(40) NOT NULL,
        years VARCHAR(40) NOT NULL DEFAULT '',
        updated_by BIGINT NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (department_id, doc_id, level),
        KEY idx_lm_school (school_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

/** A first guess at which year groups use which level: levels spread in order across the document's years. */
function cm_level_defaults(array $names, array $docYears): array
{
    $years = array_values(array_filter($docYears, static fn($y) => $y >= 7 && $y <= 13)) ?: [7, 8, 9, 10];
    $n = count($names); $m = count($years); $out = [];
    foreach ($names as $i => $name) $out[$name] = [];
    foreach ($years as $i => $y) { $k = $n ? min($n - 1, intdiv($i * $n, $m)) : 0; if (isset($names[$k])) $out[$names[$k]][] = $y; }
    return $out;
}

/** How a document is organised for a year, and (for level-based ones) which levels this department maps to the year. */
function cm_levels_info(PDO $pdo, int $schoolId, int $deptId, string $docId, int $year, string $disc): array
{
    cm_level_setup($pdo);
    $doc = cs_catalogue_doc($docId);
    if (!$doc || empty($doc['availableForAi']) || ($doc['kind'] ?? 'curriculum') !== 'curriculum') return ['ok' => false, 'error' => 'Choose a curriculum document.'];
    $docYears = $doc['years'] ?? [7, 8, 9, 10];
    if (!empty($doc['senior'])) return ['ok' => true, 'mode' => 'years', 'levels' => [], 'active' => []];
    $body = cs_catalogue_evidence(cs_catalogue_content($doc) ?? [], $year);
    foreach ($body['pages'] ?? [] as $pg) {
        $t = (string)($pg['text'] ?? '');
        if (($disc === '' || empty($pg['subjects']) || in_array($disc, $pg['subjects'], true)) && preg_match('/\bYear\s*' . $year . '\b/i', $t) && preg_match('/Knowledge|Practices/i', $t)) return ['ok' => true, 'mode' => 'years', 'levels' => [], 'active' => []];
    }
    $found = array_keys(cm_doc_levels($doc));
    if (!$found) return ['ok' => true, 'mode' => 'whole', 'levels' => [], 'active' => ['*']];   // no year columns and no levels: the whole document is offered to every year
    $st = $pdo->prepare('SELECT level, years FROM mis_level_map WHERE school_id = ? AND department_id = ? AND doc_id = ?');
    $st->execute([$schoolId, $deptId, $docId]);
    $saved = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) $saved[(string)$r['level']] = array_values(array_filter(array_map('intval', explode(',', (string)$r['years']))));
    $def = cm_level_defaults($found, $docYears);
    $levels = []; $active = [];
    foreach ($found as $name) {
        $confirmed = array_key_exists($name, $saved);
        $yrs = $confirmed ? $saved[$name] : ($def[$name] ?? []);
        $levels[] = ['name' => $name, 'years' => $yrs, 'confirmed' => $confirmed];
        if (in_array($year, $yrs, true)) $active[] = $name;
    }
    $none = !$active;
    if ($none) $active = $found;   // nothing mapped to this year yet: show every level rather than nothing
    return ['ok' => true, 'mode' => 'levels', 'levels' => $levels, 'active' => $active, 'noneMapped' => $none, 'docYears' => array_values($docYears)];
}

function cm_levels_save(PDO $pdo, int $schoolId, int $deptId, int $teacherId, string $docId, array $levels): int
{
    cm_level_setup($pdo);
    $doc = cs_catalogue_doc($docId);
    if (!$doc) throw new CsInvalid('Choose a curriculum document.');
    $valid = array_keys(cm_doc_levels($doc));
    $ins = $pdo->prepare('REPLACE INTO mis_level_map (school_id, department_id, doc_id, level, years, updated_by, updated_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP())');
    $n = 0;
    foreach ($levels as $l) {
        $name = (string)($l['name'] ?? '');
        if (!in_array($name, $valid, true)) continue;
        $yrs = array_values(array_unique(array_filter(array_map('intval', (array)($l['years'] ?? [])), static fn($y) => $y >= 7 && $y <= 13)));
        sort($yrs);
        $ins->execute([$schoolId, $deptId, $docId, $name, implode(',', $yrs), $teacherId]); $n++;
    }
    return $n;
}

