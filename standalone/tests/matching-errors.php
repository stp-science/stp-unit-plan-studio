<?php
declare(strict_types=1);
require dirname(__DIR__) . '/public/curriculum_studio_lib.php';
$cases = [
    [new CsRetry('Gemini reached its API limit. Check your Google AI Studio quota before retrying; saved work is kept.'), 'rate_limit', true],
    [new CsRetry('Daily quota exceeded'), 'quota', false],
    [new RuntimeException('Gemini rejected the API credentials.'), 'settings', false],
    [new CsRetry('Gemini timed out or the connection failed.'), 'timeout', true],
    [new CsRetry('Claude returned an incomplete response.'), 'service', true],
    [new CsInvalid('No matching curriculum statements were found for that unit and year.'), 'no_match', false],
    [new CsInvalid('Choose a curriculum document.'), 'input', false],
];
foreach ($cases as [$error, $code, $retryable]) {
    $meta = cs_failure_meta($error);
    if ($meta['code'] !== $code || $meta['retryable'] !== $retryable) throw new RuntimeException('Incorrect failure classification: ' . $code);
}
echo "Passed provider limit, quota, settings, timeout and genuine curriculum mismatch classification. No AI calls.\n";
