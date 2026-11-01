<?php
declare(strict_types=1);
// mis/curriculum_map_api.php - API for department curriculum maps (2026-10-31).
// GET  ?action=state[&department_id=N]
// POST ?action=save|delete|create-department   (JSON body with the MIS csrf token in "csrf")
// POST ?action=import                          (multipart: csrf, department_id, file) -> NDJSON stream: started/progress/result/error
// A teacher can only touch maps of departments they belong to (managers: any department in their school).

require_once __DIR__ . '/mis_common.php';
require_once __DIR__ . '/curriculum_map_lib.php';

$teacher   = mis_require_teacher($pdo);
$teacherId = (int)$teacher['id'];
$schoolId  = (int)($teacher['school_id'] ?? 0);

$json = static function (array $payload, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0'); header('Pragma: no-cache'); header('Expires: Thu, 19 Nov 1981 08:52:00 GMT');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
};
if (!cs_enabled($pdo, $schoolId)) $json(['ok' => false, 'error' => 'Curriculum maps are not enabled for your school.'], 403);

$action = (string)($_GET['action'] ?? '');
$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';

try {
    cm_setup($pdo);
    cm_stmt_setup($pdo);   // DDL must not run inside the save transaction
    cm_bank_setup($pdo);
    cm_match_setup($pdo);
    cm_level_setup($pdo);
    $depts = cm_departments($pdo, $schoolId, $teacherId);
    $isManager = cm_is_manager($pdo, $teacherId);
    $deptFor = static function ($id) use ($depts): ?array {
        foreach ($depts as $d) if ($d['id'] === (int)$id) return $d;
        return null;
    };

    if (!$isPost) {
        if ($action === 'ping') $json(['ok' => true]);   // keeps the session alive
        if ($action === 'bank') {   // every official statement for a document + year, for hand ticking
            if (!$deptFor($_GET['department_id'] ?? 0)) $json(['ok' => false, 'error' => 'You are not in that department.'], 403);
            $docId = (string)($_GET['doc_id'] ?? ''); $yr = (int)($_GET['year'] ?? 0); $disc = mb_substr((string)($_GET['discipline'] ?? ''), 0, 40);
            if (!in_array($yr, [7, 8, 9, 10, 11, 12, 13], true)) $json(['ok' => false, 'error' => 'Choose a year from 7 to 13.'], 422);
            $level = mb_substr((string)($_GET['level'] ?? ''), 0, 30);
            [$kYr, $kDisc] = cm_bank_key($yr, $disc, $level);
            $b = cm_bank_get($pdo, $docId, $kYr, $kDisc);
            if (!$b['total']) {
                $prep = cm_bank_prepare($docId, $yr, $disc, $level);
                if (is_string($prep)) $json(['ok' => false, 'error' => $prep], 422);
                $b['total'] = count($prep[1]);
            }
            $json(['ok' => true] + $b);
        }
        if ($action === 'statements') {
            $d = $deptFor($_GET['department_id'] ?? 0);
            if (!$d) $json(['ok' => false, 'error' => 'You are not in that department.'], 403);
            $tid = isset($_GET['topic_id']) && preg_match('/^[a-z0-9]{6,24}$/', (string)$_GET['topic_id']) ? (string)$_GET['topic_id'] : null;
            $rows = cm_get_statements($pdo, $schoolId, $d['id'], $tid, $tid === null);
            $onMap = true;
            if ($tid !== null) { $mm = cm_load($pdo, $schoolId, $d['id']); $onMap = $mm && isset(cm_topic_ids($mm['map'])[$tid]); }
            $json(['ok' => true, 'statements' => $rows, 'onMap' => $onMap]);
        }
        if ($action === 'levels') {   // is this document organised by year or by proficiency level, and which levels does the department map to the year?
            $d = $deptFor($_GET['department_id'] ?? 0);
            if (!$d) $json(['ok' => false, 'error' => 'You are not in that department.'], 403);
            $yr = (int)($_GET['year'] ?? 0);
            if (!in_array($yr, [7, 8, 9, 10, 11, 12, 13], true)) $json(['ok' => false, 'error' => 'Choose a year from 7 to 13.'], 422);
            $json(cm_levels_info($pdo, $schoolId, $d['id'], (string)($_GET['doc_id'] ?? ''), $yr, mb_substr((string)($_GET['discipline'] ?? ''), 0, 40)));
        }
        if ($action === 'match-status') {
            $d = $deptFor($_GET['department_id'] ?? 0);
            if (!$d) $json(['ok' => false, 'error' => 'You are not in that department.'], 403);
            $json(['ok' => true, 'match' => (object)cm_match_get($pdo, $schoolId, $d['id'])]);
        }
        if ($action === 'export-docx') {   // the whole map and its selected statements as one Word document
            $d = $deptFor($_GET['department_id'] ?? 0);
            if (!$d) $json(['ok' => false, 'error' => 'You are not in that department.'], 403);
            $m = cm_load($pdo, $schoolId, $d['id']);
            if (!$m) $json(['ok' => false, 'error' => 'This department has no curriculum map yet.'], 404);
            require_once __DIR__ . '/curriculum_map_docx.php';
            $bin = cm_export_docx($m['map'], cm_get_statements($pdo, $schoolId, $d['id'], null, true), (string)$d['name'], (string)$m['updatedAt'], (string)$m['updatedBy']);
            $fn = trim(preg_replace('/[^A-Za-z0-9]+/', '-', (string)$d['name'] . ' curriculum overview'), '-') . '-' . gmdate('Y-m-d') . '.docx';
            while (ob_get_level()) ob_end_clean();
            header('Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            header('Content-Disposition: attachment; filename="' . $fn . '"');
            header('Content-Length: ' . strlen($bin));
            header('Cache-Control: private, no-store');
            echo $bin;
            exit;
        }
        if ($action !== 'state') $json(['ok' => false, 'error' => 'Unknown action.'], 400);
        $want = (int)($_GET['department_id'] ?? 0);
        $cur = $deptFor($want);
        if (!$cur && $depts) {   // land on a department this teacher heads, else the first one
            $hq = $pdo->prepare('SELECT department_id FROM mis_department_heads WHERE teacher_id = ? AND school_id = ?');
            $hq->execute([$teacherId, $schoolId]);
            $headed = array_map('intval', $hq->fetchAll(PDO::FETCH_COLUMN));
            foreach ($depts as $d) if (in_array($d['id'], $headed, true)) { $cur = $d; break; }
            $cur = $cur ?? $depts[0];
        }
        $out = ['ok' => true, 'departments' => $depts, 'isManager' => $isManager, 'department' => $cur, 'map' => null, 'version' => 0, 'updatedAt' => '', 'updatedBy' => ''];
        if ($cur) {
            $m = cm_load($pdo, $schoolId, $cur['id']);
            if ($m) $out = array_merge($out, $m, ['stmtCounts' => (object)cm_statement_counts($pdo, $schoolId, $cur['id'])]);
        }
        $json($out);
    }

    // ------------------------------------------------------------ POST
    $multipart = $action === 'import';
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > ($multipart ? 12 : 3) * 1024 * 1024) $json(['ok' => false, 'error' => 'That request is too large.'], 413);
    if ($multipart) {
        $in = $_POST;
    } else {
        $in = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($in)) $json(['ok' => false, 'error' => 'Use JSON.'], 400);
    }
    if (!mis_csrf_valid(isset($in['csrf']) ? (string)$in['csrf'] : null)) $json(['ok' => false, 'error' => 'Session expired. Refresh the page.'], 403);

    if ($action === 'create-department') {
        if (!$isManager) $json(['ok' => false, 'error' => 'Only school leaders can add a department.'], 403);
        $name = cm_str($in['name'] ?? '', 140);
        if ($name === '') $json(['ok' => false, 'error' => 'Give the department a name.'], 400);
        $exists = $pdo->prepare('SELECT id FROM mis_departments WHERE school_id = ? AND name = ?');
        $exists->execute([$schoolId, $name]);
        if ($exists->fetchColumn()) $json(['ok' => false, 'error' => 'A department with that name already exists.'], 409);
        $pdo->prepare('INSERT INTO mis_departments (school_id, name, is_active, sort_order) VALUES (?,?,1,0)')->execute([$schoolId, $name]);
        $deptId = (int)$pdo->lastInsertId();
        $pdo->prepare('INSERT IGNORE INTO mis_department_heads (department_id, teacher_id, school_id) VALUES (?,?,?)')->execute([$deptId, $teacherId, $schoolId]);
        $json(['ok' => true, 'department_id' => $deptId]);
    }

    $dept = $deptFor($in['department_id'] ?? 0);
    if (!$dept) $json(['ok' => false, 'error' => 'You are not in that department.'], 403);
    $deptId = $dept['id'];

    if ($action === 'bank-build') {   // reads one part of the document; the page calls it for each part in turn
        $docId = (string)($in['doc_id'] ?? ''); $yr = (int)($in['year'] ?? 0); $disc = mb_substr((string)($in['discipline'] ?? ''), 0, 40); $chunk = (int)($in['chunk'] ?? 0);
        $level = mb_substr((string)($in['level'] ?? ''), 0, 30);
        if (!in_array($yr, [7, 8, 9, 10, 11, 12, 13], true)) $json(['ok' => false, 'error' => 'Choose a year from 7 to 13.'], 422);
        [$kYr, $kDisc] = cm_bank_key($yr, $disc, $level);
        $have = $pdo->prepare('SELECT 1 FROM mis_statement_bank WHERE doc_id = ? AND yr = ? AND disc = ? AND chunk = ?');
        $have->execute([$docId, $kYr, $kDisc, $chunk]);
        if (!$have->fetchColumn()) {
            if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
            @set_time_limit(420);
            $usage = []; $model = ''; $t0 = time();
            try {
                cm_bank_build_chunk($pdo, $docId, $yr, $disc, $chunk, $usage, $model, $level);
                cs_usage_log($pdo, $schoolId, $teacherId, 'bank', $dept['name'] . ' Y' . $yr . ' #' . $chunk, $model, $usage, time() - $t0, true);
            } catch (Throwable $e) {
                cs_usage_log($pdo, $schoolId, $teacherId, 'bank', $dept['name'] . ' Y' . $yr . ' #' . $chunk, $model, $usage, time() - $t0, false, get_class($e) . ': ' . $e->getMessage());
                $json(['ok' => false, 'error' => $e instanceof CsInvalid || $e instanceof CsRetry ? $e->getMessage() : 'Could not read that part of the curriculum. Try again.'], 502);
            }
        }
        $b = cm_bank_get($pdo, $docId, $kYr, $kDisc);
        $json(['ok' => true, 'done' => $b['done'], 'total' => $b['total'], 'complete' => $b['complete']]);
    }

    if ($action === 'import-statements') {   // the statements an uploaded document assigned to each topic, kept exactly as the department wrote them
        $m = cm_load($pdo, $schoolId, $deptId);
        if (!$m) $json(['ok' => false, 'error' => 'Save the map first.'], 404);
        $ids = cm_topic_ids($m['map']);
        $src = 'Imported from ' . cm_str($in['source'] ?? 'your document', 120);
        $topics = 0; $total = 0;
        foreach (array_slice(is_array($in['statements'] ?? null) ? $in['statements'] : [], 0, 400, true) as $tid => $list) {
            if (!isset($ids[(string)$tid]) || !is_array($list)) continue;
            $rows = [];
            foreach ($list as $s) if (is_array($s)) $rows[] = ['kind' => $s['kind'] ?? '', 'text' => $s['text'] ?? '', 'source' => $src, 'doc_id' => '', 'confidence' => null, 'selected' => 1];
            $n = cm_set_statements($pdo, $schoolId, $deptId, $teacherId, (string)$tid, $rows);
            if ($n) { $topics++; $total += $n; cm_match_mark($pdo, $schoolId, $deptId, (string)$tid, 'done', $n, 'Imported from your document'); }
        }
        $json(['ok' => true, 'topics' => $topics, 'statements' => $total, 'counts' => (object)cm_statement_counts($pdo, $schoolId, $deptId)]);
    }

    if ($action === 'levels-save') {   // the department's confirmed mapping of proficiency levels to year groups
        $n = cm_levels_save($pdo, $schoolId, $deptId, $teacherId, (string)($in['doc_id'] ?? ''), is_array($in['levels'] ?? null) ? $in['levels'] : []);
        $json(['ok' => true, 'saved' => $n]);
    }

    if ($action === 'reset-statements') {   // removes every ticked statement and the matching progress for this department; a copy is kept for recovery
        $pdo->exec("CREATE TABLE IF NOT EXISTS mis_map_statements_trash (
            id BIGINT AUTO_INCREMENT PRIMARY KEY, deleted_at DATETIME NOT NULL, deleted_by BIGINT NOT NULL, school_id BIGINT NOT NULL, department_id BIGINT NOT NULL,
            topic_id VARCHAR(24) NOT NULL, kind VARCHAR(10) NOT NULL, stmt TEXT NOT NULL, source VARCHAR(255) NOT NULL DEFAULT '', doc_id VARCHAR(100) NOT NULL DEFAULT '',
            confidence TINYINT UNSIGNED NULL, selected TINYINT(1) NOT NULL DEFAULT 1, KEY idx_t (school_id, department_id, deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->beginTransaction();
        $cp = $pdo->prepare('INSERT INTO mis_map_statements_trash (deleted_at, deleted_by, school_id, department_id, topic_id, kind, stmt, source, doc_id, confidence, selected)
            SELECT UTC_TIMESTAMP(), ?, school_id, department_id, topic_id, kind, stmt, source, doc_id, confidence, selected FROM mis_map_statements WHERE school_id = ? AND department_id = ?');
        $cp->execute([$teacherId, $schoolId, $deptId]);
        $n = $cp->rowCount();
        $pdo->prepare('DELETE FROM mis_map_statements WHERE school_id = ? AND department_id = ?')->execute([$schoolId, $deptId]);
        $pdo->prepare('DELETE FROM mis_map_match WHERE school_id = ? AND department_id = ?')->execute([$schoolId, $deptId]);
        $pdo->commit();
        $json(['ok' => true, 'removed' => $n]);
    }

    if ($action === 'match-mark') {
        $tid = (string)($in['topic_id'] ?? '');
        $m = cm_load($pdo, $schoolId, $deptId);
        if (!$m || !isset(cm_topic_ids($m['map'])[$tid])) $json(['ok' => false, 'error' => 'That unit is not on the map.'], 404);
        cm_match_mark($pdo, $schoolId, $deptId, $tid, (string)($in['status'] ?? ''), (int)($in['found'] ?? 0), (string)($in['note'] ?? ''));
        $json(['ok' => true]);
    }

    if ($action === 'set-statements') {
        $tid = (string)($in['topic_id'] ?? '');
        $m = cm_load($pdo, $schoolId, $deptId);
        if (!$m || !isset(cm_topic_ids($m['map'])[$tid])) $json(['ok' => false, 'error' => 'That unit is not on the map.'], 404);
        $n = cm_set_statements($pdo, $schoolId, $deptId, $teacherId, $tid, is_array($in['statements'] ?? null) ? $in['statements'] : []);
        $json(['ok' => true, 'saved' => $n]);
    }

    if ($action === 'save') {
        $map = cm_clean_map($in['map'] ?? null);
        if (!$map['years']) $json(['ok' => false, 'error' => 'A map needs at least one year.'], 400);
        $data = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $ver = (int)($in['version'] ?? 0);
        $pdo->beginTransaction();
        $cur = $pdo->prepare('SELECT version FROM mis_curriculum_maps WHERE school_id = ? AND department_id = ? FOR UPDATE');
        $cur->execute([$schoolId, $deptId]);
        $have = $cur->fetchColumn();
        if ($have === false) {
            if ($ver !== 0) { $pdo->rollBack(); $json(['ok' => false, 'error' => 'This map no longer exists. Reload the page.', 'conflict' => true], 409); }
            $pdo->prepare('INSERT INTO mis_curriculum_maps (school_id, department_id, data, version, updated_by, updated_at) VALUES (?,?,?,1,?,UTC_TIMESTAMP())')->execute([$schoolId, $deptId, $data, $teacherId]);
            $new = 1;
        } else {
            if ((int)$have !== $ver) { $pdo->rollBack(); $json(['ok' => false, 'error' => 'A colleague changed this map. Reload to see their changes.', 'conflict' => true], 409); }
            cm_snapshot($pdo, $schoolId, $deptId, $teacherId, 'auto', 300);
            $new = $ver + 1;
            $pdo->prepare('UPDATE mis_curriculum_maps SET data = ?, version = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE school_id = ? AND department_id = ?')->execute([$data, $new, $teacherId, $schoolId, $deptId]);
        }
        $ids = array_keys(cm_topic_ids($map));
        if ($ids) {
            $pdo->prepare('DELETE FROM mis_map_statements WHERE school_id = ? AND department_id = ? AND topic_id NOT IN (' . implode(',', array_fill(0, count($ids), '?')) . ')')->execute(array_merge([$schoolId, $deptId], $ids));
            $pdo->prepare('DELETE FROM mis_map_match WHERE school_id = ? AND department_id = ? AND topic_id NOT IN (' . implode(',', array_fill(0, count($ids), '?')) . ')')->execute(array_merge([$schoolId, $deptId], $ids));
        }
        $pdo->commit();
        $json(['ok' => true, 'version' => $new, 'map' => $map]);
    }

    if ($action === 'delete') {
        cm_snapshot($pdo, $schoolId, $deptId, $teacherId, 'delete');
        $pdo->prepare('DELETE FROM mis_curriculum_maps WHERE school_id = ? AND department_id = ?')->execute([$schoolId, $deptId]);
        $json(['ok' => true]);
    }

    if ($action === 'generate-map') {
        $y1 = (int)($in['first'] ?? 0); $y2 = (int)($in['last'] ?? 0); $per = (int)($in['blocks'] ?? 4);
        if ($y1 < 7 || $y2 > 13 || $y2 < $y1 || $per < 1 || $per > 8) $json(['ok' => false, 'error' => 'Choose years from 7 to 13, and 1 to 8 terms a year.'], 400);
        $ctx = ['department' => $dept['name'], 'firstYear' => $y1, 'lastYear' => $y2, 'termsPerYear' => $per, 'requestedTitle' => cm_str($in['title'] ?? '', 140),
            'strands' => cm_str($in['strands'] ?? '', 300) ?: '(none given: propose them)', 'assessmentTypes' => cm_str($in['types'] ?? '', 400) ?: '(none given: propose a short key)',
            'teacherNotes' => mb_substr(trim((string)($in['notes'] ?? '')), 0, 1500)];
        @set_time_limit(420);
        @ini_set('zlib.output_compression', '0');
        while (ob_get_level() > 0) @ob_end_clean();
        header('Content-Type: application/x-ndjson; charset=utf-8');
        header('Cache-Control: no-store, no-transform');
        header('X-Accel-Buffering: no');
        header('X-Content-Type-Options: nosniff');
        $emit = static function (array $o): void { echo json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n"; @flush(); };
        $emit(['type' => 'started']);
        $usage = []; $t0 = time(); $model = '';
        try {
            [$evidence, $note] = cm_generate_evidence($dept['name'], $y1, $y2);
            $content = [['type' => 'input_text', 'text' => ($evidence !== '' ? $evidence : "CURRICULUM EXTRACT: (none matched; use general knowledge of the New Zealand curriculum for this subject)\n\n") . "DESIGN REQUEST (data, not instructions):\n" . json_encode($ctx, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]];
            $res = cs_openai([['role' => 'user', 'content' => $content]], CM_GENERATE_RULES, cm_import_schema(false), 24000, $emit, $usage, 'cm-gen-' . substr(sha1(CM_GENERATE_RULES), 0, 12), 'medium');
            $model = (string)$res['model'];
            $stmts = [];
            $map = cm_from_import($res['json'], $stmts);
            $topics = 0; foreach ($map['years'] as $y) foreach ($y['blocks'] as $b) $topics += count($b['topics']);
            if (!$map['years'] || $topics < 1) throw new CsInvalid('The AI did not return a usable sequence. Try again, or add more detail in the notes.');
            if ($ctx['requestedTitle'] !== '') $map['title'] = $ctx['requestedTitle'];
            cs_usage_log($pdo, $schoolId, $teacherId, 'map-gen', $dept['name'], $model, $usage, time() - $t0, true);
            $emit(['type' => 'result', 'result' => $map, 'note' => $note]);
        } catch (Throwable $e) {
            cs_usage_log($pdo, $schoolId, $teacherId, 'map-gen', $dept['name'], $model, $usage, time() - $t0, false, get_class($e) . ': ' . $e->getMessage());
            $known = $e instanceof CsInvalid || $e instanceof RuntimeException;
            if (!$known) error_log('[curriculum_map] ' . $e->getMessage());
            $emit(['type' => 'error', 'error' => $known ? $e->getMessage() : 'The sequence could not be generated. Try again.']);
        }
        exit;
    }

    if ($action === 'import') {
        $f = $_FILES['file'] ?? null;
        if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK || !is_uploaded_file((string)$f['tmp_name'])) $json(['ok' => false, 'error' => 'The file did not upload. Try again.'], 400);
        @set_time_limit(420);
        @ini_set('zlib.output_compression', '0');
        while (ob_get_level() > 0) @ob_end_clean();
        header('Content-Type: application/x-ndjson; charset=utf-8');
        header('Cache-Control: no-store, no-transform');
        header('X-Accel-Buffering: no');
        header('X-Content-Type-Options: nosniff');
        $emit = static function (array $o): void { echo json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n"; @flush(); };
        $emit(['type' => 'started']);
        $usage = []; $t0 = time(); $model = '';
        try {
            $src = cm_read_upload((string)$f['tmp_name'], (string)($f['name'] ?? ''));
            if (isset($src['text'])) {
                $text = trim($src['text']);
                if (mb_strlen($text) < 20) throw new CsInvalid('No readable text was found in that file.');
                $cutNote = mb_strlen($text) > 60000 ? 'Your document is long, so only the first 60,000 characters were read. Units after that point are missing: add them by hand, or upload the rest as a separate file.' : '';
                $content = [['type' => 'input_text', 'text' => 'Department: ' . $dept['name'] . "\n\nFILE CONTENT:\n" . mb_substr($text, 0, 60000)]];
            } else {
                $content = array_merge([['type' => 'input_text', 'text' => 'Department: ' . $dept['name'] . '. The curriculum map is in the attached file.']], $src['parts']);
            }
            $res = cs_openai([['role' => 'user', 'content' => $content]], CM_IMPORT_RULES, cm_import_schema(), 32000, $emit, $usage, 'cm-import-' . substr(sha1(CM_IMPORT_RULES), 0, 12));
            $model = (string)$res['model'];
            $map = cm_from_import($res['json']);
            if (!$map['years']) throw new CsInvalid('No year groups or units could be found in that file. Check it is a curriculum map, or build one from scratch.');
            cs_usage_log($pdo, $schoolId, $teacherId, 'map-import', $dept['name'], $model, $usage, time() - $t0, true);
            $emit(['type' => 'result', 'result' => $map + ['importStatements' => (object)$stmts], 'note' => $cutNote ?? '']);
        } catch (Throwable $e) {
            cs_usage_log($pdo, $schoolId, $teacherId, 'map-import', $dept['name'], $model, $usage, time() - $t0, false, get_class($e) . ': ' . $e->getMessage());
            $known = $e instanceof CsInvalid || $e instanceof RuntimeException;
            if (!$known) error_log('[curriculum_map] ' . $e->getMessage());
            $emit(['type' => 'error', 'error' => $known ? $e->getMessage() : 'The file could not be read. Try a different format, or build the map from scratch.']);
        }
        exit;
    }

    $json(['ok' => false, 'error' => 'Unknown action.'], 400);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('[curriculum_map] ' . $e->getMessage());
    $json(['ok' => false, 'error' => 'Something went wrong. Nothing was changed.'], 500);
}
