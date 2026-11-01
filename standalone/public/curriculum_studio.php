<?php
declare(strict_types=1);
// mis/curriculum_studio.php - Unit Plan Studio (simple version, 2026-10-31).
// A teacher chooses subject, year and topic; the Ministry curriculum is the outline; evidence-informed teaching ideas
// are added; the draft exports to the school's Word template. Each teacher sees only their own guides.
// Front end: assets/curriculum_studio/<CS_ASSET_VER>/guide.js (bump CS_ASSET_VER in the lib when any file there changes).

require_once __DIR__ . '/mis_common.php';
require_once __DIR__ . '/curriculum_studio_lib.php';

$teacher   = mis_require_teacher($pdo);
$teacherId = (int)$teacher['id'];
$schoolId  = (int)($teacher['school_id'] ?? 0);
$misPage   = 'curriculum_studio';
if (!cs_enabled($pdo, $schoolId)) { header('Location: index.php'); exit; }
// Landing page = the department curriculum map. The topic guide builder lives at ?guide=1 (and opens from any map topic).
if (!isset($_GET['guide']) && !isset($_GET['topic'])) { require __DIR__ . '/curriculum_map.php'; exit; }

$schoolName     = mis_school_name($pdo, $schoolId);
$isAdmin = mis_is_school_admin($pdo, $teacherId) || mis_is_leadership($pdo, $teacherId);
$std     = $isAdmin ? cs_school_standard($pdo, $schoolId) : null;
$usage   = $isAdmin ? cs_usage_summary($pdo, $schoolId, 30) : [];
$e = static fn($v) => htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$base = 'assets/curriculum_studio/' . CS_ASSET_VER . '/';
$v = static fn(string $f): string => (string)(@filemtime(__DIR__ . '/' . $base . $f) ?: 1);
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unit Plan Studio &middot; <?= $e($schoolName) ?></title>
  <link rel="stylesheet" href="assets/styles.css?v=<?= @filemtime(__DIR__ . '/assets/styles.css') ?: '1' ?>">
  <link rel="stylesheet" href="assets/fresha_concept.css?v=<?= @filemtime(__DIR__ . '/assets/fresha_concept.css') ?: '1' ?>">
  <link rel="stylesheet" href="assets/standalone.css">
  <link rel="stylesheet" href="<?= $base ?>guide.css?v=<?= $v('guide.css') ?>">
</head>
<body data-page="curriculum-studio">
  <a class="skip-link" href="#main">Skip to content</a>
  <nav class="studio-nav" aria-label="Unit Plan Studio">
    <a class="brand" href="curriculum_studio.php">Unit Plan Studio</a>
    <a href="curriculum_studio.php">Start</a>
    <a href="curriculum_studio.php?department=<?= (int)($_GET['department'] ?? 0) ?>">Curriculum map</a>
    <a href="curriculum_studio.php?guide=1">Unit plans</a>
    <span class="note">Private edition &middot; <?= htmlspecialchars(cs_ai_label(), ENT_QUOTES, 'UTF-8') ?></span>
  </nav>
  <div class="app-shell">
    <div class="workspace">
      <header class="topbar">
        <div class="topbar-left">
          <div class="page-title">
            <p class="eyebrow"><?= $e($schoolName) ?> · Teaching &amp; learning</p>
            <h1>Unit Plan Studio</h1>
            <p><a href="curriculum_studio.php">&larr; Back to start</a> &middot; Choose your subject, year and unit. The Ministry curriculum gives the outline and your department's curriculum map gives the sequence. Your unit plans are private to you.</p>
          </div>
        </div>
      </header>
      <main id="main" class="page-content">
        <?php if ($isAdmin): ?>
        <details class="cg-set">
          <summary>School settings (admins only)</summary>
          <p class="cg-hint">Optional. School priorities (one per line as <b>Name: what it means</b>) let the unit plans describe where a unit genuinely supports them.</p>
          <textarea id="cs-pri" aria-label="School priorities"><?= $e($std['priorities']) ?></textarea>
          <p class="cg-hint">Anything else every unit plan should follow (optional):</p>
          <textarea id="cs-add" aria-label="Additional guidance"><?= $e($std['additionalGuidance']) ?></textarea>
          <p><button type="button" id="cs-save">Save settings</button> <span id="cs-cmsg" role="status"></span></p>
          <p class="cg-hint"><b>AI use, last 30 days:</b>
          <?php if (!$usage): ?>none yet.<?php else: foreach ($usage as $u): ?>
            <?= $e($u['op']) ?>: <?= (int)$u['calls'] ?> calls, <?= number_format((int)$u['inp']) ?> input tokens (<?= number_format((int)$u['cached']) ?> cached), <?= number_format((int)$u['outp']) ?> output;
          <?php endforeach; endif; ?></p>
        </details>
        <?php endif; ?>
        <div id="cg-root"></div>
      </main>
    </div>
  </div>
  <script>window.CS=<?= json_encode(['api' => 'curriculum_studio_api.php', 'csrf' => mis_csrf_token(), 'base' => $base], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?>;</script>
  <script src="<?= $base ?>jszip.min.js?v=<?= $v('jszip.min.js') ?>" defer></script>
  <script type="module" src="<?= $base ?>guide.js?v=<?= $v('guide.js') ?>"></script>
  <?php if ($isAdmin): ?>
  <script>
  document.getElementById('cs-save').onclick = async function () {
    var m = document.getElementById('cs-cmsg'); m.textContent = 'Saving…';
    try {
      var r = await fetch(CS.api + '?action=save-config', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({csrf: CS.csrf, priorities: document.getElementById('cs-pri').value, additionalGuidance: document.getElementById('cs-add').value})});
      var d = await r.json(); m.textContent = d.ok ? 'Saved. New drafts will use these.' : (d.error || 'Could not save.');
    } catch (e) { m.textContent = 'Could not save.'; }
  };
  </script>
  <?php endif; ?>
</body>
</html>
