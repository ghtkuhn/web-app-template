#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VerificationRunner } from './scaffold-module/verification.runner.ts';
import { OperationScaffoldCli } from './scaffold-operation/operation-scaffold.cli.ts';
import { OperationScaffolder } from './scaffold-operation/operation.scaffolder.ts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../../..');

process.exitCode = new OperationScaffoldCli(
    new OperationScaffolder({
        projectRoot,
        verification: new VerificationRunner(),
    }),
).run(process.argv.slice(2));
