import { expect, test } from 'bun:test';
import { agentCommand, agentSearchPath, DEFAULT_SETTINGS, startAgent } from '../src/agent';
import { tmpdir } from 'node:os';
import { delimiter } from 'node:path';
const vars = { vault: tmpdir(), file: '/vault/$(touch hacked); "note".md', promptFile: '/vault with spaces/prompt.md' };
test('Codex uses stdin, allows Obsidian CLI access, and permits non-git vaults', () => {
  expect(agentCommand(DEFAULT_SETTINGS, vars)).toEqual({ executable: 'codex', args: ['exec', '--sandbox', 'danger-full-access', '--skip-git-repo-check', '--color', 'never', '-'] });
});
test('explicit model names are passed literally to Codex and Claude', () => {
  expect(agentCommand({ ...DEFAULT_SETTINGS, model: 'gpt-6-sol' }, vars).args).toEqual([
    'exec', '--sandbox', 'danger-full-access', '--skip-git-repo-check', '--color', 'never', '--model', 'gpt-6-sol', '-'
  ]);
  expect(agentCommand({ ...DEFAULT_SETTINGS, agent: 'claude', model: 'sonnet' }, vars)).toEqual({
    executable: 'claude', args: ['--print', '--output-format', 'text', '--permission-mode', 'acceptEdits', '--model', 'sonnet']
  });
  expect(agentCommand({ ...DEFAULT_SETTINGS, agent: 'claude' }, vars).args).not.toContain('--model');
  expect(agentCommand({ ...DEFAULT_SETTINGS, model: 'future-model-from-settings' }, vars).args).toContain('future-model-from-settings');
});
test('custom substitutions remain single literal args and never become shell code', () => {
  expect(agentCommand({ ...DEFAULT_SETTINGS, agent: 'custom', executable: '/my path/cli', customArgs: '["{file}", "{promptFile}"]' }, vars).args).toEqual([vars.file, vars.promptFile]);
  expect(agentCommand({ ...DEFAULT_SETTINGS, agent: 'custom', model: 'future-model', executable: 'cli', customArgs: '["--model", "{model}"]' }, vars).args).toEqual(['--model', 'future-model']);
  expect(() => agentCommand({ ...DEFAULT_SETTINGS, agent: 'custom', executable: 'cli', customArgs: '"--print"' }, vars)).toThrow('JSON array');
});
test('launches real subprocess and streams full prompt through stdin', async () => {
  const output: string[] = [];
  const run = startAgent({ ...DEFAULT_SETTINGS, agent: 'custom', executable: process.execPath, customArgs: JSON.stringify(['-e', 'process.stdin.setEncoding("utf8");let p="";process.stdin.on("data",c=>p+=c);process.stdin.on("end",()=>{console.error("diagnostic");console.log(JSON.stringify({prompt:p,args:process.argv.slice(1),cwd:process.cwd()}));});', '{file}']) }, vars, 'Exact prompt\n"quotes" `backticks` $(literal) 日本語', text => output.push(text));
  const result = await run.result;
  expect(result.status).toBe('completed');
  const parsed = JSON.parse(result.stdout);
  expect(parsed.prompt).toBe('Exact prompt\n"quotes" `backticks` $(literal) 日本語');
  expect(parsed.args).toEqual([vars.file]);
  expect(result.stderr).toContain('diagnostic');
  expect(output.length).toBeGreaterThan(0);
});
test('nonzero exit and missing executable are actionable failures', async () => {
  const run = startAgent({ ...DEFAULT_SETTINGS, agent: 'custom', executable: process.execPath, customArgs: JSON.stringify(['-e', 'console.error("sign in first");process.exit(7)']) }, vars, '', () => {});
  expect(await run.result).toMatchObject({ status: 'failed', exitCode: 7, stderr: expect.stringContaining('sign in first') });
  const output: string[] = [];
  const missing = startAgent({ ...DEFAULT_SETTINGS, executable: '/no/such/deepreviews-cli' }, vars, '', (text, error) => { if (error) output.push(text); });
  const result = await missing.result;
  expect(result.status).toBe('failed');
  expect(result.exitCode).toBeNull();
  expect(result.stderr).toContain('Could not launch');
  expect(result.stderr).toContain('ENOENT');
  expect(result.stderr).toContain(`Working directory: ${vars.vault}`);
  expect(result.stderr).toContain('Search PATH:');
  expect(output.join('')).toBe(result.stderr);
});
test('macOS GUI search path includes the installed Codex app after existing CLI locations', () => {
  const paths = agentSearchPath('/usr/bin:/bin', '/Users/test', 'darwin').split(delimiter);
  expect(paths[0]).toBe('/usr/bin');
  expect(paths).toContain('/Applications/Codex.app/Contents/Resources');
  expect(paths).toContain('/Users/test/Applications/Codex.app/Contents/Resources');
  expect(paths.indexOf('/usr/local/bin')).toBeLessThan(paths.indexOf('/Applications/Codex.app/Contents/Resources'));
  expect(agentSearchPath('/usr/bin', '/home/test', 'linux')).not.toContain('Codex.app');
});
test('a missing working directory is included in launch diagnostics', async () => {
  const result = await startAgent({ ...DEFAULT_SETTINGS, executable: process.execPath }, { ...vars, vault: '/no/such/deepreviews-vault' }, '', () => {}).result;
  expect(result.status).toBe('failed');
  expect(result.stderr).toContain('Working directory: /no/such/deepreviews-vault');
});
test('cancellation stops a running agent', async () => {
  const run = startAgent({ ...DEFAULT_SETTINGS, agent: 'custom', executable: process.execPath, customArgs: '["-e", "setInterval(()=>{},1000)"]' }, vars, '', () => {});
  run.cancel();
  expect((await run.result).status).toBe('cancelled');
});
