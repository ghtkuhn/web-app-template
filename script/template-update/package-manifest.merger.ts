import fs from 'node:fs';
import path from 'node:path';
import type { UpdateAction, UpdateConflict } from './interfaces.ts';

const APPLICATION_FIELDS = new Set([
    'name',
    'version',
    'description',
    'homepage',
    'bugs',
    'repository',
    'author',
    'license',
    'private',
]);

type JsonObject = Record<string, unknown>;

/** Three-way merges template-owned package metadata while preserving app identity. */
export class PackageManifestMerger {
    /** Produces either one merged write or one explicit package conflict. */
    public plan(
        baseRoot: string,
        localRoot: string,
        incomingRoot: string,
    ): {
        readonly action?: UpdateAction;
        readonly conflict?: UpdateConflict;
    } {
        const relativePath = 'package.json';
        const basePath = path.join(baseRoot, relativePath);
        const localPath = path.join(localRoot, relativePath);
        const incomingPath = path.join(incomingRoot, relativePath);
        if (
            !fs.existsSync(basePath) ||
            !fs.existsSync(localPath) ||
            !fs.existsSync(incomingPath)
        ) {
            return {};
        }

        const base = this.read(basePath);
        const local = this.read(localPath);
        const incoming = this.read(incomingPath);
        const conflicts: string[] = [];
        const merged = this.mergeObject(
            base,
            local,
            incoming,
            '',
            conflicts,
        );
        for (const field of APPLICATION_FIELDS) {
            if (field in local) {
                merged[field] = local[field];
            } else {
                delete merged[field];
            }
        }

        const stagedPath = path.join(
            incomingRoot,
            '.template-package-merged.json',
        );
        fs.writeFileSync(
            stagedPath,
            `${JSON.stringify(merged, null, 2)}\n`,
            'utf8',
        );
        if (conflicts.length > 0) {
            return {
                conflict: {
                    id: relativePath,
                    relativePath,
                    reason:
                        `Conflicting package properties: ${conflicts.join(', ')}.`,
                    basePath,
                    localPath,
                    incomingPath: stagedPath,
                },
            };
        }
        if (this.equal(local, merged)) {
            return {};
        }
        return {
            action: {
                kind: 'write',
                relativePath,
                sourcePath: stagedPath,
                mode: fs.statSync(localPath).mode & 0o777,
            },
        };
    }

    /** Recursively merges independently changed JSON properties. */
    private mergeObject(
        base: JsonObject,
        local: JsonObject,
        incoming: JsonObject,
        pointer: string,
        conflicts: string[],
    ): JsonObject {
        const result: JsonObject = {};
        const keys = [...new Set([
            ...Object.keys(base),
            ...Object.keys(local),
            ...Object.keys(incoming),
        ])].sort();
        for (const key of keys) {
            if (APPLICATION_FIELDS.has(key) && pointer === '') {
                result[key] = local[key];
                continue;
            }
            const propertyPointer = `${pointer}/${this.escape(key)}`;
            const value = this.mergeValue(
                base[key],
                local[key],
                incoming[key],
                propertyPointer,
                conflicts,
            );
            if (value !== undefined) {
                result[key] = value;
            }
        }
        return result;
    }

    /** Resolves one three-way JSON value or records a property conflict. */
    private mergeValue(
        base: unknown,
        local: unknown,
        incoming: unknown,
        pointer: string,
        conflicts: string[],
    ): unknown {
        if (this.equal(local, base)) {
            return incoming;
        }
        if (this.equal(incoming, base) || this.equal(local, incoming)) {
            return local;
        }
        if (
            this.object(base) &&
            this.object(local) &&
            this.object(incoming)
        ) {
            return this.mergeObject(
                base as JsonObject,
                local as JsonObject,
                incoming as JsonObject,
                pointer,
                conflicts,
            );
        }
        conflicts.push(pointer);
        return incoming;
    }

    /** Reads one JSON object with contextual parser failures. */
    private read(filePath: string): JsonObject {
        const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
        if (!this.object(value)) {
            throw new Error(`${filePath} must contain a JSON object.`);
        }
        return value as JsonObject;
    }

    /** Returns whether a value is a non-array object. */
    private object(value: unknown): value is JsonObject {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    /** Compares JSON values including absence. */
    private equal(left: unknown, right: unknown): boolean {
        return JSON.stringify(left) === JSON.stringify(right);
    }

    /** Escapes one JSON Pointer segment. */
    private escape(value: string): string {
        return value.replace(/~/g, '~0').replace(/\//g, '~1');
    }
}
