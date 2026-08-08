import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { BackendLinter } from '../script/linter/backend.linter.ts';
import { TestCatalogManager } from '../script/test-catalog/test-catalog.manager.ts';
import { BaseModule } from '../src/base/base.module.ts';
import { CatalogRenderer } from '../script/scaffold-module/catalog.renderer.ts';
import { ConfigEditor } from '../script/scaffold-module/config.editor.ts';
import { ScaffoldExecutionError } from '../script/scaffold-module/errors.ts';
import type {
    ScaffoldVerification,
    ScaffoldStorage,
    ScaffoldWriter,
} from '../script/scaffold-module/interfaces.ts';
import { ModuleScaffolder } from '../script/scaffold-module/module.scaffolder.ts';
import { ModuleName } from '../script/scaffold-module/module-name.ts';
import { ScaffoldCli } from '../script/scaffold-module/scaffold.cli.ts';
import { NativeScaffoldStorage } from '../script/scaffold-module/scaffold.storage.ts';
import { VerificationRunner } from '../script/scaffold-module/verification.runner.ts';

/** Records whether scaffold verification was requested. */
class RecordingVerification implements ScaffoldVerification {
    public calls = 0;

    /** Records one successful verification call. */
    public verify(): void {
        this.calls += 1;
    }
}

/** Simulates a backend check failure. */
class FailingVerification implements ScaffoldVerification {
    /** Always fails after files have been written. */
    public verify(): void {
        throw new ScaffoldExecutionError('Simulated verification failure.');
    }
}

/** Fails exactly one generated-file write and permits the following rollback. */
class FailingWriteStorage implements ScaffoldStorage {
    private readonly native = new NativeScaffoldStorage();
    private writes = 0;

    /** Delegates directory creation. */
    public createDirectory(directory: string): void {
        this.native.createDirectory(directory);
    }

    /** Throws on the second write and delegates every other write. */
    public writeFile(filePath: string, source: string): void {
        this.writes += 1;
        if (this.writes === 2) {
            throw new Error('Simulated write failure.');
        }
        this.native.writeFile(filePath, source);
    }

    /** Delegates directory removal. */
    public removeDirectory(directory: string): void {
        this.native.removeDirectory(directory);
    }

    /** Delegates removal of newly created empty directories. */
    public removeEmptyDirectory(directory: string): void {
        this.native.removeEmptyDirectory(directory);
    }

    /** Delegates file removal. */
    public removeFile(filePath: string): void {
        this.native.removeFile(filePath);
    }
}

/** Minimal module used to prove handlerless dispatch behavior. */
class EmptyModule extends BaseModule<never, never> {}

/** Captures CLI output without touching process streams. */
class BufferWriter implements ScaffoldWriter {
    public value = '';

    /** Appends one output chunk. */
    public write(chunk: string): void {
        this.value += chunk;
    }
}

/** Creates an isolated repository shape accepted by the module scaffolder. */
class ScaffoldFixture {
    public readonly root: string;
    public readonly templateRoot: string;
    public readonly configPath: string;
    public readonly catalogPath: string;

    /** Creates a fixture containing one existing health module. */
    constructor() {
        this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-scaffold-'));
        const backendRoot = path.join(this.root, 'code/backend');
        this.configPath = path.join(backendRoot, 'src/config.ts');
        this.catalogPath = path.join(backendRoot, 'src/module.catalog.ts');
        this.templateRoot = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../script/scaffold-module/templates',
        );
        this.write(
            'code/backend/openapi/openapi.yaml',
            'openapi: 3.1.0\ninfo:\n    title: Fixture\n    version: 1.0.0\npaths: {}\n',
        );
        this.write(
            'code/backend/package.json',
            '{"dependencies":{},"devDependencies":{}}',
        );
        this.write(
            'code/backend/src/config.ts',
            `export const config = {
    untouched: true,
    modules: {
        active: ['health'] as string[],
    },
};
`,
        );
        this.write(
            'code/backend/src/module/health/index.ts',
            `export class HealthModule extends BaseModule implements HealthModulePort {
    public static readonly definition = {
        name: 'health',
        dependencies: [],
        create: () => new HealthModule(),
    } satisfies NamedModuleDefinition;
}
export type { HealthModulePort } from './interfaces.ts';
`,
        );
        this.write(
            'code/backend/src/module/health/interfaces.ts',
            'export interface HealthModulePort {}\n',
        );
        this.write(
            'code/backend/src/module.catalog.ts',
            '// original catalog\n',
        );
    }

    /** Creates a scaffolder with one explicit verification implementation. */
    public scaffolder(
        verification: ScaffoldVerification,
        storage?: ScaffoldStorage,
    ): ModuleScaffolder {
        return new ModuleScaffolder({
            projectRoot: this.root,
            templateRoot: this.templateRoot,
            verification,
            storage,
        });
    }

    /** Writes one UTF-8 fixture file below the project root. */
    public write(relativePath: string, source: string): void {
        const filePath = path.join(this.root, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, source, 'utf8');
    }

    /** Reads one UTF-8 fixture file below the project root. */
    public read(relativePath: string): string {
        return fs.readFileSync(path.join(this.root, relativePath), 'utf8');
    }

    /** Removes the complete isolated fixture. */
    public dispose(): void {
        fs.rmSync(this.root, { recursive: true, force: true });
    }
}

