import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoreMigrationInspector } from './store-migration-status/store-migration.inspector.ts';

const backendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

try {
    const findings = new StoreMigrationInspector(backendRoot).inspect();
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ findings }, null, 2));
    } else if (findings.length === 0) {
        console.log('No generic Store migration candidates found.');
    } else {
        for (const finding of findings) {
            console.log(
                `${finding.file}:${finding.line} ${finding.kind} ` +
                `${finding.method}`,
            );
        }
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
