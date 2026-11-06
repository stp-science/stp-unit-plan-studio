<?php
declare(strict_types=1);
/**
 * Unit Plan Studio, standalone edition: a PDO that runs the site's MySQL statements on SQLite.
 * The studio was written for MySQL. In SQLite mode this class rewrites the handful of MySQL-only constructs it uses
 * (UTC_TIMESTAMP(), INSERT IGNORE, ON DUPLICATE KEY UPDATE, inline KEY definitions, AUTO_INCREMENT, SHOW COLUMNS ...)
 * so nothing else has to change. In MySQL mode this class is not used at all.
 */
class StudioPdo extends PDO
{
    public function __construct(string $file)
    {
        parent::__construct('sqlite:' . $file);
        $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        parent::exec('PRAGMA journal_mode = WAL');
        parent::exec('PRAGMA busy_timeout = 8000');
        parent::exec('PRAGMA foreign_keys = OFF');
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        $last = 0;
        foreach (self::statements((string)$statement) as $sql) $last = parent::exec($sql);
        return $last;
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return parent::prepare(self::dml((string)$query), $options);
    }

    #[\ReturnTypeWillChange]
    public function query($query, $fetchMode = null, ...$fetchModeArgs)
    {
        $sql = self::dml((string)$query);
        return $fetchMode === null ? parent::query($sql) : parent::query($sql, $fetchMode, ...$fetchModeArgs);
    }

    /** One MySQL statement in, one or more SQLite statements out (a CREATE TABLE with inline KEYs becomes the table plus its indexes). */
    public static function statements(string $sql): array
    {
        $t = trim($sql);
        if (preg_match('/^CREATE\s+TABLE/i', $t)) return self::createTable($t);
        return [self::dml($t)];
    }

    public static function dml(string $sql): string
    {
        $s = $sql;
        if (preg_match('/^\s*SHOW\s+COLUMNS\s+FROM\s+`?(\w+)`?\s+LIKE\s+\'([^\']*)\'/i', $s, $m)) return "SELECT name FROM pragma_table_info('" . $m[1] . "') WHERE name = '" . $m[2] . "'";
        if (preg_match('/^\s*ALTER\s+TABLE/i', $s)) return preg_replace('/\s+AFTER\s+\w+/i', '', $s);
        $s = preg_replace('/\bUTC_TIMESTAMP\(\)\s*-\s*INTERVAL\s+(\d+)\s+DAY/i', "datetime('now','-$1 day')", $s);
        $s = preg_replace('/\bUTC_TIMESTAMP\(\)\s*-\s*INTERVAL\s+\?\s+SECOND/i', "datetime('now', '-' || ? || ' seconds')", $s);
        $s = preg_replace('/\bUTC_TIMESTAMP\(\)/i', "datetime('now')", $s);
        $s = preg_replace('/^\s*INSERT\s+IGNORE\s+INTO/i', 'INSERT OR IGNORE INTO', $s);
        $s = preg_replace('/\s+FOR\s+UPDATE\s*$/i', '', $s);
        if (preg_match('/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i', $s)) {
            $s = preg_replace('/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i', 'ON CONFLICT DO UPDATE SET', $s);
            $s = preg_replace('/\bVALUES\(\s*(\w+)\s*\)/i', 'excluded.$1', $s);
        }
        return $s;
    }

    private static function createTable(string $sql): array
    {
        $sql = preg_replace('/\)\s*ENGINE\s*=.*$/is', ')', $sql);
        if (!preg_match('/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\((.*)\)\s*;?\s*$/is', $sql, $m)) return [$sql];
        $table = $m[1]; $body = $m[2];
        $items = []; $depth = 0; $cur = '';
        foreach (str_split($body) as $ch) {
            if ($ch === '(') $depth++;
            if ($ch === ')') $depth--;
            if ($ch === ',' && $depth === 0) { $items[] = trim($cur); $cur = ''; continue; }
            $cur .= $ch;
        }
        if (trim($cur) !== '') $items[] = trim($cur);
        $cols = []; $indexes = []; $auto = '';
        foreach ($items as $it) {
            if ($auto !== '' && preg_match('/^PRIMARY\s+KEY\s*\(\s*`?' . $auto . '`?\s*\)$/i', $it)) continue;   // already the AUTOINCREMENT primary key
            if (preg_match('/^(UNIQUE\s+)?KEY\s+`?(\w+)`?\s*\(([^)]*)\)$/i', $it, $k)) { $indexes[] = [$table . '__' . $k[2], trim($k[3]), $k[1] !== '']; continue; }
            if (stripos($it, 'AUTO_INCREMENT') !== false && preg_match('/^`?(\w+)`?\s/', $it, $c)) { $auto = $c[1]; $cols[] = $c[1] . ' INTEGER PRIMARY KEY AUTOINCREMENT'; continue; }
            $it = preg_replace('/\bUNSIGNED\b/i', '', $it);
            $it = preg_replace('/\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP(\(\d*\))?/i', '', $it);
            $it = preg_replace('/\s+(COLLATE|CHARACTER\s+SET)\s+\w+/i', '', $it);
            $cols[] = $it;
        }
        $out = ['CREATE TABLE IF NOT EXISTS ' . $table . " (\n  " . implode(",\n  ", $cols) . "\n)"];
        foreach ($indexes as [$name, $list, $unique]) $out[] = 'CREATE ' . ($unique ? 'UNIQUE ' : '') . 'INDEX IF NOT EXISTS ' . $name . ' ON ' . $table . ' (' . $list . ')';
        return $out;
    }
}
