/** Suggestions only: model IDs are deliberately not an enum or validation allowlist.
 * Update this catalog independently of behavior tests. Checked 2026-09-26:
 * https://learn.chatgpt.com/docs/models
 * https://code.claude.com/docs/en/model-config
 * https://platform.claude.com/docs/en/about-claude/model-deprecations
 */
export interface ModelOption { id: string; label: string }
export const REVIEW_MODELS: Record<'codex' | 'claude', readonly ModelOption[]> = {
  codex: [
    { id: 'gpt-6-sol', label: 'GPT-6 Sol' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5.5', label: 'GPT-5.5' }
  ],
  claude: [
    { id: 'sonnet', label: 'Sonnet (latest)' },
    { id: 'opus', label: 'Opus (latest)' },
    { id: 'haiku', label: 'Haiku (latest)' },
    { id: 'fable', label: 'Fable (requires access)' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (requires access)' }
  ]
};
