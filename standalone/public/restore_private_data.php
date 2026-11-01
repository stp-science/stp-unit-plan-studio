<?php
declare(strict_types=1);
$config = require dirname(__DIR__) . '/config.php';
require_once __DIR__ . '/studio_auth.php';
require_once dirname(__DIR__) . '/tools/private-restore-lib.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
$error = '';
$result = null;
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    try {
        if (!studio_csrf_valid(is_string($_POST['csrf'] ?? null) ? $_POST['csrf'] : null)) throw new RuntimeException('Your session expired. Refresh this page and try again.');
        if (($config['driver'] ?? '') !== 'sqlite') throw new RuntimeException('This restore is for the supplied SQLite edition.');
        $file = $_FILES['archive'] ?? [];
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'] ?? '')) throw new RuntimeException('Choose the original ZIP and upload it again.');
        if (($file['size'] ?? 0) > 20000000) throw new RuntimeException('The ZIP is too large. The original file is about 3 MB.');
        $result = studio_restore_zip($file['tmp_name'], $config['sqlite_path']);
    } catch (RuntimeException $e) { $error = $e->getMessage(); }
}
$escape = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Restore saved work · Unit Plan Studio</title><link rel="stylesheet" href="assets/standalone.css"></head>
<body><nav class="studio-nav"><a class="brand" href="curriculum_studio.php">Unit Plan Studio</a><span class="note">Private setup</span></nav>
<main class="app-shell"><h1>Restore your saved curriculum work</h1>
<?php if ($result !== null): ?>
<p role="status">Restored <?= (int)$result['departments'] ?> departments, <?= (int)$result['maps'] ?> curriculum maps and <?= (int)$result['guides'] ?> unit plans.</p>
<p>No AI calls were made. Your private login is unchanged.</p><p><a href="curriculum_studio.php">Open the curriculum map →</a></p>
<?php else: ?>
<p>Choose the original <strong>unit-plan-studio-standalone.zip</strong> from your friend. This restores the saved departments, maps, guides and curriculum statement selections.</p>
<p>The upload stays on this private host. This works only on a fresh installation and will stop if you have already added work.</p>
<?php if ($error !== ''): ?><p role="alert"><?= $escape($error) ?></p><?php endif; ?>
<form method="post" enctype="multipart/form-data"><input type="hidden" name="csrf" value="<?= $escape(studio_csrf_token()) ?>"><p><label>Original ZIP <input type="file" name="archive" accept=".zip,application/zip" required></label></p><button type="submit">Restore saved work</button></form>
<?php endif; ?>
</main></body></html>
