import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

vi.mock('child_process', () => ({
  spawnSync: vi.fn()
}));

const mockSpawnSync = vi.mocked(spawnSync);

function dockerInspectResult(payload: unknown): string {
  return JSON.stringify([payload]);
}

describe('devcontainer LSP helpers', () => {
  let workspaceRoot: string;
  let configFilePath: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'omc-devcontainer-'));
    mkdirSync(join(workspaceRoot, '.devcontainer'), { recursive: true });
    configFilePath = join(workspaceRoot, '.devcontainer', 'devcontainer.json');
    writeFileSync(configFilePath, JSON.stringify({ workspaceFolder: '/workspaces/app' }));
    delete process.env.OMC_LSP_CONTAINER_ID;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
    delete process.env.OMC_LSP_CONTAINER_ID;
  });

  it('prefers explicit container override and translates host/container paths and URIs', async () => {
    process.env.OMC_LSP_CONTAINER_ID = 'forced-container';

    mockSpawnSync.mockImplementation((command: string, args: ReadonlyArray<string> | undefined) => {
      expect(command).toBe('docker');
      if (args?.[0] === 'inspect') {
        return {
          status: 0,
          stdout: dockerInspectResult({
            Id: 'forced-container',
            State: { Running: true },
            Config: { Labels: {} },
            Mounts: [{ Source: workspaceRoot, Destination: '/workspaces/app' }]
          })
        } as ReturnType<typeof spawnSync>;
      }

      throw new Error(`Unexpected docker args: ${args}`);
    });

    const mod = await import('../devcontainer.js');
    const context = mod.resolveDevContainerContext(workspaceRoot);

    expect(context).toEqual({
      containerId: 'forced-container',
      hostWorkspaceRoot: workspaceRoot,
      containerWorkspaceRoot: '/workspaces/app',
      configFilePath
    });

    const hostFile = join(workspaceRoot, 'src', 'index.ts');
    expect(mod.hostPathToContainerPath(hostFile, context)).toBe('/workspaces/app/src/index.ts');
    expect(mod.containerPathToHostPath('/workspaces/app/src/index.ts', context)).toBe(hostFile);
    expect(mod.hostUriToContainerUri(pathToFileURL(hostFile).href, context)).toBe('file:///workspaces/app/src/index.ts');
    expect(mod.containerUriToHostUri('file:///workspaces/app/src/index.ts', context)).toBe(pathToFileURL(hostFile).href);
  });

  it('matches running devcontainer by labels and nested mount', async () => {
    const mountedParent = join(workspaceRoot, '..');

    mockSpawnSync.mockImplementation((command: string, args: ReadonlyArray<string> | undefined) => {
      expect(command).toBe('docker');
      if (args?.[0] === 'ps') {
        return { status: 0, stdout: 'abc123\n' } as ReturnType<typeof spawnSync>;
      }

      if (args?.[0] === 'inspect') {
        return {
          status: 0,
          stdout: dockerInspectResult({
            Id: 'abc123',
            State: { Running: true },
            Config: {
              Labels: {
                'devcontainer.local_folder': workspaceRoot,
                'devcontainer.config_file': configFilePath
              }
            },
            Mounts: [{ Source: mountedParent, Destination: '/workspaces' }]
          })
        } as ReturnType<typeof spawnSync>;
      }

      throw new Error(`Unexpected docker args: ${args}`);
    });

    const mod = await import('../devcontainer.js');
    const context = mod.resolveDevContainerContext(workspaceRoot);

    expect(context?.containerId).toBe('abc123');
    expect(context?.containerWorkspaceRoot).toBe(`/workspaces/${workspaceRoot.split('/').pop()}`);
  });

  it('finds ancestor devcontainer config for nested workspace roots', async () => {
    const nestedWorkspaceRoot = join(workspaceRoot, 'packages', 'app');
    mkdirSync(nestedWorkspaceRoot, { recursive: true });

    mockSpawnSync.mockImplementation((command: string, args: ReadonlyArray<string> | undefined) => {
      expect(command).toBe('docker');
      if (args?.[0] === 'ps') {
        return { status: 0, stdout: 'nested123\n' } as ReturnType<typeof spawnSync>;
      }

      if (args?.[0] === 'inspect') {
        return {
          status: 0,
          stdout: dockerInspectResult({
            Id: 'nested123',
            State: { Running: true },
            Config: {
              Labels: {
                'devcontainer.local_folder': workspaceRoot,
                'devcontainer.config_file': configFilePath
              }
            },
            Mounts: [{ Source: workspaceRoot, Destination: '/workspaces/app' }]
          })
        } as ReturnType<typeof spawnSync>;
      }

      throw new Error(`Unexpected docker args: ${args}`);
    });

    const mod = await import('../devcontainer.js');
    const context = mod.resolveDevContainerContext(nestedWorkspaceRoot);

    expect(context).toEqual({
      containerId: 'nested123',
      hostWorkspaceRoot: nestedWorkspaceRoot,
      containerWorkspaceRoot: '/workspaces/app/packages/app',
      configFilePath
    });
  });

  it('returns null when no matching running devcontainer exists', async () => {
    rmSync(join(workspaceRoot, '.devcontainer'), { recursive: true, force: true });

    mockSpawnSync.mockImplementation((command: string, args: ReadonlyArray<string> | undefined) => {
      expect(command).toBe('docker');
      if (args?.[0] === 'ps') {
        return { status: 0, stdout: 'abc123\n' } as ReturnType<typeof spawnSync>;
      }

      if (args?.[0] === 'inspect') {
        return {
          status: 0,
          stdout: dockerInspectResult({
            Id: 'abc123',
            State: { Running: true },
            Config: { Labels: {} },
            Mounts: [{ Source: '/tmp/other', Destination: '/workspaces/other' }]
          })
        } as ReturnType<typeof spawnSync>;
      }

      throw new Error(`Unexpected docker args: ${args}`);
    });

    const mod = await import('../devcontainer.js');
    expect(mod.resolveDevContainerContext(workspaceRoot)).toBeNull();
  });
});
