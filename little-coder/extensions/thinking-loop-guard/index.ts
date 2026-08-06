import { ThinkingLoopDetector } from './thinking-loop.detector.ts';

type ThinkingLevel =
    | 'off'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max';

interface ThinkingLoopExtensionApi {
    on(
        event: string,
        handler: (
            event: ThinkingLoopEvent,
            context: ThinkingLoopContext,
        ) => Promise<void>,
    ): void;
    registerCommand(
        name: string,
        command: {
            readonly description: string;
            readonly handler: (
                arguments_: string,
                context: ThinkingLoopContext,
            ) => Promise<void>;
        },
    ): void;
    getThinkingLevel?(): ThinkingLevel;
    setThinkingLevel(level: ThinkingLevel): void;
    sendUserMessage(
        message: string,
        options: { readonly deliverAs: 'followUp' },
    ): void;
}

interface ThinkingLoopEvent {
    readonly assistantMessageEvent?: {
        readonly type?: string;
        readonly delta?: string;
    };
}

interface ThinkingLoopContext {
    abort(): void;
    readonly ui: {
        notify(message: string, level: 'info' | 'warning' | 'error'): void;
    };
}

/** Runtime state and recovery orchestration for one Little Coder process. */
export class ThinkingLoopGuardExtension {
    private readonly detector: ThinkingLoopDetector;
    private readonly threshold: number;
    private aborted = false;
    private forcedOff = false;
    private priorLevel: ThinkingLevel | undefined;
    private recoveries = 0;

    /** Creates the guard with ten exact consecutive fragments by default. */
    public constructor(threshold = 10) {
        this.threshold = threshold;
        this.detector = new ThinkingLoopDetector(threshold);
    }

    /** Registers streaming, lifecycle, and status hooks. */
    public register(extension: ThinkingLoopExtensionApi): void {
        extension.on('session_start', async () => {
            this.resetTask();
        });
        extension.on('input', async () => {
            if (this.forcedOff && this.priorLevel) {
                safeSetThinkingLevel(extension, this.priorLevel);
            }
            this.resetTask();
        });
        extension.on('agent_start', async () => {
            this.detector.reset();
            this.aborted = false;
        });
        extension.on('turn_start', async () => {
            this.detector.reset();
            this.aborted = false;
            if (this.forcedOff) {
                safeSetThinkingLevel(extension, 'off');
            }
        });
        extension.on('message_update', async (event, context) => {
            this.handleMessageUpdate(extension, event, context);
        });
        extension.registerCommand('thinking-loop', {
            description: 'Show the thinking-loop guard state',
            handler: async (_arguments, context) => {
                context.ui.notify(this.status(), 'info');
            },
        });
    }

    /** Reports the compact in-memory state for operator inspection. */
    public status(): string {
        return (
            `Thinking loop guard: threshold ${this.threshold}, recoveries ${this.recoveries}, ` +
            `thinking ${this.forcedOff ? 'forced off' : 'normal'}.`
        );
    }

    /** Detects one streamed loop and performs recovery before aborting. */
    private handleMessageUpdate(
        extension: ThinkingLoopExtensionApi,
        event: ThinkingLoopEvent,
        context: ThinkingLoopContext,
    ): void {
        const update = event.assistantMessageEvent;
        if (
            this.aborted ||
            update?.type !== 'thinking_delta' ||
            typeof update.delta !== 'string'
        ) {
            return;
        }
        const match = this.detector.append(update.delta);
        if (!match) {
            return;
        }

        this.aborted = true;
        if (this.recoveries >= 1) {
            context.ui.notify(
                'Thinking loop repeated after automatic recovery; stopped without another restart.',
                'error',
            );
            context.abort();
            return;
        }
        this.recoveries = 1;
        if (!this.forcedOff) {
            this.priorLevel = safeGetThinkingLevel(extension);
            this.forcedOff = true;
        }
        safeSetThinkingLevel(extension, 'off');
        const excerpt = match.fragment.slice(0, 80);
        try {
            extension.sendUserMessage(
                '[thinking loop interrupted] Continue from the current repository state. ' +
                    'Do not repeat the prior reasoning. Inspect the last concrete result, ' +
                    'then perform exactly the next necessary tool action. If no safe action ' +
                    'is possible, report the blocker tersely.',
                { deliverAs: 'followUp' },
            );
        } catch {
            // Aborting is still safer than allowing an unbounded loop.
        }
        context.ui.notify(
            `Interrupted ${match.repetitions} repeated thinking fragments: "${excerpt}"`,
            'warning',
        );
        context.abort();
    }

    /** Restores a clean state for a genuinely new user task. */
    private resetTask(): void {
        this.detector.reset();
        this.aborted = false;
        this.forcedOff = false;
        this.priorLevel = undefined;
        this.recoveries = 0;
    }
}

/** Reads a thinking level without allowing stale-extension failures to escape. */
function safeGetThinkingLevel(
    extension: ThinkingLoopExtensionApi,
): ThinkingLevel | undefined {
    try {
        return extension.getThinkingLevel?.();
    } catch {
        return undefined;
    }
}

/** Changes a thinking level without turning recovery into an extension crash. */
function safeSetThinkingLevel(
    extension: ThinkingLoopExtensionApi,
    level: ThinkingLevel,
): void {
    try {
        extension.setThinkingLevel(level);
    } catch {
        // A stale context must not crash the Little Coder process.
    }
}

/** Loads the project-local guard through Little Coder's extension API. */
export default function thinkingLoopGuard(
    extension: ThinkingLoopExtensionApi,
): void {
    new ThinkingLoopGuardExtension().register(extension);
}
