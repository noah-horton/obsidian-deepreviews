import type { AgentResult } from './agent';
import type { ReviewFeedback } from './footer';

/** Exit success alone does not mean the agent fixed every issue. */
export function reviewFeedback(result: AgentResult): ReviewFeedback {
  const output = result.stdout.trim();
  const verdict = output.match(/^(?:#{1,6}\s+)?(?:\*\*)?(?:(?:Overall )?verdict:\s*)?(PASS|FAIL|INCOMPLETE)\b/i)?.[1]?.toUpperCase();
  const issue = result.status !== 'completed' || verdict !== 'PASS' || /^\s*(?:[-*]\s+)?(?:\*\*)?Unresolved:/im.test(output);
  const status = result.status === 'completed'
    ? (verdict ? '' : 'Review incomplete: no verdict received.')
    : `Review ${result.status} (exit ${result.exitCode ?? 'none'}).`;
  return { text: [status, output || 'No review output.'].filter(Boolean).join('\n\n'), issue };
}
