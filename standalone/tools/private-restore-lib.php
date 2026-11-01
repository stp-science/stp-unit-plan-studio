<?php
declare(strict_types=1);

/** Restore only into an unused installation; never replace saved staff work. */
function studio_restore_zip(string $archive, string $target): array
{
    if (!extension_loaded('pdo_sqlite') || !class_exists('ZipArchive')) {
        throw new RuntimeException('The server needs the pdo_sqlite and zip PHP extensions.');
    }
    $directory = dirname($target);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new RuntimeException('Could not create private storage.');
    $lock = fopen($target . '.restore.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) throw new RuntimeException('A restore is already running.');
    chmod($target . '.restore.lock', 0600);
    $temporary = '';
    try {
        if (is_file($target . '.restored')) throw new RuntimeException('This installation has already been restored.');
        $zip = new ZipArchive();
        if ($zip->open($archive) !== true) throw new RuntimeException('Could not open the ZIP. Choose the original file from your friend.');
        try {
            $entry = 'unit-plan-studio-standalone/data/studio.sqlite';
            $stat = $zip->statName($entry);
            if (!$stat || $stat['size'] < 100 || $stat['size'] > 50000000) throw new RuntimeException('The ZIP does not contain the expected saved database.');
            $bytes = $zip->getFromName($entry, 50000001);
        } finally { $zip->close(); }
        if ($bytes === false || strlen($bytes) !== (int)$stat['size'] || substr($bytes, 0, 16) !== "SQLite format 3\0") throw new RuntimeException('The saved database is incomplete or invalid.');
        $temporary = tempnam($directory, '.restore-');
        if ($temporary === false) throw new RuntimeException('Could not prepare private storage.');
        chmod($temporary, 0600);
        if (file_put_contents($temporary, $bytes, LOCK_EX) !== strlen($bytes)) throw new RuntimeException('Could not save the uploaded database.');
        unset($bytes);
        $source = new PDO('sqlite:' . $temporary, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $source->exec('PRAGMA query_only=ON');
        if ($source->query('PRAGMA integrity_check')->fetchColumn() !== 'ok') throw new RuntimeException('The uploaded database failed its integrity check.');
        if ((int)$source->query('SELECT COUNT(*) FROM teachers')->fetchColumn() !== 1) throw new RuntimeException('Expected the original single-owner database.');
        $counts = [];
        foreach (['mis_curriculum_maps' => 'maps', 'mis_topic_guides' => 'guides', 'mis_departments' => 'departments'] as $table => $label) {
            $counts[$label] = (int)$source->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
        }
        $source = null;
        if (is_file($target . '-wal') || is_file($target . '-journal')) throw new RuntimeException('The database is busy. Close other studio tabs and try again.');
        if (is_file($target)) {
            $existing = new PDO('sqlite:' . $target, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $existing->exec('PRAGMA query_only=ON');
            $tables = $existing->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")->fetchAll(PDO::FETCH_COLUMN);
            foreach ($tables as $table) {
                $quoted = '"' . str_replace('"', '""', (string)$table) . '"';
                $count = (int)$existing->query('SELECT COUNT(*) FROM ' . $quoted)->fetchColumn();
                if (($table === 'teachers' && $count > 1) || ($table !== 'teachers' && $count > 0)) throw new RuntimeException('This site already contains work. Restore stopped to protect it.');
            }
            $existing = null;
            $backup = $target . '.before-restore-' . bin2hex(random_bytes(6));
            if (!copy($target, $backup)) throw new RuntimeException('Could not back up the fresh database.');
            chmod($backup, 0600);
        }
        if (!rename($temporary, $target)) throw new RuntimeException('Could not install the restored database.');
        $temporary = '';
        chmod($target, 0600);
        file_put_contents($target . '.restored', gmdate('c'), LOCK_EX);
        chmod($target . '.restored', 0600);
        return $counts;
    } catch (PDOException $e) {
        throw new RuntimeException('The database could not be validated. No existing work was replaced.');
    } finally {
        if ($temporary !== '' && is_file($temporary)) unlink($temporary);
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
