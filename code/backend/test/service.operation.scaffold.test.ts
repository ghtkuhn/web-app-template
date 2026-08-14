import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BaseServiceOperation } from '../src/base/base.service.operation.ts';
import type { ScaffoldVerification } from '../script/scaffold-module/interfaces.ts';
import { OperationScaffoldCli } from '../script/scaffold-operation/operation-scaffold.cli.ts';
import { OperationScaffolder } from '../script/scaffold-operation/operation.scaffolder.ts';

class RecordingVerification implements ScaffoldVerification {
    public calls = 0;

    /** Records one requested verification. */
    public verify(): void {
        this.calls += 1;
    }
}

class FailingVerification implements ScaffoldVerification {
    /** Simulates a failed verification after writes. */
    public verify(): void {
        throw new Error('verification failed');
    }
}

class BufferWriter {
    public value = '';

    /** Captures one CLI output chunk. */
    public write(chunk: string): void {
        this.value += chunk;
    }
}

class UppercaseOperation extends BaseServiceOperation<
    string,
    string,
    { readonly prefix: string }
> {
    /** Applies the injected dependency to one typed input. */
    public execute(input: string): string {
        return `${this.dependencies.prefix}${input.toUpperCase()}`;
    }
}

test('BaseServiceOperation exposes typed immutable dependencies and execute', () => {
    const operation = new UppercaseOperation({ prefix: 'value:' });
    assert.equal(operation.execute('test'), 'value:TEST');
});

test('operation scaffold creates an exact owner-bound abstract draft', () => {
    const root = fixtureRoot();
    const verification = new RecordingVerification();
    try {
        const scaffolder = new OperationScaffolder({
            projectRoot: root,
            verification,
        });
        const result = scaffolder.scaffold({
            moduleName: 'example',
            serviceName: 'billing',
            operationName: 'create-invoice',
            inputType: 'CreateInvoiceInput',
            outputType: 'InvoiceDTO',
        });
        assert.equal(result.className, 'CreateInvoiceOperation');
        const target = path.join(root, result.file);
        const source = fs.readFileSync(target, 'utf8');
        assert.match(source, /class CreateInvoiceOperation extends BaseServiceOperation</);
        assert.match(source, /CreateInvoiceInput/);
        assert.match(source, /InvoiceDTO/);
        assert.match(source, /BillingServiceDependencies/);
        assert.equal(verification.calls, 1);
        assert.match(
            fs.readFileSync(
                path.join(root, 'code/backend/src/module/example/interfaces.ts'),
                'utf8',
            ),
            /export interface BillingServiceDependencies \{\}/,
        );
        assert.throws(() =>
            scaffolder.scaffold({
                moduleName: 'example',
                serviceName: 'billing',
                operationName: 'create-invoice',
                inputType: 'CreateInvoiceInput',
                outputType: 'InvoiceDTO',
            }),
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('operation scaffold rejects unresolved contracts and rolls back failures', () => {
    const root = fixtureRoot();
    try {
        const interfacesPath = path.join(
            root,
            'code/backend/src/module/example/interfaces.ts',
        );
        const originalInterfaces = fs.readFileSync(interfacesPath, 'utf8');
        const scaffolder = new OperationScaffolder({
            projectRoot: root,
            verification: new FailingVerification(),
        });
        assert.throws(() =>
            scaffolder.scaffold({
                moduleName: 'example',
                serviceName: 'billing',
                operationName: 'missing-contract',
                inputType: 'MissingInput',
                outputType: 'InvoiceDTO',
            }),
        );
        assert.throws(() =>
            scaffolder.scaffold({
                moduleName: 'example',
                serviceName: 'billing',
                operationName: 'create-invoice',
                inputType: 'CreateInvoiceInput',
                outputType: 'InvoiceDTO',
            }),
        );
        assert.equal(fs.readFileSync(interfacesPath, 'utf8'), originalInterfaces);
        assert.equal(
            fs.existsSync(
                path.join(
                    root,
                    'code/backend/src/module/example/service/billing/create-invoice.operation.ts',
                ),
            ),
            false,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('operation scaffold CLI documents usage and stable invalid-input status', () => {
    const root = fixtureRoot();
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();
    try {
        const cli = new OperationScaffoldCli(
            new OperationScaffolder({
                projectRoot: root,
                verification: new RecordingVerification(),
            }),
            stdout,
            stderr,
        );
        assert.equal(cli.run(['--help']), 0);
        assert.match(stdout.value, /scaffold:operation/);
        assert.equal(cli.run(['example']), 1);
        assert.match(stderr.value, /Expected <module> <service> <operation>/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

/** Creates one minimal existing module for scaffold tests. */
function fixtureRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operation-scaffold-'));
    const moduleRoot = path.join(root, 'code/backend/src/module/example');
    write(path.join(moduleRoot, 'index.ts'), 'export class ExampleModule {}\n');
    write(
        path.join(moduleRoot, 'interfaces.ts'),
        'export interface ExampleModulePort {}\n',
    );
    write(
        path.join(moduleRoot, 'types.ts'),
        'export interface CreateInvoiceInput { readonly title: string; }\n',
    );
    write(
        path.join(moduleRoot, 'dto/invoice.dto.ts'),
        'export class InvoiceDTO {}\n',
    );
    write(
        path.join(moduleRoot, 'service/billing.service.ts'),
        'export class BillingService {}\n',
    );
    return root;
}

/** Writes one fixture file with its parents. */
function write(filePath: string, source: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source, 'utf8');
}
