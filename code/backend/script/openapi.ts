#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthOpenApiGenerator } from './openapi/auth-openapi.generator.ts';

const backendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const command = process.argv[2];

try {
    const generator = new AuthOpenApiGenerator(backendRoot);
    if (command === 'generate') {
        await generator.generate();
        process.stdout.write('Generated combined backend OpenAPI contract.\n');
    } else if (command === 'check') {
        await generator.check();
        process.stdout.write('Backend OpenAPI contract is current.\n');
    } else {
        process.stderr.write('Usage: openapi.ts <generate|check>\n');
        process.exitCode = 1;
    }
} catch (error: unknown) {
    process.stderr.write(
        `${error instanceof Error ? error.message : 'OpenAPI generation failed.'}\n`,
    );
    process.exitCode = 2;
}
