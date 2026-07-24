import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {
    BackendLintGate,
    classifyBackendPath,
    normalizeProjectPath,
    type BackendMutation,
    type BackendLintRunner,
    type GateDecision,
} from './backend-lint-gate.ts';
import { ProcessBackendLintRunner } from './lint.runner.ts';
import { findProjectRoot } from '../backend-base-guard/index.ts';

const STRUCTURED_MUTATION_TOOLS = new Set(['edit', 'write']);
const PROTECTED_PATHS = [
    'AGENTS.md',
    'AGENTS-DEFAULT.md',
    'package.json',
    'package-lock.json',
    'tsconfig.base.json',
    'code/backend/package.json',
    'code/backend/ARCHITECTURE.md',
    'code/backend/script/linter',
    'little-coder/extensions',
];

/** Minimal event API used by the project-local Little-Coder extension. */
export interface ExtensionApi {
    on(
        event: string,
        handler: (
            event: ExtensionEvent,
            context: ExtensionContext,
        ) => Promise<ExtensionDecision | undefined>,
    ): void;
    registerCommand(
        name: string,
        command: {
            readonly description: string;
            readonly handler: (
                arguments_: string,
                context: ExtensionContext,
            ) => Promise<void>;
        },
    ): void;
}

/** Tool lifecycle fields consumed by the lint gate. */
export interface ExtensionEvent {
    readonly toolCallId?: string;
    readonly toolName?: string;
    readonly input?: Record<string, unknown>;
    readonly isError?: boolean;
    readonly content?: Array<{
        readonly type: 'text';
        readonly text: string;
    }>;
}

/** Runtime context fields consumed by the lint gate. */
export interface ExtensionContext {
    readonly cwd: string;
    readonly ui: {
        notify(message: string, level: 'info' | 'warning' | 'error'): void;
    };
}

/** Tool decision or result enrichment returned to Little Coder. */
export interface ExtensionDecision {
    readonly block?: boolean;
    readonly reason?: string;
    readonly content?: Array<{ readonly type: 'text'; readonly text: string }>;
}

/** Mutable state retained only for the current Little-Coder process. */
export class BackendLintGateExtension {
    private readonly gates = new Map<string, BackendLintGate>();
    private readonly announcedRoots = new Set<string>();
    private readonly pendingMutations = new Map<
        string,
        {
            readonly mutation: BackendMutation | null;
            readonly snapshot: ReadonlyMap<string, string> | null;
        }
    >();
    private readonly runnerFactory: (
        projectRoot: string,
    ) => BackendLintRunner;

    /** Creates an extension with the production or an injected lint runner. */
    public constructor(
        runnerFactory: (
            projectRoot: string,
        ) => BackendLintRunner = (projectRoot) =>
            new ProcessBackendLintRunner(projectRoot),
    ) {
        this.runnerFactory = runnerFactory;
    }

    /** Registers lifecycle hooks and the compact status command. */
    public register(extension: ExtensionApi): void {
        extension.on('before_agent_start', async (_event, context) => {
            const state = this.state(context.cwd);
            if (
                state &&
                !this.announcedRoots.has(state.projectRoot)
            ) {
                context.ui.notify(state.gate.initialize(), 'info');
                this.announcedRoots.add(state.projectRoot);
            }
            return undefined;
        });
        extension.on('tool_call', async (event, context) => {
            return this.beforeTool(event, context);
        });
        extension.on('tool_result', async (event, context) => {
            return this.afterTool(event, context);
        });
        extension.registerCommand('backend-gate', {
            description: 'Show the current backend lint-gate state',
            handler: async (_arguments, context) => {
                const state = this.state(context.cwd);
                context.ui.notify(
                    state?.gate.status() ?? 'Backend gate unavailable',
                    state ? 'info' : 'error',
                );
            },
        });
    }

    /** Evaluates one mutation before Little Coder executes it. */
    // fallow-ignore-next-line complexity -- Coordinates independent protection, Verify, and mutation gates.
    private beforeTool(
        event: ExtensionEvent,
        context: ExtensionContext,
    ): ExtensionDecision | undefined {
        if (!event.toolName || !event.input || !event.toolCallId) {
            return undefined;
        }
        const state = this.state(context.cwd);
        if (!state) {
            return undefined;
        }
        if (
            event.toolName === 'bash' &&
            isRootVerify(event.input.command)
        ) {
            return this.decision(state.gate.authorizeVerify());
        }
        const structuredPath =
            STRUCTURED_MUTATION_TOOLS.has(event.toolName) &&
            typeof event.input.path === 'string'
                ? projectRelativePath(
                      event.input.path,
                      context.cwd,
                      state.projectRoot,
                  )
                : null;
        if (
            structuredPath &&
            isProtectedMutation(structuredPath)
        ) {
            return {
                block: true,
                reason:
                    `Protected architecture control: '${structuredPath}' ` +
                    'cannot be changed by Little Coder.',
            };
        }
        if (
            event.toolName === 'bash' &&
            typeof event.input.command === 'string' &&
            commandCanMutate(event.input.command) &&
            (
                commandReferencesProtectedControl(event.input.command) ||
                commandCanRewriteProtectedControls(event.input.command)
            )
        ) {
            return {
                block: true,
                reason:
                    'Protected architecture controls cannot be changed by ' +
                    'Little Coder.',
            };
        }

        const mutation = this.mutationFromTool(
            event.toolName,
            event.input,
            context.cwd,
            state.projectRoot,
        );
        if (!mutation) {
            if (event.toolName === 'bash') {
                this.pendingMutations.set(event.toolCallId, {
                    mutation: null,
                    snapshot: backendSnapshot(state.projectRoot),
                });
            }
            return undefined;
        }
        const decision = state.gate.authorizeMutation(mutation);
        if (decision.block) {
            return this.decision(decision);
        }
        this.pendingMutations.set(event.toolCallId, {
            mutation,
            snapshot:
                event.toolName === 'bash'
                    ? backendSnapshot(state.projectRoot)
                    : null,
        });
        return undefined;
    }

