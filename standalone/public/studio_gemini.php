<?php
declare(strict_types=1);

function cs_gemini_payload(array $input, string $instructions, array $schema, int $maxTokens): array
{
    // Reuse the existing attachment and role validation for both providers.
    $validated = cs_claude_payload($input, $instructions, $schema, $maxTokens, 'unused');
    $contents = [];
    foreach ($validated['messages'] as $message) {
        $parts = [];
        foreach ($message['content'] as $part) {
            if ($part['type'] === 'text') $parts[] = ['text' => $part['text']];
            else $parts[] = ['inlineData' => ['mimeType' => $part['source']['media_type'], 'data' => $part['source']['data']]];
        }
        $contents[] = ['role' => $message['role'] === 'assistant' ? 'model' : 'user', 'parts' => $parts];
    }
    return ['systemInstruction' => ['parts' => [['text' => $instructions]]], 'contents' => $contents,
        'generationConfig' => ['maxOutputTokens' => $maxTokens, 'responseMimeType' => 'application/json', 'responseJsonSchema' => $schema]];
}

function cs_gemini_event(string $packet, array &$state, array &$usage): void
{
    $lines = [];
    foreach (preg_split('/\r?\n/', $packet) as $line) if (str_starts_with($line, 'data:')) $lines[] = ltrim(substr($line, 5));
    $event = json_decode(implode("\n", $lines), true);
    if (!is_array($event)) return;
    if (isset($event['error']) || !empty($event['promptFeedback']['blockReason'])) $state['error'] = true;
    $candidate = $event['candidates'][0] ?? [];
    foreach ($candidate['content']['parts'] ?? [] as $part) {
        if (empty($part['thought']) && isset($part['text'])) $state['json'] .= (string)$part['text'];
    }
    if (isset($candidate['finishReason'])) $state['stop'] = (string)$candidate['finishReason'];
    if (isset($event['modelVersion'])) $state['model'] = (string)$event['modelVersion'];
    if (isset($event['usageMetadata'])) {
        $u = $event['usageMetadata'];
        $usage = ['input_tokens' => (int)($u['promptTokenCount'] ?? 0),
            'output_tokens' => (int)($u['candidatesTokenCount'] ?? 0) + (int)($u['thoughtsTokenCount'] ?? 0),
            'input_tokens_details' => ['cached_tokens' => (int)($u['cachedContentTokenCount'] ?? 0)]];
    }
}

function cs_gemini_result(array $state, string $model): array
{
    if ($state['error'] || $state['stop'] !== 'STOP') throw new CsRetry('Gemini did not return a complete result. Saved work is kept; try a smaller request.');
    $json = json_decode($state['json'], true);
    if (!is_array($json)) throw new CsRetry('Gemini returned invalid structured data. No changes were applied.');
    return ['json' => $json, 'model' => $state['model'] ?? $model];
}

function cs_gemini_request(array $input, string $instructions, array $schema, int $maxTokens, callable $emit, array &$usage): array
{
    $key = trim((string)(getenv('GEMINI_API_KEY') ?: ''));
    $model = trim((string)(getenv('GEMINI_MODEL') ?: ''));
    if ($key === '' || $model === '') throw new RuntimeException('Configure GEMINI_API_KEY and GEMINI_MODEL on the PHP server.');
    if (!preg_match('/^gemini-[A-Za-z0-9._-]+$/', $model)) throw new RuntimeException('Check the Gemini model ID in the server settings.');
    $payload = cs_gemini_payload($input, $instructions, $schema, $maxTokens);
    $state = ['json' => '', 'stop' => '', 'error' => false]; $buffer = ''; $last = 0;
    $ch = curl_init('https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':streamGenerateContent?alt=sse');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $key],
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_TIMEOUT => 400, CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_WRITEFUNCTION => static function ($c, string $chunk) use (&$buffer, &$last, &$state, &$usage, $emit): int {
            $buffer .= $chunk;
            if (strlen($buffer) + strlen($state['json']) > 8000000) return 0;
            while (preg_match('/\r?\n\r?\n/', $buffer, $m, PREG_OFFSET_CAPTURE)) {
                cs_gemini_event(substr($buffer, 0, $m[0][1]), $state, $usage);
                $buffer = substr($buffer, $m[0][1] + strlen($m[0][0]));
            }
            if (time() - $last >= 5) { $last = time(); $emit(['type' => 'progress']); }
            return strlen($chunk);
        }]);
    $ok = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($code >= 400) {
        error_log('[curriculum_studio] Gemini HTTP ' . $code);
        if ($code === 429) throw new CsRetry('Gemini reached its API limit. Check your Google AI Studio quota before retrying; saved work is kept.');
        if (in_array($code, [401, 403], true)) throw new RuntimeException('Gemini rejected the API credentials. Check the key and its API permissions.');
        if ($code === 404) throw new RuntimeException('That Gemini model is not available to this API key. Check GEMINI_MODEL.');
        throw new CsRetry('Gemini could not complete the request. Check the model, input size and service before retrying.');
    }
    if ($ok === false) throw new CsRetry('Gemini timed out or the connection failed. Saved work is kept.');
    if (trim($buffer) !== '') cs_gemini_event($buffer, $state, $usage);
    return cs_gemini_result($state, $model);
}
