<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$provider = $argv[1] ?? '';
$model = $argv[2] ?? '';
if (!in_array($provider, ['claude', 'gemini'], true) || !preg_match('/^' . ($provider === 'gemini' ? 'gemini-' : 'claude-') . '[A-Za-z0-9._-]+$/', $model)) {
    fwrite(STDERR, "Usage: pipe the API key into php tools/configure-ai.php gemini|claude MODEL_ID\n"); exit(1);
}
$key = trim(stream_get_contents(STDIN));
if (strlen($key) < 20 || preg_match('/\s/', $key)) { fwrite(STDERR, "No usable key received. Enter the key with the hidden prompt first.\n"); exit(1); }
$path = dirname(__DIR__) . '/runtime.local.php';
$values = is_file($path) ? require $path : [];
if (!is_array($values)) { fwrite(STDERR, "Existing runtime settings could not be read. Nothing changed.\n"); exit(1); }
$prefix = $provider === 'gemini' ? 'GEMINI' : 'CLAUDE';
$values['AI_PROVIDER'] = $provider;
$values[$provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'] = $key;
$values[$prefix . '_MODEL'] = $model;
umask(0077);
$tmp = tempnam(dirname($path), '.runtime-');
if ($tmp === false || file_put_contents($tmp, "<?php\nreturn " . var_export($values, true) . ";\n", LOCK_EX) === false || !rename($tmp, $path)) {
    if (is_string($tmp) && is_file($tmp)) unlink($tmp);
    fwrite(STDERR, "Could not save runtime settings. Nothing else was changed.\n"); exit(1);
}
chmod($path, 0600);
echo ucfirst($provider) . " selected with model " . $model . ". Key saved privately. No API calls made.\n";
