import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    BackendLintGate,
    classifyBackendPath,
    type BackendLintResult,
    type BackendLintRunner,
    type RepairCheckResult,
    type RepairCheckRunner,
} from '../../../../little-coder/extensions/backend-lint-gate/backend-lint-gate.ts';
import { parseBackendLintResult } from '../../../../little-coder/extensions/backend-lint-gate/lint.runner.ts';
import {
    BackendLintGateExtension,
    isProtectedMutation,
    type ExtensionApi,
    type ExtensionContext,
    type ExtensionDecision,
    type ExtensionEvent,
} from '../../../../little-coder/extensions/backend-lint-gate/index.ts';

class SequenceRunner implements BackendLintRunner {
    public calls = 0;
    private readonly results: BackendLintResult[];

    /** Creates a runner that returns results in declaration order. */
    public constructor(results: BackendLintResult[]) {
        this.results = results;
    }

    /** Returns the next result and repeats the final result when exhausted. */
    public run(): BackendLintResult {
        const result =
            this.results[Math.min(this.calls, this.results.length - 1)];
        this.calls += 1;
        return result;
    }
}

class SequenceCheckRunner implements RepairCheckRunner {
    public calls = 0;
    private readonly results: RepairCheckResult[];

    /** Creates a focused runner that returns results in order. */
    public constructor(results: RepairCheckResult[]) {
        this.results = results;
    }

    /** Returns the next result and repeats the final result. */
    public run(): RepairCheckResult {
        const result =
            this.results[Math.min(this.calls, this.results.length - 1)];
        this.calls += 1;
        return result;
    }
}

const GREEN: BackendLintResult = { status: 'green', issues: [] };
const ISSUE_DETAILS = {
    fix: 'Apply the required architecture repair.',
    location: {
        start: { line: 2, column: 3 },
        end: { line: 2, column: 8 },
    },
} as const;

