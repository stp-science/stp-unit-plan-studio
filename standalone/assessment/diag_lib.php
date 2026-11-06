<?php
declare(strict_types=1);
function diagApiKey(): string { return trim((string)(getenv('ANTHROPIC_API_KEY') ?: '')); }
function diagModel(): string { return trim((string)(getenv('CLAUDE_MODEL') ?: ($GLOBALS['STUDIO_CFG']['claude_model'] ?? ''))); }
