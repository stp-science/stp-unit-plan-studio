# Deploy the complete friend's edition with Claude

The friend's PHP interface, map workflow, statement matching, catalogue and Word exports are retained. Claude is the default provider; Gemini can be selected for a trial. Each request uses only the selected provider, with no automatic fallback.

The current live ChatGPT Sites Worker URL and API secret are unchanged. This PHP application cannot run directly on that runtime or GitHub Pages. This branch is prepared for PHP hosting; it is not a completed live deployment.

## School IT setup

Use PHP 8.1+ with pdo_sqlite, zip, mbstring, curl, dom and xml. Point the HTTPS web root at standalone/public, never the repository root. Use persistent private storage for the SQLite database.

Set these server environment variables (not GitHub files):

- ANTHROPIC_API_KEY: the school's Claude API key, as a secret.
- CLAUDE_MODEL: the model ID from the existing working deployment.
- STUDIO_LOGIN_USER: the private owner's login (defaults to gary).
- STUDIO_PASSWORD_HASH: a PHP password_hash value; do not commit a password.
- Optionally STUDIO_SQLITE_PATH for a persistent database outside the web root.

Remote requests refuse access without password configuration. Local loopback testing needs no password. Writes use real session CSRF tokens. The owner login has administrator rights. An optional separate shared staff login can use all school maps and plans without school-settings permissions. These are shared workspace accounts, not individual teacher accounts.

## Shared staff login for testing

Keep the existing owner username/password private. After pulling this version, sign in as the owner, open **Unit plans → School settings (admins only) → Shared staff login**, choose a username and a different password, and press **Save staff login**. Use a separate private browser window to test the staff credentials. The form never displays the saved password and the API rejects requests from staff, including requests made directly.

Alternatively, configure the same account from SSH with a hidden terminal prompt:

    read -s -p "Choose a STAFF website password (12–72 characters): " studio_staff_password

Enter the password, press Enter, and wait until the normal command prompt returns. Then run:

    printf '%s' "$studio_staff_password" | PHP_VERSION=8.4 php /home/stp-unit-plans/studio/standalone/tools/configure-staff.php staff
    unset studio_staff_password

The helper writes only `staff-login.local.php`, outside the public directory, with a password hash and owner-only file permissions. This file is ignored by Git. It does not change the existing owner password, API settings, or database. Repeating the helper rotates the staff password.

The `staff` login can view, create, edit and delete shared maps/plans and use the configured AI provider. It cannot see the school-settings/usage box, change school settings through the API, create departments, or use the private database restore page. Access is checked from the credentials on every request, even if a browser previously had an administrator session. Only the owner login is an administrator.

Test the staff login in a separate private browser window, because browsers remember HTTP Basic credentials. Check the navigation label says **Staff**; the owner sees **Administrator**. School settings remain available only to the owner. Anyone given the shared staff credentials can use them; this temporary login does not verify school employment.

## Restore the supplied private work

The original ZIP contains a private SQLite database. It is not committed to this public branch.

Before the first web launch on the PHP host:

    cd standalone
    php tools/restore-private-data.php /private/path/unit-plan-studio-standalone.zip

The command restores the five maps, seven plans, statement choices, matching progress, cached statements and school settings, checks integrity and refuses to overwrite a database. Original teacher and school IDs are discovered from the restored database.

Keep the original ZIP, SQLite file, SQL data dump and config.local.php private. API secrets are not automatically transferred from the current host; school IT must configure them on the PHP host.

### Browser restore on a fresh installation

Once private login works, open `/restore_private_data.php` and upload the original ZIP. The page requires the existing owner login and a session CSRF token. It accepts only the expected database entry, checks size and integrity, and keeps the database outside the public directory. It backs up an automatically created empty database and refuses to replace any saved work. After a successful restore, a private marker prevents further restores. The ZIP is not retained and no AI calls are made.

## Switching between Gemini and Claude

For PHP hosts that do not pass website environment variables to PHP, the CLI-only helper saves provider settings in ignored `runtime.local.php`, outside the web root with owner-only permissions. It preserves the other provider's settings and the private login. Enter the key into a hidden shell prompt, then pass the value over stdin; never paste it into a command or GitHub:

    read -s -p "Paste API key, then press Enter: " studio_api_key

After entering the key and returning to the shell prompt:

    printf '%s' "$studio_api_key" | PHP_VERSION=8.3 php tools/configure-ai.php gemini gemini-3.5-flash-lite
    unset studio_api_key

For Claude, use `claude` and the school's working Claude model ID instead. This setup helper makes no API calls. Gemini uses the documented streamed GenerateContent endpoint with JSON-schema output and inline validated PDF/image data. Test a single small task first. Quotas and charges depend on the Google project; do not promise unlimited or free usage.

## Checks without API use

    php tests/claude-adapter.php
    php tests/gemini-adapter.php

Use the original maps and saved guides to test viewing, editing and exports without AI. Any live generation test spends Claude API credits and should be kept small. There is no OpenAI fallback.
