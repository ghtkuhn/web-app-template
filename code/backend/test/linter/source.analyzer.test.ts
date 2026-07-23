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
            { source: './input.ts', kind: 'import', typeOnly: true },
            { source: './value.ts', kind: 'export', typeOnly: false },
            { source: './output.ts', kind: 'export', typeOnly: true },
            { source: './required.ts', kind: 'require', typeOnly: false },
            {
                source: './lazy.ts',
                kind: 'dynamic-import',
                typeOnly: false,
            },
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

test('source analyzer captures contracts, casts, errors, and persistence order', () => {
    const fixture = new FixtureProject();
    try {
        const filePath = fixture.write(
            'code/backend/src/module/example/service/example.service.ts',
            `export class ExampleService extends BaseService implements ExamplePort {
                public passwordHash: string = '';

                public async create(request: any): Promise<HandlerResult<UserDTO>> {
                    try {
                        const user = new UserObject(request.body);
                        const store = this.store as unknown as UserStore;
                        user.validate();
                        await store.save(user);
                        return { success: false, error: request.message };
                    } catch (error) {
                        throw error;
                    }
                }
            }`,
        );
        const analysis = new SourceAnalyzer().analyze(filePath);

        assert.equal(analysis.classes[0].name, 'ExampleService');
        assert.deepEqual(analysis.classes[0].implementedNames, [
            'ExamplePort',
        ]);
        assert.ok(analysis.classes[0].methodNames.includes('create'));
        assert.ok(analysis.classes[0].propertyNames.includes('passwordHash'));
        assert.ok(analysis.parameterNames.includes('request'));
        assert.ok(analysis.returnTypeNames.includes('Promise'));
        assert.equal(analysis.anyTypeCount, 1);
        assert.equal(analysis.catchCount, 1);
        assert.equal(analysis.objectReturnCount, 1);
        assert.equal(analysis.requestBodyAccessCount, 1);
        assert.equal(analysis.unknownCastCount, 1);
        assert.equal(analysis.throwMessageAccessCount, 1);
        assert.equal(analysis.constructorCalls[0].className, 'UserObject');
        assert.ok(
            analysis.validationCallOffsets[0] <
                analysis.persistenceCallOffsets[0],
        );
    } finally {
        fixture.dispose();
    }
});
