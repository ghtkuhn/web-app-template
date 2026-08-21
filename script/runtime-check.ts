import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuntimeContract } from './runtime-check/runtime.contract.ts';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

try {
    const result = new RuntimeContract(projectRoot).check();
    process.stdout.write(
        `Runtime contract valid (Node.js ${result.nodeVersion}, npm ${result.npmVersion}).\n`,
    );
} catch (error: unknown) {
    process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
}
