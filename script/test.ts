import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestRunner } from './testing/test.runner.ts';

try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    process.exitCode = await new TestRunner(root).run(process.argv.slice(2));
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Test selection failed.'}\n`);
    process.exitCode = 2;
}