test('scaffold creates, registers, activates, and lints a typed module', () => {
    const fixture = new ScaffoldFixture();
    const verification = new RecordingVerification();
    try {
        const result = fixture
            .scaffolder(verification)
            .scaffold('user-profile');

        assert.equal(result.moduleName, 'user-profile');
        assert.equal(result.files.length, 5);
        assert.equal(verification.calls, 1);
        assert.match(
            fixture.read(
                'code/backend/src/module/user-profile/index.ts',
            ),
            /class UserProfileModule/,
        );
        assert.match(
            fixture.read(
                'code/backend/src/module/user-profile/interfaces.ts',
            ),
            /interface UserProfileModulePort/,
        );
        assert.match(
            fixture.read('code/backend/src/module/user-profile/types.ts'),
            /type UserProfileNodeRequest = never/,
        );
        assert.match(
            fixture.read(
                'code/backend/src/module/user-profile/module.manifest.json',
            ),
            /"name": "user-profile"/u,
        );
        assert.match(
            fixture.read(
                'code/backend/src/module/user-profile/constants.ts',
            ),
            /USER_PROFILE_MODULE_NAME = 'user-profile'/,
        );
        assert.match(
            fs.readFileSync(fixture.configPath, 'utf8'),
            /active: \['health', 'user-profile'\] as string\[\]/,
        );
        assert.match(
            fs.readFileSync(fixture.catalogPath, 'utf8'),
            /UserProfileModule\.definition/,
        );
        new TestCatalogManager(
            path.join(fixture.root, 'code/backend'),
        ).generate();
        assert.deepEqual(
            new BackendLinter({ projectRoot: fixture.root }).run().issues,
            [],
        );
    } finally {
        fixture.dispose();
    }
});

test('catalog output is deterministic while active order is append-only', () => {
    const fixture = new ScaffoldFixture();
    try {
        const scaffolder = fixture.scaffolder(new RecordingVerification());
        scaffolder.scaffold('zebra');
        scaffolder.scaffold('alpha');

        const catalog = fs.readFileSync(fixture.catalogPath, 'utf8');
        assert.ok(
            catalog.indexOf("./module/alpha/index.ts") <
                catalog.indexOf("./module/health/index.ts"),
        );
        assert.ok(
            catalog.indexOf("./module/health/index.ts") <
                catalog.indexOf("./module/zebra/index.ts"),
        );
        assert.match(
            fs.readFileSync(fixture.configPath, 'utf8'),
            /active: \['health', 'zebra', 'alpha'\]/,
        );
    } finally {
        fixture.dispose();
    }
});

test('catalog regeneration preserves module-owned dependency metadata', () => {
    const fixture = new ScaffoldFixture();
    const healthIndex = `export class HealthModule {
    public static readonly definition = {
        name: 'health',
        dependencies: ['database'],
        create: (dependencies: unknown) => new HealthModule(dependencies),
    };

    public readonly dependencies: unknown;

    public constructor(dependencies: unknown) {
        this.dependencies = dependencies;
    }
}
`;
    try {
        fixture.write(
            'code/backend/src/module/health/index.ts',
            healthIndex,
        );

        fixture.scaffolder(new RecordingVerification()).scaffold('orders');

        assert.equal(
            fixture.read('code/backend/src/module/health/index.ts'),
            healthIndex,
        );
        assert.match(
            fixture.read('code/backend/src/module.catalog.ts'),
            /\[HealthModule\.definition\.name\]: HealthModule\.definition/,
        );
        assert.doesNotMatch(
            fixture.read('code/backend/src/module.catalog.ts'),
            /dependencies:/,
        );
    } finally {
        fixture.dispose();
    }
});

