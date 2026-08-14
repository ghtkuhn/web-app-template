import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { BackendLinter } from '../script/linter/backend.linter.ts';
import { TestCatalogManager } from '../script/test-catalog/test-catalog.manager.ts';
import { FileScaffoldCli } from '../script/scaffold-module/file-scaffold.cli.ts';
import { FileScaffolder } from '../script/scaffold-module/file.scaffolder.ts';
import type {
    FileScaffoldRequest,
    ScaffoldStorage,
    ScaffoldVerification,
    ScaffoldWriter,
} from '../script/scaffold-module/interfaces.ts';
import { NativeScaffoldStorage } from '../script/scaffold-module/scaffold.storage.ts';

type ExpectedFile = {
    type: string;
    name: string;
    relativePath: string;
    className: string;
    baseClass: string;
    owner?: string;
};

/** Records automatic verification calls without launching child processes. */
class RecordingFileVerification implements ScaffoldVerification {
    public calls = 0;

    /** Records one requested backend verification. */
    public verify(): void {
        this.calls += 1;
    }
}

/** Fails automatic verification after the file has been written. */
class FailingFileVerification implements ScaffoldVerification {
    /** Always reports a controlled verification failure. */
    public verify(): void {
        throw new Error('Simulated file verification failure.');
    }
}

/** Writes a file once and then throws to simulate a partial write failure. */
class PartialWriteStorage implements ScaffoldStorage {
    private readonly native = new NativeScaffoldStorage();

    /** Delegates directory creation. */
    public createDirectory(directory: string): void {
        this.native.createDirectory(directory);
    }

    /** Writes the target and then reports a failure exactly once. */
    public writeFile(filePath: string, source: string): void {
        this.native.writeFile(filePath, source);
        throw new Error('Simulated partial file write.');
    }

    /** Delegates recursive directory removal. */
    public removeDirectory(directory: string): void {
        this.native.removeDirectory(directory);
    }

    /** Delegates empty directory removal. */
    public removeEmptyDirectory(directory: string): void {
        this.native.removeEmptyDirectory(directory);
    }

    /** Delegates generated file removal. */
    public removeFile(filePath: string): void {
        this.native.removeFile(filePath);
    }
}

/** Captures command output for CLI tests. */
class FileBufferWriter implements ScaffoldWriter {
    public value = '';

    /** Appends one output chunk. */
    public write(chunk: string): void {
        this.value += chunk;
    }
}

/** Creates an isolated existing module for file-scaffold tests. */
class FileScaffoldFixture {
    public readonly root: string;
    public readonly backendRoot: string;
    public readonly moduleRoot: string;
    public readonly templatePath: string;

