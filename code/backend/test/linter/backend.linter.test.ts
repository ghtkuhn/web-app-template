import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { BackendLinter } from '../../script/linter/backend.linter.ts';
import { FixtureProject } from './fixture-project.ts';

test('real backend satisfies all architecture rules', () => {
    const projectRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../..',
    );
    const result = new BackendLinter({ projectRoot }).run();
    assert.deepEqual(result.issues, []);
    assert.ok(result.filesChecked > 0);
});

test('backend modules must use the singular module directory', () => {
    const fixture = new FixtureProject();
    try {
        fixture.mkdir('code/backend/src/modules');

        const emptyDirectoryIssues = new BackendLinter({
            projectRoot: fixture.root,
        }).run().issues;
        assert.deepEqual(emptyDirectoryIssues, [
            {
                ruleId: 'MODULE_DIRECTORY_NAME',
                severity: 'error',
                file: 'code/backend/src/modules',
                message:
                    'Backend modules must be placed in ' +
                    'code/backend/src/module/<name>/; ' +
                    'code/backend/src/modules/ is forbidden.',
            },
        ]);

        fixture.write(
            'code/backend/src/modules/example/index.ts',
            'export class IncorrectModule {}',
        );

        const populatedDirectoryIssues = new BackendLinter({
            projectRoot: fixture.root,
        }).run().issues;
        assert.deepEqual(
            populatedDirectoryIssues.map((issue) => issue.ruleId),
            ['MODULE_DIRECTORY_NAME'],
        );
    } finally {
        fixture.dispose();
    }
});

test('DTO classes must extend BaseDTO or EntityDTO', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/dto/valid.dto.ts',
            `import { BaseDTO } from '../../../base/base.dto.ts';
             export class ValidDTO extends BaseDTO {}`,
        );
        fixture.write(
            'code/backend/src/module/example/dto/invalid.dto.ts',
            'export class InvalidDTO {}',
        );

        const issues = new BackendLinter({ projectRoot: fixture.root }).run()
            .issues;
        assert.deepEqual(
            issues.map((issue) => issue.ruleId),
            ['LAYER_BASE_CLASS'],
        );
        assert.match(issues[0].file, /invalid\.dto\.ts$/);
    } finally {
        fixture.dispose();
    }
});

test('architecture folders enforce their required base classes', () => {
    const fixture = new FixtureProject();
    try {
        const cases = [
            ['controller', 'BaseController'],
            ['service', 'BaseService'],
            ['store', 'BaseStore'],
            ['object', 'BaseObject'],
            ['api', 'NodeHandler'],
        ];
        for (const [folder, baseClass] of cases) {
            fixture.write(
                `code/backend/src/module/example/${folder}/valid.${folder}.ts`,
                `export class Valid${folder} extends ${baseClass} {}`,
            );
            fixture.write(
                `code/backend/src/module/example/${folder}/invalid.${folder}.ts`,
                `export class Invalid${folder} {}`,
            );
        }

        const issues = new BackendLinter({ projectRoot: fixture.root }).run()
            .issues;
        assert.equal(
            issues.filter((issue) => issue.ruleId === 'LAYER_BASE_CLASS')
                .length,
            cases.length,
        );
    } finally {
        fixture.dispose();
    }
});

test('cross-module imports and re-exports must use the public index', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/alpha/api/alpha.handler.ts',
            `import { PublicPort } from '../../beta/index.ts';
             export { InternalDTO } from '../../beta/dto/internal.dto.ts';
             export class AlphaHandler extends BaseHandler {}`,
        );
        fixture.write(
            'code/backend/src/module/beta/index.ts',
            'export interface PublicPort {}',
        );
        fixture.write(
            'code/backend/src/module/beta/dto/internal.dto.ts',
            'export class InternalDTO extends BaseDTO {}',
        );

        const issues = new BackendLinter({ projectRoot: fixture.root }).run()
            .issues;
        assert.equal(
            issues.filter(
                (issue) => issue.ruleId === 'CROSS_MODULE_PUBLIC_ENTRY',
            ).length,
            1,
        );
    } finally {
        fixture.dispose();
    }
});

