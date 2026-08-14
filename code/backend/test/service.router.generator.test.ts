import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ModuleManifestManager } from '../script/module-tools/module-manifest.manager.ts';

test('module sync generates a deterministic Service router from Operations', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'service-router-'));
    try {
        write(
            root,
            'code/backend/src/module/billing/module.manifest.json',
            '{"schemaVersion":1,"name":"billing","dependencies":[]}\n',
        );
        write(
            root,
            'code/backend/src/module/billing/index.ts',
            `export class BillingModule {
    // module-sync:start
    public static readonly definition = {
        name: BILLING_MODULE_NAME,
        dependencies: [],
    };
    // module-sync:end
}\n`,
        );
        write(
            root,
            'code/backend/src/module/billing/service/billing.service.ts',
            'stale\n',
        );
        write(
            root,
            'code/backend/src/module/billing/service/billing/create-invoice.operation.ts',
            `export class CreateInvoiceOperation extends BaseServiceOperation<Input, Output, BillingServiceDependencies> {
    public execute(input: Input): Output {
        return input.output;
    }
}\n`,
        );
        write(
            root,
            'code/backend/src/module/billing/service/billing/get-status.operation.ts',
            `export class GetStatusOperation extends BaseServiceOperation<void, Output, BillingServiceDependencies> {
    public execute(input: void): Output {
        return input;
    }
}\n`,
        );
        write(
            root,
            'code/backend/src/module/billing/service/billing/pending.operation.ts',
            'export abstract class PendingOperation extends BaseServiceOperation<Input, Output, BillingServiceDependencies> {}\n',
        );

        const manager = new ModuleManifestManager(root);
        assert.deepEqual(manager.check(), ['billing']);
        assert.equal(manager.sync('billing'), true);
        assert.deepEqual(manager.check(), []);
        assert.equal(manager.sync('billing'), false);
        const source = fs.readFileSync(
            path.join(
                root,
                'code/backend/src/module/billing/service/billing.service.ts',
            ),
            'utf8',
        );
        assert.match(source, /class BillingService extends BaseService/);
        assert.match(source, /public createInvoice\(/);
        assert.match(source, /public getStatus\(\)/);
        assert.doesNotMatch(source, /PendingOperation/);
        assert.ok(
            source.indexOf('CreateInvoiceOperation') <
                source.indexOf('GetStatusOperation'),
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

/** Writes one repository-relative fixture file. */
function write(root: string, relativePath: string, source: string): void {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source, 'utf8');
}
