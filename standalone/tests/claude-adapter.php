<?php
declare(strict_types=1);
require dirname(__DIR__) . '/public/studio_claude.php';
function check(bool $v, string $m): void { if (!$v) throw new RuntimeException($m); }
$schema = ['type' => 'object', 'properties' => ['ok' => ['type' => 'boolean']], 'required' => ['ok']];
$payload = cs_claude_payload([['role' => 'user', 'content' => [['type' => 'input_text', 'text' => 'Test only'], ['type' => 'input_file', 'file_data' => 'data:application/pdf;base64,' . base64_encode('%PDF-test')]]]], 'Test instructions', $schema, 512, 'mock');
check($payload['messages'][0]['content'][1]['type'] === 'document', 'PDF conversion');
check($payload['tools'][0]['input_schema'] === $schema, 'Schema retained');
check($payload['tool_choice']['name'] === 'submit_result', 'Structured result');
// Sonnet 5.5 must never use forced tools. Its JSON-schema response streams as text.
$sonnet = cs_claude_payload([['role' => 'user', 'content' => [['type' => 'input_text', 'text' => 'Test only']]]], 'Test instructions', $schema, 512, 'claude-sonnet-5-5');
check(!isset($sonnet['tool_choice']) && !isset($sonnet['tools']), 'Sonnet 5.5 no forced tool choice');
check(($sonnet['output_config']['format']['type'] ?? '') === 'json_schema' && ($sonnet['output_config']['format']['schema'] ?? null) === $schema, 'Sonnet 5.5 native JSON schema');
$sonnetState = ['json' => '', 'stop' => '', 'error' => false, 'mode' => 'json']; $sonnetUsage = [];
foreach ([
 ['type' => 'message_start', 'message' => ['usage' => ['input_tokens' => 7]]],
 ['type' => 'content_block_start', 'index' => 0, 'content_block' => ['type' => 'text', 'text' => '']],
 ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'text_delta', 'text' => '{"ok":']],
 ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'text_delta', 'text' => 'true}']],
 ['type' => 'message_delta', 'delta' => ['stop_reason' => 'end_turn'], 'usage' => ['output_tokens' => 4]],
] as $event) cs_claude_event('data: ' . json_encode($event), $sonnetState, $sonnetUsage);
check(($sonnetState['stop'] ?? '') === 'end_turn' && (json_decode($sonnetState['json'], true)['ok'] ?? false) === true, 'Sonnet 5.5 streamed structured JSON');
check($sonnetUsage['input_tokens'] === 7 && $sonnetUsage['output_tokens'] === 4, 'Sonnet 5.5 usage counts');
$state = ['json' => '', 'stop' => '', 'error' => false];$usage = [];
$events = [
 ['type' => 'message_start', 'message' => ['usage' => ['input_tokens' => 10, 'cache_read_input_tokens' => 20]]],
 ['type' => 'content_block_start', 'index' => 1, 'content_block' => ['type' => 'tool_use', 'name' => 'submit_result']],
 ['type' => 'content_block_delta', 'index' => 1, 'delta' => ['type' => 'input_json_delta', 'partial_json' => '{"ok":']],
 ['type' => 'content_block_delta', 'index' => 1, 'delta' => ['type' => 'input_json_delta', 'partial_json' => 'true}']],
 ['type' => 'message_delta', 'delta' => ['stop_reason' => 'tool_use'], 'usage' => ['output_tokens' => 8]],
];
foreach ($events as $e) cs_claude_event('data: ' . json_encode($e), $state, $usage);
check(json_decode($state['json'], true)['ok'] === true && $state['stop'] === 'tool_use', 'Partial structured result');
check($usage['input_tokens'] === 30 && $usage['input_tokens_details']['cached_tokens'] === 20 && $usage['output_tokens'] === 8, 'Usage counts');
cs_claude_event('data: {"type":"error","error":{"message":"interruption"}}', $state, $usage);
check($state['error'], 'Interruption');
$failed = false;try { cs_claude_payload([['content' => [['type' => 'input_image', 'image_url' => 'https://untrusted.invalid/image']]]], '', $schema, 512, 'mock'); } catch (RuntimeException $e) { $failed = true; }
check($failed, 'Remote attachment URLs rejected');
echo "Passed Claude payload, PDF, schema, streamed JSON, usage and interruption checks. No network or API calls.\n";