test('the checked-in production catalog matches deterministic generation', () => {
    const backendRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
    );
    const actual = fs.readFileSync(
        path.join(backendRoot, 'src/module.catalog.ts'),
        'utf8',
    );
    const expected = new CatalogRenderer().render([
        new ModuleName('auth'),
        new ModuleName('health'),
    ]);
    assert.equal(actual, expected);
});

test('invalid, reserved, and existing names leave managed files unchanged', () => {
    const fixture = new ScaffoldFixture();
    try {
        const scaffolder = fixture.scaffolder(new RecordingVerification());
        const originalConfig = fs.readFileSync(fixture.configPath, 'utf8');
        const originalCatalog = fs.readFileSync(fixture.catalogPath, 'utf8');

        for (const moduleName of [
            '',
            'UserProfile',
            '../escape',
            'module-template',
            'health',
        ]) {
            assert.throws(() => scaffolder.scaffold(moduleName));
        }
        assert.equal(
            fs.readFileSync(fixture.configPath, 'utf8'),
            originalConfig,
        );
        assert.equal(
            fs.readFileSync(fixture.catalogPath, 'utf8'),
            originalCatalog,
        );
    } finally {
        fixture.dispose();
    }
});

test('verification failure restores config and catalog and removes the module', () => {
    const fixture = new ScaffoldFixture();
    try {
        const originalConfig = fs.readFileSync(fixture.configPath, 'utf8');
        const originalCatalog = fs.readFileSync(fixture.catalogPath, 'utf8');
        assert.throws(
            () =>
                fixture
                    .scaffolder(new FailingVerification())
                    .scaffold('orders'),
            /Simulated verification failure/,
        );
        assert.equal(
            fs.existsSync(
                path.join(
                    fixture.root,
                    'code/backend/src/module/orders',
                ),
            ),
            false,
        );
        assert.equal(
            fs.readFileSync(fixture.configPath, 'utf8'),
            originalConfig,
        );
        assert.equal(
            fs.readFileSync(fixture.catalogPath, 'utf8'),
            originalCatalog,
        );
    } finally {
        fixture.dispose();
    }
});

test('write failure removes partial output and restores managed files', () => {
    const fixture = new ScaffoldFixture();
    try {
        const originalConfig = fs.readFileSync(fixture.configPath, 'utf8');
        const originalCatalog = fs.readFileSync(fixture.catalogPath, 'utf8');
        assert.throws(
            () =>
                fixture
                    .scaffolder(
                        new RecordingVerification(),
                        new FailingWriteStorage(),
                    )
                    .scaffold('orders'),
            /Simulated write failure/,
        );
        assert.equal(
            fs.existsSync(
                path.join(
                    fixture.root,
                    'code/backend/src/module/orders',
                ),
            ),
            false,
        );
        assert.equal(
            fs.readFileSync(fixture.configPath, 'utf8'),
            originalConfig,
        );
        assert.equal(
            fs.readFileSync(fixture.catalogPath, 'utf8'),
            originalCatalog,
        );
    } finally {
        fixture.dispose();
    }
});

test('config editor rejects malformed or non-literal active arrays', () => {
    const editor = new ConfigEditor();
    assert.throws(
        () => editor.addActiveModule('export const config = {', 'orders'),
        /Unable to parse config\.ts/,
    );
    assert.throws(
        () =>
            editor.addActiveModule(
                `const existing = 'health';
                 export const config = { modules: { active: [existing] } };`,
                'orders',
            ),
        /string literals only/,
    );
});

test('CLI documents usage and returns stable success and input exit codes', () => {
    const fixture = new ScaffoldFixture();
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();
    try {
        const cli = new ScaffoldCli(
            fixture.scaffolder(new RecordingVerification()),
            stdout,
            stderr,
        );
        assert.equal(cli.run(['--help']), 0);
        assert.match(stdout.value, /Usage: npm run scaffold:module/);
        assert.equal(cli.run([]), 1);
        assert.equal(cli.run(['BadName']), 1);
        assert.match(stderr.value, /Expected exactly one module name/);
        assert.match(stderr.value, /lowercase kebab-case/);
    } finally {
        fixture.dispose();
    }
});

test('real verification runner accepts the current backend', () => {
    const backendRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
    );
    assert.doesNotThrow(() => new VerificationRunner().verify(backendRoot));
});

test('a generated handlerless module returns a controlled transport error', async () => {
    const result = await new EmptyModule().dispatch('http', new Request('http://localhost'));
    assert.deepEqual(result, {
        success: false,
        error: "Interface 'http' is not supported by this module.",
        statusCode: 405,
    });
});
