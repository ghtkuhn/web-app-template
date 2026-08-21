import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MigrationCatalogChecker } from './migration-check/migration.catalog.checker.ts';

const backendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const command = process.argv[2];

try {
    const checker = new MigrationCatalogChecker(backendRoot);
    if (command === 'generate') {
        checker.generate();
        console.log('Generated migration.catalog.json.');
    } else if (command === 'check') {
        const count = checker.check();
        console.log(`Migration catalog valid (${count} pairs).`);
    } else {
        throw new Error('Usage: migration-check.ts <generate|check>');
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
