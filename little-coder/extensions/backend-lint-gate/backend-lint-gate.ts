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

/** Result of the smallest compile or test check for one mutation. */
export type RepairCheckResult =
    | { readonly status: 'passed'; readonly summary: string }
    | { readonly status: 'failed'; readonly reason: string };

/** Runs the focused compile or test check selected for a mutation. */
export interface RepairCheckRunner {
    run(mutation: BackendMutation): RepairCheckResult;
}

/** First deterministic architecture cause currently assigned for repair. */
interface ActiveRepairCause extends BackendLintIssue {
    readonly allowedFiles: ReadonlySet<string>;
}

const MUTATION_LIMIT = 5;
const REPAIR_ATTEMPT_LIMIT = 2;
const PASSING_CHECK_RUNNER: RepairCheckRunner = {
    run: () => ({ status: 'passed', summary: 'focused check passed' }),
};

/** Enforces bounded backend mutation batches around a focused lint runner. */
export class BackendLintGate {
    private readonly runner: BackendLintRunner;
    private readonly checkRunner: RepairCheckRunner;
    private initialized = false;
    private lintFresh = false;
    private mode: 'green' | 'repair' | 'blocked' | 'failed' = 'failed';
    private mutationCount = 0;
    private currentMutation: BackendMutation | null = null;
    private pendingCheck: BackendMutation | null = null;
    private activeCause: ActiveRepairCause | null = null;
    private repairAttempts = 0;
    private lastCheck = 'not run';
    private lastSummary = 'not initialized';

    /** Creates one in-memory gate for a Little-Coder session. */
    public constructor(
        runner: BackendLintRunner,
        checkRunner: RepairCheckRunner = PASSING_CHECK_RUNNER,
    ) {
        this.runner = runner;
        this.checkRunner = checkRunner;
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

        if (this.pendingCheck) {
            this.runRepairCheckpoint(this.pendingCheck);
        }
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
        return this.mode === 'failed' || this.mode === 'blocked';
    }

    /** Records one successful mutation after its tool result returns. */
    public recordSuccessfulMutation(mutation: BackendMutation): void {
        this.currentMutation = mutation;
        this.pendingCheck = mutation;
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
            `${this.lastSummary}; attempts ${this.repairAttempts}/` +
            `${REPAIR_ATTEMPT_LIMIT}; mutations ${this.mutationCount}/` +
            `${MUTATION_LIMIT}; last check: ${this.lastCheck}`
        );
    }

    /** Returns the compact repair instruction injected into the agent. */
    // fallow-ignore-next-line unused-class-member -- Called by the dynamically loaded Little-Coder extension entry.
    public instruction(): string {
        this.initialize();
        if (!this.activeCause) {
            return this.status();
        }
        return (
            `${this.status()}. Active cause: [${this.activeCause.ruleId}] ` +
            `${this.activeCause.file}: ${this.activeCause.message} ` +
            `Allowed: ${[...this.activeCause.allowedFiles].join(', ')}. ` +
            'Fix only the active lint cause. Do not silence or approximate ' +
            'the rule. Do not use casts, widened return types, permissive ' +
            'assertions, placeholder values, or unrelated refactors. Run ' +
            'the required focused check immediately. Stop after two failed ' +
            'attempts and report the blocker tersely.'
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
        this.pendingCheck = null;
        if (result.status === 'green') {
            this.mode = 'green';
            this.lintFresh = true;
            this.activeCause = null;
            this.repairAttempts = 0;
            this.lastSummary = 'Backend gate green';
            return;
        }
        if (result.status === 'failed') {
            this.mode = 'failed';
            this.lintFresh = false;
            this.activeCause = null;
            this.lastSummary = `Backend gate unavailable: ${result.reason}`;
            return;
        }

        this.mode = 'repair';
        this.lintFresh = true;
        const first = result.issues[0];
        const previousKey = this.activeCause
            ? this.causeKey(this.activeCause)
            : null;
        this.activeCause = {
            ...first,
            allowedFiles: this.allowedRepairFiles(first),
        };
        if (
            previousKey !== null &&
            previousKey !== this.causeKey(this.activeCause)
        ) {
            this.repairAttempts = 0;
        }
        this.lastSummary =
            `Backend gate red: [${first.ruleId}] ${first.file}: ` +
            first.message;
    }

    /** Runs the focused check and architecture checkpoint after a mutation. */
    private runRepairCheckpoint(mutation: BackendMutation): void {
        this.pendingCheck = null;
        const check = this.checkRunner.run(mutation);
        this.lastCheck =
            check.status === 'passed' ? check.summary : check.reason;
        if (check.status === 'failed') {
            if (!this.activeCause) {
                this.mode = 'repair';
                this.lintFresh = false;
                this.activeCause = {
                    ruleId: 'FOCUSED_CHECK_FAILED',
                    file: mutation.file,
                    message:
                        `${check.reason}. Fix the new compile or test ` +
                        'failure in the mutated file.',
                    allowedFiles: new Set([
                        normalizeProjectPath(mutation.file),
                    ]),
                };
                this.lastSummary =
                    `Backend gate red: [FOCUSED_CHECK_FAILED] ` +
                    `${mutation.file}: ${check.reason}`;
            }
            this.registerFailedAttempt(
                `Focused check failed: ${check.reason}`,
            );
            return;
        }
        const previousKey = this.activeCause
            ? this.causeKey(this.activeCause)
            : null;
        const result = this.runner.run();
        this.applyLintResult(result);
        if (
            result.status === 'red' &&
            previousKey === this.causeKey(result.issues[0])
        ) {
            this.registerFailedAttempt('Active lint cause remains');
        }
    }

    /** Counts an ineffective repair and stops after the fixed limit. */
    private registerFailedAttempt(reason: string): void {
        this.repairAttempts += 1;
        this.lastSummary = `${this.lastSummary} ${reason}.`;
        if (this.repairAttempts >= REPAIR_ATTEMPT_LIMIT) {
            this.mode = 'blocked';
            this.lastSummary =
                `Backend gate blocked after ${REPAIR_ATTEMPT_LIMIT} ` +
                'ineffective repair attempts';
        }
    }

    /** Allows only files required by the single active root cause. */
    private repairAllows(mutation: BackendMutation): boolean {
        if (!this.activeCause) {
            return false;
        }
        const file = normalizeProjectPath(mutation.file);
        return [...this.activeCause.allowedFiles].some(
            (allowed) =>
                file === allowed ||
                file.startsWith(`${allowed.replace(/\/$/u, '')}/`),
        );
    }

    /** Computes the bounded file set for one architecture cause. */
    private allowedRepairFiles(issue: BackendLintIssue): ReadonlySet<string> {
        const file = normalizeProjectPath(issue.file);
        const classified = classifyBackendPath(file);
        const allowed = new Set([file]);
        if (!classified.moduleName) {
            return allowed;
        }
        const root = `code/backend/src/module/${classified.moduleName}`;
        for (const contract of [
            'index.ts',
            'interfaces.ts',
            'types.ts',
            'constants.ts',
        ]) {
            allowed.add(`${root}/${contract}`);
        }
        if (
            issue.ruleId.startsWith('HANDLER_') ||
            issue.ruleId.startsWith('HTTP_')
        ) {
            allowed.add(`${root}/dto`);
            allowed.add('code/backend/test');
            allowed.add('code/backend/openapi/openapi.yaml');
        }
        return allowed;
    }

    /** Compares causes without relying on diagnostic wording. */
    private causeKey(issue: BackendLintIssue): string {
        return `${issue.ruleId}:${normalizeProjectPath(issue.file)}`;
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
