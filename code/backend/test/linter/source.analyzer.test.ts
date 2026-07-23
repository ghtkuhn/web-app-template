import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SourceAnalyzer } from '../../script/linter/source.analyzer.ts';
import { FixtureProject } from './fixture-project.ts';

test('source analyzer captures imports, re-exports, and top-level declarations', () => {
    const fixture = new FixtureProject();
    try {
        const filePath = fixture.write(
            'sample.ts',
            `
                import type { Input } from './input.ts';
                export { Value } from './value.ts';
                export type { Output } from './output.ts';
                const required = require('./required.ts');
                const lazy = import('./lazy.ts');
                export interface Contract {}
                export type Alias = string;
                export const VALUE = 1;
                export function loose() {}
                export class Example extends Namespace.Base {
                    method() {
                        this.fromObject();
                        class Nested {}
                        return Nested;
                    }
                }
            `,
        );

        const analysis = new SourceAnalyzer().analyze(filePath);
        assert.deepEqual(analysis.dependencies, [
            { source: './input.ts', kind: 'import' },
            { source: './value.ts', kind: 'export' },
            { source: './output.ts', kind: 'export' },
            { source: './required.ts', kind: 'require' },
            { source: './lazy.ts', kind: 'dynamic-import' },
        ]);
        assert.equal(analysis.interfaceCount, 1);
        assert.equal(analysis.typeCount, 1);
        assert.equal(analysis.constantCount, 3);
        assert.equal(analysis.functionCount, 1);
        assert.deepEqual(analysis.classBaseNames, ['Namespace.Base']);
        assert.deepEqual(analysis.methodCalls, ['fromObject']);
    } finally {
        fixture.dispose();
    }
});

test('source analyzer rejects malformed TypeScript', () => {
    const fixture = new FixtureProject();
    try {
        const filePath = fixture.write('broken.ts', 'export class {');
        assert.throws(() => new SourceAnalyzer().analyze(filePath));
    } finally {
        fixture.dispose();
    }
});
