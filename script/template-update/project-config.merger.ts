import fs from 'node:fs';
import path from 'node:path';
import type { UpdateAction } from './interfaces.ts';

type JsonObject = Record<string, unknown>;

/** Adds new template settings without replacing application-owned config. */
export class ProjectConfigMerger {
    public static readonly relativePath = 'project.json';

    /** Plans one merged config write when the target release owns project.json. */
    public plan(
        baseRoot: string,
        localRoot: string,
        incomingRoot: string,
    ): UpdateAction | undefined {
        const incomingPath = path.join(
            incomingRoot,
            ProjectConfigMerger.relativePath,
        );
        const incomingStatus = this.status(incomingPath);
        if (!incomingStatus) {
            return undefined;
        }
        this.assertRegular(incomingPath, incomingStatus, 'Incoming');
        const incoming = this.read(incomingPath, 'Incoming');

        const localPath = path.join(
            localRoot,
            ProjectConfigMerger.relativePath,
        );
        const localStatus = this.status(localPath);
        if (!localStatus) {
            return this.write(incomingPath, incomingStatus.mode & 0o777);
        }
        this.assertRegular(localPath, localStatus, 'Local');
        const local = this.read(localPath, 'Local');

        const basePath = path.join(
            baseRoot,
            ProjectConfigMerger.relativePath,
        );
        const baseStatus = this.status(basePath);
        let base: JsonObject = {};
        if (baseStatus) {
            this.assertRegular(basePath, baseStatus, 'Base');
            base = this.read(basePath, 'Base');
        }

        const merged = this.mergeObject(base, local, incoming);
        if (this.equal(local, merged)) {
            return undefined;
        }
        const stagedPath = path.join(
            incomingRoot,
            '.template-project-merged.json',
        );
        fs.writeFileSync(
            stagedPath,
            `${JSON.stringify(merged, null, 4)}\n`,
            'utf8',
        );
        return this.write(stagedPath, localStatus.mode & 0o777);
    }

    /** Recursively retains local state and admits only truly new defaults. */
    private mergeObject(
        base: JsonObject,
        local: JsonObject,
        incoming: JsonObject,
    ): JsonObject {
        const result: JsonObject = {};
        const keys = [...new Set([
            ...Object.keys(local),
            ...Object.keys(incoming),
        ])].sort();
        for (const key of keys) {
            const localOwns = Object.hasOwn(local, key);
            const baseOwns = Object.hasOwn(base, key);
            const incomingOwns = Object.hasOwn(incoming, key);
            if (localOwns) {
                const localValue = local[key];
                const incomingValue = incoming[key];
                const baseValue = base[key];
                if (
                    incomingOwns &&
                    this.object(localValue) &&
                    this.object(incomingValue) &&
                    (!baseOwns || this.object(baseValue))
                ) {
                    result[key] = this.mergeObject(
                        this.object(baseValue) ? baseValue : {},
                        localValue,
                        incomingValue,
                    );
                } else {
                    result[key] = localValue;
                }
            } else if (incomingOwns && !baseOwns) {
                result[key] = incoming[key];
            }
        }
        return result;
    }

    /** Reads one regular JSON object with a stable contextual error. */
    private read(filePath: string, owner: string): JsonObject {
        let value: unknown;
        try {
            value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
        } catch (error) {
            throw new Error(
                `${owner} project.json must contain valid JSON: ${this.message(error)}`,
            );
        }
        if (!this.object(value)) {
            throw new Error(`${owner} project.json must contain a JSON object.`);
        }
        return value;
    }

    /** Rejects directories, devices, and symbolic links before parsing. */
    private assertRegular(
        filePath: string,
        status: fs.Stats,
        owner: string,
    ): void {
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error(
                `${owner} project.json must be a regular non-symlink file: ${filePath}`,
            );
        }
    }

    /** Returns path metadata without following a final symbolic link. */
    private status(filePath: string): fs.Stats | undefined {
        try {
            return fs.lstatSync(filePath);
        } catch (error) {
            if (
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
            ) {
                return undefined;
            }
            throw error;
        }
    }

    /** Returns whether a value is a non-array JSON object. */
    private object(value: unknown): value is JsonObject {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    /** Compares JSON values independent of object-key insertion order. */
    private equal(left: unknown, right: unknown): boolean {
        return JSON.stringify(this.normalized(left)) ===
            JSON.stringify(this.normalized(right));
    }

    /** Produces a recursively key-sorted value for semantic comparison. */
    private normalized(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map((item) => this.normalized(item));
        }
        if (!this.object(value)) {
            return value;
        }
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [
                key,
                this.normalized(value[key]),
            ]),
        );
    }

    /** Builds the canonical project.json write action. */
    private write(sourcePath: string, mode: number): UpdateAction {
        return {
            kind: 'write',
            relativePath: ProjectConfigMerger.relativePath,
            sourcePath,
            mode,
        };
    }

    /** Normalizes parser failures without leaking unstable thrown shapes. */
    private message(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
