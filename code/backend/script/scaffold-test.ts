#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestScaffoldCli } from './scaffold-test/test-scaffold.cli.ts';
import { TestScaffoldVerificationRunner } from './scaffold-test/test-scaffold.verification.ts';
import { TestScaffolder } from './scaffold-test/test.scaffolder.ts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../../..');
const scaffolder = new TestScaffolder(
    projectRoot,
    new TestScaffoldVerificationRunner(),
);

process.exitCode = new TestScaffoldCli(scaffolder).run(process.argv.slice(2));
