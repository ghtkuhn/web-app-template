import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TestScaffoldCli } from '../script/scaffold-test/test-scaffold.cli.ts';
import type {
    TestScaffoldVerification,
    TestScaffoldWriter,
} from '../script/scaffold-test/interfaces.ts';
import { TestScaffolder } from '../script/scaffold-test/test.scaffolder.ts';

/** Records or rejects scaffold verification. */
class RecordingVerification implements TestScaffoldVerification {
    public calls = 0;

    /** Records one verification or throws the configured error. */
    public verify(): void {
        this.calls += 1;
    }
}

/** Simulates a verification failure after catalog generation. */
class FailingVerification implements TestScaffoldVerification {
    /** Always rejects verification. */
    public verify(): void {
        throw new Error('Simulated verification failure.');
    }
}

/** Captures CLI output. */
class BufferWriter implements TestScaffoldWriter {
    public value = '';

    /** Appends one output chunk. */
    public write(chunk: string): void {
        this.value += chunk;
    }
}

/** Creates an isolated module and catalog for scaffold tests. */
class TestScaffoldFixture {
    public readonly root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'test-scaffold-'),
    );
    public readonly backendRoot = path.join(this.root, 'code/backend');
    public readonly moduleRoot = path.join(
        this.backendRoot,
        'src/module/user-profile',
    );
    public readonly catalogPath = path.join(
        this.backendRoot,
        'test.catalog.ts',
    );

    /** Creates the public module contract required by the scaffold. */
    constructor() {
        fs.mkdirSync(this.moduleRoot, { recursive: true });
        fs.writeFileSync(
            path.join(this.moduleRoot, 'index.ts'),
            `export const USER_PROFILE_MODULE_NAME = 'user-profile';
export class UserProfileModule {
    public static readonly definition = {
        name: USER_PROFILE_MODULE_NAME,
        dependencies: [],
    };
}
`,
            'utf8',
        );
        fs.writeFileSync(this.catalogPath, '// original catalog\n', 'utf8');
    }

    /** Removes the isolated fixture. */
    public dispose(): void {
        fs.rmSync(this.root, { recursive: true, force: true });
    }
}

test('test scaffold creates a real module contract test and updates the catalog', () => {
    const fixture = new TestScaffoldFixture();
    const verification = new RecordingVerification();
    try {
        const result = new TestScaffolder(fixture.root, verification).scaffold(
            'user-profile',
        );
        assert.equal(
            result.file,
            'code/backend/src/module/user-profile/test/user-profile.module.test.ts',
        );
        assert.equal(verification.calls, 1);
        const source = fs.readFileSync(
            path.join(fixture.moduleRoot, 'test/user-profile.module.test.ts'),
            'utf8',
        );
        assert.match(source, /UserProfileModule\.definition\.name/);
        assert.match(source, /USER_PROFILE_MODULE_NAME/);
        assert.match(
            fs.readFileSync(fixture.catalogPath, 'utf8'),
            /src\/module\/user-profile\/test\/user-profile\.module\.test\.ts/,
        );
    } finally {
        fixture.dispose();
    }
});

test('test scaffold rejects invalid targets and rolls back verification failures', () => {
    const fixture = new TestScaffoldFixture();
    const originalCatalog = fs.readFileSync(fixture.catalogPath, 'utf8');
    try {
        assert.throws(
            () => new TestScaffolder(fixture.root, new RecordingVerification()).scaffold('../bad'),
            /lowercase kebab-case/u,
        );
        assert.throws(
            () => new TestScaffolder(fixture.root, new RecordingVerification()).scaffold('missing'),
            /does not exist/u,
        );
        assert.throws(
            () => new TestScaffolder(fixture.root, new FailingVerification()).scaffold('user-profile'),
            /Unable to scaffold test/u,
        );
        assert.equal(fs.existsSync(path.join(fixture.moduleRoot, 'test')), false);
        assert.equal(fs.readFileSync(fixture.catalogPath, 'utf8'), originalCatalog);
    } finally {
        fixture.dispose();
    }
});

test('test scaffold CLI documents syntax and stable exit codes', () => {
    const fixture = new TestScaffoldFixture();
    try {
        const stdout = new BufferWriter();
        const stderr = new BufferWriter();
        const cli = new TestScaffoldCli(
            new TestScaffolder(fixture.root, new RecordingVerification()),
            stdout,
            stderr,
        );
        assert.equal(cli.run(['--help']), 0);
        assert.match(stdout.value, /scaffold:test/u);
        assert.equal(cli.run([]), 1);
        assert.equal(cli.run(['missing']), 1);
        assert.match(stderr.value, /Expected exactly one|does not exist/u);
    } finally {
        fixture.dispose();
    }
});