    /** Creates a module with valid owners for every supported Aux variant. */
    constructor() {
        this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-scaffold-'));
        this.backendRoot = path.join(this.root, 'code/backend');
        this.moduleRoot = path.join(
            this.backendRoot,
            'src/module/example',
        );
        this.templatePath = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../script/scaffold-module/templates/architecture-file.ts.template',
        );
        this.write(
            'openapi/openapi.yaml',
            'openapi: 3.1.0\ninfo:\n    title: Fixture\n    version: 1.0.0\npaths: {}\n',
        );
        this.write(
            'package.json',
            '{"dependencies":{},"devDependencies":{}}',
        );
        this.write(
            'src/module/example/index.ts',
            `import { BaseModule } from '../../base/base.module.ts';
             import type { NamedModuleDefinition } from '../../base/interfaces.ts';
             import type { ExampleModulePort } from './interfaces.ts';
             export class ExampleModule extends BaseModule<never, never> implements ExampleModulePort {
                 public static readonly definition = {
                     name: 'example',
                     dependencies: [],
                     create: () => new ExampleModule(),
                 } satisfies NamedModuleDefinition;
             }
             export type { ExampleModulePort } from './interfaces.ts';`,
        );
        this.write(
            'src/module/example/interfaces.ts',
            'export interface ExampleModulePort {}',
        );
        this.write(
            'src/module.catalog.ts',
            `import { ExampleModule } from './module/example/index.ts';
             export const moduleDefinitions = [ExampleModule.definition];`,
        );
        this.write(
            'src/module/example/api/owner.http.handler.ts',
            `import { HttpHandler } from '../../../base/http.handler.ts';
             export abstract class OwnerHttpHandler extends HttpHandler {}`,
        );
        this.write(
            'src/module/example/controller/owner.controller.ts',
            `import { BaseController } from '../../../base/base.controller.ts';
             export class OwnerController extends BaseController {}`,
        );
        this.write(
            'src/module/example/service/owner.service.ts',
            `import { BaseService } from '../../../base/base.service.ts';
             export abstract class OwnerService extends BaseService {}`,
        );
        this.write(
            'src/module/example/store/owner.store.ts',
            `import { BaseStore } from '../../../base/base.store.ts';
             export abstract class OwnerStore extends BaseStore<never> {}`,
        );
    }

    /** Creates a file scaffolder with optional storage behavior. */
    public scaffolder(
        verification: ScaffoldVerification,
        storage?: ScaffoldStorage,
    ): FileScaffolder {
        return new FileScaffolder({
            projectRoot: this.root,
            templatePath: this.templatePath,
            verification,
            storage,
        });
    }

    /** Writes one backend-relative UTF-8 fixture file. */
    public write(relativePath: string, source: string): void {
        const filePath = path.join(this.backendRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, source, 'utf8');
    }

    /** Returns every fixture file path relative to the backend root. */
    public files(): string[] {
        const files: string[] = [];
        this.collect(this.backendRoot, files);
        return files.sort((left, right) => left.localeCompare(right));
    }

    /** Copies real base sources and runs TypeScript over generated variants. */
    public typecheck(): void {
        const repositoryRoot = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../../..',
        );
        fs.cpSync(
            path.join(repositoryRoot, 'code/backend/src/base'),
            path.join(this.backendRoot, 'src/base'),
            { recursive: true },
        );
        fs.copyFileSync(
            path.join(repositoryRoot, 'code/backend/src/database.ts'),
            path.join(this.backendRoot, 'src/database.ts'),
        );
        fs.copyFileSync(
            path.join(repositoryRoot, 'code/backend/src/config.ts'),
            path.join(this.backendRoot, 'src/config.ts'),
        );
        fs.symlinkSync(
            path.join(repositoryRoot, 'node_modules'),
            path.join(this.root, 'node_modules'),
            'dir',
        );
        this.write(
            'tsconfig.json',
            JSON.stringify({
                extends: path.join(repositoryRoot, 'tsconfig.base.json'),
                compilerOptions: { types: ['node'] },
                include: ['src/**/*.ts'],
            }),
        );
        const result = spawnSync(
            path.join(repositoryRoot, 'node_modules/.bin/tsc'),
            ['--project', path.join(this.backendRoot, 'tsconfig.json')],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.stdout || result.stderr);
    }

    /** Removes the complete temporary project. */
    public dispose(): void {
        fs.rmSync(this.root, { recursive: true, force: true });
    }

    /** Recursively collects fixture files. */
    private collect(directory: string, files: string[]): void {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                this.collect(entryPath, files);
            } else if (entry.isFile()) {
                files.push(path.relative(this.backendRoot, entryPath));
            }
        }
    }
}

const expectedFiles: readonly ExpectedFile[] = [
    { type: 'controller', name: 'multi-word', relativePath: 'controller/multi-word.controller.ts', className: 'MultiWordController', baseClass: 'BaseController' },
    { type: 'service', name: 'billing', relativePath: 'service/billing.service.ts', className: 'BillingService', baseClass: 'BaseService' },
    { type: 'store', name: 'billing', relativePath: 'store/billing.store.ts', className: 'BillingStore', baseClass: 'BaseStore' },
    { type: 'object', name: 'invoice', relativePath: 'object/invoice.object.ts', className: 'InvoiceObject', baseClass: 'BaseObject' },
    { type: 'dto', name: 'invoice-summary', relativePath: 'dto/invoice-summary.dto.ts', className: 'InvoiceSummaryDTO', baseClass: 'BaseDTO' },
    { type: 'entity-dto', name: 'invoice-entity', relativePath: 'dto/invoice-entity.dto.ts', className: 'InvoiceEntityDTO', baseClass: 'EntityDTO' },
    { type: 'http-handler', name: 'billing', relativePath: 'api/billing.http.handler.ts', className: 'BillingHttpHandler', baseClass: 'HttpHandler' },
    { type: 'websocket-handler', name: 'billing', relativePath: 'api/billing.websocket.handler.ts', className: 'BillingWebSocketHandler', baseClass: 'WebSocketHandler' },
    { type: 'cli-handler', name: 'billing', relativePath: 'api/billing.cli.handler.ts', className: 'BillingCliHandler', baseClass: 'CliHandler' },
    { type: 'node-handler', name: 'billing', relativePath: 'api/billing.node.handler.ts', className: 'BillingNodeHandler', baseClass: 'NodeHandler' },
    { type: 'api-aux', name: 'parser', owner: 'owner', relativePath: 'api/owner/parser.api-aux.ts', className: 'ParserApiAux', baseClass: 'BaseApiAux' },
    { type: 'controller-aux', name: 'mapper', owner: 'owner', relativePath: 'controller/owner/mapper.controller-aux.ts', className: 'MapperControllerAux', baseClass: 'BaseControllerAux' },
    { type: 'store-aux', name: 'query', owner: 'owner', relativePath: 'store/owner/query.store-aux.ts', className: 'QueryStoreAux', baseClass: 'BaseStoreAux' },
];

