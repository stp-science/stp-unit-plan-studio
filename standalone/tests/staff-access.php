<?php
declare(strict_types=1);
require dirname(__DIR__) . '/public/studio_access.php';
require dirname(__DIR__) . '/tools/private-staff-login-lib.php';
function staff_check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
$directory = sys_get_temp_dir() . '/studio-staff-' . bin2hex(random_bytes(6));
mkdir($directory, 0700);
$file = $directory . '/staff-login.local.php';
$ownerPassword = 'Synthetic-owner-test-only';
$staffPassword = 'Synthetic-staff-test-only';
$ownerHash = password_hash($ownerPassword, PASSWORD_BCRYPT, ['cost' => 4]);
studio_save_staff_login($file, 'staff', $staffPassword, 'gary', $ownerHash);
$staff = require $file;
staff_check(!str_contains((string)file_get_contents($file), $staffPassword), 'Plaintext password was saved.');
staff_check((fileperms($file) & 0777) === 0600, 'Staff file must be private.');
staff_check(studio_credentials_role('gary', $ownerPassword, 'gary', $ownerHash, $staff) === 'admin', 'Existing owner login changed.');
staff_check(studio_credentials_role('staff', $staffPassword, 'gary', $ownerHash, $staff) === 'staff', 'Staff login failed.');
foreach ([['staff', $ownerPassword], ['gary', $staffPassword], ['staff', 'wrong'], ['unknown', $staffPassword], ['', '']] as [$user, $password]) {
    staff_check(studio_credentials_role($user, $password, 'gary', $ownerHash, $staff) === '', 'Credentials crossed roles.');
}
staff_check(studio_credentials_role('staff', $staffPassword, 'gary', '', $staff) === '', 'Missing owner configuration must fail closed.');
$before = file_get_contents($file);
foreach ([['gary', $staffPassword], ['GARY', $staffPassword], ['staff', 'short'], ['staff', $ownerPassword]] as [$user, $password]) {
    $rejected = false;
    try { studio_save_staff_login($file, $user, $password, 'gary', $ownerHash); } catch (RuntimeException $e) { $rejected = true; }
    staff_check($rejected && file_get_contents($file) === $before, 'Invalid setup overwrote the working staff login.');
}

// Work on a disposable copy; never change the supplied private database.
$dbFile = $directory . '/studio.sqlite';
copy(dirname(__DIR__) . '/data/studio.sqlite', $dbFile);
putenv('STUDIO_SQLITE_PATH=' . $dbFile);
require dirname(__DIR__) . '/public/mis_common.php';
unset($db); // release config.php's temporary owner-discovery connection
require dirname(__DIR__) . '/public/curriculum_map_lib.php';
$teacherId = (int)studio_cfg('teacher_id');
$schoolId = (int)studio_cfg('school_id');
$GLOBALS['STUDIO_ACCESS_ROLE'] = 'admin';
$adminDepartments = cm_departments($pdo, $schoolId, $teacherId);
$GLOBALS['STUDIO_ACCESS_ROLE'] = 'staff';
staff_check(!mis_is_school_admin($pdo, $teacherId) && !mis_is_leadership($pdo, $teacherId) && !cm_is_manager($pdo, $teacherId), 'Staff acquired administrator rights.');
staff_check(mis_require_teacher($pdo)['role'] === 'teacher', 'Stored owner role elevated staff.');
staff_check(cm_departments($pdo, $schoolId, $teacherId) === $adminDepartments && count($adminDepartments) >= 37, 'Staff lost access to shared departments.');

