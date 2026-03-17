import { createInterface } from 'readline/promises';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join, relative, resolve } from 'path';
import { type AutoresearchKeepPolicy, parseSandboxContract, slugifyMissionName } from '../autoresearch/contracts.js';
import { buildTmuxShellCommand, isTmuxAvailable, wrapWithLoginShell } from './tmux-utils.js';

export interface InitAutoresearchOptions {
  topic: string;
  evaluatorCommand: string;
  keepPolicy?: AutoresearchKeepPolicy;
  slug: string;
  repoRoot: string;
}

export interface InitAutoresearchResult {
  missionDir: string;
  slug: string;
}

function buildMissionContent(topic: string): string {
  return `# Mission\n\n${topic}\n`;
}

function buildSandboxContent(evaluatorCommand: string, keepPolicy?: AutoresearchKeepPolicy): string {
  // Strip newlines/carriage returns to prevent YAML injection
  const safeCommand = evaluatorCommand.replace(/[\r\n]/g, ' ').trim();
  const keepPolicyLine = keepPolicy ? `\n  keep_policy: ${keepPolicy}` : '';
  return `---\nevaluator:\n  command: ${safeCommand}\n  format: json${keepPolicyLine}\n---\n`;
}

export async function initAutoresearchMission(opts: InitAutoresearchOptions): Promise<InitAutoresearchResult> {
  const missionsRoot = join(opts.repoRoot, 'missions');
  const missionDir = join(missionsRoot, opts.slug);

  // Defense-in-depth: ensure slug does not escape missions/ directory
  const rel = relative(missionsRoot, missionDir);
  if (!rel || rel.startsWith('..') || resolve(rel) === resolve(missionDir)) {
    throw new Error('Invalid slug: resolves outside missions/ directory.');
  }

  if (existsSync(missionDir)) {
    throw new Error(`Mission directory already exists: ${missionDir}`);
  }

  await mkdir(missionDir, { recursive: true });

  const missionContent = buildMissionContent(opts.topic);
  const sandboxContent = buildSandboxContent(opts.evaluatorCommand, opts.keepPolicy);

  // Validate before writing — ensures contract fidelity
  parseSandboxContract(sandboxContent);

  await writeFile(join(missionDir, 'mission.md'), missionContent, 'utf-8');
  await writeFile(join(missionDir, 'sandbox.md'), sandboxContent, 'utf-8');

  return { missionDir, slug: opts.slug };
}

export function parseInitArgs(args: readonly string[]): Partial<InitAutoresearchOptions> {
  const result: Partial<InitAutoresearchOptions> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if ((arg === '--topic') && next) {
      result.topic = next;
      i++;
    } else if ((arg === '--evaluator') && next) {
      result.evaluatorCommand = next;
      i++;
    } else if ((arg === '--keep-policy') && next) {
      const normalized = next.trim().toLowerCase();
      if (normalized !== 'pass_only' && normalized !== 'score_improvement') {
        throw new Error('--keep-policy must be one of: score_improvement, pass_only');
      }
      result.keepPolicy = normalized;
      i++;
    } else if ((arg === '--slug') && next) {
      result.slug = slugifyMissionName(next);
      i++;
    } else if (arg.startsWith('--topic=')) {
      result.topic = arg.slice('--topic='.length);
    } else if (arg.startsWith('--evaluator=')) {
      result.evaluatorCommand = arg.slice('--evaluator='.length);
    } else if (arg.startsWith('--keep-policy=')) {
      const normalized = arg.slice('--keep-policy='.length).trim().toLowerCase();
      if (normalized !== 'pass_only' && normalized !== 'score_improvement') {
        throw new Error('--keep-policy must be one of: score_improvement, pass_only');
      }
      result.keepPolicy = normalized;
    } else if (arg.startsWith('--slug=')) {
      result.slug = slugifyMissionName(arg.slice('--slug='.length));
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown init flag: ${arg.split('=')[0]}`);
    }
  }
  return result;
}

export async function guidedAutoresearchSetup(repoRoot: string): Promise<InitAutoresearchResult> {
  if (!process.stdin.isTTY) {
    throw new Error('Guided setup requires an interactive terminal. Use --mission, --sandbox, --keep-policy, and --slug flags for non-interactive use.');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const topic = await rl.question('Research mission (what should autoresearch improve or prove?)\n> ');
    if (!topic.trim()) {
      throw new Error('Research mission is required.');
    }

    const evaluatorCommand = await rl.question('\nSandbox/evaluator command (must print {pass: boolean, score?: number} JSON)\n> ');
    if (!evaluatorCommand.trim()) {
      throw new Error('Sandbox/evaluator command is required.');
    }

    const keepPolicyInput = await rl.question('\nKeep policy [Enter for runtime default / score_improvement / pass_only]\n> ');
    const normalizedKeepPolicyInput = keepPolicyInput.trim().toLowerCase();
    let keepPolicy: AutoresearchKeepPolicy | undefined;
    if (normalizedKeepPolicyInput) {
      if (normalizedKeepPolicyInput !== 'score_improvement' && normalizedKeepPolicyInput !== 'pass_only') {
        throw new Error('--keep-policy must be one of: score_improvement, pass_only');
      }
      keepPolicy = normalizedKeepPolicyInput;
    }

    const suggestedSlug = slugifyMissionName(topic);
    const slugInput = await rl.question(`\nMission slug (default: ${suggestedSlug})\n> `);
    const slug = slugInput.trim() ? slugifyMissionName(slugInput.trim()) : suggestedSlug;

    return initAutoresearchMission({
      topic: topic.trim(),
      evaluatorCommand: evaluatorCommand.trim(),
      keepPolicy,
      slug,
      repoRoot,
    });
  } finally {
    rl.close();
  }
}

export function checkTmuxAvailable(): boolean {
  return isTmuxAvailable();
}

function resolveMissionRepoRoot(missionDir: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: missionDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function assertTmuxSessionAvailable(sessionName: string): void {
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'ignore' });
  } catch {
    throw new Error(
      `tmux session "${sessionName}" did not stay available after launch. `
      + 'Check the mission command, login-shell environment, and tmux logs, then try again.',
    );
  }
}

export function spawnAutoresearchTmux(missionDir: string, slug: string): void {
  if (!checkTmuxAvailable()) {
    throw new Error('tmux is required for background autoresearch execution. Install tmux and try again.');
  }

  const sessionName = `omc-autoresearch-${slug}`;

  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'ignore' });
    throw new Error(
      `tmux session "${sessionName}" already exists.\n`
      + `  Attach: tmux attach -t ${sessionName}\n`
      + `  Kill:   tmux kill-session -t ${sessionName}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already exists')) {
      throw error;
    }
  }

  const repoRoot = resolveMissionRepoRoot(missionDir);
  const omcPath = resolve(join(__dirname, '..', '..', 'bin', 'omc.js'));
  const command = buildTmuxShellCommand(process.execPath, [omcPath, 'autoresearch', missionDir]);
  const wrappedCommand = wrapWithLoginShell(command);

  execFileSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', repoRoot, wrappedCommand], { stdio: 'ignore' });
  assertTmuxSessionAvailable(sessionName);

  console.log('\nAutoresearch launched in background tmux session.');
  console.log(`  Session:  ${sessionName}`);
  console.log(`  Mission:  ${missionDir}`);
  console.log(`  Attach:   tmux attach -t ${sessionName}`);
}
