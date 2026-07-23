#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileScaffoldCli } from './scaffold-module/file-scaffold.cli.ts';
import { FileScaffolder } from './scaffold-module/file.scaffolder.ts';
import { VerificationRunner } from './scaffold-module/verification.runner.ts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../../..');
const scaffolder = new FileScaffolder({
    projectRoot,
    templatePath: path.join(
        scriptDirectory,
        'scaffold-module/templates/architecture-file.ts.template',
    ),
    verification: new VerificationRunner(),
});

process.exitCode = new FileScaffoldCli(scaffolder).run(process.argv.slice(2));
