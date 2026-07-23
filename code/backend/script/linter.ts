#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinterCli } from './linter/linter.cli.ts';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
);

process.exitCode = new LinterCli(projectRoot).run();
