<?php
declare(strict_types=1);
/**
 * Standalone school workspace. Private HTTP credentials decide admin/staff access;
 * both logins share the configured workspace teacher so existing work is retained.
 */

$GLOBALS['STUDIO_CFG'] = require dirname(__DIR__) . '/config.php';
require_once __DIR__ . '/studio_auth.php';

function studio_cfg(string $key, $default = null)
{
    return $GLOBALS['STUDIO_CFG'][$key] ?? $default;
}

/** The database: SQLite (a single file, nothing to install) or MySQL, chosen in config.php. */
function studio_connect(): PDO
{
    $c = $GLOBALS['STUDIO_CFG'];
    if (($c['driver'] ?? 'sqlite') === 'mysql') {
        $m = $c['mysql'];
        $pdo = new PDO('mysql:host=' . $m['host'] . ';port=' . ($m['port'] ?? 3306) . ';dbname=' . $m['dbname'] . ';charset=utf8mb4', $m['user'], $m['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]);
        return $pdo;
    }
    require_once __DIR__ . '/studio_pdo.php';
    $file = $c['sqlite_path'] ?? dirname(__DIR__) . '/data/studio.sqlite';
    if (!is_dir(dirname($file))) mkdir(dirname($file), 0775, true);
    return new StudioPdo($file);
}

$pdo = studio_connect();

/** A blank database still works: the one teacher row the page needs is created on first use. */
function studio_ensure_base(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS teachers (id BIGINT NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL DEFAULT '', school_id BIGINT NULL, role VARCHAR(32) NOT NULL DEFAULT 'teacher', is_active TINYINT(1) NOT NULL DEFAULT 1) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    if ((int)$pdo->query('SELECT COUNT(*) FROM teachers')->fetchColumn() === 0) {
        $pdo->prepare('INSERT INTO teachers (id, name, email, school_id, role, is_active) VALUES (?,?,?,?,?,1)')
            ->execute([(int)studio_cfg('teacher_id', 1), 'Teacher', '', (int)studio_cfg('school_id', 1), 'leadership']);
    }
}
studio_ensure_base($pdo);

function mis_table_exists(PDO $pdo, string $table): bool
{
    try {
        if ($pdo instanceof StudioPdo) return (bool)$pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = " . $pdo->quote($table))->fetchColumn();
        $st = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $st->execute([$table]);
        return (bool)$st->fetchColumn();
    } catch (Throwable $e) { return false; }
}

/** Both logins use the shared workspace; privileges come from verified credentials. */
function mis_require_teacher(PDO $pdo): array
{
    $id = (int)studio_cfg('teacher_id', 0);
    try {
        $st = $pdo->prepare('SELECT id, name, email, school_id, role FROM teachers WHERE id = ?');
        $st->execute([$id]);
        $t = $st->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) { $t = false; }
    if (!$t) $t = ['id' => $id, 'name' => 'Teacher', 'email' => '', 'school_id' => (int)studio_cfg('school_id', 0), 'role' => 'leadership'];
    if (empty($t['school_id'])) $t['school_id'] = (int)studio_cfg('school_id', 0);
    $t['role'] = studio_is_admin() ? 'leadership' : 'teacher';
    return $t;
}

// Each browser session has its own anti-forgery token.
function mis_csrf_token(): string { return studio_csrf_token(); }
function mis_csrf_valid(?string $token): bool { return studio_csrf_valid($token); }

function mis_school_flag(PDO $pdo, int $schoolId, string $flag, bool $default = false): bool { return true; }
function mis_school_name(PDO $pdo, int $schoolId): string { return (string)studio_cfg('school_name', 'Your school'); }
function mis_is_school_admin(PDO $pdo, int $teacherId): bool { return studio_is_admin(); }
function mis_is_leadership(PDO $pdo, int $teacherId): bool { return studio_is_admin(); }
function mis_menu_visibility(PDO $pdo, int $schoolId): array { return []; }
function mis_teacher_classes(PDO $pdo, int $teacherId, int $schoolId): array { return []; }
