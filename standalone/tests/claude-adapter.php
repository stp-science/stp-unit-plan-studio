<?php
declare(strict_types=1);
require dirname(__DIR__) . '/public/studio_claude.php';
function check(bool $v, string $m): void { if (!$v) throw new RuntimeException($m); }
$schema = ['type' => 'object', 'properties' => ['ok' => ['type' => 'boolean']], 'required' => ['ok']];
$payload = cs_claude_payload([['role' => 'user', 'content' => [['type' => 'input_text', 'text' => 'Test only'], ['type' => 'input_file', 'file_data' => 'data:application/pdf;base64,' . base64_encode('%PDF-test')]]]], 'Test instructions', $schema, 512, 'mock');
check($payload['messages'][0]['content'][1]['type'] === 'document', 'PDF conversion');
check($payload['tools'][0]['input_schema'] === $schema, 'Schema retained');
check($payload['tool_choice']['name'] === 'submit_result', 'Structured result');
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
