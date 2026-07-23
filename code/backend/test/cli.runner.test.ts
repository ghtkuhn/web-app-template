import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseHandler } from '../src/base/base.handler.ts';
import { BaseModule } from '../src/base/base.module.ts';
import { CliRunner } from '../src/base/cli.runner.ts';
import type {
    CliHandlerInput,
    HandlerResult,
    OutputWriter,
} from '../src/base/interfaces.ts';
import { HealthModule } from '../src/module/health/index.ts';

class StringWriter implements OutputWriter {
    public value = '';

    public write(chunk: string): void {
        this.value += chunk;
    }
}

class CapturingCliHandler extends BaseHandler<CliHandlerInput> {
    public input: CliHandlerInput | null = null;

    protected async processRequest(
        input: CliHandlerInput,
    ): Promise<HandlerResult> {
        this.input = input;
        return { success: true, data: input };
    }
}

class CliTestModule extends BaseModule {
    constructor(handler: CapturingCliHandler) {
        super();
        this.registerHandler('cli', handler);
    }
}

test('health status command returns JSON and exit code zero', async () => {
    const stdout = new StringWriter();
    const stderr = new StringWriter();
    const runner = new CliRunner({
        modules: { health: new HealthModule() },
        stdout,
        stderr,
    });

    assert.equal(await runner.run(['health', 'status']), 0);
    assert.deepEqual(JSON.parse(stdout.value), {
        success: true,
        data: { status: 'ok' },
    });
    assert.equal(stderr.value, '');
});

test('CLI parses positional arguments, values, equals syntax, and flags', async () => {
    const handler = new CapturingCliHandler();
    const runner = new CliRunner({
        modules: { test: new CliTestModule(handler) },
        stdout: new StringWriter(),
        stderr: new StringWriter(),
    });

    const exitCode = await runner.run([
        'test',
        'execute',
        'first',
        '--name',
        'value',
        '--count=2',
        '--force',
    ]);

    assert.equal(exitCode, 0);
    assert.deepEqual(handler.input, {
        command: 'execute',
        arguments: ['first'],
        options: { name: 'value', count: '2', force: true },
    });
});

test('CLI reports usage and unknown modules with exit code two', async () => {
    const stderr = new StringWriter();
    const runner = new CliRunner({ modules: {}, stderr });

    assert.equal(await runner.run([]), 2);
    assert.match(stderr.value, /Usage/);

    stderr.value = '';
    assert.equal(await runner.run(['missing', 'command']), 2);
    assert.match(stderr.value, /Unknown module/);
});
