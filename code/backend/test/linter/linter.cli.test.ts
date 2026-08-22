import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LintWriter } from '../../script/linter/interfaces.ts';
import { LinterCli } from '../../script/linter/linter.cli.ts';
import { FixtureProject } from './fixture-project.ts';

class StringWriter implements LintWriter {
    public value = '';

    public write(chunk: string): void {
        this.value += chunk;
    }
}

test('linter CLI returns zero and writes a success summary', () => {
    const fixture = new FixtureProject();
    const stdout = new StringWriter();
    const stderr = new StringWriter();
    try {
        fixture.write(
            'code/backend/src/module/example/index.ts',
            `export class ExampleModule extends BaseModule implements ExampleModulePort {
                public static readonly definition = {
                    name: 'example',
                    dependencies: [],
                    create: () => new ExampleModule(),
                } satisfies NamedModuleDefinition;
            }
            export type { ExampleModulePort } from './interfaces.ts';`,
        );
        const exitCode = new LinterCli(fixture.root, stdout, stderr).run();
        assert.equal(exitCode, 0);
        assert.match(stdout.value, /architecture valid/);
        assert.equal(stderr.value, '');
    } finally {
        fixture.dispose();
    }
});

test('linter CLI returns one with deterministic architecture diagnostics', () => {
    const fixture = new FixtureProject();
    const stderr = new StringWriter();
    try {
        fixture.write(
            'code/backend/src/module/zeta/dto/zeta.dto.ts',
            'export class ZetaDTO {}',
        );
        fixture.write(
            'code/backend/src/module/alpha/dto/alpha.dto.ts',
            'export class AlphaDTO {}',
        );
        const exitCode = new LinterCli(
            fixture.root,
            new StringWriter(),
            stderr,
        ).run();
        assert.equal(exitCode, 1);
        assert.match(stderr.value, /ERROR \[[A-Z_]+\] .+/u);
        assert.match(stderr.value, /Where: .*module\/alpha/u);
        assert.match(stderr.value, /Found: /u);
        assert.match(stderr.value, /Why: /u);
        assert.match(stderr.value, /Meaning: /u);
        assert.match(stderr.value, /Architecture: /u);
        assert.match(stderr.value, /How to fix:\n  1\. /u);
        assert.match(stderr.value, /Verify:\n  npm run /u);
        assert.ok(
            stderr.value.indexOf('module/alpha') <
                stderr.value.indexOf('module/zeta'),
        );
        assert.doesNotMatch(stderr.value, /ARCHITECTURE\.md/u);
    } finally {
        fixture.dispose();
    }
});

test('linter CLI emits one versioned JSON diagnostic document', () => {
    const fixture = new FixtureProject();
    const stdout = new StringWriter();
    const stderr = new StringWriter();
    try {
        fixture.write(
            'code/backend/src/module/example/dto/example.dto.ts',
            'export class ExampleDTO {}',
        );
        const exitCode = new LinterCli(
            fixture.root,
            stdout,
            stderr,
            'json',
        ).run();
        const payload = JSON.parse(stdout.value) as {
            schemaVersion: number;
            issues: Array<{
                title: string;
                observed: string;
                why: string;
                meaning: string;
                context: string;
                fixSteps: string[];
                verify: string[];
                location: { start: { line: number; column: number } } | null;
            }>;
        };

        assert.equal(exitCode, 1);
        assert.equal(stderr.value, '');
        assert.equal(payload.schemaVersion, 2);
        assert.ok(payload.issues[0].title.length > 0);
        assert.ok(payload.issues[0].observed.length > 0);
        assert.ok(payload.issues[0].why.length > 0);
        assert.ok(payload.issues[0].meaning.length > 0);
        assert.ok(payload.issues[0].context.length > 0);
        assert.ok(payload.issues[0].fixSteps.length > 0);
        assert.ok(payload.issues[0].verify.length > 0);
    } finally {
        fixture.dispose();
    }
});

test('linter CLI returns two for parser failures', () => {
    const fixture = new FixtureProject();
    const stderr = new StringWriter();
    try {
        fixture.write(
            'code/backend/src/module/example/broken.ts',
            'export class {',
        );
        const exitCode = new LinterCli(
            fixture.root,
            new StringWriter(),
            stderr,
        ).run();
        assert.equal(exitCode, 2);
        assert.match(stderr.value, /FATAL \[SOURCE_PARSE_ERROR\]/u);
        assert.match(stderr.value, /Why: /u);
        assert.match(stderr.value, /How to fix:/u);
        assert.doesNotMatch(stderr.value, /ARCHITECTURE\.md/u);
    } finally {
        fixture.dispose();
    }
});
