import { CliRunner } from './base/cli.runner.ts';
import { DatabaseManager } from './base/base.database.ts';
import { config } from './config.ts';
import { ModuleRegistry } from './module.registry.ts';

/** Owns one short-lived command-line application invocation. */
class CliApplication {
    /** Initializes modules, executes the command, and releases infrastructure. */
    public async start(argv: string[]): Promise<void> {
        if (!config.cli.enabled) {
            console.error('CLI transport is disabled.');
            process.exitCode = 2;
            return;
        }

        try {
            const database = await DatabaseManager.getInstance();
            const modules = new ModuleRegistry(config.modules.active, {
                database,
                databaseType: config.database.type,
            }).create();
            const runner = new CliRunner({ modules });
            process.exitCode = await runner.run(argv);
        } catch (error: unknown) {
            console.error('CLI execution failed:', error);
            process.exitCode = 1;
        } finally {
            await DatabaseManager.close();
        }
    }
}

void new CliApplication().start(process.argv.slice(2));
