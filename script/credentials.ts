import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialManager } from './credentials/credential.manager.ts';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const [command, script, ...args] = process.argv.slice(2);
const manager = new CredentialManager(projectRoot);

try {
    if (command === 'init') {
        manager.initialize();
        console.log('Created .credentials.env with mode 0600.');
    } else if (command === 'check') {
        manager.check();
        console.log('Credential safeguards are valid.');
    } else if (command === 'run' && script) {
        process.exitCode = manager.run(script, args);
    } else {
        throw new Error(
            'Usage: credentials.ts <init|check|run> [npm-script] [args...]',
        );
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
