import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type {
    ModuleCommandResult,
    ModuleCommandRunner,
    ModuleToolWriter,
} from '../script/module-tools/interfaces.ts';
import { ModuleInspector } from '../script/module-tools/module.inspector.ts';
import { ModuleToolsCli } from '../script/module-tools/module-tools.cli.ts';
import { ModuleVerifier } from '../script/module-tools/module.verifier.ts';
import { ModuleManifestManager } from '../script/module-tools/module-manifest.manager.ts';
import { FixtureProject } from './linter/fixture-project.ts';

/** Captures focused verifier commands. */
class RecordingRunner implements ModuleCommandRunner {
    public readonly commands: string[] = [];
    private readonly exitCode: number;

    /** Creates a runner returning one stable status. */
    constructor(exitCode = 0) {
        this.exitCode = exitCode;
    }

    /** Records one command without starting a process. */
    public run(
        command: string,
        arguments_: readonly string[],
    ): ModuleCommandResult {
        this.commands.push([command, ...arguments_].join(' '));
        return { status: this.exitCode };
    }
}

/** Captures module CLI output. */
class BufferWriter implements ModuleToolWriter {
    public value = '';

    /** Appends one output chunk. */
    public write(chunk: string): void {
        this.value += chunk;
    }
}

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
);

test('module status reports one deterministic next state', () => {
    const inspector = new ModuleInspector(projectRoot);
    assert.equal(inspector.inspect('health').state, 'ready');
    assert.throws(() => inspector.inspect('missing'), /does not exist/u);
});

test('blocked module status preserves the complete tutorial diagnostic', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/index.ts',
            'export class IncorrectModule {}',
        );
        const status = new ModuleInspector(fixture.root).inspect('example');
        assert.equal(status.state, 'blocked');
        assert.match(status.message, /Where: /u);
        assert.match(status.message, /Found: /u);
        assert.match(status.message, /Why: /u);
        assert.match(status.message, /Meaning: /u);
        assert.match(status.message, /Architecture: /u);
        assert.match(status.message, /How to fix:/u);
        assert.match(status.message, /Verify:/u);
    } finally {
        fixture.dispose();
    }
});

test('focused verifier runs required checks and direct module tests', () => {
    const runner = new RecordingRunner();
    assert.equal(new ModuleVerifier(projectRoot, runner).verify('health'), 0);
    assert.deepEqual(runner.commands, [
        'npm run typecheck',
        'npm run lint:architecture',
        'npm run lint:openapi',
        `${process.execPath} --test src/module/health/test/health.module.test.ts`,
    ]);
});

test('module CLI documents commands and maps invalid input', () => {
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();
    const cli = new ModuleToolsCli(projectRoot, stdout, stderr);
    assert.equal(cli.run(['--help']), 0);
    assert.match(stdout.value, /module:status/u);
    assert.equal(cli.run(['status', 'missing']), 1);
    assert.match(stderr.value, /does not exist/u);
});

test('module manifest check and sync preserve current Health fach wiring', () => {
    const manager = new ModuleManifestManager(projectRoot);
    assert.deepEqual(manager.check(), []);
    assert.equal(manager.sync('health'), false);
    assert.throws(
        () => manager.addDependency('health', 'health'),
        /cannot depend on itself/u,
    );
});
