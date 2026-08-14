import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import SwaggerParser from '@apidevtools/swagger-parser';
import { Kysely, SqliteDialect } from 'kysely';
import type { Database } from '../../src/database.ts';
import { AuthRuntimeService } from '../../src/module/auth/service/auth-runtime.service.ts';
import { YamlSerializer } from './yaml.serializer.ts';

/** Generates and checks the merged application and Better Auth OpenAPI contract. */
export class AuthOpenApiGenerator {
    private readonly backendRoot: string;
    private readonly serializer = new YamlSerializer();

    /** Creates a generator for one backend workspace. */
    constructor(backendRoot: string) {
        this.backendRoot = path.resolve(backendRoot);
    }

    /** Writes the deterministic combined OpenAPI document. */
    public async generate(): Promise<void> {
        fs.writeFileSync(this.outputPath(), await this.render(), 'utf8');
    }

    /** Rejects drift without modifying the checked-in contract. */
    public async check(): Promise<void> {
        const expected = await this.render();
        const actual = fs.readFileSync(this.outputPath(), 'utf8');
        if (actual !== expected) {
            throw new Error(
                'Combined OpenAPI contract is stale. Run npm run generate:openapi.',
            );
        }
    }

    /** Builds the merged document in memory. */
    private async render(): Promise<string> {
        const application = await SwaggerParser.parse(
            path.join(this.backendRoot, 'openapi/application.openapi.yaml'),
        );
        const applicationDocument = this.record(application);
        const auth = this.normalizeAuthDocument(await this.authDocument());
        const merged = {
            ...applicationDocument,
            paths: this.mergeRecords(
                this.record(applicationDocument.paths),
                this.prefixedAuthPaths(auth.paths),
                'path',
            ),
            components: this.mergeComponentGroups(
                this.record(applicationDocument.components),
                this.record(auth.components),
            ),
            tags: this.mergeTags(
                this.array(applicationDocument.tags),
                auth.tags ?? [],
            ),
        };
        return this.serializer.serialize(merged);
    }

    /** Generates Better Auth's schema without opening another application connection. */
    private async authDocument() {
        const database = new Kysely<Database>({
            dialect: new SqliteDialect({
                database: new BetterSqlite3(':memory:'),
            }),
        });
        try {
            const runtime = new AuthRuntimeService({
                database,
                databaseType: 'sqlite',
                options: {
                    secret: 'openapi-generation-secret-with-at-least-32-characters',
                    baseUrl: 'http://localhost:3000',
                    registrationEnabled: true,
                    trustedOrigins: [],
                },
            }).createAuthRuntime();
            return await runtime.api.generateOpenAPISchema();
        } finally {
            await database.destroy();
        }
    }

    /** Converts generated plugin output into strict OpenAPI 3.1 operations. */
    private normalizeAuthDocument(document: {
        readonly paths: Readonly<Record<string, unknown>>;
        readonly components?: Readonly<Record<string, unknown>>;
        readonly tags?: readonly unknown[];
    }) {
        const paths = Object.fromEntries(
            Object.entries(document.paths).map(([route, item]) => [
                route,
                this.normalizePathItem(route, this.record(item)),
            ]),
        );
        return {
            ...document,
            paths,
            components: this.normalizeValue(document.components ?? {}),
        };
    }

    /** Adds deterministic operation metadata and valid security requirements. */
    private normalizePathItem(
        route: string,
        item: Record<string, unknown>,
    ): Record<string, unknown> {
        return Object.fromEntries(
            Object.entries(item).map(([method, value]) => {
                const operation = this.record(this.normalizeValue(value));
                const description = operation.description;
                const operationId = operation.operationId;
                const fallbackId = `${method}${route}`
                    .replace(/[^A-Za-z0-9]+(.)?/gu, (_match, next: string) =>
                        next ? next.toUpperCase() : '',
                    );
                return [
                    method,
                    {
                        ...operation,
                        operationId:
                            typeof operationId === 'string' &&
                            operationId !== 'undefined'
                                ? operationId
                                : fallbackId,
                        summary:
                            typeof operation.summary === 'string'
                                ? operation.summary
                                : typeof description === 'string' &&
                                    description !== 'undefined'
                                    ? description
                                    : `${method.toUpperCase()} ${route}`,
                        security: this.normalizeSecurity(operation.security),
                    },
                ];
            }),
        );
    }

    /** Normalizes security scheme values to required string arrays. */
    private normalizeSecurity(value: unknown): unknown[] {
        if (!Array.isArray(value)) {
            return [];
        }
        return value.map((requirement) =>
            Object.fromEntries(
                Object.keys(this.record(requirement)).map((scheme) => [
                    scheme,
                    [],
                ]),
            ),
        );
    }

    /** Removes undefined values and converts nullable schemas to OpenAPI 3.1. */
    private normalizeValue(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value
                .filter((item) => item !== undefined)
                .map((item) => this.normalizeValue(item));
        }
        if (typeof value !== 'object' || value === null) {
            return value;
        }
        const source = value as Record<string, unknown>;
        const normalized = Object.fromEntries(
            Object.entries(source)
                .filter(([, item]) => item !== undefined)
                .map(([key, item]) => [key, this.normalizeValue(item)]),
        );
        if (source.nullable === true) {
            delete normalized.nullable;
            const type = normalized.type;
            normalized.type = Array.isArray(type)
                ? [...type, 'null']
                : [type ?? 'string', 'null'];
        }
        return normalized;
    }

    /** Prefixes Better Auth's protocol-relative paths with its public module route. */
    private prefixedAuthPaths(
        paths: Readonly<Record<string, unknown>>,
    ): Record<string, unknown> {
        return Object.fromEntries(
            Object.entries(paths).map(([route, operation]) => [
                `/api/auth${route}`,
                operation,
            ]),
        );
    }

    /** Merges component categories while rejecting every name collision. */
    private mergeComponentGroups(
        application: Readonly<Record<string, unknown>>,
        auth: Readonly<Record<string, unknown>>,
    ): Record<string, unknown> {
        const categories = new Set([
            ...Object.keys(application),
            ...Object.keys(auth),
        ]);
        return Object.fromEntries(
            [...categories].map((category) => [
                category,
                this.mergeRecords(
                    this.record(application[category]),
                    this.record(auth[category]),
                    `component '${category}'`,
                ),
            ]),
        );
    }

    /** Merges named maps and rejects duplicate ownership. */
    private mergeRecords(
        application: Readonly<Record<string, unknown>>,
        auth: Readonly<Record<string, unknown>>,
        kind: string,
    ): Record<string, unknown> {
        for (const key of Object.keys(auth)) {
            if (key in application) {
                throw new Error(`OpenAPI ${kind} collision: '${key}'.`);
            }
        }
        return { ...application, ...auth };
    }

    /** Merges tags by stable name. */
    private mergeTags(
        application: readonly unknown[],
        auth: readonly unknown[],
    ): unknown[] {
        const tags = new Map<string, unknown>();
        for (const tag of [...application, ...auth]) {
            const name = this.record(tag).name;
            const key = typeof name === 'string' ? name : JSON.stringify(tag);
            tags.set(key, tag);
        }
        return [...tags.values()];
    }

    /** Safely narrows an optional OpenAPI map. */
    private record(value: unknown): Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {};
    }

    /** Safely narrows an optional OpenAPI array. */
    private array(value: unknown): unknown[] {
        return Array.isArray(value) ? value : [];
    }

    /** Returns the generated contract path. */
    private outputPath(): string {
        return path.join(this.backendRoot, 'openapi/openapi.yaml');
    }
}
