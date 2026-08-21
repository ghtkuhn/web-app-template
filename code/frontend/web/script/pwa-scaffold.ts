import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PwaScaffolder } from './pwa-scaffold/pwa.scaffolder.ts';

const frontendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

process.exitCode = new PwaScaffolder(frontendRoot).run(process.argv.slice(2));
