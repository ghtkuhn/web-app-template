import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FrontendScaffold } from './scaffold/scaffold.ts';

const frontendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

process.exitCode = new FrontendScaffold(frontendRoot).run(
    process.argv[2],
    process.argv.slice(3),
);
