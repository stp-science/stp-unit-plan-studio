# Unit Plan Studio — friend's edition with Claude

This preserves the complete PHP studio supplied by Gary's friend: curriculum maps, junior and senior subject catalogues, statement matching, saved guide workflow, settings, front-end assets and Word template.

The provider adapter now uses the school's Claude API via server environment variables. No API key is in this repository.

This version requires PHP hosting. Read DEPLOYMENT.md for the concrete hosting setup and how it differs from the existing live ChatGPT Sites deployment.

The original supplied ZIP's private database and SQL data dump are deliberately excluded from public GitHub. The restore tool imports them privately on the PHP host, keeping the five maps, seven guides, selected statements, cached banks and matching progress.

For local inspection, restore the data first, then run run.sh, run.bat or php -S localhost:8080 -t public. Viewing, editing and exporting saved work need no AI key. Generation and AI statement matching use Claude API credits.

Remote deployments require private access configuration. This is a single-owner edition, matching the supplied data.
