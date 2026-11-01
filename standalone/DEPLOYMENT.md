# Deploy the complete friend's edition with Claude

The friend's PHP interface, map workflow, statement matching, catalogue and Word exports are retained. The AI transport is now Claude.

The current live ChatGPT Sites Worker URL and API secret are unchanged. This PHP application cannot run directly on that runtime or GitHub Pages. This branch is prepared for PHP hosting; it is not a completed live deployment.

## School IT setup

Use PHP 8.1+ with pdo_sqlite, zip, mbstring, curl, dom and xml. Point the HTTPS web root at standalone/public, never the repository root. Use persistent private storage for the SQLite database.

Set these server environment variables (not GitHub files):

- ANTHROPIC_API_KEY: the school's Claude API key, as a secret.
- CLAUDE_MODEL: the model ID from the existing working deployment.
- STUDIO_LOGIN_USER: the private owner's login (defaults to gary).
- STUDIO_PASSWORD_HASH: a PHP password_hash value; do not commit a password.
- Optionally STUDIO_SQLITE_PATH for a persistent database outside the web root.

Remote requests refuse access without password configuration. Local loopback testing needs no password. Writes use real session CSRF tokens. This is still the supplied single-owner edition, not independent staff accounts.

## Restore the supplied private work

The original ZIP contains a private SQLite database. It is not committed to this public branch.

Before the first web launch on the PHP host:

    cd standalone
    php tools/restore-private-data.php /private/path/unit-plan-studio-standalone.zip

The command restores the five maps, seven plans, statement choices, matching progress, cached statements and school settings, checks integrity and refuses to overwrite a database. Original teacher and school IDs are discovered from the restored database.

Keep the original ZIP, SQLite file, SQL data dump and config.local.php private. API secrets are not automatically transferred from the current host; school IT must configure them on the PHP host.

## Checks without API use

    php tests/claude-adapter.php

Use the original maps and saved guides to test viewing, editing and exports without AI. Any live generation test spends Claude API credits and should be kept small. There is no OpenAI fallback.
