#!/bin/sh
# Unit Plan Studio (standalone): starts a local web server on http://localhost:8080
cd "$(dirname "$0")" || exit 1
command -v php >/dev/null 2>&1 || { echo "PHP was not found. Install PHP 8.1 or newer, then run this again."; exit 1; }
echo "Open http://localhost:8080 in your browser. Press Ctrl+C to stop."
php -S localhost:8080 -t public
