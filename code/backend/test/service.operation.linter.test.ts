import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BackendLinter } from '../script/linter/backend.linter.ts';
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
        fixture.write(
            'code/backend/src/module/example/service/example.service.ts',
            `import { BaseService } from '../../../base/base.service.ts';
import { RunOperation } from './example/run.operation.ts';
import type { ExampleServiceDependencies } from '../interfaces.ts';

/** Generated Router for example Service Operations. */
export class ExampleService extends BaseService {
    private readonly runOperation: RunOperation;

    /** Creates every owner-bound Operation with shared dependencies. */
    constructor(dependencies: ExampleServiceDependencies) {
        super();
        this.runOperation = new RunOperation(dependencies);
    }

    /** Routes the run application operation. */
    public run(
        input: Parameters<RunOperation['execute']>[0],
    ): ReturnType<RunOperation['execute']> {
        return this.runOperation.execute(input);
    }
}\n`,
        );
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
