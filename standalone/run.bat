@echo off
rem Unit Plan Studio (standalone): starts a local web server on http://localhost:8080
cd /d "%~dp0"
where php >nul 2>nul
if errorlevel 1 (
  echo PHP was not found. Install PHP 8.1 or newer and make sure "php" works in a terminal, then run this again.
  pause
  exit /b 1
)
echo Open http://localhost:8080 in your browser. Press Ctrl+C here to stop.
start "" http://localhost:8080
php -S localhost:8080 -t public
