#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinterCli } from './linter/linter.cli.ts';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
);

const args = process.argv.slice(2);
const format = args.includes('--format') &&
    args[args.indexOf('--format') + 1] === 'json'
    ? 'json'
    : 'text';

process.exitCode = new LinterCli(
    projectRoot,
    process.stdout,
    process.stderr,
    format,
).run();