test('layer direction, declaration placement, and controller mapping are enforced', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/api/example.handler.ts',
            `import { ExampleService } from '../service/example.service.ts';
             export interface Misplaced {}
             export class ExampleHandler extends BaseHandler {}`,
        );
        fixture.write(
            'code/backend/src/module/example/controller/example.controller.ts',
            `export class ExampleController extends BaseController {
                 run() { return this.fromObject(); }
             }`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('LAYER_IMPORT_DIRECTION'));
        assert.ok(ruleIds.includes('DECLARATION_INTERFACE_LOCATION'));
        assert.ok(ruleIds.includes('CONTROLLER_MAPPING'));
    } finally {
        fixture.dispose();
    }
});

test('all restricted layer directions are enforced', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/controller/example.controller.ts',
            `import { Store } from '../store/example.store.ts';
             export class ExampleController extends BaseController {}`,
        );
        fixture.write(
            'code/backend/src/module/example/service/example.service.ts',
            `import { Handler } from '../api/example.handler.ts';
             export class ExampleService extends BaseService {}`,
        );
        fixture.write(
            'code/backend/src/module/example/store/example.store.ts',
            `import { DTO } from '../dto/example.dto.ts';
             export class ExampleStore extends BaseStore {}`,
        );
        fixture.write(
            'code/backend/src/module/example/dto/example.dto.ts',
            `import { Service } from '../service/example.service.ts';
             export class ExampleDTO extends BaseDTO {}`,
        );

        const issues = new BackendLinter({ projectRoot: fixture.root }).run()
            .issues;
        assert.equal(
            issues.filter((issue) => issue.ruleId === 'LAYER_IMPORT_DIRECTION')
                .length,
            4,
        );
    } finally {
        fixture.dispose();
    }
});

test('regular module files reject misplaced declarations and structure', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/misc/invalid.ts',
            `export interface Contract {}
             export type Alias = string;
             export const VALUE = 1;
             export function loose() {}
             export class First {}
             export class Second {}`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.deepEqual(ruleIds, [
            'DECLARATION_CONSTANT_LOCATION',
            'DECLARATION_INTERFACE_LOCATION',
            'DECLARATION_TYPE_LOCATION',
            'MODULE_CLASS_COUNT',
            'MODULE_FREE_FUNCTION',
        ]);
    } finally {
        fixture.dispose();
    }
});

test('composition and domain code respect dependency direction', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module.registry.ts',
            `import { Internal } from './module/example/service/internal.ts';
             export class Registry {}`,
        );
        fixture.write(
            'code/backend/src/module.catalog.ts',
            `import { Internal } from './module/example/service/internal.ts';
             export const definitions = {};`,
        );
        fixture.write(
            'code/backend/src/module/example/service/internal.ts',
            `import { Registry } from '../../../module.registry.ts';
             import { definitions } from '../../../module.catalog.ts';
             export class Internal extends BaseService {}`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('COMPOSITION_PUBLIC_ENTRY'));
        assert.ok(ruleIds.includes('DOMAIN_COMPOSITION_IMPORT'));
        assert.equal(
            ruleIds.filter(
                (ruleId) => ruleId === 'COMPOSITION_PUBLIC_ENTRY',
            ).length,
            2,
        );
        assert.equal(
            ruleIds.filter(
                (ruleId) => ruleId === 'DOMAIN_COMPOSITION_IMPORT',
            ).length,
            2,
        );
    } finally {
        fixture.dispose();
    }
});

test('the generated catalog only aggregates module-owned definitions', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module.catalog.ts',
            `import { ExampleModule } from './module/example/index.ts';
             export const definitions = {
                 example: {
                     dependencies: [],
                     create: () => new ExampleModule(),
                 },
             };`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('CATALOG_AGGREGATION_ONLY'));
    } finally {
        fixture.dispose();
    }
});

