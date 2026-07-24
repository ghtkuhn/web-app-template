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
            'MODULE_DIRECTORY_UNKNOWN',
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

test('unknown module directories report allowed directories and root files', () => {
    const fixture = new FixtureProject();
    try {
        fixture.mkdir('code/backend/src/module/example/constants');

        const issue = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.find(
                (candidate) =>
                    candidate.ruleId === 'MODULE_DIRECTORY_UNKNOWN',
            );
        assert.equal(
            issue?.message,
            "Unsupported module-root directory 'constants'. Allowed directories: api, controller, dto, object, service, store. Module contracts and metadata must use these root files: constants.ts, index.ts, interfaces.ts, types.ts.",
        );
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
            [
                'MODULE_ROOT_FILE',
                'MODULE_ROOT_PLACEMENT',
                'SOURCE_PARSE_ERROR',
            ],
        );
        assert.equal(issues[2].severity, 'fatal');
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
            'LAYER_FILE_NAME',
            'AUX_CLASS_COUNT',
            'LAYER_FILE_NAME',
            'LAYER_BASE_CLASS',
            'LAYER_FILE_NAME',
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
            'LAYER_FILE_NAME',
            'AUX_PATH_DEPTH',
            'LAYER_FILE_NAME',
            'AUX_FILE_TYPE',
            'AUX_OWNER_MISSING',
            'LAYER_FILE_NAME',
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
            'LAYER_FILE_NAME',
            'AUX_IMPORT_OWNER',
            'LAYER_FILE_NAME',
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

test('module roots, entries, registration, and local imports are strict', () => {
    const fixture = new FixtureProject();
    try {
        fixture.mkdir('code/backend/src/module/empty');
        fixture.write(
            'code/backend/src/module/example/user.ts',
            `import { BaseObject } from '../../base/base.object';
             export class User extends BaseObject {}`,
        );
        fixture.mkdir('code/backend/src/module/example/unexpected');
        fixture.mkdir('code/backend/src/module/example/dto');
        fixture.write(
            'code/backend/src/module/example/.DS_Store',
            'metadata',
        );
        fixture.write('code/backend/src/module.catalog.ts', 'export {};');

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        for (const ruleId of [
            'MODULE_ENTRY_MISSING',
            'MODULE_ROOT_PLACEMENT',
            'MODULE_DIRECTORY_UNKNOWN',
            'MODULE_DIRECTORY_EMPTY',
            'MODULE_NON_SOURCE_FILE',
            'MODULE_REGISTRATION_MISSING',
            'LOCAL_IMPORT_EXTENSION',
        ]) {
            assert.ok(ruleIds.includes(ruleId), ruleId);
        }
    } finally {
        fixture.dispose();
    }
});

test('module entry diagnostic explains the complete required contract', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/index.ts',
            'export class IncorrectModule {}',
        );
        fixture.write(
            'code/backend/src/module/example/interfaces.ts',
            'export interface IncorrectPort {}',
        );

        const issue = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.find(
                (candidate) =>
                    candidate.ruleId === 'MODULE_ENTRY_CONTRACT',
            );
        assert.equal(
            issue?.message,
            "The example module entry is incomplete. Fix: Export ExampleModule from index.ts and extend BaseModule. ExampleModule must implement ExampleModulePort. ExampleModule must declare public static readonly definition in index.ts. The static definition must satisfy NamedModuleDefinition. Export interface ExampleModulePort from interfaces.ts. Make ExampleModulePort public from the module entry. Add this exact top-level line to index.ts: export type { ExampleModulePort } from './interfaces.ts'; An import type statement is private to index.ts and does not expose the port to consumers. Keep the interface in interfaces.ts; do not move or redeclare it.",
        );
    } finally {
        fixture.dispose();
    }
});

test('module entry diagnostic reports only incorrect contract parts', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/interfaces.ts',
            'export interface ExampleModulePort {}',
        );
        fixture.write(
            'code/backend/src/module/example/index.ts',
            `export type { ExampleModulePort } from './interfaces.ts';
             export class ExampleModule
                 extends BaseModule
                 implements ExampleModulePort {}`,
        );

        const issue = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.find(
                (candidate) =>
                    candidate.ruleId === 'MODULE_ENTRY_CONTRACT',
            );
        assert.equal(
            issue?.message,
            'The example module entry is incomplete. Fix: ExampleModule must declare public static readonly definition in index.ts. The static definition must satisfy NamedModuleDefinition.',
        );
    } finally {
        fixture.dispose();
    }
});

