import path from 'node:path';

/** Backend work phases used to keep one mutation batch coherent. */
export type BackendPhase =
    | 'module-contract'
    | 'dto-types'
    | 'object-store'
    | 'service'
    | 'controller'
    | 'api'
    | 'tests-openapi'
    | 'composition'
    | 'workspace'
    | 'unknown';

/** One backend file mutation classified for gate decisions. */
export interface BackendMutation {
    readonly file: string;
    readonly moduleName: string | null;
    readonly phase: BackendPhase;
    readonly uncertain?: boolean;
}

/** One parsed architecture-linter diagnostic. */
export interface BackendLintIssue {
    readonly ruleId: string;
    readonly file: string;
    readonly message: string;
}

/** Normalized result returned by the architecture-linter runner. */
export type BackendLintResult =
    | { readonly status: 'green'; readonly issues: readonly [] }
    | { readonly status: 'red'; readonly issues: readonly BackendLintIssue[] }
    | { readonly status: 'failed'; readonly reason: string };

/** Blocking result returned before a tool mutation. */
export interface GateDecision {
    readonly block: boolean;
    readonly reason?: string;
}

/** Executes the focused backend architecture linter. */
export interface BackendLintRunner {
    run(): BackendLintResult;
}

type RepairScope =
    | {
          readonly kind: 'module';
          readonly moduleName: string;
          readonly files: ReadonlySet<string>;
      }
    | {
          readonly kind: 'composition' | 'workspace';
          readonly files: ReadonlySet<string>;
      };

const MUTATION_LIMIT = 5;

/** Enforces bounded backend mutation batches around a focused lint runner. */
export class BackendLintGate {
    private readonly runner: BackendLintRunner;
    private initialized = false;
    private lintFresh = false;
    private mode: 'green' | 'repair' | 'failed' = 'failed';
    private mutationCount = 0;
    private currentMutation: BackendMutation | null = null;
    private repairScope: RepairScope | null = null;
    private lastSummary = 'not initialized';

    /** Creates one in-memory gate for a Little-Coder session. */
    public constructor(runner: BackendLintRunner) {
        this.runner = runner;
    }

    /** Initializes the session from the current project lint state. */
    public initialize(): string {
        if (!this.initialized) {
            this.applyLintResult(this.runner.run());
            this.initialized = true;
        }
        return this.lastSummary;
    }

    /** Authorizes one backend mutation, running a mandatory gate when needed. */
    public authorizeMutation(mutation: BackendMutation): GateDecision {
        this.initialize();
        if (this.gateUnavailable()) {
            return this.blocked(this.lastSummary);
        }

        if (this.mustLintBefore(mutation)) {
            this.applyLintResult(this.runner.run());
        }
        if (this.gateUnavailable()) {
            return this.blocked(this.lastSummary);
        }
        if (this.mode === 'repair' && !this.repairAllows(mutation)) {
            return this.blocked(
                `${this.lastSummary} Stay inside the active repair scope.`,
            );
        }
        return { block: false };
    }

    /** Avoids stale control-flow narrowing across a synchronous lint run. */
    private gateUnavailable(): boolean {
        return this.mode === 'failed';
    }

    /** Records one successful mutation after its tool result returns. */
    public recordSuccessfulMutation(mutation: BackendMutation): void {
        this.currentMutation = mutation;
        this.mutationCount += 1;
        this.lintFresh = false;
        if (mutation.uncertain) {
            this.mutationCount = MUTATION_LIMIT;
        }
    }

    /** Requires a current green architecture result before root Verify. */
    public authorizeVerify(): GateDecision {
        this.initialize();
        if (!this.lintFresh || this.mode !== 'green') {
            this.applyLintResult(this.runner.run());
        }
        return this.mode === 'green'
            ? { block: false }
            : this.blocked(
                  `${this.lastSummary} Root Verify requires a current green backend gate.`,
              );
    }

    /** Returns a terse status suitable for Little-Coder context. */
    public status(): string {
        this.initialize();
        return (
            `${this.lastSummary}; mutations ${this.mutationCount}/` +
            `${MUTATION_LIMIT}`
        );
    }

    /** Determines whether a boundary or mutation budget requires linting. */
    private mustLintBefore(mutation: BackendMutation): boolean {
        if (this.mutationCount >= MUTATION_LIMIT) {
            return true;
        }
        if (!this.currentMutation || this.mutationCount === 0) {
            return false;
        }
        return (
            this.currentMutation.moduleName !== mutation.moduleName ||
            this.currentMutation.phase !== mutation.phase
        );
    }

