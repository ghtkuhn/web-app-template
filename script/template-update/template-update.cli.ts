import path from 'node:path';
import { TemplateUpdateError } from './errors.ts';
import { TemplateUpdater } from './template.updater.ts';

/** Non-interactive command-line entry point for template updates. */
export class TemplateUpdateCli {
    private readonly updater = new TemplateUpdater();

    /** Checks releases or updates the current project. */
    public async run(arguments_: readonly string[]): Promise<number> {
        try {
            return await this.execute(arguments_);
        } catch (error) {
            process.stderr.write(
                `${error instanceof Error ? error.message : String(error)}\n`,
            );
            return error instanceof TemplateUpdateError
                ? error.exitCode
                : 2;
        }
    }

    private async execute(arguments_: readonly string[]): Promise<number> {
        const [command = 'check', value, ...extra] = arguments_;
        if (this.helpRequested(command, value)) {
            process.stdout.write(this.help());
            return 0;
        }
        if (extra.length > 0) {
            throw new TemplateUpdateError('Too many arguments.', 1);
        }
        const projectRoot = path.resolve(process.cwd());
        const handlers: Record<string, () => Promise<number>> = {
            check: () => this.check(projectRoot, value),
            update: () => this.update(projectRoot, value),
        };
        const handler = handlers[command];
        if (!handler) {
            throw new TemplateUpdateError(
                `Unknown template command '${command}'.`,
                1,
            );
        }
        return handler();
    }

    private async check(
        projectRoot: string,
        value?: string,
    ): Promise<number> {
        if (value) {
            throw new TemplateUpdateError(
                'template:check accepts no version.',
                1,
            );
        }
        const result = await this.updater.check(projectRoot);
        process.stdout.write(
            result.current === result.latest
                ? `Template ${result.current} is current.\n`
                : `Template update available: ${result.current} → ${result.latest}.\n`,
        );
        return 0;
    }

    private async update(
        projectRoot: string,
        value?: string,
    ): Promise<number> {
        const result = await this.updater.update(projectRoot, value);
        process.stdout.write(
            result.updated
                ? `Template updated to ${result.current}.\n`
                : `Template ${result.current} is already current.\n`,
        );
        return 0;
    }

    private helpRequested(command: string, value?: string): boolean {
        return command === '--help' ||
            command === 'help' ||
            value === '--help';
    }

    private help(): string {
        return [
            'Usage:',
            '  npm run template:check',
            '  npm run template:update',
            '  npm run template:update -- <version>',
            '',
            'Requirements: Node 22, Git, npm, tar, and HTTPS access to GitHub.',
            'Exit codes: 0 success/current, 1 input/dirty/conflict, 2 execution failure.',
            '',
        ].join('\n');
    }
}
