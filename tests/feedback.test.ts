import { expect, test } from 'bun:test';
import { reviewFeedback } from '../src/feedback';
import type { AgentResult } from '../src/agent';

const result = (stdout: string, status: AgentResult['status'] = 'completed'): AgentResult => ({ stdout, status, stderr: 'ordinary CLI diagnostics', exitCode: status === 'completed' ? 0 : 1 });
test('clean reviews and successfully repaired notes stay in the footer despite diagnostics', () => {
  expect(reviewFeedback(result('PASS — No issues found.')).issue).toBe(false);
  expect(reviewFeedback(result('PASS\n- Fixed: corrected 1+3=3 to 1+3=4.'))).toEqual({ text: 'PASS\n- Fixed: corrected 1+3=3 to 1+3=4.', issue: false });
  expect(reviewFeedback(result('**Overall verdict: PASS**')).issue).toBe(false);
});
test('unresolved findings, incomplete reviews, and malformed or absent output need attention', () => {
  for (const output of ['FAIL\n- Unresolved: missing source.', 'INCOMPLETE\n- Unresolved: check not run.', '', 'No verdict here', 'PASS\n- Unresolved: missing source.', 'PASSING is not a verdict', 'INCOMPLETE\nQuoted example: PASS']) {
    expect(reviewFeedback(result(output)).issue).toBe(true);
  }
});
test('failure, timeout, and cancellation override any PASS text', () => {
  for (const status of ['failed', 'timed-out', 'cancelled'] as const) {
    const feedback = reviewFeedback(result('PASS', status));
    expect(feedback.issue).toBe(true);
    expect(feedback.text).toContain(status);
  }
});
