import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseModule } from '../src/base/base.module.ts';
import type {
    ApplicationInfrastructure,
    HandlerResult,
    ModuleDefinitions,
    NodeRequestContext,
} from '../src/base/interfaces.ts';
import type { Kysely } from 'kysely';
import type { Database } from '../src/database.ts';
import { NodeHandler } from '../src/base/node.handler.ts';
import { ModuleRegistry } from '../src/module.registry.ts';
import type { HealthModulePort } from '../src/module/health/index.ts';
import { HealthModule, HealthStatusDTO } from '../src/module/health/index.ts';

type ConsumerNodeRequest = {
    operation: 'readHealth';
    context: NodeRequestContext;
};

class ConsumerNodeHandler extends NodeHandler<
    ConsumerNodeRequest,
    HealthStatusDTO
> {
    private readonly healthModule: HealthModulePort;

    constructor(healthModule: HealthModulePort) {
        super();
        this.healthModule = healthModule;
    }

    protected async processRequest(
        input: ConsumerNodeRequest,
    ): Promise<HandlerResult<HealthStatusDTO>> {
        return this.healthModule.dispatch('node', {
            operation: 'getStatus',
            context: {
                caller: 'consumer',
                correlationId: input.context.correlationId,
            },
        });
    }
}

class ConsumerModule extends BaseModule<ConsumerNodeRequest, HealthStatusDTO> {
    constructor(healthModule: HealthModulePort) {
        super();
        this.registerHandler('node', new ConsumerNodeHandler(healthModule));
    }
}

class EmptyModule extends BaseModule {}

const infrastructure: ApplicationInfrastructure = {
    database: {} as Kysely<Database>,
};

test('health exposes a typed in-process status operation', async () => {
    const health = new HealthModule();
    const result = await health.dispatch('node', {
        operation: 'getStatus',
        context: { caller: 'test', correlationId: 'correlation-1' },
    });

    assert.equal(result.success, true);
    assert.ok(result.data instanceof HealthStatusDTO);
    assert.equal(result.data.status, 'ok');
    assert.equal('id' in result.data, false);
    assert.equal(result.statusCode, 200);
});

test('health rejects an unknown in-process operation at runtime', async () => {
    const health = new HealthModule();
    const invalidRequest = {
        operation: 'missing',
        context: { caller: 'test' },
    };
    const result = await Reflect.apply(health.dispatch, health, [
        'node',
        invalidRequest,
    ]);
    assert.deepEqual(result, {
        success: false,
        error: 'Unknown health operation',
    });
});

test('registry injects only the public health module port into a consumer', async () => {
    const definitions: ModuleDefinitions = {
        health: {
            dependencies: [],
            create: () => new HealthModule(),
        },
        consumer: {
            dependencies: ['health'],
            create: (dependencies) => {
                if (!(dependencies.health instanceof HealthModule)) {
                    throw new Error('Health dependency is invalid.');
                }
                return new ConsumerModule(dependencies.health);
            },
        },
    };
    const modules = new ModuleRegistry(
        ['health', 'consumer'],
        infrastructure,
        definitions,
    ).create();
    const consumer = modules.consumer as ConsumerModule;

    const result = await consumer.dispatch('node', {
        operation: 'readHealth',
        context: { caller: 'test', correlationId: 'correlation-2' },
    });
    assert.ok(result.data instanceof HealthStatusDTO);
    assert.equal(result.data.status, 'ok');
});

test('registry supplies the same application infrastructure to module factories', () => {
    let receivedInfrastructure: ApplicationInfrastructure | null = null;
    const definitions: ModuleDefinitions = {
        empty: {
            dependencies: [],
            create: (_dependencies, suppliedInfrastructure) => {
                receivedInfrastructure = suppliedInfrastructure;
                return new EmptyModule();
            },
        },
    };

    new ModuleRegistry(
        ['empty'],
        infrastructure,
        definitions,
    ).create();

    assert.equal(receivedInfrastructure, infrastructure);
    assert.ok(receivedInfrastructure);
    assert.equal(receivedInfrastructure.database, infrastructure.database);
});

test('registry rejects required modules that are not active', () => {
    const definitions: ModuleDefinitions = {
        consumer: {
            dependencies: ['health'],
            create: () => new EmptyModule(),
        },
        health: {
            dependencies: [],
            create: () => new HealthModule(),
        },
    };

    assert.throws(
        () =>
            new ModuleRegistry(
                ['consumer'],
                infrastructure,
                definitions,
            ).create(),
        /Module 'consumer' requires inactive module 'health'/,
    );
});

test('registry rejects a named definition registered under another name', () => {
    const definitions: ModuleDefinitions = {
        alias: {
            name: 'actual',
            dependencies: [],
            create: () => new EmptyModule(),
        },
    };

    assert.throws(
        () =>
            new ModuleRegistry(
                ['alias'],
                infrastructure,
                definitions,
            ).create(),
        /Module definition 'actual' is registered as 'alias'/,
    );
});

test('registry reports direct dependency cycles with their path', () => {
    const definitions: ModuleDefinitions = {
        alpha: {
            dependencies: ['alpha'],
            create: () => new EmptyModule(),
        },
    };

    assert.throws(
        () =>
            new ModuleRegistry(
                ['alpha'],
                infrastructure,
                definitions,
            ).create(),
        /Cyclic module dependency: alpha -> alpha/,
    );
});

test('registry reports indirect dependency cycles with their path', () => {
    const definitions: ModuleDefinitions = {
        alpha: {
            dependencies: ['beta'],
            create: () => new EmptyModule(),
        },
        beta: {
            dependencies: ['gamma'],
            create: () => new EmptyModule(),
        },
        gamma: {
            dependencies: ['alpha'],
            create: () => new EmptyModule(),
        },
    };

    assert.throws(
        () =>
            new ModuleRegistry(
                ['alpha', 'beta', 'gamma'],
                infrastructure,
                definitions,
            ).create(),
        /Cyclic module dependency: alpha -> beta -> gamma -> alpha/,
    );
});

test('health node request contract rejects invalid compile-time inputs', () => {
    const health = new HealthModule();
    if (false) {
        // @ts-expect-error Unknown operations are rejected by the public port.
        void health.dispatch('node', {
            operation: 'missing',
            context: { caller: 'test' },
        });

        // @ts-expect-error The caller identity is mandatory.
        void health.dispatch('node', {
            operation: 'getStatus',
            context: {},
        });
    }
    assert.ok(health);
});
