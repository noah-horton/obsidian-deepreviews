import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { obsidianCliExecutable } from './obsidian-cli';

export interface AgentSettings {
  agent: 'codex' | 'claude' | 'custom';
  model: string;
  executable: string;
  customArgs: string;
  allowVerification: boolean;
  timeoutMinutes: number;
}
export const DEFAULT_SETTINGS: AgentSettings = {
  agent: 'codex', model: '', executable: '', customArgs: '[]', allowVerification: false, timeoutMinutes: 10
};
export interface AgentVariables { vault: string; file: string; promptFile: string }
export function agentCommand(settings: AgentSettings, vars: AgentVariables): { executable: string; args: string[] } {
  const executable = settings.executable.trim() || (settings.agent === 'custom' ? '' : settings.agent);
  if (!executable || executable.includes('\0')) throw new Error('Set a valid agent executable in DeepReviews settings.');
  const model = settings.model.trim();
  if (model.includes('\0') || model.startsWith('-')) throw new Error('Set a valid review model name in DeepReviews settings.');
  const modelArgs = model ? ['--model', model] : [];
  if (settings.agent === 'codex') {
    return { executable, args: ['exec', '--sandbox', 'danger-full-access', '--skip-git-repo-check', '--color', 'never', ...modelArgs, '-'] };
  }
  if (settings.agent === 'claude') {
    return { executable, args: ['--print', '--output-format', 'text', '--permission-mode', 'acceptEdits', ...modelArgs] };
  }
  const parsed: unknown = JSON.parse(settings.customArgs);
  if (!Array.isArray(parsed) || !parsed.every(x => typeof x === 'string' && !x.includes('\0'))) {
    throw new Error('Custom arguments must be a JSON array of strings.');
  }
  const values = { ...vars, model };
  const args = (parsed as string[]).map(arg => arg.replace(/\{(vault|file|promptFile|model)\}/g, (_: string, key: keyof typeof values) => values[key]));
  return { executable, args };
}

export interface AgentResult { stdout: string; stderr: string; exitCode: number | null; status: 'completed' | 'failed' | 'cancelled' | 'timed-out'; }
export interface AgentRun { result: Promise<AgentResult>; cancel: () => void }
const MAX_OUTPUT = 1_000_000;
const tail = (value: string): string => value.length > MAX_OUTPUT ? '[Earlier output truncated]\n' + value.slice(-MAX_OUTPUT) : value;
export function agentSearchPath(path = process.env.PATH ?? '', home = homedir(), platform = process.platform): string {
  return [path, join(home, '.local/bin'), join(home, '.npm-global/bin'), '/opt/homebrew/bin', '/usr/local/bin',
    ...(platform === 'darwin' ? ['/Applications/Codex.app/Contents/Resources', join(home, 'Applications/Codex.app/Contents/Resources')] : [])
  ].join(delimiter);
}

export function agentSpawnOptions(cwd: string): SpawnOptions {
  return {
    cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
    env: { ...process.env, PATH: agentSearchPath() }
  };
}

export interface DependencyCheck { name: string; status: 'passed' | 'failed' | 'unavailable'; message: string }

interface CommandCheck { ok: boolean; detail: string }
const CHECK_TIMEOUT = 10_000;
const CHECK_OUTPUT_LIMIT = 4_000;

function runCheck(executable: string, args: string[], cwd: string): Promise<CommandCheck> {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(executable, args, {
        ...agentSpawnOptions(cwd),
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      resolve({ ok: false, detail: String(error) });
      return;
    }
    let output = '';
    let settled = false;
    const finish = (result: CommandCheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const append = (chunk: string | Buffer) => { output = (output + String(chunk)).slice(-CHECK_OUTPUT_LIMIT); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.once('error', error => finish({ ok: false, detail: error.message }));
    child.once('close', code => finish({ ok: code === 0, detail: output.trim() || (code === 0 ? 'Command completed.' : `Exited with code ${code ?? 'unknown'}.`) }));
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, detail: `Timed out after ${CHECK_TIMEOUT / 1000} seconds.` });
    }, CHECK_TIMEOUT);
  });
}

function shortened(detail: string): string {
  const cleaned = detail.replace(/\s+/g, ' ').trim();
  return cleaned.length > 280 ? `${cleaned.slice(0, 277)}...` : cleaned;
}

