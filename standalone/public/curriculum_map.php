<?php
declare(strict_types=1);
// mis/curriculum_map.php - the department curriculum map (2026-10-31).
// A teacher lands here as part of a department. If the department has a map it is shown; if not, they can build one or upload an existing one.
// Front end: assets/curriculum_map/<CM_ASSET_VER>/map.js (bump CM_ASSET_VER in curriculum_map_lib.php when any file there changes).

require_once __DIR__ . '/mis_common.php';
require_once __DIR__ . '/curriculum_map_lib.php';

$teacher   = mis_require_teacher($pdo);
$teacherId = (int)$teacher['id'];
$schoolId  = (int)($teacher['school_id'] ?? 0);
$misPage   = 'curriculum_map';
if (!cs_enabled($pdo, $schoolId)) { header('Location: index.php'); exit; }

$navMode = in_array($_GET['mode'] ?? '', ['overview', 'existing'], true) ? (string)$_GET['mode'] : '';
$navDepartment = max(0, (int)($_GET['department'] ?? $_GET['dept'] ?? 0));
$schoolName     = mis_school_name($pdo, $schoolId);
$e = static fn($v) => htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$base = 'assets/curriculum_map/' . CM_ASSET_VER . '/';
$v = static fn(string $f): string => (string)(@filemtime(__DIR__ . '/' . $base . $f) ?: 1);
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Curriculum map &middot; <?= $e($schoolName) ?></title>
  <link rel="stylesheet" href="assets/styles.css?v=<?= @filemtime(__DIR__ . '/assets/styles.css') ?: '1' ?>">
  <link rel="stylesheet" href="assets/fresha_concept.css?v=<?= @filemtime(__DIR__ . '/assets/fresha_concept.css') ?: '1' ?>">
  <link rel="stylesheet" href="assets/standalone.css">
  <link rel="stylesheet" href="<?= $base ?>map.css?v=<?= $v('map.css') ?>">
  <link rel="stylesheet" href="assets/stp-brand.css?v=<?= @filemtime(__DIR__ . '/assets/stp-brand.css') ?: '1' ?>">
</head>
<body data-page="curriculum-map">
  <a class="skip-link" href="#main">Skip to content</a>
  <nav class="studio-nav" aria-label="Unit Plan Studio">
    <a class="brand" href="curriculum_studio.php" aria-label="St Peter's Curriculum Studio — Home">
      <img class="stp-header-logo" src="assets/stp-crest.svg" alt="" referrerpolicy="no-referrer" width="55" height="55">
      <span class="stp-nav-name"><strong>St Peter's</strong><small>Curriculum Studio</small></span>
    </a>
    <a href="curriculum_studio.php?guide=1">Single unit plan</a>
    <a href="curriculum_studio.php?mode=overview&amp;department=<?= $navDepartment ?>"<?= $navMode === 'overview' ? ' aria-current="page"' : '' ?>>Curriculum overview</a>
    <a href="curriculum_studio.php?mode=existing&amp;department=<?= $navDepartment ?>"<?= $navMode === 'existing' ? ' aria-current="page"' : '' ?>>Existing overview</a>
    <span class="note"><?= studio_is_admin() ? 'Administrator' : 'Staff' ?></span>
  </nav>
  <div class="app-shell">
    <div class="workspace">
      <header class="topbar">
        <div class="topbar-left">
          <div class="page-title">
            <p class="eyebrow"><?= $e($schoolName) ?> · Teaching &amp; learning</p>
            <h1>Plan with purpose.</h1>
            <p>Bring your curriculum, teaching sequence and unit plans together in one shared workspace.</p>
          </div>
        </div>
      </header>
      <main id="main" class="page-content">
        <div id="cm-root"></div>
      </main>
    </div>
  </div>
  <script>window.CM=<?= json_encode(['api' => 'curriculum_map_api.php', 'guide' => 'curriculum_studio.php', 'studio' => 'curriculum_studio_api.php', 'csrf' => mis_csrf_token(), 'department' => (int)($_GET['department'] ?? 0)], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?>;</script>
  <script type="module" src="<?= $base ?>map.js?v=<?= $v('map.js') ?>"></script>
</body>
</html>