    /** Records only successful mutations and emits a bounded checkpoint hint. */
    // fallow-ignore-next-line complexity -- Reconciles structured and opaque Bash mutation evidence.
    private afterTool(
        event: ExtensionEvent,
        _context: ExtensionContext,
    ): ExtensionDecision | undefined {
        if (!event.toolCallId) {
            return undefined;
        }
        const pending = this.pendingMutations.get(event.toolCallId);
        this.pendingMutations.delete(event.toolCallId);
        if (!pending || event.isError) {
            return undefined;
        }
        const projectRoot = findProjectRoot(_context.cwd);
        const gate = projectRoot ? this.gates.get(projectRoot) : undefined;
        if (!gate || !projectRoot) {
            return undefined;
        }
        if (pending.mutation) {
            gate.recordSuccessfulMutation(pending.mutation);
        }
        const changedPaths = pending.snapshot
            ? changedBackendPaths(
                  pending.snapshot,
                  backendSnapshot(projectRoot),
              )
            : [];
        if (!pending.mutation && changedPaths.length > 0) {
            gate.recordSuccessfulMutation({
                ...classifyBackendPath(changedPaths[0]),
                uncertain: true,
            });
        }
        const protectedChange = changedPaths.find(isProtectedMutation);
        if (protectedChange) {
            return {
                content: [
                    ...(event.content ?? []),
                    {
                        type: 'text',
                        text:
                            `Backend gate detected a protected change to ` +
                            `'${protectedChange}'. Stop and request an ` +
                            'authorized repair.',
                    },
                ],
            };
        }
        if (gate.status().endsWith('mutations 5/5')) {
            return {
                content: [
                    ...(event.content ?? []),
                    {
                        type: 'text',
                        text:
                            'Backend gate checkpoint reached; the next ' +
                            'backend mutation requires architecture lint.',
                    },
                ],
            };
        }
        return undefined;
    }

    /** Returns or creates the gate bound to the containing project root. */
    private state(
        cwd: string,
    ): { projectRoot: string; gate: BackendLintGate } | null {
        const projectRoot = findProjectRoot(cwd);
        if (!projectRoot) {
            return null;
        }
        let gate = this.gates.get(projectRoot);
        if (!gate) {
            gate = new BackendLintGate(
                this.runnerFactory(projectRoot),
            );
            this.gates.set(projectRoot, gate);
        }
        return { projectRoot, gate };
    }

    /** Converts one structured or shell tool call into a backend mutation. */
    // fallow-ignore-next-line complexity -- Normalizes the finite structured and shell mutation forms.
    private mutationFromTool(
        toolName: string,
        input: Record<string, unknown>,
        cwd: string,
        projectRoot: string,
    ): BackendMutation | null {
        if (STRUCTURED_MUTATION_TOOLS.has(toolName)) {
            const candidate = input.path;
            if (typeof candidate !== 'string') {
                return null;
            }
            const relative = projectRelativePath(
                candidate,
                cwd,
                projectRoot,
            );
            return isBackendPath(relative)
                ? classifyBackendPath(relative)
                : null;
        }
        if (
            toolName !== 'bash' ||
            typeof input.command !== 'string' ||
            !commandCanMutate(input.command)
        ) {
            return null;
        }
        const referenced = backendPathFromCommand(input.command);
        if (referenced) {
            return classifyBackendPath(referenced);
        }
        if (
            input.command.includes('scaffold:') ||
            normalizeProjectPath(cwd).includes('/code/backend')
        ) {
            return {
                file: 'code/backend',
                moduleName: null,
                phase: 'unknown',
                uncertain: true,
            };
        }
        return null;
    }

    /** Converts the gate's stable decision to the extension response. */
    private decision(
        decision: GateDecision,
    ): ExtensionDecision | undefined {
        return decision.block
            ? { block: true, reason: decision.reason }
            : undefined;
    }
}