describe('BackendLintGate', () => {
    test('runs a focused architecture checkpoint after every mutation', () => {
        const runner = new SequenceRunner([GREEN]);
        const gate = new BackendLintGate(runner);
        const mutation = classifyBackendPath(
            'code/backend/src/module/example/service/example.service.ts',
        );

        for (let index = 0; index < 5; index += 1) {
            expect(gate.authorizeMutation(mutation).block).toBe(false);
            gate.recordSuccessfulMutation(mutation);
        }
        expect(runner.calls).toBe(5);
        expect(gate.authorizeMutation(mutation).block).toBe(false);
        expect(runner.calls).toBe(6);
        expect(gate.status()).toContain('mutations 0/5');
    });

    test('lints before changing layer or module', () => {
        const runner = new SequenceRunner([GREEN, GREEN, GREEN]);
        const gate = new BackendLintGate(runner);
        const service = classifyBackendPath(
            'code/backend/src/module/example/service/example.service.ts',
        );
        const controller = classifyBackendPath(
            'code/backend/src/module/example/controller/example.controller.ts',
        );
        const other = classifyBackendPath(
            'code/backend/src/module/other/controller/other.controller.ts',
        );

        expect(gate.authorizeMutation(service).block).toBe(false);
        gate.recordSuccessfulMutation(service);
        expect(gate.authorizeMutation(controller).block).toBe(false);
        expect(runner.calls).toBe(2);
        gate.recordSuccessfulMutation(controller);
        expect(gate.authorizeMutation(other).block).toBe(false);
        expect(runner.calls).toBe(3);
    });

    test('red module mode permits its module and support tests only', () => {
        const runner = new SequenceRunner([
            {
                status: 'red',
                issues: [
                    {
                        ...ISSUE_DETAILS,
                        ruleId: 'HANDLER_DTO_INPUT',
                        file:
                            'code/backend/src/module/example/api/' +
                            'example.http.handler.ts',
                        reason: 'Use a DTO.',
                    },
                ],
            },
        ]);
        const gate = new BackendLintGate(runner);
        expect(gate.instruction()).toContain(
            'example.http.handler.ts:2:3',
        );
        expect(gate.instruction()).toContain('Reason: Use a DTO.');
        expect(gate.instruction()).toContain(
            'Fix: Apply the required architecture repair.',
        );

        expect(
            gate.authorizeMutation(
                classifyBackendPath(
                    'code/backend/src/module/example/dto/input.dto.ts',
                ),
            ).block,
        ).toBe(false);
        expect(
            gate.authorizeMutation(
                classifyBackendPath(
                    'code/backend/test/example.http.test.ts',
                ),
            ).block,
        ).toBe(false);
        expect(
            gate.authorizeMutation(
                classifyBackendPath(
                    'code/backend/src/module/other/dto/input.dto.ts',
                ),
            ).block,
        ).toBe(true);
        expect(
            gate.authorizeMutation(
                classifyBackendPath(
                    'code/backend/src/module/example/service/example.service.ts',
                ),
            ).block,
        ).toBe(true);
    });

    test('blocks after two ineffective repairs of the same cause', () => {
        const red: BackendLintResult = {
            status: 'red',
            issues: [
                {
                    ...ISSUE_DETAILS,
                    ruleId: 'HANDLER_DTO_CAST_BYPASS',
                    file:
                        'code/backend/src/module/example/api/' +
                        'example.http.handler.ts',
                    reason: 'Do not cast JSON.',
                },
            ],
        };
        const gate = new BackendLintGate(
            new SequenceRunner([red, red, red]),
        );
        const mutation = classifyBackendPath(
            'code/backend/src/module/example/api/example.http.handler.ts',
        );

        expect(gate.authorizeMutation(mutation).block).toBe(false);
        gate.recordSuccessfulMutation(mutation);
        expect(gate.authorizeMutation(mutation).block).toBe(false);
        gate.recordSuccessfulMutation(mutation);
        expect(gate.authorizeMutation(mutation).block).toBe(true);
        expect(gate.status()).toContain('blocked after 2');
    });

    test('focused check failures count attempts and prevent cause drift', () => {
        const red: BackendLintResult = {
            status: 'red',
            issues: [
                {
                    ...ISSUE_DETAILS,
                    ruleId: 'DOMAIN_ANY_TYPE',
                    file:
                        'code/backend/src/module/example/service/' +
                        'example.service.ts',
                    reason: 'Remove any.',
                },
            ],
        };
        const checks = new SequenceCheckRunner([
            { status: 'failed', reason: 'typecheck failed' },
            { status: 'failed', reason: 'typecheck failed again' },
        ]);
        const gate = new BackendLintGate(
            new SequenceRunner([red]),
            checks,
        );
        const mutation = classifyBackendPath(
            'code/backend/src/module/example/service/example.service.ts',
        );

        expect(gate.authorizeMutation(mutation).block).toBe(false);
        gate.recordSuccessfulMutation(mutation);
        expect(gate.authorizeMutation(mutation).block).toBe(false);
        gate.recordSuccessfulMutation(mutation);
        expect(gate.authorizeMutation(mutation).block).toBe(true);
        expect(checks.calls).toBe(2);
    });

    test('workspace repair mode permits only reported files', () => {
        const runner = new SequenceRunner([
            {
                status: 'red',
                issues: [
                    {
                        ...ISSUE_DETAILS,
                        ruleId: 'WORKSPACE_LOCKFILE_OWNERSHIP',
                        file: 'code/backend/package-lock.json',
                        reason: 'Nested lockfile.',
                    },
                    {
                        ...ISSUE_DETAILS,
                        ruleId: 'ROOT_COMPILER_CONFIG_CONTRACT',
                        file: 'tsconfig.base.json',
                        reason: 'Compiler mismatch.',
                    },
                ],
            },
        ]);
        const gate = new BackendLintGate(runner);

        expect(
            gate.authorizeMutation(
                classifyBackendPath('code/backend/package-lock.json'),
            ).block,
        ).toBe(false);
        expect(
            gate.authorizeMutation(
                classifyBackendPath('code/backend/src/config.ts'),
            ).block,
        ).toBe(true);
    });

    test('failed lint closes mutations and stale Verify re-lints', () => {
        const failed = new BackendLintGate(
            new SequenceRunner([
                { status: 'failed', reason: 'lint timed out' },
            ]),
        );
        expect(
            failed.authorizeMutation(
                classifyBackendPath('code/backend/src/config.ts'),
            ).block,
        ).toBe(true);

        const runner = new SequenceRunner([
            GREEN,
            {
                status: 'red',
                issues: [
                    {
                        ...ISSUE_DETAILS,
                        ruleId: 'DOMAIN_ANY_TYPE',
                        file:
                            'code/backend/src/module/example/' +
                            'service/example.service.ts',
                        reason: 'Remove any.',
                    },
                ],
            },
        ]);
        const gate = new BackendLintGate(runner);
        const mutation = classifyBackendPath(
            'code/backend/src/module/example/service/example.service.ts',
        );
        expect(gate.authorizeMutation(mutation).block).toBe(false);
        gate.recordSuccessfulMutation(mutation);
        expect(gate.authorizeVerify().block).toBe(true);
        expect(runner.calls).toBe(2);
    });
});

