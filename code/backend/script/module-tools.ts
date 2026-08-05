#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleToolsCli } from './module-tools/module-tools.cli.ts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../../..');
const arguments_ = process.argv.slice(2);
const command = arguments_[0];
const normalized = command === 'status' || command === 'verify'
    ? arguments_
    : [path.basename(process.argv[1]).includes('verify') ? 'verify' : 'status', ...arguments_];

process.exitCode = new ModuleToolsCli(projectRoot).run(normalized);
