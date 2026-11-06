<?php
declare(strict_types=1);
class CsRetry extends RuntimeException {}
require dirname(__DIR__) . '/public/studio_claude.php';
require dirname(__DIR__) . '/public/studio_gemini.php';
function verify(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$schema = ['type' => 'object', 'properties' => ['ok' => ['type' => 'boolean']], 'required' => ['ok'], 'additionalProperties' => false];
$payload = cs_gemini_payload([['role' => 'user', 'content' => [['type' => 'input_text', 'text' => 'Test'], ['type' => 'input_file', 'file_data' => 'data:application/pdf;base64,' . base64_encode('%PDF-test')]]], ['role' => 'assistant', 'content' => 'Prior answer']], 'Rules', $schema, 2048);
verify($payload['contents'][0]['parts'][1]['inlineData']['mimeType'] === 'application/pdf', 'PDF input');
verify($payload['contents'][1]['role'] === 'model', 'Conversation roles');
verify($payload['generationConfig']['responseJsonSchema'] === $schema, 'Structured schema');
$state = ['json' => '', 'stop' => '', 'error' => false]; $usage = [];
foreach ([['candidates' => [['content' => ['parts' => [['text' => 'private reasoning', 'thought' => true], ['text' => '{"ok":']]]]]], ['candidates' => [['content' => ['parts' => [['text' => 'true}']]], 'finishReason' => 'STOP']], 'usageMetadata' => ['promptTokenCount' => 12, 'candidatesTokenCount' => 4, 'thoughtsTokenCount' => 3, 'cachedContentTokenCount' => 5]]] as $e) cs_gemini_event('data: ' . json_encode($e), $state, $usage);
verify(cs_gemini_result($state, 'mock')['json'] === ['ok' => true], 'Chunk assembly and thoughts excluded');
verify($usage['output_tokens'] === 7 && $usage['input_tokens'] === 12 && $usage['input_tokens_details']['cached_tokens'] === 5, 'Usage includes thinking');
foreach (['MAX_TOKENS', 'SAFETY', ''] as $reason) {
    $bad = $state; $bad['stop'] = $reason; $failed = false;
    try { cs_gemini_result($bad, 'mock'); } catch (CsRetry $e) { $failed = true; }
    verify($failed, 'Incomplete result rejected: ' . $reason);
}
$bad = $state; $bad['json'] = 'broken'; $failed = false;
try { cs_gemini_result($bad, 'mock'); } catch (CsRetry $e) { $failed = true; }
verify($failed, 'Malformed JSON rejected');
cs_gemini_event('data: {"promptFeedback":{"blockReason":"SAFETY"}}', $state, $usage);
verify($state['error'], 'Blocked prompt rejected');
$failed = false;
try { cs_gemini_payload([['content' => [['type' => 'input_image', 'image_url' => 'https://example.invalid/file']]]], '', $schema, 512); } catch (RuntimeException $e) { $failed = true; }
verify($failed, 'Remote attachment URL rejected');
putenv('AI_PROVIDER=gemini'); verify(cs_ai_label() === 'Gemini', 'Gemini badge');
putenv('AI_PROVIDER=claude'); verify(cs_ai_label() === 'Claude', 'Claude badge');
echo "Passed Gemini PDF, schema, streamed JSON, usage, blocked/truncated response and provider-label checks. No API calls.\n";
