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
        const lines = stderr.value.trim().split('\n');
        assert.equal(
            lines[0],
            'You must Read code/backend/ARCHITECTURE.md to understand the required backend structure.',
        );
        assert.match(lines[1], /module\/alpha/);
        assert.match(lines[4], /module\/zeta/);
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
                reason: string;
                fix: string;
                location: { start: { line: number; column: number } };
            }>;
        };

        assert.equal(exitCode, 1);
        assert.equal(stderr.value, '');
        assert.equal(payload.schemaVersion, 1);
        assert.ok(payload.issues[0].reason.length > 0);
        assert.ok(payload.issues[0].fix.length > 0);
        assert.ok(payload.issues[0].location.start.line >= 1);
        assert.ok(payload.issues[0].location.start.column >= 1);
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
        const lines = stderr.value.trim().split('\n');
        assert.equal(
            lines[0],
            'You must Read code/backend/ARCHITECTURE.md to understand the required backend structure.',
        );
        assert.ok(
            lines
                .slice(1)
                .some((line) => /FATAL \[SOURCE_PARSE_ERROR\]/.test(line)),
        );
    } finally {
        fixture.dispose();
    }
});