/** Captures content hashes so opaque Bash mutations cannot bypass the gate. */
function backendSnapshot(projectRoot: string): ReadonlyMap<string, string> {
    const snapshot = new Map<string, string>();
    const roots = [
        path.join(projectRoot, 'code/backend/src'),
        path.join(projectRoot, 'code/backend/test'),
        path.join(projectRoot, 'code/backend/openapi'),
        path.join(projectRoot, 'code/backend/script'),
        path.join(projectRoot, 'code/backend/package.json'),
        path.join(projectRoot, 'code/backend/package-lock.json'),
        ...PROTECTED_PATHS.map((candidate) =>
            path.join(projectRoot, candidate),
        ),
    ];
    for (const root of roots) {
        collectSnapshotEntries(root, projectRoot, snapshot);
    }
    return snapshot;
}

/** Recursively adds regular files without following symbolic links. */
function collectSnapshotEntries(
    candidate: string,
    projectRoot: string,
    snapshot: Map<string, string>,
): void {
    if (!fs.existsSync(candidate)) {
        return;
    }
    const stats = fs.lstatSync(candidate);
    if (stats.isSymbolicLink()) {
        return;
    }
    if (stats.isDirectory()) {
        for (const entry of fs.readdirSync(candidate)) {
            collectSnapshotEntries(
                path.join(candidate, entry),
                projectRoot,
                snapshot,
            );
        }
        return;
    }
    if (stats.isFile()) {
        snapshot.set(
            normalizeProjectPath(path.relative(projectRoot, candidate)),
            crypto
                .createHash('sha256')
                .update(fs.readFileSync(candidate))
                .digest('hex'),
        );
    }
}

/** Returns created, changed, and removed files between two snapshots. */
function changedBackendPaths(
    before: ReadonlyMap<string, string>,
    after: ReadonlyMap<string, string>,
): string[] {
    return [...new Set([...before.keys(), ...after.keys()])]
        .filter((file) => before.get(file) !== after.get(file))
        .sort();
}

/** Returns a project-relative path without trusting the tool's cwd. */
function projectRelativePath(
    candidate: string,
    cwd: string,
    projectRoot: string,
): string {
    return normalizeProjectPath(
        path.relative(projectRoot, path.resolve(cwd, candidate)),
    );
}

/** Returns whether a path belongs to backend source, tests, or contracts. */
function isBackendPath(candidate: string): boolean {
    return (
        candidate === 'code/backend' ||
        candidate.startsWith('code/backend/')
    );
}

/** Protects architecture controls from the agent that they constrain. */
export function isProtectedMutation(candidate: string): boolean {
    const normalized = normalizeProjectPath(candidate);
    return (
        normalized.endsWith('/package-lock.json') ||
        PROTECTED_PATHS.some(
            (protectedPath) =>
                normalized === protectedPath ||
                normalized.startsWith(`${protectedPath}/`),
        )
    );
}

/** Recognizes Root Verify without confusing workspace verification scripts. */
function isRootVerify(command: unknown): boolean {
    return (
        typeof command === 'string' &&
        /(^|[;&|]\s*)npm\s+run\s+verify(?:\s|$)/u.test(command)
    );
}

/** Identifies shell commands capable of changing tracked project files. */
// fallow-ignore-next-line code-duplication -- Each guard owns its intentionally conservative shell policy.
function commandCanMutate(command: string): boolean {
    return (
        /(^|[;&|]\s*|\s)(cp|install|mkdir|mv|rm|rmdir|tee|touch|truncate|unlink)(?=\s|$)/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)sed\s+(?:-[^\s]*i|--in-place)(?=\s|=)/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)npm\s+(?:install|uninstall|update)(?=\s|$)/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)npm\s+run\s+(?:rm|scaffold:[^\s]+)(?=\s|$)/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)git\s+(?:apply|checkout|restore|reset)(?=\s|$)/u.test(
            command,
        ) ||
        /(^|[^<])>>?(?!>)/u.test(command)
    );
}

/** Blocks broad package or Git rewrites that can replace protected controls. */
function commandCanRewriteProtectedControls(command: string): boolean {
    return (
        /(^|[;&|]\s*|\s)npm\s+(?:install|uninstall|update)(?=\s|$)/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)git\s+(?:apply|checkout|restore|reset)(?=\s|$)/u.test(
            command,
        )
    );
}

/** Extracts the first explicit backend path from a shell command. */
function backendPathFromCommand(command: string): string | null {
    const match = command
        .split('\\')
        .join('/')
        .match(/(?:\.\/)?(code\/backend(?:\/[A-Za-z0-9_.{}@/-]+)?)/u);
    return match?.[1] ?? null;
}

/** Detects protected files explicitly referenced by a mutating shell call. */
function commandReferencesProtectedControl(command: string): boolean {
    const normalized = command.split('\\').join('/');
    return PROTECTED_PATHS.some((protectedPath) =>
        normalized.includes(protectedPath),
    );
}

/** Loads the project-local gate when explicitly selected by the launcher. */
// fallow-ignore-next-line unused-export -- Little Coder loads this entry dynamically.
export default function backendLintGate(extension: ExtensionApi): void {
    new BackendLintGateExtension().register(extension);
}
