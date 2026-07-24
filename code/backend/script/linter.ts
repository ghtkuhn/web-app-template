#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinterCli } from './linter/linter.cli.ts';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
);

const format = process.argv.slice(2).includes('--format') &&
    process.argv.slice(2).includes('json')
    ? 'json'
    : 'text';

process.exitCode = new LinterCli(
    projectRoot,
    process.stdout,
    process.stderr,
    format,
).run();