$endpointCase = $argv[1] ?? '';
if (in_array($endpointCase, ['--settings-api', '--staff-login-api', '--admin-staff-login-api', '--department-api', '--restore-page'], true)) {
    // Supply an HTTP-body fixture to the actual endpoint while running under CLI.
    // Its authorization, CSRF and database code remain unchanged.
    $beforeSettings = $pdo->query('SELECT priorities FROM mis_curriculum_school_config')->fetchColumn();
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_GET['action'] = $endpointCase === '--department-api' ? 'create-department' : (str_contains($endpointCase, 'staff-login-api') ? 'save-staff-login' : 'save-config');
    if ($endpointCase === '--admin-staff-login-api') {
        $GLOBALS['STUDIO_ACCESS_ROLE'] = 'admin';
        putenv('STUDIO_LOGIN_USER=gary');
        putenv('STUDIO_PASSWORD_HASH=' . $ownerHash);
    }
    $GLOBALS['STAFF_TEST_BODY'] = json_encode(['csrf' => studio_csrf_token(), 'priorities' => 'UNAUTHORIZED CHANGE', 'additionalGuidance' => '', 'name' => 'UNAUTHORIZED DEPARTMENT', 'role' => 'admin', 'username' => 'feedback', 'password' => 'Rotated-staff-test-password']);
    $departmentCount = (int)$pdo->query('SELECT COUNT(*) FROM mis_departments')->fetchColumn();
    register_shutdown_function(static function () use (&$pdo, $beforeSettings, $directory, $endpointCase, $departmentCount, $file, $ownerHash, $ownerPassword): void {
        if ($endpointCase === '--admin-staff-login-api') {
            staff_check(http_response_code() === 200, 'Administrator could not save staff login.');
            $saved = require $file;
            staff_check(studio_credentials_role('feedback', 'Rotated-staff-test-password', 'gary', $ownerHash, $saved) === 'staff', 'Staff login was not saved correctly.');
            staff_check(studio_credentials_role('gary', $ownerPassword, 'gary', $ownerHash, $saved) === 'admin', 'Administrator login changed.');
        } else staff_check(http_response_code() === 403, 'Direct administrator request was not forbidden.');
        staff_check($pdo->query('SELECT priorities FROM mis_curriculum_school_config')->fetchColumn() === $beforeSettings, 'Staff changed school settings.');
        staff_check((int)$pdo->query('SELECT COUNT(*) FROM mis_departments')->fetchColumn() === $departmentCount, 'Staff created a department.');
        echo "\nVerified $endpointCase access control and unchanged school settings/departments.\n";
        $pdo = null;
        foreach (glob($directory . '/*') ?: [] as $path) @unlink($path);
        @rmdir($directory);
    });
    $endpointFile = $endpointCase === '--department-api' ? 'curriculum_map_api.php' : ($endpointCase === '--restore-page' ? 'restore_private_data.php' : 'curriculum_studio_api.php');
    $api = file_get_contents(dirname(__DIR__) . '/public/' . $endpointFile);
    $api = str_replace("dirname(__DIR__) . '/staff-login.local.php'", var_export($file, true), $api);
    $api = str_replace("file_get_contents('php://input')", '$GLOBALS[\'STAFF_TEST_BODY\']', $api);
    $api = str_replace('__DIR__', var_export(dirname(__DIR__) . '/public', true), $api);
    eval(substr($api, 5));
    throw new RuntimeException('The settings endpoint unexpectedly returned.');
}

$_GET = ['guide' => '1'];
ob_start(); require dirname(__DIR__) . '/public/curriculum_studio.php'; $staffHtml = ob_get_clean();
staff_check(!str_contains($staffHtml, 'School settings (admins only)') && !str_contains($staffHtml, 'id="cs-save"'), 'Staff can see administrator controls.');
staff_check(!str_contains($staffHtml, 'id="cs-staff-save"'), 'Staff can change the shared login.');
staff_check(str_contains($staffHtml, '&middot; Staff'), 'Staff role indicator is missing.');
$GLOBALS['STUDIO_ACCESS_ROLE'] = 'admin';
staff_check(mis_is_school_admin($pdo, $teacherId) && mis_is_leadership($pdo, $teacherId), 'Owner lost administrator rights.');
ob_start(); require dirname(__DIR__) . '/public/curriculum_studio.php'; $adminHtml = ob_get_clean();
staff_check(str_contains($adminHtml, 'School settings (admins only)') && str_contains($adminHtml, 'id="cs-save"'), 'Owner lost settings controls.');
staff_check(str_contains($adminHtml, 'id="cs-staff-save"'), 'Owner cannot configure the staff login.');
$pdo = null;
foreach (glob($directory . '/*') ?: [] as $path) unlink($path);
rmdir($directory);
echo "Passed separate credentials, password privacy, owner preservation, staff department access, server roles and hidden settings controls. No AI calls.\n";
