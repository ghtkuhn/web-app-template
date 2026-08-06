import { describe, expect, test } from 'vitest';
import {
    ThinkingLoopDetector,
} from '../../../../little-coder/extensions/thinking-loop-guard/thinking-loop.detector.ts';
import {
    ThinkingLoopGuardExtension,
} from '../../../../little-coder/extensions/thinking-loop-guard/index.ts';

type Handler = (
    event: {
        readonly assistantMessageEvent?: {
            readonly type?: string;
            readonly delta?: string;
        };
    },
    context: TestContext,
) => Promise<void>;

interface TestContext {
    abort(): void;
    readonly ui: {
        notify(message: string, level: 'info' | 'warning' | 'error'): void;
    };
}

type ThinkingLevel =
    | 'off'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max';

describe('thinking-loop detector', () => {
    test('allows nine copies and detects the tenth across stream boundaries', () => {
        const detector = new ThinkingLoopDetector();
        const fragment = 'Inspect the current repository state. ';

        expect(detector.append(fragment.repeat(9))).toBeNull();
        expect(detector.append(fragment.slice(0, 11))).toBeNull();
        const match = detector.append(fragment.slice(11));

        expect(match).toEqual({
            fragment: fragment.trim(),
            repetitions: 10,
        });
    });

    test('ignores short punctuation and resets between turns', () => {
        const detector = new ThinkingLoopDetector();

        expect(detector.append('...'.repeat(20))).toBeNull();
        expect(
            detector.append('Read the next concrete result. '.repeat(9)),
        ).toBeNull();
        detector.reset();
        expect(
            detector.append('Read the next concrete result. '),
        ).toBeNull();
    });
});

describe('thinking-loop extension', () => {
    test('queues one recovery before abort and forces thinking off', async () => {
        const handlers = new Map<string, Handler>();
        const operations: string[] = [];
        let thinkingLevel: ThinkingLevel = 'high';
        const extension = {
            on: (event: string, handler: Handler) => {
                handlers.set(event, handler);
            },
            registerCommand: () => undefined,
            getThinkingLevel: () => thinkingLevel,
            setThinkingLevel: (level: ThinkingLevel) => {
                thinkingLevel = level;
                operations.push(`thinking:${level}`);
            },
            sendUserMessage: (message: string) => {
                operations.push(`recovery:${message}`);
            },
        };
        const context: TestContext = {
            abort: () => {
                operations.push('abort');
            },
            ui: {
                notify: (message) => {
                    operations.push(`notice:${message}`);
                },
            },
        };
        new ThinkingLoopGuardExtension(3).register(extension);
        const update = handlers.get('message_update');
        expect(update).toBeDefined();

        for (let index = 0; index < 3; index += 1) {
            await update?.(
                {
                    assistantMessageEvent: {
                        type: 'thinking_delta',
                        delta: 'Inspect the current repository state. ',
                    },
                },
                context,
            );
        }

        expect(thinkingLevel).toBe('off');
        expect(operations.filter((value) => value === 'abort')).toHaveLength(1);
        expect(operations.findIndex((value) => value.startsWith('recovery:')))
            .toBeLessThan(operations.indexOf('abort'));

        await handlers.get('turn_start')?.({}, context);
        expect(thinkingLevel).toBe('off');
        await handlers.get('input')?.({}, context);
        expect(thinkingLevel).toBe('high');
    });

    test('does not react to visible answer text or duplicate after abort', async () => {
        const handlers = new Map<string, Handler>();
        let aborts = 0;
        let recoveries = 0;
        const extension = {
            on: (event: string, handler: Handler) => {
                handlers.set(event, handler);
            },
            registerCommand: () => undefined,
            setThinkingLevel: () => undefined,
            sendUserMessage: () => {
                recoveries += 1;
            },
        };
        const context: TestContext = {
            abort: () => {
                aborts += 1;
            },
            ui: { notify: () => undefined },
        };
        new ThinkingLoopGuardExtension(2).register(extension);
        const update = handlers.get('message_update');

        await update?.(
            {
                assistantMessageEvent: {
                    type: 'text_delta',
                    delta: 'Visible answer text. '.repeat(20),
                },
            },
            context,
        );
        await update?.(
            {
                assistantMessageEvent: {
                    type: 'thinking_delta',
                    delta: 'Inspect the current repository state. '.repeat(2),
                },
            },
            context,
        );
        await update?.(
            {
                assistantMessageEvent: {
                    type: 'thinking_delta',
                    delta: 'Inspect the current repository state. '.repeat(2),
                },
            },
            context,
        );

        expect(aborts).toBe(1);
        expect(recoveries).toBe(1);

        await handlers.get('turn_start')?.({}, context);
        await update?.(
            {
                assistantMessageEvent: {
                    type: 'thinking_delta',
                    delta: 'Inspect the current repository state. '.repeat(2),
                },
            },
            context,
        );

        expect(aborts).toBe(2);
        expect(recoveries).toBe(1);
    });
});
