import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BackendLinter } from '../script/linter/backend.linter.ts';
import { ServiceRouterManager } from '../script/module-tools/service-router.manager.ts';
import { FixtureProject } from './linter/fixture-project.ts';

test('operation rules reject public helpers, primitive inputs, and peers', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/service/example.service.ts',
            `export class ExampleService extends BaseService {}`,
        );
        fixture.write(
            'code/backend/src/module/example/service/example/peer.operation.ts',
            `export abstract class PeerOperation extends BaseServiceOperation<InputDTO, OutputDTO, ExampleServiceDependencies> {}`,
        );
        fixture.write(
            'code/backend/src/module/example/service/example/run.operation.ts',
            `import { PeerOperation } from './peer.operation.ts';
export class RunOperation extends BaseServiceOperation<string, OutputDTO, ExampleServiceDependencies> {
    public execute(input: string): OutputDTO {
        return new OutputDTO(input);
    }
    public helper(): void {}
}`,
        );
        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('OPERATION_PEER_IMPORT'));
        assert.ok(ruleIds.includes('OPERATION_PUBLIC_METHOD'));
        assert.ok(ruleIds.includes('OPERATION_EXECUTE_CONTRACT'));
        assert.ok(ruleIds.includes('OPERATION_INPUT_CONTRACT'));
        assert.ok(ruleIds.includes('OPERATION_ROUTING_MISSING'));
        assert.ok(ruleIds.includes('SERVICE_ROUTER_DRIFT'));
    } finally {
        fixture.dispose();
    }
});

test('operation rules accept a generated direct-delegation router', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/service/example/run.operation.ts',
            `export class RunOperation extends BaseServiceOperation<InputDTO, OutputDTO, ExampleServiceDependencies> {
    public execute(input: InputDTO): OutputDTO {
        return input.output;
    }
}`,
        );
        new ServiceRouterManager(fixture.root).syncModule('example');
        const operationIssues = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.filter((issue) =>
                issue.ruleId.startsWith('OPERATION_') ||
                issue.ruleId.startsWith('SERVICE_ROUTER_'),
            );
        assert.deepEqual(operationIssues, []);
    } finally {
        fixture.dispose();
    }
});

test('operation rules reject global reads, in-memory queries, and upserts', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/service/example/query.operation.ts',
            `export class QueryOperation extends BaseServiceOperation<InputDTO, OutputDTO, ExampleServiceDependencies> {
    public async execute(input: InputDTO): Promise<OutputDTO> {
        const rows = await this.store.findAll();
        rows.filter(input.filter).slice(input.offset);
        await this.store.upsert(input);
        return input.output;
    }
}`,
        );
        new ServiceRouterManager(fixture.root).syncModule('example');

        const ruleIds = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues.map((issue) => issue.ruleId);

        assert.ok(ruleIds.includes('OPERATION_GLOBAL_STORE_READ'));
        assert.ok(ruleIds.includes('OPERATION_IN_MEMORY_QUERY'));
        assert.ok(ruleIds.includes('OPERATION_GENERIC_UPSERT'));
    } finally {
        fixture.dispose();
    }
});

test('operation rules reject handwritten Service behavior and legacy Service Aux files', () => {
    const fixture = new FixtureProject();
    try {
        fixture.write(
            'code/backend/src/module/example/service/example.service.ts',
            `export class ExampleService extends BaseService {
    public run(): OutputDTO {
        return new OutputDTO();
    }
}`,
        );
        fixture.write(
            'code/backend/src/module/example/service/example/legacy.service-aux.ts',
            `export class LegacyServiceAux extends BaseServiceAux {}`,
        );
        const issues = new BackendLinter({ projectRoot: fixture.root })
            .run()
            .issues;
        const ruleIds = issues.map((issue) => issue.ruleId);
        assert.ok(ruleIds.includes('SERVICE_OPERATION_MISSING'));
        assert.ok(ruleIds.includes('SERVICE_ROUTER_BUSINESS_LOGIC'));
        assert.ok(ruleIds.includes('SERVICE_AUX_FORBIDDEN'));
        assert.match(
            issues.find(
                (issue) => issue.ruleId === 'SERVICE_AUX_FORBIDDEN',
            )?.fix ?? '',
            /scaffold:operation -- example example/,
        );
    } finally {
        fixture.dispose();
    }
});
