<?php
declare(strict_types=1);
/** Legacy function name retained; the selected provider is called once, without fallback. */
function cs_ai_label(): string { return strtolower(trim((string)getenv('AI_PROVIDER'))) === 'gemini' ? 'Gemini' : 'Claude'; }
function cs_claude_payload(array $input, string $instructions, array $schema, int $maxTokens, string $model): array {
    $messages = [];
    foreach ($input as $message) {
        $role = (string)($message['role'] ?? 'user');
        if (!in_array($role, ['user', 'assistant'], true)) throw new RuntimeException('Invalid message role.');
        $parts = $message['content'] ?? [];
        if (is_string($parts)) $parts = [['type' => 'input_text', 'text' => $parts]];
        $content = [];
        foreach ($parts as $part) {
            if (($part['type'] ?? '') === 'input_text') { $content[] = ['type' => 'text', 'text' => (string)($part['text'] ?? '')]; continue; }
            $uri = (string)($part['file_data'] ?? $part['image_url'] ?? '');
            if (!preg_match('~^data:(application/pdf|image/png|image/jpeg|image/gif|image/webp);base64,([A-Za-z0-9+/=\r\n]+)$~', $uri, $m) || strlen($m[2]) > 16000000 || base64_decode($m[2], true) === false) throw new RuntimeException('Use a valid PDF, PNG, JPEG, GIF or WebP attachment.');
            $content[] = ['type' => $m[1] === 'application/pdf' ? 'document' : 'image', 'source' => ['type' => 'base64', 'media_type' => $m[1], 'data' => $m[2]]];
        }
        $messages[] = ['role' => $role, 'content' => $content];
    }
    return ['model' => $model, 'stream' => true, 'max_tokens' => $maxTokens, 'system' => $instructions, 'messages' => $messages,
        'tools' => [['name' => 'submit_result', 'description' => 'Return the requested structured curriculum result.', 'input_schema' => $schema]],
        'tool_choice' => ['type' => 'tool', 'name' => 'submit_result']];
}
function cs_claude_event(string $packet, array &$state, array &$usage): void {
    $lines = [];
    foreach (preg_split('/\r?\n/', $packet) as $line) if (str_starts_with($line, 'data:')) $lines[] = ltrim(substr($line, 5));
    $e = json_decode(implode("\n", $lines), true);
    if (!is_array($e)) return;
    if (($e['type'] ?? '') === 'error') { $state['error'] = true; return; }
    if (($e['type'] ?? '') === 'message_start') {
        $u = $e['message']['usage'] ?? [];
        $usage = ['input_tokens' => (int)($u['input_tokens'] ?? 0) + (int)($u['cache_read_input_tokens'] ?? 0) + (int)($u['cache_creation_input_tokens'] ?? 0), 'output_tokens' => 0, 'input_tokens_details' => ['cached_tokens' => (int)($u['cache_read_input_tokens'] ?? 0)]];
    }
    if (($e['type'] ?? '') === 'content_block_start' && ($e['content_block']['type'] ?? '') === 'tool_use' && ($e['content_block']['name'] ?? '') === 'submit_result') $state['index'] = $e['index'];
    if (($e['type'] ?? '') === 'content_block_delta' && isset($state['index']) && $e['index'] === $state['index'] && ($e['delta']['type'] ?? '') === 'input_json_delta') $state['json'] .= (string)($e['delta']['partial_json'] ?? '');
    if (($e['type'] ?? '') === 'message_delta') { $state['stop'] = $e['delta']['stop_reason'] ?? $state['stop']; $usage['output_tokens'] = (int)($e['usage']['output_tokens'] ?? ($usage['output_tokens'] ?? 0)); }
}
function cs_openai(array $input, string $instructions, array $schema, int $maxTokens, callable $emit, array &$usage = [], string $cacheKey = '', string $effort = 'low'): array {
    $provider = strtolower(trim((string)(getenv('AI_PROVIDER') ?: 'claude')));
    if ($provider === 'gemini') {
        require_once __DIR__ . '/studio_gemini.php';
        return cs_gemini_request($input, $instructions, $schema, $maxTokens, $emit, $usage);
    }
    if ($provider !== 'claude') throw new RuntimeException('AI_PROVIDER must be claude or gemini.');
    require_once dirname(__DIR__) . '/assessment/diag_lib.php';
    $key = diagApiKey(); $model = diagModel();
    if ($key === '' || $model === '') throw new RuntimeException('School IT must configure ANTHROPIC_API_KEY and CLAUDE_MODEL on the PHP server.');
    $payload = cs_claude_payload($input, $instructions, $schema, $maxTokens, $model);
    $state = ['json' => '', 'stop' => '', 'error' => false]; $buf = ''; $last = 0;
    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-api-key: ' . $key, 'anthropic-version: 2023-06-01'],
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_TIMEOUT => 400, CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_WRITEFUNCTION => static function ($c, string $chunk) use (&$buf, &$last, &$state, &$usage, $emit): int {
            $buf .= $chunk;
            if (strlen($buf) > 8000000) return 0;
            while (preg_match('/\r?\n\r?\n/', $buf, $m, PREG_OFFSET_CAPTURE)) {
                cs_claude_event(substr($buf, 0, $m[0][1]), $state, $usage);
                $buf = substr($buf, $m[0][1] + strlen($m[0][0]));
            }
            if (time() - $last >= 5) { $last = time(); $emit(['type' => 'progress']); }
            return strlen($chunk);
        },
    ]);
    $ok = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($code >= 400) {
        error_log('[curriculum_studio] Claude HTTP ' . $code);
        if ($code === 429) throw new CsRetry('Claude reached an API rate or spending limit. Check the school API limits before retrying; completed work is kept.');
        if (in_array($code, [401, 403], true)) throw new RuntimeException('Claude rejected the server API credentials. Ask school IT to check the key and API access.');
        throw new CsRetry('Claude could not complete this request. Completed work is kept; check the model, input size and service before retrying.');
    }
    if ($ok === false) throw new CsRetry('Claude timed out or the connection failed. Completed work is kept.');
    if (trim($buf) !== '') cs_claude_event($buf, $state, $usage);
    if ($state['error'] || $state['stop'] !== 'tool_use') throw new CsRetry('Claude returned an incomplete response. Completed work is kept; try a smaller request.');
    $j = json_decode($state['json'], true);
    if (!is_array($j)) throw new CsRetry('Claude returned invalid structured data. No changes were applied.');
    return ['json' => $j, 'model' => $model];
}
