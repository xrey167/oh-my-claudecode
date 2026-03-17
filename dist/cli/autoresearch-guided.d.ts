import { type AutoresearchKeepPolicy } from '../autoresearch/contracts.js';
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
export declare function initAutoresearchMission(opts: InitAutoresearchOptions): Promise<InitAutoresearchResult>;
export declare function parseInitArgs(args: readonly string[]): Partial<InitAutoresearchOptions>;
export declare function guidedAutoresearchSetup(repoRoot: string): Promise<InitAutoresearchResult>;
export declare function checkTmuxAvailable(): boolean;
export declare function spawnAutoresearchTmux(missionDir: string, slug: string): void;
//# sourceMappingURL=autoresearch-guided.d.ts.map