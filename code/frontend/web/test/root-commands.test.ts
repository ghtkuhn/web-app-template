import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { COMMANDS, DEPLOYMENTS, SCAFFOLDS, commandHelp } from '../../../../script/commands/catalog.ts';
import { runScaffold } from '../../../../script/commands/scaffold.runner.ts';
import { validateDeploymentArguments } from '../../../../script/deployment/arguments.ts';
import { DeploymentCli } from '../../../../script/deployment/deployment.cli.ts';
import { TestRunner } from '../../../../script/testing/test.runner.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

test('public command catalog covers the reduced manifest and all help is offline', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
    expect(Object.keys(scripts)).toHaveLength(40);
    expect(Object.keys(COMMANDS).sort()).toEqual(Object.keys(scripts).filter((name) => name !== 'prepare').sort());
    expect(Object.keys(scripts).filter((name) => /^(deployment|scaffold):/u.test(name))).toEqual([]);
    for (const name of Object.keys(COMMANDS)) {
        expect(commandHelp([name])).toContain('Effects:');
    }
    for (const topic of ['credentials', 'workflow', 'template', 'maintenance']) expect(commandHelp([topic])).toContain('Example:');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'command-help-'));
    try {
        fs.writeFileSync(path.join(temporary, 'project.json'), 'invalid json');
        const output = spawnSync(process.execPath, [path.join(root, 'script/help.ts'), 'deployment', 'rollback'], { cwd: temporary, encoding: 'utf8', env: { PATH: '' } });
        expect(output.status).toBe(0);
        expect(output.stdout).toContain('npm run deployment -- rollback <profile>');
        expect(output.stdout).not.toContain('-- rollback --');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('scaffold dispatcher forwards all eight types, preserves exit codes, and never executes help', () => {
    const examples: Record<keyof typeof SCAFFOLDS, string[]> = {
        file: ['billing', 'dto', 'invoice'], module: ['billing'],
        operation: ['billing', 'invoices', 'create-invoice', '--input', 'void', '--output', 'void'],
        test: ['billing'], route: ['invoices'], component: ['mobile', 'invoice-card'], feature: ['invoices'],
        pwa: ['billing', '--name', 'Billing App', '--short-name', 'Billing'],
    };
    const execute = vi.fn(() => ({ status: 7 }));
    for (const [kind, values] of Object.entries(examples)) {
        const entry = SCAFFOLDS[kind as keyof typeof SCAFFOLDS];
        expect(runScaffold(root, [kind, ...values], execute)).toBe(7);
        expect(execute).toHaveBeenLastCalledWith(process.execPath, [path.join(root, entry.entry), ...('argument' in entry ? [entry.argument] : []), ...values], root);
        execute.mockClear();
        expect(runScaffold(root, [kind, '--help'], execute, () => {})).toBe(0);
        expect(() => runScaffold(root, [kind], execute)).toThrow('Invalid');
        expect(execute).not.toHaveBeenCalled();
    }
});

test('deployment parser accepts every action and rejects missing or ambiguous targets before config access', async () => {
    const valid: Record<keyof typeof DEPLOYMENTS, string[]> = {
        validate: ['--all'], scaffold: ['production', '--database=postgres'], build: ['local', 'backend'],
        deploy: ['production', 'all'], status: ['local', 'frontend'], stop: ['local', 'backend'],
        diagnose: ['production', 'all'], bootstrap: ['production', 'backend'],
        'infrastructure:status': ['production', 'backend'], 'infrastructure:upgrade': ['production', 'all'],
        rollback: ['production', 'backend', 'release-1'], 'database:list': ['production'],
        'database:restore': ['production', 'backup-1'],
    };
    for (const [action, args] of Object.entries(valid)) expect(() => validateDeploymentArguments([action, ...args])).not.toThrow();
    const invalid = [
        ['deploy'], ['deploy', 'production'], ['deploy', 'production', 'backend', 'extra'],
        ['deploy', 'production', '--all'], ['validate', '--all', 'production'],
        ['scaffold', 'production', '--from'], ['scaffold', 'production', '--typo', 'local'],
        ['scaffold', 'production', '--from', 'local', '--from', 'other'],
        ['scaffold', 'production', '--backend-driver', 'lxc'],
        ['rollback', 'production', 'all'], ['database:restore', 'production', 'latest'],
        ['database:list', 'production', 'backend'], ['unknown'],
    ];
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-args-'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const read = vi.spyOn(fs, 'readFileSync');
    try {
        const cli = new DeploymentCli(temporary);
        for (const args of invalid) {
            expect(() => validateDeploymentArguments(args)).toThrow();
            expect(await cli.run(args)).toBe(1);
        }
        expect(await cli.run([])).toBe(0);
        for (const action of Object.keys(DEPLOYMENTS)) expect(await cli.run([action, '--help'])).toBe(0);
        expect(read).not.toHaveBeenCalled();
        expect(fs.readdirSync(temporary)).toEqual([]);
    } finally { read.mockRestore(); stdout.mockRestore(); stderr.mockRestore(); fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('focused tests select only the intended backend module or test file', async () => {
    const execute = vi.fn((_command: string, _args: readonly string[], _cwd: string) => ({ status: 0 }));
    const runner = new TestRunner(root, execute);
    expect(await runner.run(['--module', 'health'])).toBe(0);
    expect(execute.mock.calls).toEqual([
        ['npm', ['run', 'check:test-catalog'], path.join(root, 'code/backend')],
        [process.execPath, ['--test', '--test-concurrency=1', 'src/module/health/test/health.module.test.ts'], path.join(root, 'code/backend')],
    ]);
    execute.mockClear();
    expect(await runner.run(['--file', 'code/frontend/web/test/core.test.ts'])).toBe(0);
    expect(execute.mock.calls).toEqual([['npm', ['test', '--', '--run', 'test/core.test.ts'], path.join(root, 'code/frontend/web')]]);
    execute.mockClear();
    expect(await runner.run(['--file', 'code/backend/src/module/auth/test/auth.integration.test.ts'])).toBe(0);
    expect(execute.mock.calls[1]?.[1]).toEqual(['--test', '--test-concurrency=1', 'src/module/auth/test/auth.integration.test.ts']);
    execute.mockClear();
    await runner.run([]);
    expect(execute.mock.calls).toEqual([['npm', ['test', '--workspaces', '--if-present'], root]]);
});

test('invalid test selectors never start any runner and symlink selections fail', async () => {
    const execute = vi.fn(() => ({ status: 0 }));
    const runner = new TestRunner(root, execute);
    for (const args of [
        ['--module', 'missing-module'], ['--module', '../auth'], ['--file'],
        ['--file', '/tmp/test.test.ts'], ['--file', 'code/backend/../test.test.ts'],
        ['--file', 'code/frontend/web/test/missing.test.ts'],
        ['--file', 'code/frontend/web/test/e2e/application.spec.ts'],
        ['--module', 'health', '--file', 'anything'], ['--typo', 'health'],
    ]) await expect(runner.run(args)).rejects.toThrow();
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'test-select-'));
    try {
        fs.symlinkSync(path.join(root, 'code'), path.join(temporary, 'code'));
        await expect(new TestRunner(temporary, execute).run(['--file', 'code/frontend/web/test/core.test.ts'])).rejects.toThrow('symlink');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    expect(execute).not.toHaveBeenCalled();
});

test('a regular backend module without tests reports the absence without starting a runner', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-module-'));
    const execute = vi.fn(() => ({ status: 0 }));
    const messages: string[] = [];
    try {
        fs.mkdirSync(path.join(temporary, 'code/backend/src/module/empty'), { recursive: true });
        fs.writeFileSync(path.join(temporary, 'code/backend/src/module/empty/index.ts'), 'export {};');
        fs.writeFileSync(path.join(temporary, 'code/backend/test.catalog.ts'), 'export const BACKEND_TEST_FILES = [];');
        expect(await new TestRunner(temporary, execute, (text) => messages.push(text)).run(['--module', 'empty'])).toBe(0);
        expect(messages.join('')).toContain('No direct module tests');
        expect(execute).not.toHaveBeenCalled();
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
