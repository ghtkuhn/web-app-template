import fs from 'node:fs';
import path from 'node:path';

/** One logical migration rendered for both supported database dialects. */
export interface MigrationPairRequest {
    readonly name: string;
    readonly sqliteSource: string;
    readonly postgresSource: string;
}

/** Files created for one logical resource migration. */
export interface MigrationPairResult {
    readonly sqliteFile: string;
    readonly postgresFile: string;
}

/** Injectable filesystem write used to verify rollback behavior. */
export type MigrationFileWriter = (
    filePath: string,
    source: string,
) => void;

/** Atomically owns paired migration output for resource scaffolding. */
export class MigrationPairWriter {
    private readonly backendRoot: string;
    private readonly writeFile: MigrationFileWriter;

    /** Creates a writer rooted at one backend workspace. */
    public constructor(
        backendRoot: string,
        writeFile: MigrationFileWriter = (filePath, source) => {
            fs.writeFileSync(filePath, source, 'utf8');
        },
    ) {
        this.backendRoot = path.resolve(backendRoot);
        this.writeFile = writeFile;
    }

    /** Validates and writes both dialect variants as one transaction. */
    public write(request: MigrationPairRequest): MigrationPairResult {
        if (!/^\d{3}-[a-z][a-z0-9-]*$/u.test(request.name)) {
            throw new Error(
                `Migration '${request.name}' must use <three-digits>-<kebab-case>.`,
            );
        }
        if (!request.sqliteSource.trim() || !request.postgresSource.trim()) {
            throw new Error('Both dialect migration sources are required.');
        }

        const migrationRoot = path.join(this.backendRoot, 'src/migration');
        const sqliteDirectory = path.join(migrationRoot, 'sqlite');
        const postgresDirectory = path.join(migrationRoot, 'postgres');
        const fileName = `${request.name}.migration.ts`;
        const sqliteFile = path.join(sqliteDirectory, fileName);
        const postgresFile = path.join(postgresDirectory, fileName);
        const targets = [sqliteFile, postgresFile];
        for (const target of targets) {
            if (fs.existsSync(target)) {
                throw new Error(
                    `Migration target '${this.relative(target)}' already exists.`,
                );
            }
        }

        const createdDirectories = [sqliteDirectory, postgresDirectory]
            .filter((directory) => !fs.existsSync(directory));
        try {
            for (const directory of createdDirectories) {
                fs.mkdirSync(directory, { recursive: true });
            }
            this.writeFile(sqliteFile, request.sqliteSource);
            this.writeFile(postgresFile, request.postgresSource);
        } catch (error: unknown) {
            for (const target of targets) {
                if (fs.existsSync(target)) {
                    fs.rmSync(target);
                }
            }
            for (const directory of [...createdDirectories].reverse()) {
                if (
                    fs.existsSync(directory) &&
                    fs.readdirSync(directory).length === 0
                ) {
                    fs.rmdirSync(directory);
                }
            }
            throw new Error(
                error instanceof Error
                    ? `Unable to write migration pair: ${error.message}`
                    : 'Unable to write migration pair.',
            );
        }

        return {
            sqliteFile: this.relative(sqliteFile),
            postgresFile: this.relative(postgresFile),
        };
    }

    /** Returns one stable backend-relative result path. */
    private relative(filePath: string): string {
        return path.relative(this.backendRoot, filePath).split(path.sep).join('/');
    }
}
