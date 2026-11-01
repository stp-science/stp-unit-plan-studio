<?php
declare(strict_types=1);
// mis/curriculum_studio_api.php - API for the Topic Guide Studio (simple version, 2026-10-31).
// GET  ?action=list|catalogue
// POST ?action=save|delete|save-config|find|generate   (JSON body with the MIS csrf token in "csrf")
// find and generate stream NDJSON: {"type":"started"} ... {"type":"result","result":...} or {"type":"error","error":...}.
// Everything is scoped to the signed-in teacher (their own guides only) and gated by cs_enabled() for their school.

require_once __DIR__ . '/mis_common.php';
require_once __DIR__ . '/curriculum_studio_lib.php';

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
if (!cs_enabled($pdo, $schoolId)) $json(['ok' => false, 'error' => 'Unit Plan Studio is not enabled for your school.'], 403);

$action = (string)($_GET['action'] ?? '');
$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$idOk = static fn($v): bool => is_string($v) && (bool)preg_match('/^[a-f0-9]{32}$/', $v);

try {
    cs_setup($pdo);

    if (!$isPost) {
        if ($action === 'list') {
            $st = $pdo->prepare('SELECT data FROM mis_topic_guides WHERE teacher_id = ? AND school_id = ? ORDER BY updated_at DESC');
            $st->execute([$teacherId, $schoolId]);
            // Stored JSON is returned verbatim so empty objects survive.
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0'); header('Pragma: no-cache'); header('Expires: Thu, 19 Nov 1981 08:52:00 GMT');
            echo '{"ok":true,"guides":[' . implode(',', $st->fetchAll(PDO::FETCH_COLUMN)) . ']}';
            exit;
        }
        if ($action === 'catalogue') {
            $docs = [];
            foreach (cs_catalogue()['documents'] ?? [] as $d) {
                if (empty($d['availableForAi']) || ($d['availableForCurriculum'] ?? true) === false || ($d['kind'] ?? 'curriculum') !== 'curriculum') continue;
                $docs[] = ['id' => $d['id'], 'learningArea' => $d['learningArea'] ?? '', 'subject' => $d['subject'] ?? ($d['learningArea'] ?? ''), 'title' => $d['title'] ?? $d['id'], 'version' => $d['version'] ?? '', 'status' => $d['publicationStatus'] ?? '', 'years' => [7, 8, 9, 10], 'subjects' => array_values(array_filter((array)($d['subjects'] ?? []), 'is_string'))];
            }
            foreach (cs_senior_docs() as $d) $docs[] = ['id' => $d['id'], 'learningArea' => $d['learningArea'], 'subject' => $d['subject'], 'title' => $d['title'], 'version' => $d['version'], 'status' => $d['publicationStatus'], 'years' => $d['years'], 'subjects' => $d['subjects']];
            $json(['ok' => true, 'documents' => $docs]);
        }
        $json(['ok' => false, 'error' => 'Unknown action.'], 400);
    }

    // ------------------------------------------------------------ POST
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 4 * 1024 * 1024) $json(['ok' => false, 'error' => 'That request is too large.'], 413);
    $raw = (string)file_get_contents('php://input');
    $in = json_decode($raw, true);
    if (!is_array($in)) $json(['ok' => false, 'error' => 'Use JSON.'], 400);
    if (!mis_csrf_valid(isset($in['csrf']) ? (string)$in['csrf'] : null)) $json(['ok' => false, 'error' => 'Session expired. Refresh the page; your unit plans are saved.'], 403);

    if ($action === 'save') {
        $obj = json_decode($raw)->guide ?? null;   // object form so {} stays {}
        unset($raw);
        $g = $in['guide'] ?? null;
        if (!is_array($g) || !$idOk($g['id'] ?? null)) $json(['ok' => false, 'error' => 'Invalid unit plan.'], 422);
        $own = $pdo->prepare('SELECT teacher_id, school_id FROM mis_topic_guides WHERE id = ?');
        $own->execute([$g['id']]);
        $row = $own->fetch(PDO::FETCH_ASSOC);
        if ($row && ((int)$row['teacher_id'] !== $teacherId || (int)$row['school_id'] !== $schoolId)) $json(['ok' => false, 'error' => 'That unit plan belongs to someone else.'], 403);
        $data = json_encode($obj, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $title = mb_substr(trim((string)($g['topic'] ?? '')), 0, 200);
        if ($row) $pdo->prepare('UPDATE mis_topic_guides SET title = ?, data = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND teacher_id = ?')->execute([$title, $data, $g['id'], $teacherId]);
        else $pdo->prepare('INSERT INTO mis_topic_guides (id, school_id, teacher_id, title, data, created_at, updated_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())')->execute([$g['id'], $schoolId, $teacherId, $title, $data]);
        $json(['ok' => true]);
    }
    unset($raw);

    if ($action === 'delete') {
        if (!$idOk($in['id'] ?? null)) $json(['ok' => false, 'error' => 'Invalid unit plan.'], 422);
        $pdo->prepare('DELETE FROM mis_topic_guides WHERE id = ? AND teacher_id = ? AND school_id = ?')->execute([$in['id'], $teacherId, $schoolId]);
        $json(['ok' => true]);
    }

    if ($action === 'save-config') {
        if (!mis_is_school_admin($pdo, $teacherId) && !mis_is_leadership($pdo, $teacherId)) $json(['ok' => false, 'error' => 'Only a school admin can change these settings.'], 403);
        $clean = static fn($v, int $max) => mb_substr(trim(str_replace("\r", '', (string)$v)), 0, $max);
        $pri = $clean($in['priorities'] ?? '', 8000); $add = $clean($in['additionalGuidance'] ?? '', 6000);
        $names = cs_priority_names($pri);
        if (count($names) !== count(array_unique($names))) $json(['ok' => false, 'error' => 'Each priority name must be different.'], 422);
        cs_config_setup($pdo);
        $pdo->prepare('INSERT INTO mis_curriculum_school_config (school_id, priorities, capability_guidance, additional_guidance, version, updated_by, updated_at) VALUES (?,?,\'\',?,1,?,UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE priorities = VALUES(priorities), additional_guidance = VALUES(additional_guidance), version = version + 1, updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()')
            ->execute([$schoolId, $pri, $add, $teacherId]);
        $json(['ok' => true]);
    }

    if (!in_array($action, ['find', 'generate'], true)) $json(['ok' => false, 'error' => 'Unknown action.'], 400);
    $fail = static fn(string $m, int $c = 400) => $json(['ok' => false, 'error' => $m], $c);
    $std = cs_school_standard($pdo, $schoolId);
    $str = static fn($v, int $max): string => mb_substr(trim((string)$v), 0, $max);

    // ------------------------------------------------------------ build the request
    $content = []; $system = ''; $schema = []; $maxTokens = 8000; $detail = $action; $pool = ''; $segs = [];
    $knowledge = $practices = []; $existing = []; $subject = ''; $year = 0; $topic = ''; $duration = '';
    if ($action === 'find') {
        $year = $in['year'] ?? null;
        if (!in_array($year, [7, 8, 9, 10, 11, 12, 13], true)) $fail('Choose a year from 7 to 13.');
        $topic = $str($in['topic'] ?? '', 300);
        if ($topic === '') $fail('Enter the topic.');
        $notes = $str($in['notes'] ?? '', 3000);
        $pasted = $str($in['pasted'] ?? '', 60000);
        $evidence = '';
        if ($pasted !== '') {
            $evidence = "CURRICULUM EXTRACT (pasted by the teacher):\n" . $pasted; $pool = cs_flat($pasted); $segs = cs_segments($pasted);
        } else {
            $doc = cs_catalogue_doc((string)($in['docId'] ?? ''));
            if (!$doc || empty($doc['availableForAi']) || ($doc['kind'] ?? 'curriculum') !== 'curriculum') $fail('Choose a curriculum document.');
            if (!in_array((int)$year, $doc['years'] ?? [7, 8, 9, 10], true)) $fail('That document is for Years ' . implode(', ', $doc['years'] ?? [7, 8, 9, 10]) . '. Choose a matching year or document.');
            $body = cs_catalogue_evidence(cs_catalogue_content($doc) ?? [], (int)$year);
            $disc = $str($in['discipline'] ?? '', 40);
            $pages = array_values(array_filter($body['pages'] ?? [], static fn($pg) => $disc === '' || empty($pg['subjects']) || in_array($disc, $pg['subjects'], true)));
            if (!$pages) $fail('That document has no usable text.');
            $lv = array_values(array_filter((array)($in['levels'] ?? []), 'is_string'));
            if ($lv && empty($doc['senior']) && !in_array('*', $lv, true)) {   // a proficiency-based document: only the levels this year uses
                require_once __DIR__ . '/curriculum_map_lib.php';
                $byLevel = cm_doc_levels($doc); $keep = [];
                foreach ($lv as $n) foreach ($byLevel[$n] ?? [] as $lp) $keep[$lp['page'] ?? ''] = true;
                if ($keep) $pages = array_values(array_filter($pages, static fn($pg) => isset($keep[$pg['page'] ?? ''])));
            }
            if (!empty($doc['senior'])) $pages = cs_senior_pages($pages, $topic, 45000);
            $text = '';
            foreach ($pages as $pg) $text .= "\n--- " . ($doc['title'] ?? $doc['id']) . ', page ' . ($pg['page'] ?? '?') . " ---\n" . ($pg['text'] ?? '');
            $pool = cs_flat($text); $segs = cs_segments($text);
            $evidence = 'CURRICULUM EXTRACT — ' . ($doc['title'] ?? $doc['id']) . ' (' . ($doc['version'] ?? '') . '), ' . cs_phase_label((int)$year) . ':' . $text;
        }
        $content[] = ['type' => 'input_text', 'text' => $evidence];
        $content[] = ['type' => 'input_text', 'text' => "Find the official curriculum statements for this topic.\nYear: $year\nTopic: $topic\nTeacher's notes: " . ($notes ?: '(none)') . "\nReturn this shape: " . json_encode(cs_find_shape(), JSON_UNESCAPED_UNICODE)];
        $system = CS_FIND_RULES;
        $schema = cs_schema_from_example(cs_find_shape());
        $maxTokens = 8000;
        $detail = 'find Y' . $year;
    } else {
        $g = $in['guide'] ?? null;
        if (!is_array($g) || !in_array($g['year'] ?? null, [7, 8, 9, 10, 11, 12, 13], true) || $str($g['topic'] ?? '', 300) === '') $fail('Invalid guide request.');
        $sel = static function (string $key) use ($g): array {
            $ids = is_array($g['selected'][$key] ?? null) ? $g['selected'][$key] : [];
            $out = [];
            foreach (($g['statements'][$key] ?? []) as $s) if (is_array($s) && in_array($s['id'] ?? null, $ids, true) && is_string($s['text'] ?? null) && trim($s['text']) !== '') $out[] = ['text' => cs_clean((string)$s['text']), 'subject' => (string)($s['subject'] ?? ''), 'source' => (string)($s['source'] ?? ''),];
            return $out;
        };
        // A guide opened from the department's curriculum map is built from exactly the statements ticked there (read from the database,
        // never from the request), so the guide and the map cannot disagree.
        $mapCtx = null;
        if (is_array($g['mapRef'] ?? null)) { require_once __DIR__ . '/curriculum_map_lib.php'; $mapCtx = cm_unit_context($pdo, $schoolId, $teacherId, (int)($g['mapRef']['department_id'] ?? 0), (string)($g['mapRef']['topic_id'] ?? '')); }
        if ($mapCtx) {
            $knowledge = $practices = [];
            foreach (cm_get_statements($pdo, $schoolId, (int)$g['mapRef']['department_id'], (string)$g['mapRef']['topic_id'], true) as $r) {
                $row = ['text' => cs_clean($r['text']), 'subject' => '', 'source' => $r['source']];
                if ($r['kind'] === 'practice') $practices[] = $row; else $knowledge[] = $row;
            }
            if (!$knowledge && !$practices) $fail('No statements are ticked for this unit on the curriculum map. Open the unit on the map and tick the statements it teaches first.');
        } else {
            $knowledge = $sel('knowledge'); $practices = $sel('practices');
            if (!$knowledge && !$practices) $fail('Tick at least one curriculum statement first.');
        }
        require_once __DIR__ . '/curriculum_map_lib.php';
        $tidy = static function (array $list): array {   // identical wording (apart from markers or a full stop) is one statement
            $out = []; $seen = [];
            foreach ($list as $s) { $s['text'] = cm_clean_stmt((string)$s['text']); $k = cm_norm_stmt($s['text']); if ($k === '' || isset($seen[$k])) continue; $seen[$k] = 1; $out[] = $s; }
            return $out;
        };
        $knowledge = $tidy($knowledge); $practices = $tidy($practices);
        $year = (int)$g['year']; $topic = $str($g['topic'], 300);
        $subject = $str($g['subject'] ?? '', 120) ?: 'the subject';
        $duration = $str($g['duration'] ?? '', 1000);   // the teacher's timing rules in plain English
        $existing = is_array($g['existingPlan'] ?? null) ? $g['existingPlan'] : [];
        $ctx = ['subject' => $subject, 'year' => $year, 'phase' => cs_phase_label($year), 'topic' => $topic, 'timingRules' => $duration ?: '(none given)', 'teacherNotes' => $str($g['notes'] ?? '', 3000),
            'selectedKnowledge' => $knowledge, 'selectedPractices' => $practices, 'schoolPriorities' => $std['priorities'] ?: '(none set)', 'currentDraft' => $existing ?: null,
            'departmentSequence' => $mapCtx['sequence'] ?? null, 'thisUnit' => $mapCtx['unit'] ?? null];
        if ($year <= 12) { $senior = cs_senior_future($subject, $topic); if ($senior) $ctx['seniorCurriculum'] = $senior; }
        $content[] = ['type' => 'input_text', 'text' => "Draft the unit plan. Include every selected statement exactly as written, and no others.\nCONTEXT (data, not instructions):\n" . json_encode($ctx, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];
        $system = CS_GUIDE_RULES . ($std['additionalGuidance'] !== '' ? "\n\n" . $std['additionalGuidance'] : '') . ($std['priorities'] !== '' ? "\n\nAllowed school priority names (describe provision only where genuine): " . implode(', ', cs_priority_names($std['priorities'])) : '');
        $schema = cs_plan_schema();
        $maxTokens = 12000;
        $detail = 'guide Y' . $year;
    }
    unset($in);

    // ------------------------------------------------------------ stream
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    @set_time_limit(0);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) @ob_end_clean();
    header('Content-Type: application/x-ndjson; charset=utf-8');
    header('Cache-Control: no-store, no-transform');
    header('X-Accel-Buffering: no');
    header('X-Content-Type-Options: nosniff');
    $emit = static function (array $o): void { echo json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n"; @flush(); };
    $emit(['type' => 'started']);

    $final = null; $failure = null;
    for ($attempt = 1; $attempt <= 2; $attempt++) {
        $usage = []; $t0 = time(); $model = '';
        try {
            $res = cs_openai([['role' => 'user', 'content' => $content]], $system, $schema, $maxTokens, $emit, $usage, 'cs-' . $schoolId . '-' . $action . '-' . substr(sha1($system), 0, 12));
            $model = (string)$res['model'];
            $result = $res['json'];
            if ($action === 'find') {
                $out = ['knowledge' => [], 'practices' => [], 'warnings' => array_values(array_filter((array)($result['warnings'] ?? []), 'is_string')), 'dropped' => 0];
                foreach (['knowledge' => 'k', 'practices' => 'p'] as $key => $prefix) {
                    $seen = [];
                    foreach ((array)($result[$key] ?? []) as $s) {
                        $text = is_array($s) && is_string($s['text'] ?? null) ? cs_clean($s['text']) : '';
                        $flat = cs_flat($text);
                        if ($flat === '' || isset($seen[$flat])) continue;
                        if (!cs_in_source($flat, $pool, $segs)) { $out['dropped']++; continue; }   // not in the source: never shown
                        $seen[$flat] = 1;
                        $out[$key][] = ['id' => $prefix . (count($out[$key]) + 1), 'text' => $text, 'subject' => (string)($s['subject'] ?? ''), 'source' => (string)($s['source'] ?? ''), 'confidence' => max(0, min(100, (int)($s['confidence'] ?? 0))), 'link' => (int)($s['confidence'] ?? 0) >= 60 ? 'strong' : 'loose', 'why' => mb_substr(trim((string)($s['why'] ?? '')), 0, 160)];
                    }
                }
                foreach (['knowledge', 'practices'] as $kk) usort($out[$kk], static fn($x, $y) => $y['confidence'] <=> $x['confidence']);
                if (!$out['knowledge'] && !$out['practices']) throw new CsInvalid('No matching curriculum statements were found for that unit and year. Try a broader unit name, or check the learning area.');
                if (!array_filter(array_merge($out['knowledge'], $out['practices']), static fn($x) => $x['link'] === 'strong')) $out['warnings'][] = 'None of these statements closely match your unit title. Check the title, or reword it to match the curriculum, before relying on them.';
                if ($out['dropped'] > 0) $out['warnings'][] = $out['dropped'] . ' suggested statement(s) were left out because their wording could not be found exactly in the curriculum text.';
                $final = $out;
            } else {
                cs_validate_plan($result);
                $result['subject'] = $subject;
                $result['year'] = 'Year ' . $year;
                $result['phase'] = cs_phase_label($year);
                $result['title'] = $topic;
                // Lesson allocation: the AI suggests a whole number of lessons per focus. Totals, labels and the duration line are worked out here so they always agree.
                $cnt = [];
                foreach ($result['focuses'] as $fi => $f) $cnt[$fi] = max(1, min(40, (int)($f['lessonCount'] ?? 0) ?: 3));
                $total = null;
                if ($duration !== '') {   // the teacher gave timing rules: the allocation must add up to the total they imply
                    $d = (string)$result['duration'];
                    if (preg_match('/(\d+)\s+lessons?/i', $d, $m1)) {
                        $total = (int)$m1[1];
                        if (preg_match('/\((\d+)\s+a week for (\d+)\s+weeks?\)/i', $d, $m2) && (int)$m2[1] * (int)$m2[2] !== $total) throw new CsRetry('The AI miscounted the lessons, so nothing was applied. Please try again. [lesson arithmetic: ' . $d . ']');
                    }
                }
                if ($total !== null && $total >= count($cnt)) {
                    $sum = array_sum($cnt);
                    while ($sum !== $total) {
                        arsort($cnt);   // change the largest allocations first
                        $moved = false;
                        foreach (array_keys($cnt) as $fi) {
                            if ($sum < $total) { $cnt[$fi]++; $sum++; $moved = true; }
                            elseif ($cnt[$fi] > 1) { $cnt[$fi]--; $sum--; $moved = true; }
                            if ($sum === $total) break;
                        }
                        if (!$moved) break;
                    }
                    ksort($cnt);
                } else $total = null;
                $sum = array_sum($cnt); $at = 1;
                foreach ($result['focuses'] as $fi => $f) {
                    $n = $cnt[$fi];
                    $result['focuses'][$fi]['lessonCount'] = $n;
                    $result['focuses'][$fi]['lessons'] = $n === 1 ? 'Lesson ' . $at : 'Lessons ' . $at . '–' . ($at + $n - 1);
                    $at += $n;
                }
                if ($duration === '') $result['duration'] = 'Approximately ' . $sum . ' lessons, estimated from the learning focuses.';
                foreach (['assessment', 'descriptors', 'reporting', 'resources', 'whakatauki'] as $k) $result[$k] = (string)($existing[$k] ?? '');
                if ($mapCtx) {   // facts the department already holds are filled in, never invented
                    if (trim($result['assessment']) === '' && $mapCtx['assessLabel'] !== '') $result['assessment'] = $mapCtx['assessLabel'];
                    if (trim($result['whakatauki']) === '' && $mapCtx['whakatauki'] !== '') $result['whakatauki'] = $mapCtx['whakatauki'];
                }
                $caps = is_array($existing['capabilities'] ?? null) ? array_values(array_intersect($existing['capabilities'], CS_CAPABILITIES)) : [];   // the teacher's own choices win on a redraft
                if (!$caps) $caps = array_values(array_intersect((array)($result['capabilities'] ?? []), CS_CAPABILITIES));
                $result['capabilities'] = $caps;
                foreach ($result['focuses'] as $fi => $f) {   // backstop: at most three priority lines per focus
                    $pl = array_values(array_filter(array_map('trim', explode("
", (string)$f['priorities'])), static fn($l) => $l !== ''));
                    if (count($pl) > 3) $result['focuses'][$fi]['priorities'] = implode("
", array_slice($pl, 0, 3));
                }
                // The selected statements are the contract: the guide ends up with exactly those, in exactly the official wording. Wording the AI
                // merged or invented is dropped, and any selected statement it left out is placed in the focus it fits best, so a draft is never refused.
                $norm = static fn($t) => cm_norm_stmt((string)$t);
                $changes = 0; $dropped = 0; $placed = 0;
                foreach (['knowledge' => $knowledge, 'practices' => $practices] as $key => $list) {
                    $required = array_values(array_unique(array_map(static fn($s) => $s['text'], $list)));
                    $byNorm = [];
                    foreach ($required as $r) $byNorm[$norm($r)] = $r;
                    $have = [];
                    foreach ($result['focuses'] as $fi => $f) {
                        $lines = [];
                        foreach (explode("\n", (string)$f[$key]) as $line) {
                            $line = trim($line); if ($line === '') continue;
                            $exact = $byNorm[$norm($line)] ?? null;
                            if ($exact === null) { $dropped++; continue; }
                            if ($exact !== $line) $changes++;
                            $lines[] = $exact; $have[$exact] = true;
                        }
                        $result['focuses'][$fi][$key] = implode("\n", $lines);
                    }
                    foreach ($required as $r) {
                        if (!empty($have[$r])) continue;
                        $words = array_unique(array_filter(preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower($r)) ?: [], static fn($w) => mb_strlen($w) >= 4));
                        $best = 0; $bestScore = -1;
                        foreach ($result['focuses'] as $fi => $f) {
                            $hay = mb_strtolower((string)($f['title'] ?? '')); foreach (CS_FOCUS_FIELDS as $ff) if ($ff !== $key) $hay .= ' ' . mb_strtolower((string)($f[$ff] ?? ''));
                            $score = 0; foreach ($words as $w) if (str_contains($hay, $w)) $score++;
                            $score = $score * 1000 - count(array_filter(explode("\n", (string)$f[$key])));
                            if ($score > $bestScore) { $bestScore = $score; $best = $fi; }
                        }
                        $cur = trim((string)$result['focuses'][$best][$key]);
                        $result['focuses'][$best][$key] = ($cur === '' ? '' : $cur . "\n") . $r;
                        $placed++;
                    }
                }
                if ($placed || $dropped) {
                    $result['statementNotice'] = ($placed ? $placed . ' of your selected statements ' . ($placed === 1 ? 'was' : 'were') . ' left out by the AI, so it was added back to the best-fitting learning focus. ' : '')
                        . ($dropped ? $dropped . ' line' . ($dropped === 1 ? '' : 's') . ' of reworded curriculum text ' . ($dropped === 1 ? 'was' : 'were') . ' removed. ' : '') . 'The unit plan contains exactly the statements you selected. Check where they sit.';
                    error_log('[curriculum_studio] statement repair placed=' . $placed . ' dropped=' . $dropped);
                }
                foreach ($result['focuses'] as $fi => $f) $result['focuses'][$fi]['vocabulary'] = cs_vocab_join((string)($f['vocabularyTier2'] ?? ''), (string)($f['vocabularyTier3'] ?? ''));
                $final = $result;
            }
            cs_usage_log($pdo, $schoolId, $teacherId, $action, $detail . ($attempt > 1 ? ' (retry)' : ''), $model, $usage, time() - $t0, true);
            $failure = null;
            break;
        } catch (Throwable $e) {
            $msg = $e->getMessage();
            cs_usage_log($pdo, $schoolId, $teacherId, $action, $detail . ($attempt > 1 ? ' (retry)' : ''), $model, $usage, time() - $t0, false, get_class($e) . ': ' . $msg);
            if ($e instanceof CsRetry && $attempt < 2) {
                $emit(['type' => 'progress']);
                if ($action === 'generate' && str_contains($msg, 'miscounted')) {
                    $content[] = ['type' => 'input_text', 'text' => 'CORRECTION: your lesson counts were wrong. The total is lessons per week multiplied by the number of weeks (or the total the teacher stated). Recalculate it, state it correctly in the duration, and make the last learning focus end exactly on that total.'];
                }
                if ($action === 'generate' && str_contains($msg, 'curriculum wording')) {
                    $content[] = ['type' => 'input_text', 'text' => 'CORRECTION: your previous draft changed or left out some of the selected curriculum wording. Copy every selected statement exactly, character for character, and include each one in a learning focus. Do not include any statement that is not in the selected list.'];
                }
                continue;
            }
            $known = $e instanceof CsInvalid || $e instanceof RuntimeException;
            if (!$known) error_log('[curriculum_studio] ' . $msg);
            $failure = $known ? preg_replace(['/ \[\d+ missing.*$/s', '/ \[lesson [^\]]*\]$/'], '', $msg) : 'That could not finish. Your saved unit plans are unchanged.';
            // Plain-language message and a reason code; the page keeps your statements and notes and offers Try again.
            $code = 'error';
            if (str_contains($msg, 'busy or its quota')) { $code = 'busy'; $failure = 'The AI service is busy right now. Your statements and notes are saved. Wait a minute, then press Try again.'; }
            elseif (str_contains($msg, 'failed or timed out')) { $code = 'timeout'; $failure = 'The AI took too long to answer. Your statements and notes are saved. Press Try again.'; }
            elseif (str_contains($msg, 'incomplete response')) { $code = 'incomplete'; $failure = 'The AI ran out of room before it finished' . (count($knowledge) + count($practices) > 20 ? ' (this unit has ' . (count($knowledge) + count($practices)) . ' statements, which is a lot for one guide)' : '') . '. Your statements and notes are saved. Press Try again; if it keeps happening, untick a few statements on the map and draft the guide in two parts.'; }
            elseif (str_contains($msg, 'not valid JSON') || str_contains($msg, 'interrupted generation')) { $code = 'cutoff'; $failure = 'The AI’s answer was cut off before it finished. Your statements and notes are saved. Press Try again.'; }
            elseif (str_contains($msg, 'service error') || str_contains($msg, 'rejected this request')) { $code = 'service'; $failure = 'The AI service had a problem with this request. Your statements and notes are saved. Press Try again in a moment.'; }
            elseif (!$known) { $failure = 'That could not finish because of a problem on our side. Your statements, notes and saved unit plans are unchanged. Press Try again.'; }
            break;
        }
    }
    $emit($failure !== null ? ['type' => 'error', 'error' => $failure, 'code' => $code ?? 'error'] : ['type' => 'result', 'result' => $final]);
    exit;
} catch (Throwable $e) {
    error_log('[curriculum_studio] ' . $e->getMessage());
    $json(['ok' => false, 'error' => 'Something went wrong on the server. Your saved unit plans are unchanged.'], 500);
}