test('database drivers and connections are owned by base.database', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/store/example.store.ts',
            `const Database = require('better-sqlite3');
             import { DatabaseManager } from '../../../base/base.database.ts';
             export class ExampleStore extends BaseStore {
                 connect() { return new Kysely({ dialect: Database }); }
             }`,
        );
        fixture.write(
            'code/backend/src/base/base.database.ts',
            `import Database from 'better-sqlite3';
             export class DatabaseManager {
                 connect() { return new Kysely({ dialect: Database }); }
             }`,
        );

        const issues = new BackendLinter({ projectRoot: fixture.root }).run()
            .issues;
        assert.deepEqual(
            issues
                .filter((issue) => issue.ruleId.startsWith('DATABASE_'))
                .map((issue) => issue.ruleId),
            ['DATABASE_CONNECTION_CREATION', 'DATABASE_DRIVER_IMPORT'],
        );
        assert.ok(
            issues.some(
                (issue) => issue.ruleId === 'LAYER_IMPORT_DIRECTION',
            ),
        );
    } finally {
        fixture.dispose();
    }
});

test('module root files and parser failures produce stable findings', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/direct.txt',
            'not a TypeScript source file',
        );
        fixture.write(
            'code/backend/src/module/example/broken.ts',
            'export class {',
        );

        const issues = new BackendLinter({ projectRoot: fixture.root }).run()
            .issues;
        assert.deepEqual(
            issues.map((issue) => issue.ruleId),
            ['MODULE_ROOT_FILE', 'SOURCE_PARSE_ERROR'],
        );
        assert.equal(issues[1].severity, 'fatal');
    } finally {
        fixture.dispose();
    }
});

test('all supported layers accept owner-bound auxiliary classes', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/api/health.http.handler.ts',
            `import { ParserApiAux } from './health/parser.api-aux.ts';
             export class HealthHttpHandler extends HttpHandler {}`,
        );
        fixture.write(
            'code/backend/src/module/example/api/health.node.handler.ts',
            `import { ParserApiAux } from './health/parser.api-aux.ts';
             export class HealthNodeHandler extends NodeHandler {}`,
        );
        fixture.write(
            'code/backend/src/module/example/api/health/parser.api-aux.ts',
            'export class ParserApiAux extends BaseApiAux {}',
        );
        fixture.write(
            'code/backend/src/module/example/controller/health.controller.ts',
            `import { ResultControllerAux } from './health/result.controller-aux.ts';
             export class HealthController extends BaseController {}`,
        );
        fixture.write(
            'code/backend/src/module/example/controller/health/result.controller-aux.ts',
            'export class ResultControllerAux extends BaseControllerAux {}',
        );
        fixture.write(
            'code/backend/src/module/example/service/health.service.ts',
            `import { StatusServiceAux } from './health/status.service-aux.ts';
             export class HealthService extends BaseService {}`,
        );
        fixture.write(
            'code/backend/src/module/example/service/health/status.service-aux.ts',
            'export class StatusServiceAux extends BaseServiceAux {}',
        );
        fixture.write(
            'code/backend/src/module/example/store/health.store.ts',
            `import { QueryStoreAux } from './health/query.store-aux.ts';
             export class HealthStore extends BaseStore {}`,
        );
        fixture.write(
            'code/backend/src/module/example/store/health/query.store-aux.ts',
            'export class QueryStoreAux extends BaseStoreAux {}',
        );

        const result = new BackendLinter({ projectRoot: fixture.root }).run();
        assert.deepEqual(result.issues, []);
    } finally {
        fixture.dispose();
    }
});

