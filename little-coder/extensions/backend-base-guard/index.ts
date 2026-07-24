import fs from 'node:fs';
import path from 'node:path';

const PROTECTED_DIRECTORY = 'code/backend/src/base';
const MUTATION_TOOLS = new Set([
    'apply_patch',
    'delete',
    'edit',
    'mkdir',
    'move',
    'patch',
    'remove',
    'rename',
    'rmdir',
    'unlink',
    'write',
    'write_file',
]);
const SHELL_TOOLS = new Set(['bash', 'shell', 'shellsession']);
const PATH_KEYS = new Set([
    'destination',
    'destination_path',
    'directory',
    'file',
    'file_path',
    'new_path',
    'old_path',
    'path',
    'source',
    'source_path',
    'target',
]);

/** Minimal Little Coder extension API used by this project-local guard. */
interface ExtensionApi {
    on(
        event: 'tool_call',
        handler: (
            event: ToolCallEvent,
            context: ToolCallContext,
        ) => Promise<ToolCallDecision | undefined>,
    ): void;
}

/** Relevant shape of a Little Coder tool-call event. */
interface ToolCallEvent {
    readonly toolName?: unknown;
    readonly input?: unknown;
    readonly args?: unknown;
}

/** Relevant Little Coder execution context. */
interface ToolCallContext {
    readonly cwd: string;
}

/** A blocked tool-call response understood by Little Coder. */
export interface ToolCallDecision {
    readonly block: true;
    readonly reason: string;
}

/** Locates the template root that owns the protected backend Base directory. */
export function findProjectRoot(startDirectory: string): string | undefined {
    let current = path.resolve(startDirectory);
    while (true) {
        if (
            fs.existsSync(path.join(current, 'package.json')) &&
            fs.existsSync(path.join(current, PROTECTED_DIRECTORY))
        ) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}

/** Evaluates a tool call and returns a blocking decision when Base is targeted. */
export function guardBackendBaseToolCall(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
    projectRoot: string,
): ToolCallDecision | undefined {
    const normalizedTool = toolName.toLowerCase();
    if (MUTATION_TOOLS.has(normalizedTool)) {
        return guardMutationTool(input, cwd, projectRoot);
    }
    if (SHELL_TOOLS.has(normalizedTool)) {
        return guardShellTool(input, cwd, projectRoot);
    }
    return undefined;
}

/** Blocks structured mutation tools when any path points into backend Base. */
function guardMutationTool(
    input: Record<string, unknown>,
    cwd: string,
    projectRoot: string,
): ToolCallDecision | undefined {
    for (const [key, value] of Object.entries(input)) {
        if (
            PATH_KEYS.has(key) &&
            typeof value === 'string' &&
            isProtectedPath(value, cwd, projectRoot)
        ) {
            return blockedDecision(value);
        }
    }
    return undefined;
}

/** Blocks shell access that runs inside or explicitly references backend Base. */
function guardShellTool(
    input: Record<string, unknown>,
    cwd: string,
    projectRoot: string,
): ToolCallDecision | undefined {
    const command = input.command;
    if (typeof command !== 'string') {
        return undefined;
    }
    if (
        (
            isProtectedPath(cwd, projectRoot, projectRoot) &&
            commandCanMutate(command)
        ) ||
        (
            commandReferencesProtectedDirectory(command, projectRoot) &&
            (commandCanMutate(command) || commandChangesDirectory(command))
        )
    ) {
        return blockedDecision(PROTECTED_DIRECTORY);
    }
    return undefined;
}

/** Identifies shell operations capable of changing filesystem contents. */
function commandCanMutate(command: string): boolean {
    return (
        /(^|[;&|]\s*|\s)(chmod|chown|cp|dd|install|ln|mkdir|mv|rm|rmdir|tee|touch|truncate|unlink)(?=\s|$)/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)(node|perl|python3?|ruby|sh|zsh)(?=\s|$)/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)sed\s+(?:-[^\s]*i[^\s]*\s|--in-place(?:=|\s))/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)npm\s+run\s+(?:rm|scaffold:[^\s]+)(?=\s|$)/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)git\s+(?:apply|checkout|clean|restore|reset)(?=\s|$)/u.test(
            command,
        ) ||
        /(^|[;&|]\s*|\s)tar\s+[^\s]*[xA][^\s]*(?=\s|$)/u.test(command) ||
        /(^|[^<])>>?(?!>)/u.test(command)
    );
}

