import { TemplateUpdateCli } from './template-update/template-update.cli.ts';

process.exitCode = await new TemplateUpdateCli().run(process.argv.slice(2));