test('auxiliary classes require their matching base and exactly one class', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/service/health.service.ts',
            'export class HealthService extends BaseService {}',
        );
        fixture.write(
            'code/backend/src/module/example/service/health/missing.ts',
            'export const value = 1;',
        );
        fixture.write(
            'code/backend/src/module/example/service/health/multiple.ts',
            `export class First extends BaseServiceAux {}
             export class Second extends BaseServiceAux {}`,
        );
        fixture.write(
            'code/backend/src/module/example/service/health/wrong.ts',
            `export function loose() {}
             export class Wrong extends BaseService {}`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.deepEqual(ruleIds, [
            'AUX_CLASS_COUNT',
            'DECLARATION_CONSTANT_LOCATION',
            'AUX_CLASS_COUNT',
            'LAYER_BASE_CLASS',
            'MODULE_FREE_FUNCTION',
        ]);
    } finally {
        fixture.dispose();
    }
});

test('auxiliary paths require a supported layer, one level, and an owner', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/service/orphan/helper.ts',
            'export class Helper extends BaseServiceAux {}',
        );
        fixture.write(
            'code/backend/src/module/example/service/health/nested/helper.ts',
            'export class Nested extends BaseServiceAux {}',
        );
        fixture.write(
            'code/backend/src/module/example/dto/health/helper.ts',
            'export class DTOHelper extends BaseDTO {}',
        );
        fixture.write(
            'code/backend/src/module/example/service/health/readme.txt',
            'Auxiliary folders contain TypeScript sources only.',
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.deepEqual(ruleIds, [
            'AUX_LAYER_UNSUPPORTED',
            'AUX_PATH_DEPTH',
            'AUX_FILE_TYPE',
            'AUX_OWNER_MISSING',
        ]);
    } finally {
        fixture.dispose();
    }
});

test('auxiliary imports are private, one-way, and never re-exported', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/service/health.service.ts',
            `import { OwnAux } from './health/own.ts';
             export { OwnAux as PublicAux } from './health/own.ts';
             export class HealthService extends BaseService {}`,
        );
        fixture.write(
            'code/backend/src/module/example/service/other.service.ts',
            `import { OwnAux } from './health/own.ts';
             export class OtherService extends BaseService {}`,
        );
        fixture.write(
            'code/backend/src/module/example/service/health/own.ts',
            `import { HealthService } from '../health.service.ts';
             export class OwnAux extends BaseServiceAux {}`,
        );
        fixture.write(
            'code/backend/src/module/example/service/health/peer.ts',
            `import { OwnAux } from './own.ts';
             export class PeerAux extends BaseServiceAux {}`,
        );
        fixture.write(
            'code/backend/src/module/example/controller/example.controller.ts',
            `import { OwnAux } from '../service/health/own.ts';
             export class ExampleController extends BaseController {}`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.deepEqual(ruleIds, [
            'AUX_IMPORT_OWNER',
            'AUX_REEXPORT',
            'AUX_IMPORT_DIRECTION',
            'AUX_IMPORT_OWNER',
            'AUX_IMPORT_OWNER',
        ]);
    } finally {
        fixture.dispose();
    }
});

test('auxiliary classes retain their architecture layer restrictions', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/api/health.http.handler.ts',
            'export class HealthHttpHandler extends HttpHandler {}',
        );
        fixture.write(
            'code/backend/src/module/example/api/health/helper.ts',
            `import { Service } from '../../service/health.service.ts';
             export class Helper extends BaseApiAux {}`,
        );
        fixture.write(
            'code/backend/src/module/example/store/health.store.ts',
            'export class HealthStore extends BaseStore {}',
        );
        fixture.write(
            'code/backend/src/module/example/store/health/helper.ts',
            `import { DTO } from '../../dto/health.dto.ts';
             export class Helper extends BaseStoreAux {}`,
        );

        const issues = new BackendLinter({ projectRoot: fixture.root }).run()
            .issues;
        assert.equal(
            issues.filter(
                (issue) => issue.ruleId === 'LAYER_IMPORT_DIRECTION',
            ).length,
            2,
        );
    } finally {
        fixture.dispose();
    }
});
