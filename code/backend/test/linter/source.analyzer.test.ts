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
        assert.deepEqual(
            analysis.dependencies.map(({ location: _location, ...item }) =>
                item,
            ),
            [
                { source: './input.ts', kind: 'import', typeOnly: true },
                { source: './value.ts', kind: 'export', typeOnly: false },
                { source: './output.ts', kind: 'export', typeOnly: true },
                { source: './required.ts', kind: 'require', typeOnly: false },
                {
                    source: './lazy.ts',
                    kind: 'dynamic-import',
                    typeOnly: false,
                },
            ],
        );
        assert.deepEqual(analysis.dependencies[0].location.start, {
            line: 2,
            column: 17,
        });
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

test('source analyzer captures executable architecture evidence structurally', () => {
    const fixture = new FixtureProject();
    try {
        const filePath = fixture.write(
            'evidence.ts',
            `interface ExamplePort extends BaseModule {}
            type ExampleNodeRequest =
                | { operation: 'create'; payload: CreateDTO }
                | { operation: 'read'; payload: ReadDTO };
            class Example {
                public static readonly definition = {
                    name: 'example',
                    dependencies: [],
                    create: () => new Example(),
                } satisfies NamedModuleDefinition;

                constructor(private readonly hidden: string) {}

                async run(request: Request, row: Row) {
                    this.registerHandler('http', new ExampleHttpHandler());
                    const payload = await request.json();
                    const dto = new CreateDTO(payload);
                    this.controller.create(dto);
                    const response = await fetch('https://test/api/example', {
                        method: 'POST',
                    });
                    assert.equal(response.status, 201);
                    return new ExampleObject({
                        id: row.id,
                        createdAt: row.created_at,
                    });
                }
            }`,
        );
        const analysis = new SourceAnalyzer().analyze(filePath);

        assert.deepEqual(analysis.interfaceBaseNames, ['BaseModule']);
        assert.equal(
            analysis.typeAliasOperationKinds[0].operationLiteralCount,
            2,
        );
        assert.equal(analysis.ownedModuleDefinitionCount, 1);
        assert.deepEqual(analysis.ownedModuleDefinitionProperties, [
            'name',
            'dependencies',
            'create',
        ]);
        assert.equal(analysis.nonErasableSyntaxCount, 1);
        assert.deepEqual(analysis.handlerRegistrations, [
            { transport: 'http', handlerClass: 'ExampleHttpHandler' },
        ]);
        assert.equal(analysis.httpTestOperations.length, 1);
        assert.equal(analysis.httpTestOperations[0].method, 'POST');
        assert.equal(analysis.httpTestOperations[0].path, '/api/example');
        assert.equal(
            analysis.httpTestOperations[0].responseName,
            'response',
        );
        assert.ok((analysis.httpTestOperations[0].offset ?? 0) > 0);
        assert.deepEqual(analysis.assertedHttpStatuses, [201]);
        assert.deepEqual(analysis.jsonResultVariables, ['payload']);
        assert.deepEqual(analysis.dtoResultVariables, ['dto']);
        assert.deepEqual(analysis.controllerPayloadVariables, ['dto']);
        assert.deepEqual(analysis.objectMappings[0].sourceProperties, [
            'id',
            'created_at',
        ]);
    } finally {
        fixture.dispose();
    }
});
