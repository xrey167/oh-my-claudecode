import { describe, it, expect } from 'vitest';
import { normalizeAutoresearchClaudeArgs, parseAutoresearchArgs, AUTORESEARCH_HELP } from '../autoresearch.js';

describe('normalizeAutoresearchClaudeArgs', () => {
  it('adds permission bypass by default for autoresearch workers', () => {
    expect(normalizeAutoresearchClaudeArgs(['--model', 'opus'])).toEqual(['--model', 'opus', '--dangerously-skip-permissions']);
  });

  it('deduplicates explicit bypass flags', () => {
    expect(normalizeAutoresearchClaudeArgs(['--dangerously-skip-permissions'])).toEqual(['--dangerously-skip-permissions']);
  });
});

describe('parseAutoresearchArgs', () => {
  it('defaults to interview-first guided mode with no args', () => {
    const parsed = parseAutoresearchArgs([]);
    expect(parsed.guided).toBe(true);
    expect(parsed.missionDir).toBeNull();
    expect(parsed.runId).toBeNull();
    expect(parsed.claudeArgs).toEqual([]);
  });

  it('parses bypass mode with mission and sandbox flags', () => {
    const parsed = parseAutoresearchArgs(['--mission', 'Improve onboarding', '--sandbox', 'npm run eval']);
    expect(parsed.missionDir).toBeNull();
    expect(parsed.runId).toBeNull();
    expect(parsed.missionText).toBe('Improve onboarding');
    expect(parsed.sandboxCommand).toBe('npm run eval');
    expect(parsed.keepPolicy).toBeUndefined();
    expect(parsed.slug).toBeUndefined();
  });

  it('parses bypass mode with optional keep-policy and slug', () => {
    const parsed = parseAutoresearchArgs([
      '--mission=Improve onboarding',
      '--sandbox=npm run eval',
      '--keep-policy=pass_only',
      '--slug',
      'My Mission',
    ]);
    expect(parsed.missionText).toBe('Improve onboarding');
    expect(parsed.sandboxCommand).toBe('npm run eval');
    expect(parsed.keepPolicy).toBe('pass_only');
    expect(parsed.slug).toBe('my-mission');
  });

  it('rejects mission without sandbox', () => {
    expect(() => parseAutoresearchArgs(['--mission', 'Improve onboarding'])).toThrow(/Both --mission and --sandbox are required together/);
  });

  it('rejects sandbox without mission', () => {
    expect(() => parseAutoresearchArgs(['--sandbox', 'npm run eval'])).toThrow(/Both --mission and --sandbox are required together/);
  });

  it('rejects positional arguments in bypass mode', () => {
    expect(() => parseAutoresearchArgs(['--mission', 'x', '--sandbox', 'y', 'missions/demo'])).toThrow(/Positional arguments are not supported/);
  });

  it('parses mission-dir as first positional argument', () => {
    const parsed = parseAutoresearchArgs(['/path/to/mission']);
    expect(parsed.missionDir).toBe('/path/to/mission');
    expect(parsed.runId).toBeNull();
    expect(parsed.claudeArgs).toEqual([]);
  });

  it('parses --resume with run-id', () => {
    const parsed = parseAutoresearchArgs(['--resume', 'my-run-id']);
    expect(parsed.missionDir).toBeNull();
    expect(parsed.runId).toBe('my-run-id');
  });

  it('parses --resume= with run-id', () => {
    const parsed = parseAutoresearchArgs(['--resume=my-run-id']);
    expect(parsed.missionDir).toBeNull();
    expect(parsed.runId).toBe('my-run-id');
  });

  it('parses --help', () => {
    const parsed = parseAutoresearchArgs(['--help']);
    expect(parsed.missionDir).toBe('--help');
    expect(AUTORESEARCH_HELP).toContain('research interview + background launch');
    expect(AUTORESEARCH_HELP).toMatch(/Partial bypass is invalid/);
  });

  it('parses init subcommand', () => {
    const parsed = parseAutoresearchArgs(['init', '--topic', 'my topic']);
    expect(parsed.guided).toBe(true);
    expect(parsed.initArgs).toEqual(['--topic', 'my topic']);
  });

  it('passes extra args as claudeArgs', () => {
    const parsed = parseAutoresearchArgs(['/path/to/mission', '--model', 'opus']);
    expect(parsed.missionDir).toBe('/path/to/mission');
    expect(parsed.claudeArgs).toEqual(['--model', 'opus']);
  });

  it('rejects flags before mission-dir', () => {
    expect(() => parseAutoresearchArgs(['--unknown-flag'])).toThrow(/mission-dir must be the first positional argument/);
  });
});
