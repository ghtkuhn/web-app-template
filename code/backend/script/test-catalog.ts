import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestCatalogCli } from './test-catalog/test-catalog.cli.ts';

const backendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
process.exitCode = new TestCatalogCli(backendRoot).run(process.argv.slice(2));
