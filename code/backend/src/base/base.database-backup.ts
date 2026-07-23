import fs from 'node:fs';
import path from 'node:path';
import { DatabaseManager } from './base.database.ts';

export interface DatabaseBackup {
    readonly id: string;
    readonly path: string;
    readonly size: number;
    readonly timestamp: string;
    readonly release: string;
    readonly migrations: string;
}

/** Creates, validates, retains, lists, and restores SQLite backups. */
export class DatabaseBackupManager {
    private readonly databasePath: string;
    private readonly backupRoot: string;

    public constructor(databasePath = DatabaseManager.getSqlitePath()) {
        this.databasePath = databasePath;
        this.backupRoot = path.join(path.dirname(databasePath), 'backups');
    }

    /** Creates and validates one atomic pre-migration backup. */
    public async create(
        releaseId: string,
        fromMigration: string,
        toMigration: string,
    ): Promise<DatabaseBackup> {
        const id = [
            new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z'),
            this.safeSegment(releaseId),
            `${this.safeSegment(fromMigration)}-to-${this.safeSegment(toMigration)}`,
        ].join('_') + '.sqlite';
        fs.mkdirSync(this.backupRoot, { recursive: true });
        const target = path.join(this.backupRoot, id);
        const temporary = `${target}.tmp`;
        try {
            await DatabaseManager.backup(temporary);
            DatabaseManager.assertFileIntegrity(temporary);
            fs.renameSync(temporary, target);
        } finally {
            fs.rmSync(temporary, { force: true });
        }
        return this.describe(target);
    }

    /** Lists valid backup filenames without opening their contents. */
    public list(): readonly DatabaseBackup[] {
        if (!fs.existsSync(this.backupRoot)) {
            return [];
        }
        return fs.readdirSync(this.backupRoot)
            .filter((name) => this.isBackupId(name))
            .sort()
            .reverse()
            .map((name) => this.describe(path.join(this.backupRoot, name)));
    }

    /** Removes older backups after a successful deployment. */
    public retain(count: number): void {
        for (const backup of this.list().slice(count)) {
            fs.rmSync(backup.path);
        }
    }

    /** Validates and atomically restores an explicit backup identifier. */
    public restore(id: string): void {
        if (!this.isBackupId(id) || id === 'latest') {
            throw new Error(`Invalid database backup identifier '${id}'.`);
        }
        const source = path.join(this.backupRoot, id);
        if (!fs.existsSync(source)) {
            throw new Error(`Database backup '${id}' does not exist.`);
        }
        const sourceStatus = fs.lstatSync(source);
        if (!sourceStatus.isFile() || sourceStatus.isSymbolicLink()) {
            throw new Error(`Database backup '${id}' is not a regular file.`);
        }
        DatabaseManager.assertFileIntegrity(source);
        const temporary = `${this.databasePath}.restore.tmp`;
        fs.copyFileSync(source, temporary);
        try {
            DatabaseManager.assertFileIntegrity(temporary);
            fs.rmSync(`${this.databasePath}-wal`, { force: true });
            fs.rmSync(`${this.databasePath}-shm`, { force: true });
            fs.renameSync(temporary, this.databasePath);
        } finally {
            fs.rmSync(temporary, { force: true });
        }
    }

    private describe(filePath: string): DatabaseBackup {
        const id = path.basename(filePath);
        const [timestamp = 'unknown', release = 'unknown', migrations = 'unknown'] =
            id.replace(/\.sqlite$/, '').split('_', 3);
        return {
            id,
            path: filePath,
            size: fs.statSync(filePath).size,
            timestamp,
            release,
            migrations,
        };
    }

    private isBackupId(id: string): boolean {
        return /^[A-Za-z0-9][A-Za-z0-9._-]*\.sqlite$/.test(id);
    }

    private safeSegment(value: string): string {
        const safe = value.replace(/[^A-Za-z0-9.-]/g, '-');
        return safe || 'none';
    }
}
