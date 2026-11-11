<?php
declare(strict_types=1);

function studio_save_staff_login(string $path, string $username, string $password, string $owner, string $ownerHash = ''): void
{
    if (!preg_match('/^[A-Za-z0-9._-]{3,64}$/', $username) || strcasecmp($username, $owner) === 0) throw new RuntimeException('Choose a staff username different from the administrator username.');
    if (strlen($password) < 12 || strlen($password) > 72 || str_contains($password, "\0") || strpbrk($password, "\r\n") !== false) throw new RuntimeException('Use a staff password between 12 and 72 characters, on one line.');
    if ($ownerHash !== '' && password_verify($password, $ownerHash)) throw new RuntimeException('Choose a staff password different from your administrator password.');
    $values = ['username' => $username, 'password_hash' => password_hash($password, PASSWORD_DEFAULT)];
    umask(0077);
    $tmp = tempnam(dirname($path), '.staff-login-');
    try {
        if ($tmp === false || !chmod($tmp, 0600) || file_put_contents($tmp, "<?php\nreturn " . var_export($values, true) . ";\n", LOCK_EX) === false || !rename($tmp, $path)) throw new RuntimeException('Could not save the private staff login. The administrator login is unchanged.');
    } finally {
        if (is_string($tmp) && is_file($tmp)) unlink($tmp);
    }
}
