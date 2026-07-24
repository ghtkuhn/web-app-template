import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { HttpServer } from '../src/base/http.server.ts';
import { HealthModule } from '../src/module/health/index.ts';

type HealthOperation = {
    responses: {
        '200': {
            content: {
                'application/json': {
                    schema: object;
                };
            };
        };
    };
};

type HealthContractDocument = {
    paths: {
        '/api/health': {
            get: HealthOperation;
        };
    };
};

/** Loads and compiles the documented Health success response. */
class HealthContract {
    private readonly validateResponse: ValidateFunction;

    /** Creates a contract around one compiled JSON schema validator. */
    private constructor(validateResponse: ValidateFunction) {
        this.validateResponse = validateResponse;
    }

    /** Loads the OpenAPI document and resolves component references. */
    public static async load(): Promise<HealthContract> {
        const backendRoot = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '..',
        );
        const dereferenced: unknown = await SwaggerParser.dereference(
            path.join(backendRoot, 'openapi/openapi.yaml'),
        );
        const document = dereferenced as HealthContractDocument;
        const schema =
            document.paths['/api/health'].get.responses['200'].content[
                'application/json'
            ].schema;
        const ajv = new Ajv2020({ strict: true });
        return new HealthContract(ajv.compile(schema));
    }

    /** Returns whether a value satisfies the documented response schema. */
    public accepts(value: unknown): boolean {
        return this.validateResponse(value);
    }

    /** Returns readable validation diagnostics from the most recent check. */
    public errors(): string {
        return JSON.stringify(this.validateResponse.errors);
    }
}

test('real Health response satisfies the OpenAPI contract', async () => {
    const contract = await HealthContract.load();
    const server = new HttpServer({
        port: 0,
        modules: { health: new HealthModule() },
    });
    await server.start();

    try {
        const response = await fetch(
            `http://127.0.0.1:${server.port}/api/health`,
        );
        const body: unknown = await response.json();

        assert.equal(response.status, 200);
        assert.match(
            response.headers.get('content-type') ?? '',
            /^application\/json\b/,
        );
        assert.equal(contract.accepts(body), true, contract.errors());
    } finally {
        await server.stop();
    }
});

test('Health contract rejects undocumented response shapes', async () => {
    const contract = await HealthContract.load();

    assert.equal(
        contract.accepts({
            success: true,
            data: { status: 'degraded', extra: true },
        }),
        false,
    );
});