test('controllers, handlers, DTO boundaries, and architecture casts are strict', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/controller/auth.controller.ts',
            `export class AuthController extends BaseController {
                public async login(req: any, res: any): Promise<HandlerResult<User>> {
                    try {
                        const result = await this.authService.login(req.body);
                        return { success: true, data: result, error: res.message };
                    } catch (error) {
                        return { success: false, error: error.message };
                    }
                }
            }`,
        );
        fixture.write(
            'code/backend/src/module/example/api/auth.http.handler.ts',
            `import { UserObject } from '../object/user.object.ts';
             export class AuthHttpHandler extends HttpHandler {
                 protected processRequest(): Promise<HandlerResult<UserObject>> {
                     return this.controller.login();
                 }
             }`,
        );
        fixture.write(
            'code/backend/src/module/example/service/auth.service.ts',
            `export class AuthService extends BaseService {
                public run() { return this.store as unknown as AuthStore; }
            }`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        for (const ruleId of [
            'CONTROLLER_TRANSPORT_INPUT',
            'CONTROLLER_DTO_CONTRACT',
            'CONTROLLER_ERROR_TRANSLATION',
            'RAW_ERROR_RESPONSE',
            'ANONYMOUS_RESPONSE_CONTRACT',
            'LAYER_RETURN_CONTRACT',
            'HANDLER_DTO_OUTPUT',
            'DOMAIN_OBJECT_TRANSPORT',
            'DOMAIN_ARCHITECTURE_CAST',
        ]) {
            assert.ok(ruleIds.includes(ruleId), ruleId);
        }
    } finally {
        fixture.dispose();
    }
});

test('stores and services enforce typed mapping and validation', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/store/user.store.ts',
            `export class UserStore extends BaseStore {
                public async save(user: any): Promise<any> {
                    const result = await this.db.updateTable('users').executeTakeFirst();
                    return new UserObject(result);
                }
            }`,
        );
        fixture.write(
            'code/backend/src/module/example/service/user.service.ts',
            `export class UserService extends BaseService {
                public async create(): Promise<UserDTO> {
                    const user = new UserObject({});
                    await this.store.save(user);
                    user.validate();
                    return new UserDTO();
                }
            }`,
        );
        fixture.write(
            'code/backend/src/database.ts',
            `export interface UserTable {
                id: string;
                created_at: string;
            }`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        for (const ruleId of [
            'STORE_ANY_TYPE',
            'STORE_QUERY_OBJECT_MAPPING',
            'STORE_SAVE_SEMANTICS',
            'DATABASE_OBJECT_METADATA',
            'OBJECT_VALIDATION_BEFORE_PERSIST',
        ]) {
            assert.ok(ruleIds.includes(ruleId), ruleId);
        }
    } finally {
        fixture.dispose();
    }
});

test('domain configuration, secrets, serialization, and dependencies are strict', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/constants.ts',
            `import { z } from 'zod';
             export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
             export const LoginSchema = z.object({});`,
        );
        fixture.write(
            'code/backend/src/module/example/object/user.object.ts',
            `export class UserObject extends BaseObject {
                public passwordHash = '';
            }`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        for (const ruleId of [
            'CONSTANT_EXECUTABLE_VALUE',
            'DOMAIN_ENV_ACCESS',
            'SECRET_FALLBACK',
            'SENSITIVE_OBJECT_SERIALIZATION',
            'UNDECLARED_WORKSPACE_DEPENDENCY',
        ]) {
            assert.ok(ruleIds.includes(ruleId), ruleId);
        }
    } finally {
        fixture.dispose();
    }
});

test('constants accept recursively passive data and static expressions', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/constants.ts',
            `const STATUS = { OK: 'ok' } as const;
             export const VALUES = {
                 name: 'example',
                 enabled: true,
                 attempts: 3,
                 nested: [null, STATUS.OK],
                 timeout: 5 * 1000,
                 label: \`status-\${STATUS.OK}\`,
             } as const;`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(!ruleIds.includes('CONSTANT_EXECUTABLE_VALUE'));
    } finally {
        fixture.dispose();
    }
});

test('constants reject executable values at every nesting depth', () => {
    const invalidInitializers = [
        `{
            name: 'auth',
            create(deps: any, infra: any): any {
                return require('./index.ts');
            },
        }`,
        `() => 'value'`,
        `function named() { return 'value'; }`,
        `class Anonymous {}`,
        `buildValue()`,
        `new Builder()`,
        `{ nested: { run: () => true } }`,
        `{ get value() { return 'value'; } }`,
        `target.value = 'changed'`,
        `import('./service/example.service.ts')`,
    ];
    for (const initializer of invalidInitializers) {
        const fixture = new FixtureProject();
        try {
            fixture.write(
                'code/backend/src/module/example/constants.ts',
                `export const VALUE = ${initializer};`,
            );
            const ruleIds = new BackendLinter({ projectRoot: fixture.root })
                .run()
                .issues.map((issue) => issue.ruleId);
            assert.ok(
                ruleIds.includes('CONSTANT_EXECUTABLE_VALUE'),
                initializer,
            );
        } finally {
            fixture.dispose();
        }
    }
});

