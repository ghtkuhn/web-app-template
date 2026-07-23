#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleScaffolder } from './scaffold-module/module.scaffolder.ts';
import { ScaffoldCli } from './scaffold-module/scaffold.cli.ts';
import { VerificationRunner } from './scaffold-module/verification.runner.ts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../../..');
const scaffolder = new ModuleScaffolder({
    projectRoot,
    templateRoot: path.join(scriptDirectory, 'scaffold-module/templates'),
    verification: new VerificationRunner(),
});

process.exitCode = new ScaffoldCli(scaffolder).run(process.argv.slice(2));