export async function testDependencies(settings: AgentSettings, vaultPath = process.cwd()): Promise<DependencyCheck[]> {
  const executable = settings.executable.trim() || (settings.agent === 'custom' ? '' : settings.agent);
  const checks: DependencyCheck[] = [];

  let cliAvailable = false;
  if (!executable) {
    checks.push({ name: 'Selected CLI', status: 'failed', message: 'Set an executable path for the custom CLI.' });
  } else {
    const result = await runCheck(executable, ['--version'], vaultPath);
    cliAvailable = result.ok;
    checks.push({
      name: 'Selected CLI', status: result.ok ? 'passed' : 'failed',
      message: result.ok ? `${executable} responded to --version.` : `Could not run ${executable} --version: ${shortened(result.detail)}`
    });
  }

  if (settings.agent === 'custom') {
    checks.push({ name: 'CLI sign-in', status: 'unavailable', message: 'Custom CLIs have no standard sign-in status command, so login could not be checked.' });
  } else if (!cliAvailable) {
    checks.push({ name: 'CLI sign-in', status: 'failed', message: `Could not check sign-in because the selected ${settings.agent === 'codex' ? 'Codex' : 'Claude'} CLI is not callable.` });
  } else {
    const args = settings.agent === 'codex' ? ['login', 'status'] : ['auth', 'status'];
    const result = await runCheck(executable, args, vaultPath);
    checks.push({
      name: 'CLI sign-in', status: result.ok ? 'passed' : 'failed',
      message: result.ok ? `${settings.agent === 'codex' ? 'Codex' : 'Claude'} CLI is signed in.` : `Sign-in check failed: ${shortened(result.detail)}`
    });
  }

  const obsidianExecutable = obsidianCliExecutable();
  const obsidian = await runCheck(obsidianExecutable, ['help', 'rename'], vaultPath);
  checks.push({
    name: 'Obsidian CLI', status: obsidian.ok ? 'passed' : 'failed',
    message: obsidian.ok ? `${obsidianExecutable} responded to help rename.` : `The Obsidian CLI is not callable at ${obsidianExecutable}: ${shortened(obsidian.detail)}`
  });
  return checks;
}

export function startAgent(settings: AgentSettings, vars: AgentVariables, prompt: string, onOutput: (text: string, stderr: boolean) => void): AgentRun {
  const { executable, args } = agentCommand(settings, vars);
  let child: ChildProcessWithoutNullStreams;
  let stopped: 'cancelled' | 'timed-out' | undefined;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const signal = (force: boolean) => {
    if (!child || settled) return;
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
      else child.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch { child.kill(force ? 'SIGKILL' : 'SIGTERM'); }
  };
  const stop = (reason: 'cancelled' | 'timed-out') => {
    if (settled || stopped) return;
    stopped = reason;
    signal(false);
    forceKill = setTimeout(() => signal(true), 2000);
  };
  const result = new Promise<AgentResult>((resolve) => {
    child = spawn(executable, args, {
      ...agentSpawnOptions(vars.vault), stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    let launchFailed = false;
    const diagnostic = (message: string) => { stderr = tail(stderr + message); onOutput(message, true); };
    const timeout = setTimeout(() => stop('timed-out'), Math.min(120, Math.max(1, settings.timeoutMinutes || 10)) * 60_000);
    const cleanup = () => { settled = true; clearTimeout(timeout); clearTimeout(forceKill); };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout = tail(stdout + chunk); onOutput(chunk, false); });
    child.stderr.on('data', diagnostic);
    child.once('error', error => {
      launchFailed = true;
      diagnostic(`\nCould not launch ${executable}: ${error.message}\nCommand: ${JSON.stringify([executable, ...args])}\nWorking directory: ${vars.vault}\nSearch PATH: ${agentSearchPath()}\nSet a valid executable path in DeepReviews settings. If the executable exists, check the working directory and executable permissions.\n`);
    });
    // A CLI may exit (e.g. authentication failure) before consuming stdin.
    child.stdin.on('error', error => diagnostic(`\nPrompt input: ${error.message}\n`));
    child.once('close', (code, signal) => {
      if (signal) diagnostic(`\nAgent terminated by signal ${signal}.\n`);
      cleanup();
      resolve({ stdout, stderr, exitCode: launchFailed ? null : code, status: stopped ?? (!launchFailed && code === 0 ? 'completed' : 'failed') });
    });
    child.stdin.end(prompt, 'utf8');
  });
  return { result, cancel: () => stop('cancelled') };
}