test('HTTP routes require OpenAPI and integration-test coverage', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/api/session.http.handler.ts',
            `export class SessionHttpHandler extends HttpHandler {
                protected processRequest(request: Request): Promise<HandlerResult<SessionDTO>> {
                    const url = new URL(request.url);
                    if (request.method !== 'POST' || url.pathname !== '/api/session/login') {
                        return Promise.resolve({ success: false, error: 'Not found' });
                    }
                    return this.controller.login();
                }
            }`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('HTTP_OPENAPI_COVERAGE'));
        assert.ok(ruleIds.includes('MODULE_FACTORY_COMPLETENESS'));
    } finally {
        fixture.dispose();
    }
});

test('malformed package and OpenAPI contracts are fatal linter errors', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write('code/backend/package.json', '{ invalid');
        fixture.write('code/backend/openapi/openapi.yaml', 'not-openapi');

        const issues = new BackendLinter({ projectRoot: fixture.root }).run()
            .issues;
        assert.deepEqual(
            issues.map((issue) => issue.ruleId),
            ['OPENAPI_PARSE_ERROR', 'PACKAGE_MANIFEST_PARSE_ERROR'],
        );
        assert.ok(issues.every((issue) => issue.severity === 'fatal'));
    } finally {
        fixture.dispose();
    }
});

test('module contracts reject post-wiring, concrete ports, any, and bad node unions', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/interfaces.ts',
            'export interface ExampleModulePort extends BaseModule {}',
        );
        fixture.write(
            'code/backend/src/module/example/types.ts',
            `export type ExampleNodeRequest = {
                operation: 'create' | 'read';
                payload: CreateDTO | ReadDTO;
            };`,
        );
        fixture.write(
            'code/backend/src/module/example/index.ts',
            `export class ExampleModule extends BaseModule implements ExampleModulePort {
                public static readonly definition = {
                    ...EXAMPLE_DEFINITION,
                    create: (dependencies: any) => new ExampleModule(),
                } satisfies NamedModuleDefinition;

                public setInfrastructure(value: any): void {}
            }
            export type { ExampleModulePort } from './interfaces.ts';`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        for (const expected of [
            'DOMAIN_ANY_TYPE',
            'MODULE_DEFINITION_OWNERSHIP',
            'MODULE_INFRASTRUCTURE_CONTRACT',
            'MODULE_PORT_CONCRETE_BASE',
            'MODULE_POST_CONSTRUCTION_WIRING',
            'NODE_REQUEST_DISCRIMINATION',
        ]) {
            assert.ok(ruleIds.includes(expected), expected);
        }
    } finally {
        fixture.dispose();
    }
});

test('handlers reject unvalidated JSON and executable DTO schemas', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/api/input.http.handler.ts',
            `export class InputHttpHandler extends HttpHandler {
                protected async processRequest(request: Request): Promise<HandlerResult<InputResponseDTO>> {
                    const payload = await request.json();
                    return this.controller.create(payload);
                }
            }`,
        );
        fixture.write(
            'code/backend/src/module/example/dto/input.dto.ts',
            `export class InputDTO extends BaseDTO {
                public static readonly schema = validator.object({});
            }`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('HANDLER_UNVALIDATED_INPUT'));
        assert.ok(ruleIds.includes('HANDLER_DTO_INPUT'));
        assert.ok(ruleIds.includes('DTO_EXECUTABLE_LOGIC'));
    } finally {
        fixture.dispose();
    }
});

test('store semantics require metadata mapping, active filters, and soft delete', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/store/example.store.ts',
            `export class ExampleStore extends BaseStore {
                public findById(id: string) {
                    return this.db.selectFrom('examples').where('id', '=', id)
                        .selectAll().executeTakeFirst();
                }

                public map(row: ExampleRow) {
                    return new ExampleObject({ id: row.id });
                }

                public delete(id: string) {
                    return this.db.deleteFrom('examples').where('id', '=', id).execute();
                }
            }`,
        );
        fixture.write(
            'code/backend/test/example.store.test.ts',
            `const store = new ExampleStore(database);
            void store.findById('one');`,
        );
        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('STORE_OBJECT_METADATA_MAPPING'));
        assert.ok(ruleIds.includes('STORE_ACTIVE_READ_FILTER'));
        assert.ok(ruleIds.includes('STORE_SOFT_DELETE_CONTRACT'));
        assert.ok(!ruleIds.includes('STORE_TEST_EXECUTABLE_COVERAGE'));
    } finally {
        fixture.dispose();
    }
});

