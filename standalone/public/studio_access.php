<?php
declare(strict_types=1);

/** Credentials are checked on every request. Browser parameters and session roles are never trusted. */
function studio_credentials_role(string $user, string $password, string $owner, string $ownerHash, array $staff = []): string
{
    if ($ownerHash === '') return '';
    if (hash_equals($owner, $user) && password_verify($password, $ownerHash)) return 'admin';
    $staffUser = is_string($staff['username'] ?? null) ? $staff['username'] : '';
    $staffHash = is_string($staff['password_hash'] ?? null) ? $staff['password_hash'] : '';
    if ($staffUser !== '' && $staffUser !== $owner && $staffHash !== '' && hash_equals($staffUser, $user) && password_verify($password, $staffHash)) return 'staff';
    return '';
}

function studio_is_admin(): bool { return ($GLOBALS['STUDIO_ACCESS_ROLE'] ?? '') === 'admin'; }
function studio_is_staff(): bool { return ($GLOBALS['STUDIO_ACCESS_ROLE'] ?? '') === 'staff'; }
function studio_require_admin(): void
{
    if (!studio_is_admin()) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        exit('Only the administrator can use this page.');
    }
}