/** Prevents a persistent shell from establishing Base as its working directory. */
function commandChangesDirectory(command: string): boolean {
    return /(^|[;&|]\s*|\s)cd(?=\s|$)/u.test(command);
}

/** Checks whether one tool path resolves to or below backend Base. */
function isProtectedPath(
    candidate: string,
    cwd: string,
    projectRoot: string,
): boolean {
    try {
        const protectedRoot = fs.realpathSync(
            path.resolve(projectRoot, PROTECTED_DIRECTORY),
        );
        const resolvedCandidate = resolveThroughExistingAncestors(
            path.resolve(cwd, candidate),
        );
        return (
            resolvedCandidate === protectedRoot ||
            resolvedCandidate.startsWith(`${protectedRoot}${path.sep}`)
        );
    } catch {
        return true;
    }
}

/** Resolves existing symbolic-link ancestors even when the final path is new. */
function resolveThroughExistingAncestors(
    candidate: string,
    visitedLinks = new Set<string>(),
): string {
    const missingSegments: string[] = [];
    let current = candidate;
    while (!directoryEntryExists(current)) {
        const parent = path.dirname(current);
        if (parent === current) {
            return candidate;
        }
        missingSegments.unshift(path.basename(current));
        current = parent;
    }
    if (fs.lstatSync(current).isSymbolicLink()) {
        if (visitedLinks.has(current)) {
            throw new Error(`Symbolic-link cycle at '${current}'.`);
        }
        visitedLinks.add(current);
        const linkTarget = path.resolve(
            path.dirname(current),
            fs.readlinkSync(current),
        );
        return path.join(
            resolveThroughExistingAncestors(linkTarget, visitedLinks),
            ...missingSegments,
        );
    }
    return path.join(fs.realpathSync(current), ...missingSegments);
}

/** Checks for regular entries and dangling symbolic links without following. */
function directoryEntryExists(candidate: string): boolean {
    try {
        fs.lstatSync(candidate);
        return true;
    } catch {
        return false;
    }
}

/** Detects explicit absolute or repository-relative Base references in shell. */
function commandReferencesProtectedDirectory(
    command: string,
    projectRoot: string,
): boolean {
    const normalized = command.split('\\').join('/');
    const absolute = path
        .resolve(projectRoot, PROTECTED_DIRECTORY)
        .split('\\')
        .join('/');
    return (
        normalized.includes(absolute) ||
        /(^|[\s'"=;|&(])(?:\.\/)?code\/backend\/src\/base(?:\/|[\s'"=;|&)]|$)/u.test(
            normalized,
        ) ||
        /(^|[\s'"=;|&(])base(?:\/|[\s'"=;|&)]|$)/u.test(normalized)
    );
}

/** Creates the stable refusal returned to the agent. */
function blockedDecision(target: string): ToolCallDecision {
    return {
        block: true,
        reason:
            `Protected backend infrastructure: '${target}' is inside ` +
            `${PROTECTED_DIRECTORY}. Little Coder may read this directory but ` +
            'must not create, edit, move, rename, or delete anything in it.',
    };
}

/** Registers the backend Base mutation guard with Little Coder. */
export default function backendBaseGuard(extension: ExtensionApi): void {
    extension.on('tool_call', async (event, context) => {
        const projectRoot = findProjectRoot(context.cwd);
        if (!projectRoot) {
            return undefined;
        }
        const input = event.input ?? event.args;
        if (
            typeof event.toolName !== 'string' ||
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input)
        ) {
            return undefined;
        }
        return guardBackendBaseToolCall(
            event.toolName,
            input as Record<string, unknown>,
            context.cwd,
            projectRoot,
        );
    });
}
