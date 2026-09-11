import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScaffold } from './commands/scaffold.runner.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
    process.exitCode = runScaffold(root, process.argv.slice(2));
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Scaffold failed.'}\n`);
    process.exitCode = 1;
}
