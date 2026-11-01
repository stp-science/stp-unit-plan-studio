<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$source = $argv[1] ?? '';
if ($source === '' || !is_file($source)) exit("Usage: php tools/restore-private-data.php /private/path/unit-plan-studio-standalone.zip\n");
$target = dirname(__DIR__) . '/data/studio.sqlite';
if (is_file($target)) exit("A database already exists. This command never replaces existing work.\n");
$zip = new ZipArchive();
if ($zip->open($source) !== true) exit("Could not read the original ZIP.\n");
$bytes = $zip->getFromName('unit-plan-studio-standalone/data/studio.sqlite');$zip->close();
if ($bytes === false || strlen($bytes) > 50000000 || substr($bytes, 0, 16) !== "SQLite format 3\0") exit("The ZIP did not contain the expected private database.\n");
if (!is_dir(dirname($target))) mkdir(dirname($target), 0700, true);
$tmp = $target . '.importing';file_put_contents($tmp, $bytes, LOCK_EX);chmod($tmp, 0600);
try {
    $db = new PDO('sqlite:' . $tmp);$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    if ($db->query('PRAGMA integrity_check')->fetchColumn() !== 'ok') throw new RuntimeException('Database integrity check failed.');
    if ((int)$db->query('SELECT COUNT(*) FROM teachers')->fetchColumn() !== 1) throw new RuntimeException('Expected the supplied single-owner database.');
    $maps = (int)$db->query('SELECT COUNT(*) FROM mis_curriculum_maps')->fetchColumn();$guides = (int)$db->query('SELECT COUNT(*) FROM mis_topic_guides')->fetchColumn();$db = null;
    if (!rename($tmp, $target)) throw new RuntimeException('Could not place the database.');
    echo "Restored $maps curriculum maps and $guides unit plans. No AI calls made.\n";
} catch (Throwable $e) { @unlink($tmp);fwrite(STDERR, $e->getMessage() . "\n");exit(1); }
