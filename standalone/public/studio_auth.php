<?php
declare(strict_types=1);
/** Private owner login plus an optional shared staff login with no school-settings permission. */
require_once __DIR__ . '/studio_access.php';
$GLOBALS['STUDIO_ACCESS_ROLE'] = '';
$local = in_array((string)($_SERVER['REMOTE_ADDR'] ?? ''), ['127.0.0.1', '::1'], true) && preg_match('/^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$/i', (string)($_SERVER['HTTP_HOST'] ?? ''));
$identity = 'local-admin';
if (PHP_SAPI !== 'cli' && !$local) {
    $hash = (string)(getenv('STUDIO_PASSWORD_HASH') ?: '');
    if ($hash === '') { http_response_code(503); header('Content-Type: text/plain; charset=utf-8'); exit('Private hosting is not configured. Set STUDIO_PASSWORD_HASH on the server.'); }
    $staffFile = dirname(__DIR__) . '/staff-login.local.php';
    $staff = is_file($staffFile) ? require $staffFile : [];
    $user = (string)($_SERVER['PHP_AUTH_USER'] ?? '');
    $role = studio_credentials_role($user, (string)($_SERVER['PHP_AUTH_PW'] ?? ''), (string)(getenv('STUDIO_LOGIN_USER') ?: 'gary'), $hash, is_array($staff) ? $staff : []);
    if ($role === '') {
        http_response_code(401); header('WWW-Authenticate: Basic realm="Private Unit Plan Studio", charset="UTF-8"'); exit('Sign in to the private Unit Plan Studio.');
    }
    $GLOBALS['STUDIO_ACCESS_ROLE'] = $role;
    $identity = $role . ':' . $user;
} else {
    $GLOBALS['STUDIO_ACCESS_ROLE'] = 'admin';
}
if (session_status() !== PHP_SESSION_ACTIVE) { session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']); session_start(); }
if (($_SESSION['studio_identity'] ?? '') !== $identity) {
    session_regenerate_id(true);
    unset($_SESSION['studio_csrf']);
    $_SESSION['studio_identity'] = $identity;
}
function studio_csrf_token(): string { if (empty($_SESSION['studio_csrf'])) $_SESSION['studio_csrf'] = bin2hex(random_bytes(32)); return (string)$_SESSION['studio_csrf']; }
function studio_csrf_valid(?string $token): bool { return $token !== null && $token !== '' && hash_equals(studio_csrf_token(), $token); }
