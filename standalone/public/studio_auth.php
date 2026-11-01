<?php
declare(strict_types=1);
/** Single-owner private edition. Remote deployment fails closed without access configuration. */
$local = in_array((string)($_SERVER['REMOTE_ADDR'] ?? ''), ['127.0.0.1', '::1'], true) && preg_match('/^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$/i', (string)($_SERVER['HTTP_HOST'] ?? ''));
if (PHP_SAPI !== 'cli' && !$local) {
    $hash = (string)(getenv('STUDIO_PASSWORD_HASH') ?: '');
    if ($hash === '') { http_response_code(503); header('Content-Type: text/plain; charset=utf-8'); exit('Private hosting is not configured. Set STUDIO_PASSWORD_HASH on the server.'); }
    if (!hash_equals((string)(getenv('STUDIO_LOGIN_USER') ?: 'gary'), (string)($_SERVER['PHP_AUTH_USER'] ?? '')) || !password_verify((string)($_SERVER['PHP_AUTH_PW'] ?? ''), $hash)) {
        http_response_code(401); header('WWW-Authenticate: Basic realm="Private Unit Plan Studio", charset="UTF-8"'); exit('Sign in to the private Unit Plan Studio.');
    }
}
if (session_status() !== PHP_SESSION_ACTIVE) { session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']); session_start(); }
function studio_csrf_token(): string { if (empty($_SESSION['studio_csrf'])) $_SESSION['studio_csrf'] = bin2hex(random_bytes(32)); return (string)$_SESSION['studio_csrf']; }
function studio_csrf_valid(?string $token): bool { return $token !== null && $token !== '' && hash_equals(studio_csrf_token(), $token); }
