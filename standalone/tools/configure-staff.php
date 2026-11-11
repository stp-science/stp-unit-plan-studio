<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/private-staff-login-lib.php';
require dirname(__DIR__) . '/config.php';
unset($db);
try {
    $username = $argv[1] ?? 'staff';
    $password = stream_get_contents(STDIN);
    $ownerHash = (string)(getenv('STUDIO_PASSWORD_HASH') ?: '');
    if ($ownerHash === '') throw new RuntimeException('Configure your private administrator login before adding staff. Nothing changed.');
    studio_save_staff_login(dirname(__DIR__) . '/staff-login.local.php', $username, $password, (string)(getenv('STUDIO_LOGIN_USER') ?: 'gary'), $ownerHash);
    echo 'Shared staff username: ' . $username . "\nStaff can use shared maps and unit plans, but cannot change school settings.\nYour existing administrator username and password are unchanged. No AI calls made.\n";
} catch (Throwable $e) {
    fwrite(STDERR, $e instanceof RuntimeException ? $e->getMessage() . "\n" : "Could not configure the staff login. Your administrator login is unchanged.\n");
    exit(1);
} finally { unset($password); }
