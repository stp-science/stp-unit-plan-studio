<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
if (($argv[1] ?? '') !== '--reset-plans') {
    fwrite(STDERR, "Usage: php tools/reset-plans.php --reset-plans\nClears all unit plans and curriculum overviews after a private backup.\n"); exit(1);
}
$config = require dirname(__DIR__) . '/config.php';
unset($db);
if (($config['driver'] ?? '') !== 'sqlite' || !is_file($config['sqlite_path'])) {
    fwrite(STDERR, "This reset requires the existing SQLite database. Nothing changed.\n"); exit(1);
}
$pdo = null;
try {
    $pdo = new PDO('sqlite:' . $config['sqlite_path'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA busy_timeout=5000');
    $directory = dirname(__DIR__) . '/data/backups';
    umask(0077);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new RuntimeException('Could not create the private backup folder.');
    $backup = $directory . '/before-plans-reset-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.sqlite';
    // VACUUM INTO includes committed WAL data in a consistent standalone backup.
    $pdo->exec('VACUUM INTO ' . $pdo->quote($backup));
    chmod($backup, 0600);
    $check = new PDO('sqlite:' . $backup);
    if ($check->query('PRAGMA integrity_check')->fetchColumn() !== 'ok') throw new RuntimeException('Backup verification failed.');
    $check = null;
    $tables = ['mis_topic_guides', 'mis_curriculum_maps', 'mis_curriculum_map_history', 'mis_map_statements', 'mis_map_statements_trash', 'mis_map_match'];
    $counts = [];
    $pdo->beginTransaction();
    foreach ($tables as $table) {
        $exists = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
        $exists->execute([$table]);
        if (!$exists->fetchColumn()) continue;
        $counts[$table] = (int)$pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
        $pdo->exec('DELETE FROM ' . $table);
    }
    $pdo->commit();
    echo 'Cleared ' . ($counts['mis_topic_guides'] ?? 0) . ' unit plans and ' . ($counts['mis_curriculum_maps'] ?? 0) . " curriculum overviews, including their histories and statement allocations.\n";
    echo "Departments, faculties, curriculum sources, cached statement banks, school settings and API configuration are kept.\n";
    echo 'Private database backup: ' . $backup . "\nNo AI calls made.\n";
} catch (Throwable $e) {
    if ($pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, "Reset stopped. Check the private server database and backup permissions; no reset transaction was committed.\n"); exit(1);
}
