import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LxcContractCatalog } from './lxc-contract.catalog.ts';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
);
const command = process.argv[2] ?? 'check';
const catalog = new LxcContractCatalog();

try {
    if (command === 'generate') {
        catalog.generate(projectRoot);
        process.stdout.write('Generated LXC runtime contract catalog.\n');
    } else if (command === 'check') {
        catalog.check(projectRoot);
        process.stdout.write('LXC runtime contract catalog is current.\n');
    } else {
        throw new Error(`Unknown LXC contract command '${command}'.`);
    }
} catch (error) {
    process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
}
