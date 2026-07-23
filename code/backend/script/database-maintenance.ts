// fallow-ignore-file unused-file
import { DatabaseBackupManager } from '../src/base/base.database-backup.ts';
import { DatabaseManager } from '../src/base/base.database.ts';
import { config } from '../src/config.ts';

/** Provides non-interactive database backup maintenance commands. */
export class DatabaseMaintenanceCli {
    /** Lists backups or restores one explicit backup identifier. */
    public async run(arguments_: readonly string[]): Promise<number> {
        try {
            const [command, backupId] = arguments_;
            const backups = new DatabaseBackupManager();
            if (command === 'list') {
                for (const backup of backups.list()) {
                    process.stdout.write(
                        [
                            backup.id,
                            backup.timestamp,
                            backup.size,
                            backup.release,
                            backup.migrations,
                        ].join('\t') + '\n',
                    );
                }
                return 0;
            }
            if (command === 'retain') {
                backups.retain(config.database.backupRetention);
                return 0;
            }
            if (command !== 'restore' || !backupId) {
                throw new Error(
                    'Usage: database-maintenance <list|retain|restore> [backup-id]',
                );
            }
            await DatabaseManager.getInstance();
            const safety = await backups.create(
                'pre-restore',
                'current',
                'current',
            );
            await DatabaseManager.close();
            backups.restore(backupId);
            process.stdout.write(
                `Restored ${backupId}; safety backup ${safety.id}.\n`,
            );
            return 0;
        } catch (error) {
            await DatabaseManager.close();
            process.stderr.write(
                `${error instanceof Error ? error.message : String(error)}\n`,
            );
            return 1;
        }
    }
}

process.exitCode = await new DatabaseMaintenanceCli().run(
    process.argv.slice(2),
);