describe('backend lint support contracts', () => {
    test('classifies architecture phases and protected controls', () => {
        expect(
            classifyBackendPath(
                'code/backend/src/module/example/interfaces.ts',
            ).phase,
        ).toBe('module-contract');
        expect(
            classifyBackendPath(
                'code/backend/src/module/example/store/example.store.ts',
            ).phase,
        ).toBe('object-store');
        expect(
            classifyBackendPath('code/backend/test/example.test.ts').phase,
        ).toBe('tests-openapi');
        expect(isProtectedMutation('code/backend/ARCHITECTURE.md')).toBe(
            true,
        );
        expect(
            isProtectedMutation(
                'code/backend/src/module/example/service/example.service.ts',
            ),
        ).toBe(false);
    });

    test('parses green, red, timeout, fatal, and malformed output', () => {
        expect(
            parseBackendLintResult({
                status: 0,
                stdout: JSON.stringify({
                    schemaVersion: 1,
                    filesChecked: 1,
                    issues: [],
                }),
                stderr: '',
            }).status,
        ).toBe('green');
        expect(
            parseBackendLintResult({
                status: 1,
                stdout: JSON.stringify({
                    schemaVersion: 1,
                    filesChecked: 1,
                    issues: [
                        {
                            ...ISSUE_DETAILS,
                            ruleId: 'DOMAIN_ANY_TYPE',
                            severity: 'error',
                            file:
                                'code/backend/src/module/example/' +
                                'types.ts',
                            reason: 'Remove any.',
                        },
                    ],
                }),
                stderr: '',
            }),
        ).toMatchObject({
            status: 'red',
            issues: [{ ruleId: 'DOMAIN_ANY_TYPE' }],
        });
        expect(
            parseBackendLintResult({
                status: null,
                stdout: '',
                stderr: '',
                error: Object.assign(new Error('timeout'), {
                    name: 'ETIMEDOUT',
                }),
            }),
        ).toEqual({
            status: 'failed',
            reason: 'architecture lint timed out',
        });
        expect(
            parseBackendLintResult({
                status: 2,
                stdout: JSON.stringify({
                    schemaVersion: 1,
                    filesChecked: 0,
                    issues: [
                        {
                            ...ISSUE_DETAILS,
                            ruleId: 'LINTER_FAILURE',
                            severity: 'fatal',
                            file: 'code/backend',
                            reason: 'failed',
                        },
                    ],
                }),
                stderr: 'fatal',
            }).status,
        ).toBe('failed');
        expect(
            parseBackendLintResult({
                status: 1,
                stdout: JSON.stringify({
                    schemaVersion: 2,
                    issues: [],
                }),
                stderr: '',
            }).status,
        ).toBe('failed');
        expect(
            parseBackendLintResult({
                status: 1,
                stdout: 'unexpected',
                stderr: '',
            }).status,
        ).toBe('failed');
    });
});

// fallow-ignore-next-line complexity -- One lifecycle test preserves state across the complete tool sequence.
test('extension tracks tool results, uncertain shell mutations, and protected files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-gate-'));
    const handlers = new Map<
        string,
        (
            event: ExtensionEvent,
            context: ExtensionContext,
        ) => Promise<ExtensionDecision | undefined>
    >();
    let statusCommand:
        | ((
              arguments_: string,
              context: ExtensionContext,
          ) => Promise<void>)
        | undefined;
    const notices: string[] = [];
    const runner = new SequenceRunner([GREEN, GREEN, GREEN, GREEN]);
    const extension = new BackendLintGateExtension(
        () => runner,
        () =>
            new SequenceCheckRunner([
                { status: 'passed', summary: 'focused check passed' },
            ]),
    );
    const api: ExtensionApi = {
        on: (event, handler) => {
            handlers.set(event, handler);
        },
        registerCommand: (_name, command) => {
            statusCommand = command.handler;
        },
    };
    const context: ExtensionContext = {
        cwd: root,
        ui: {
            notify: (message) => {
                notices.push(message);
            },
        },
    };

    try {
        fs.mkdirSync(path.join(root, 'code/backend/src/base'), {
            recursive: true,
        });
        fs.writeFileSync(path.join(root, 'package.json'), '{}', 'utf8');
        extension.register(api);
        await handlers.get('before_agent_start')?.({}, context);

        const edit: ExtensionEvent = {
            toolCallId: 'failed-edit',
            toolName: 'edit',
            input: {
                path:
                    'code/backend/src/module/example/service/' +
                    'example.service.ts',
            },
        };
        expect(
            (await handlers.get('tool_call')?.(edit, context))?.block,
        ).not.toBe(true);
        await handlers.get('tool_result')?.(
            { ...edit, isError: true },
            context,
        );
        await statusCommand?.('', context);
        expect(notices.at(-1)).toContain('mutations 0/5');

        await handlers.get('tool_call')?.(edit, context);
        await handlers.get('tool_result')?.(
            { ...edit, isError: false },
            context,
        );
        await statusCommand?.('', context);
        expect(notices.at(-1)).toContain('mutations 1/5');

        const protectedEdit: ExtensionEvent = {
            toolCallId: 'protected',
            toolName: 'write',
            input: { path: 'code/backend/ARCHITECTURE.md' },
        };
        expect(
            (
                await handlers
                    .get('tool_call')
                    ?.(protectedEdit, context)
            )?.block,
        ).toBe(true);
        expect(
            (
                await handlers.get('tool_call')?.(
                    {
                        toolCallId: 'install',
                        toolName: 'bash',
                        input: { command: 'npm install example' },
                    },
                    context,
                )
            )?.block,
        ).toBe(true);

        const scaffold: ExtensionEvent = {
            toolCallId: 'scaffold',
            toolName: 'bash',
            input: {
                command:
                    'npm run scaffold:file -- example service helper',
            },
        };
        await handlers.get('tool_call')?.(scaffold, context);
        await handlers.get('tool_result')?.(
            { ...scaffold, isError: false },
            context,
        );
        await handlers.get('tool_call')?.(
            { ...edit, toolCallId: 'after-scaffold' },
            context,
        );
        expect(runner.calls).toBeGreaterThanOrEqual(3);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
