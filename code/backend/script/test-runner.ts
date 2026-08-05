import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKEND_TEST_FILES } from '../test.catalog.ts';
import { BackendTestRunner } from './test-runner/backend-test.runner.ts';

const backendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

try {
    process.exitCode = new BackendTestRunner(
        backendRoot,
        BACKEND_TEST_FILES,
    ).run();
} catch (error: unknown) {
    process.stderr.write(
        `${error instanceof Error ? error.message : 'Unknown backend test-runner failure'}\n`,
    );
    process.exitCode = 2;
}