test('workspace ownership rejects nested locks, local TypeScript, and verify shortcuts', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/package.json',
            JSON.stringify({
                scripts: { verify: 'tsc' },
                dependencies: {},
                devDependencies: { typescript: '^5.0.0' },
            }),
        );
        fixture.write('code/backend/package-lock.json', '{}');
        fixture.write(
            'tsconfig.base.json',
            '{"compilerOptions":{"moduleResolution":"bundler","allowImportingTsExtensions":false,"noEmit":false}}',
        );
        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('WORKSPACE_LOCKFILE_OWNERSHIP'));
        assert.ok(ruleIds.includes('TOOLCHAIN_DEPENDENCY_OWNERSHIP'));
        assert.ok(ruleIds.includes('ROOT_COMPILER_CONFIG_CONTRACT'));
        assert.ok(ruleIds.includes('WORKSPACE_VERIFY_OWNERSHIP'));
    } finally {
        fixture.dispose();
    }
});

test('HTTP coverage requires executable requests and documented status assertions', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/openapi/openapi.yaml',
            `openapi: 3.1.0
info:
    title: Fixture
    version: 1.0.0
paths:
    /api/example:
        post:
            responses:
                "201":
                    description: Created
                "400":
                    description: Invalid`,
        );
        fixture.write(
            'code/backend/src/module/example/api/example.http.handler.ts',
            `export class ExampleHttpHandler extends HttpHandler {
                protected processRequest(request: Request): Promise<HandlerResult<ExampleDTO>> {
                    const url = new URL(request.url);
                    if (request.method !== 'POST' || url.pathname !== '/api/example') {
                        return Promise.resolve({ success: false, error: 'Not found' });
                    }
                    return this.controller.create();
                }
            }`,
        );
        fixture.write(
            'code/backend/test/example.http.test.ts',
            `// fetch('/api/example') is not executable coverage.
            const response = await fetch('http://test/api/example', {
                method: 'POST',
            });
            assert.equal(response.status, 201);`,
        );
        const issues = new BackendLinter({ projectRoot: fixture.root }).run()
            .issues;
        assert.ok(
            issues.some(
                (issue) => issue.ruleId === 'HTTP_STATUS_CONTRACT',
            ),
        );

        fixture.write(
            'code/backend/test/example.http.test.ts',
            `// /api/example`,
        );
        const missingRequest = new BackendLinter({
            projectRoot: fixture.root,
        }).run().issues;
        assert.ok(
            missingRequest.some(
                (issue) =>
                    issue.ruleId === 'HTTP_TEST_EXECUTABLE_COVERAGE',
            ),
        );
    } finally {
        fixture.dispose();
    }
});

test('handler casts and permissive HTTP assertions cannot satisfy contracts', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/openapi/openapi.yaml',
            `openapi: 3.1.0
info:
    title: Fixture
    version: 1.0.0
paths:
    /api/example:
        post:
            responses:
                "200":
                    description: Success`,
        );
        fixture.write(
            'code/backend/src/module/example/api/example.http.handler.ts',
            `export class ExampleHttpHandler extends HttpHandler {
                protected async processRequest(request: Request): Promise<HandlerResult<BaseDTO>> {
                    const url = new URL(request.url);
                    if (request.method !== 'POST' || url.pathname !== '/api/example') {
                        return { success: false, error: 'Not found' };
                    }
                    const body = await request.json() as ExampleRequestDTO;
                    return this.controller.create(body);
                }
            }`,
        );
        fixture.write(
            'code/backend/test/example.http.test.ts',
            `const response = await fetch('http://test/api/example', {
                method: 'POST',
            });
            assert.ok(response.status === 200 || response.status === 500);`,
        );

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        for (const expected of [
            'HANDLER_DTO_CAST_BYPASS',
            'HANDLER_CONCRETE_DTO_CONTRACT',
            'HTTP_ASSERTION_EXACT',
            'HTTP_UNEXPECTED_SERVER_ERROR',
            'TEST_PERMISSIVE_ASSERTION',
        ]) {
            assert.ok(ruleIds.includes(expected), expected);
        }
    } finally {
        fixture.dispose();
    }
});

test('test files reject type escapes and non-erasable TypeScript', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/test/escape.test.ts',
            `class Example {
                constructor(public readonly value: string) {}
            }
            const value = {} as unknown as Example;`,
        );
        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('TEST_TYPE_ESCAPE'));
        assert.ok(ruleIds.includes('NODE_ERASABLE_TYPES_ONLY'));
    } finally {
        fixture.dispose();
    }
});

test('composition remains generic and cannot post-wire modules', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/index.ts',
            `import { ExampleModule } from './module/example/index.ts';
            const module = new ExampleModule();
            module.setInfrastructure(infrastructure);`,
        );
        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('COMPOSITION_GENERICITY'));
        assert.ok(ruleIds.includes('MODULE_POST_CONSTRUCTION_WIRING'));
    } finally {
        fixture.dispose();
    }
});