    /** Applies one runner result and resets the current mutation batch. */
    private applyLintResult(result: BackendLintResult): void {
        this.mutationCount = 0;
        this.currentMutation = null;
        if (result.status === 'green') {
            this.mode = 'green';
            this.lintFresh = true;
            this.repairScope = null;
            this.lastSummary = 'Backend gate green';
            return;
        }
        if (result.status === 'failed') {
            this.mode = 'failed';
            this.lintFresh = false;
            this.repairScope = null;
            this.lastSummary = `Backend gate unavailable: ${result.reason}`;
            return;
        }

        this.mode = 'repair';
        this.lintFresh = true;
        this.repairScope = this.createRepairScope(result.issues);
        const first = result.issues[0];
        this.lastSummary =
            `Backend gate red: [${first.ruleId}] ${first.file}`;
    }

    /** Builds a repair scope from the first root-cause area. */
    private createRepairScope(
        issues: readonly BackendLintIssue[],
    ): RepairScope {
        const first = classifyBackendPath(issues[0].file);
        if (first.moduleName) {
            return {
                kind: 'module',
                moduleName: first.moduleName,
                files: new Set(
                    issues
                        .filter(
                            (issue) =>
                                classifyBackendPath(issue.file).moduleName ===
                                first.moduleName,
                        )
                        .map((issue) => normalizeProjectPath(issue.file)),
                ),
            };
        }
        const kind =
            first.phase === 'composition' ? 'composition' : 'workspace';
        return {
            kind,
            files: new Set(
                issues
                    .filter(
                        (issue) => {
                            const candidate = classifyBackendPath(issue.file);
                            return (
                                candidate.moduleName === null &&
                                (kind === 'composition'
                                    ? candidate.phase === 'composition'
                                    : candidate.phase !== 'composition')
                            );
                        },
                    )
                    .map((issue) => normalizeProjectPath(issue.file)),
            ),
        };
    }

    /** Allows only changes capable of repairing the active root-cause area. */
    private repairAllows(mutation: BackendMutation): boolean {
        if (!this.repairScope) {
            return false;
        }
        if (this.repairScope.kind === 'module') {
            return (
                mutation.moduleName === this.repairScope.moduleName ||
                mutation.phase === 'tests-openapi'
            );
        }
        return this.repairScope.files.has(
            normalizeProjectPath(mutation.file),
        );
    }

    /** Creates a stable blocked response. */
    private blocked(reason: string): GateDecision {
        return { block: true, reason };
    }
}

/** Classifies a project-relative path into its backend work area. */
export function classifyBackendPath(file: string): BackendMutation {
    const normalized = normalizeProjectPath(file);
    const moduleMatch = normalized.match(
        /^code\/backend\/src\/module\/([^/]+)\/(.+)$/u,
    );
    if (moduleMatch) {
        return {
            file: normalized,
            moduleName: moduleMatch[1],
            phase: modulePhase(moduleMatch[2]),
        };
    }
    if (
        normalized.startsWith('code/backend/test/') ||
        normalized.startsWith('code/backend/openapi/')
    ) {
        return {
            file: normalized,
            moduleName: null,
            phase: 'tests-openapi',
        };
    }
    if (
        /^code\/backend\/src\/(?:index|cli|module\.registry|module\.catalog)\.ts$/u.test(
            normalized,
        )
    ) {
        return {
            file: normalized,
            moduleName: null,
            phase: 'composition',
        };
    }
    return {
        file: normalized,
        moduleName: null,
        phase: normalized.startsWith('code/backend/')
            ? 'workspace'
            : 'unknown',
    };
}

/** Normalizes absolute or platform-specific project paths. */
export function normalizeProjectPath(file: string): string {
    return path.normalize(file).split(path.sep).join('/').replace(/^\.\//u, '');
}

/** Maps one module-relative file to its architecture phase. */
function modulePhase(relativeFile: string): BackendPhase {
    const segment = relativeFile.split('/')[0];
    if (
        ['index.ts', 'interfaces.ts', 'constants.ts'].includes(segment)
    ) {
        return 'module-contract';
    }
    if (segment === 'types.ts' || segment === 'dto') {
        return 'dto-types';
    }
    if (segment === 'object' || segment === 'store') {
        return 'object-store';
    }
    if (segment === 'service') {
        return 'service';
    }
    if (segment === 'controller') {
        return 'controller';
    }
    if (segment === 'api') {
        return 'api';
    }
    return 'unknown';
}
