<?php
declare(strict_types=1);
/** Server secrets are environment variables. Local overrides are ignored by Git. */
$runtimeFile = __DIR__ . '/runtime.local.php';
if (is_file($runtimeFile)) {
    $runtime = require $runtimeFile;
    if (is_array($runtime)) foreach (['AI_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'ANTHROPIC_API_KEY', 'CLAUDE_MODEL'] as $key) {
        if (isset($runtime[$key]) && is_string($runtime[$key])) putenv($key . '=' . $runtime[$key]);
    }
}
$c = [
    'driver' => getenv('STUDIO_DB_DRIVER') ?: 'sqlite',
    'sqlite_path' => getenv('STUDIO_SQLITE_PATH') ?: __DIR__ . '/data/studio.sqlite',
    'mysql' => ['host' => getenv('DB_HOST') ?: '127.0.0.1', 'port' => (int)(getenv('DB_PORT') ?: 3306), 'dbname' => getenv('DB_NAME') ?: 'unit_plan_studio', 'user' => getenv('DB_USER') ?: '', 'pass' => getenv('DB_PASSWORD') ?: ''],
    'claude_model' => getenv('CLAUDE_MODEL') ?: '',
    'teacher_id' => (int)(getenv('STUDIO_TEACHER_ID') ?: 1),
    'school_id' => (int)(getenv('STUDIO_SCHOOL_ID') ?: 1),
    'school_name' => getenv('STUDIO_SCHOOL_NAME') ?: 'St Peter’s School',
];
$overrides = [];
if (is_file(__DIR__ . '/config.local.php')) { $overrides = require __DIR__ . '/config.local.php'; if (is_array($overrides)) $c = array_replace_recursive($c, $overrides); }
if ($c['driver'] === 'sqlite' && is_file($c['sqlite_path']) && !getenv('STUDIO_TEACHER_ID') && !isset($overrides['teacher_id'])) {
    try {
        $db = new PDO('sqlite:' . $c['sqlite_path']);
        $rows = $db->query('SELECT id, school_id FROM teachers WHERE is_active = 1')->fetchAll(PDO::FETCH_ASSOC);
        if (count($rows) === 1) { $c['teacher_id'] = (int)$rows[0]['id']; $c['school_id'] = (int)$rows[0]['school_id']; }
    } catch (Throwable $e) { }
}
return $c;