test('all architecture file types generate exact lintable and typed classes', () => {
    const fixture = new FileScaffoldFixture();
    const verification = new RecordingFileVerification();
    try {
        const scaffolder = fixture.scaffolder(verification);
        for (const expected of expectedFiles) {
            const result = scaffolder.scaffold({
                moduleName: 'example',
                fileType: expected.type,
                name: expected.name,
                owner: expected.owner,
            });
            assert.equal(result.className, expected.className);
            assert.ok(result.file.endsWith(expected.relativePath));
            const source = fs.readFileSync(
                path.join(fixture.moduleRoot, expected.relativePath),
                'utf8',
            );
            assert.match(source, new RegExp(`class ${expected.className}`));
            assert.match(source, new RegExp(`extends ${expected.baseClass}`));
        }
        assert.equal(verification.calls, expectedFiles.length);
        fixture.write(
            'src/module/example/test/example.module.test.ts',
            `import { test } from 'node:test';
             test('example module contract is executable', () => {});`,
        );
        new TestCatalogManager(fixture.backendRoot).generate();
        assert.deepEqual(
            new BackendLinter({ projectRoot: fixture.root }).run().issues,
            [],
        );
        fixture.typecheck();
    } finally {
        fixture.dispose();
    }
});

test('invalid requests and collisions do not mutate the module', () => {
    const fixture = new FileScaffoldFixture();
    try {
        const scaffolder = fixture.scaffolder(
            new RecordingFileVerification(),
        );
        const originalFiles = fixture.files();
        assert.throws(
            () => scaffolder.scaffold({
                moduleName: 'example',
                fileType: 'service-aux',
                name: 'test',
            }),
            /Service Aux scaffolding is obsolete.*scaffold:operation/,
        );
        const invalidRequests: FileScaffoldRequest[] = [
            { moduleName: 'missing', fileType: 'service', name: 'test' },
            { moduleName: '../escape', fileType: 'service', name: 'test' },
            { moduleName: 'example', fileType: 'unknown', name: 'test' },
            { moduleName: 'example', fileType: 'service', name: 'BadName' },
            { moduleName: 'example', fileType: 'service', name: 'test', owner: 'owner' },
        ];
        for (const request of invalidRequests) {
            assert.throws(() => scaffolder.scaffold(request));
        }
        scaffolder.scaffold({
            moduleName: 'example',
            fileType: 'service',
            name: 'existing',
        });
        const afterCreation = fixture.files();
        assert.throws(() =>
            scaffolder.scaffold({
                moduleName: 'example',
                fileType: 'service',
                name: 'existing',
            }),
        );
        assert.deepEqual(fixture.files(), afterCreation);
        assert.ok(afterCreation.length > originalFiles.length);
    } finally {
        fixture.dispose();
    }
});

test('write and verification failures remove files and only new directories', () => {
    const fixture = new FileScaffoldFixture();
    try {
        const objectPath = path.join(fixture.moduleRoot, 'object');
        assert.equal(fs.existsSync(objectPath), false);
        assert.throws(() =>
            fixture
                .scaffolder(
                    new RecordingFileVerification(),
                    new PartialWriteStorage(),
                )
                .scaffold({
                    moduleName: 'example',
                    fileType: 'object',
                    name: 'invoice',
                }),
        );
        assert.equal(fs.existsSync(objectPath), false);

        const ownerDirectory = path.join(
            fixture.moduleRoot,
            'controller/owner',
        );
        assert.equal(fs.existsSync(ownerDirectory), false);
        assert.throws(() =>
            fixture.scaffolder(new FailingFileVerification()).scaffold({
                moduleName: 'example',
                fileType: 'controller-aux',
                name: 'mapper',
                owner: 'owner',
            }),
        );
        assert.equal(fs.existsSync(ownerDirectory), false);
        assert.equal(
            fs.existsSync(path.join(fixture.moduleRoot, 'service')),
            true,
        );
    } finally {
        fixture.dispose();
    }
});

test('file scaffold CLI exposes help and stable exit codes', () => {
    const fixture = new FileScaffoldFixture();
    const stdout = new FileBufferWriter();
    const stderr = new FileBufferWriter();
    try {
        const cli = new FileScaffoldCli(
            fixture.scaffolder(new RecordingFileVerification()),
            stdout,
            stderr,
        );
        assert.equal(cli.run(['--help']), 0);
        assert.match(stdout.value, /controller, service, store/);
        assert.equal(cli.run([]), 1);
        assert.equal(cli.run(['example', 'unknown', 'test']), 1);
        assert.equal(cli.run(['example', 'service', 'created']), 0);
        assert.match(stdout.value, /Created service 'CreatedService'/);
        assert.match(stderr.value, /Expected <module>/);
        assert.match(stderr.value, /Unknown file type/);

        const failingCli = new FileScaffoldCli(
            fixture.scaffolder(new FailingFileVerification()),
            stdout,
            stderr,
        );
        assert.equal(
            failingCli.run(['example', 'object', 'failed-check']),
            2,
        );
        assert.match(stderr.value, /Simulated file verification failure/);
    } finally {
        fixture.dispose();
    }
});
