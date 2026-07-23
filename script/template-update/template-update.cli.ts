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
        const [command = 'check', ...values] = arguments_;
        if (this.helpRequested(command, values[0])) {
            process.stdout.write(this.help());
            return 0;
        }
        const projectRoot = path.resolve(process.cwd());
        const handlers: Record<string, () => Promise<number>> = {
            init: () => this.initialize(projectRoot, values),
            check: () => this.check(projectRoot, values),
            update: () => this.update(projectRoot, values),
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
        values: readonly string[],
    ): Promise<number> {
        if (values.length > 0) {
            throw new TemplateUpdateError(
                'template:check accepts no version.',
                1,
            );
        }
        const result = await this.updater.check(projectRoot);
        process.stdout.write(this.checkOutput(result));
        return 0;
    }

    /** Formats release, conflict, and prior verification state. */
    private checkOutput(
        result: Awaited<ReturnType<TemplateUpdater['check']>>,
    ): string {
        const lines = [
            this.versionOutput(result.current, result.latest),
            this.pendingOutput(result.pending),
            this.verificationOutput(result.verification),
        ].filter((line) => line.length > 0);
        return `${lines.join('\n')}\n`;
    }

    /** Formats the installed/latest version relationship. */
    private versionOutput(current: string, latest: string): string {
        return current === latest
            ? `Template ${current} is current.`
            : `Template update available: ${current} → ${latest}.`;
    }

    /** Formats pending conflict sessions when present. */
    private pendingOutput(pending: readonly string[]): string {
        return pending.length > 0
            ? `Pending conflict session(s): ${pending.join(', ')}.`
            : '';
    }

    /** Formats a prior failed post-update verification when present. */
    private verificationOutput(
        verification: Awaited<
            ReturnType<TemplateUpdater['check']>
        >['verification'],
    ): string {
        return verification?.verification === 'failed'
            ? `Last update verification failed; log: ${verification.logPath}.`
            : '';
    }

    /** Initializes explicit metadata for a legacy project. */
    private async initialize(
        projectRoot: string,
        values: readonly string[],
    ): Promise<number> {
        if (values.length !== 1) {
            throw new TemplateUpdateError(
                'template:init requires exactly one installed version.',
                1,
            );
        }
        const result = await this.updater.initialize(
            projectRoot,
            values[0],
        );
        process.stdout.write(
            `Template metadata initialized at ${result.version}.\n`,
        );
        return 0;
    }

    private async update(
        projectRoot: string,
        values: readonly string[],
    ): Promise<number> {
        if (values[0] === '--abort') {
            return this.abort(projectRoot, values);
        }
        const result =
            values[0] === '--continue'
                ? await this.continue(projectRoot, values)
                : await this.directUpdate(projectRoot, values);
        return this.reportUpdate(result);
    }

    /** Aborts exactly one versioned staging session. */
    private abort(projectRoot: string, values: readonly string[]): number {
        if (values.length !== 2) {
            throw new TemplateUpdateError(
                'template:update --abort requires one target version.',
                1,
            );
        }
        this.updater.abort(projectRoot, values[1]);
        process.stdout.write(
            `Template conflict session ${values[1]} aborted.\n`,
        );
        return 0;
    }

    /** Reports installed state separately from migration follow-up. */
    private reportUpdate(
        result: Awaited<ReturnType<TemplateUpdater['update']>>,
    ): number {
        if (!result.verificationPassed) {
            process.stderr.write(
                `Template ${result.current} installed, but npm run verify failed; log: ${result.logPath}.\n`,
            );
            return 1;
        }
        process.stdout.write(
            result.updated
                ? `Template updated to ${result.current}.\n`
                : `Template ${result.current} is already current.\n`,
        );
        return 0;
    }

    /** Validates and executes a continued conflict session. */
    private async continue(
        projectRoot: string,
        values: readonly string[],
    ): ReturnType<TemplateUpdater['continue']> {
        if (values.length !== 2) {
            throw new TemplateUpdateError(
                'template:update --continue requires one target version.',
                1,
            );
        }
        return this.updater.continue(projectRoot, values[1]);
    }

    /** Validates and executes a direct update request. */
    private async directUpdate(
        projectRoot: string,
        values: readonly string[],
    ): ReturnType<TemplateUpdater['update']> {
        if (values.length > 1) {
            throw new TemplateUpdateError('Too many arguments.', 1);
        }
        return this.updater.update(projectRoot, values[0]);
    }

    private helpRequested(command: string, value?: string): boolean {
        return command === '--help' ||
            command === 'help' ||
            value === '--help';
    }

    private help(): string {
        return [
            'Usage:',
            '  npm run template:init -- <installed-version>',
            '  npm run template:check',
            '  npm run template:update',
            '  npm run template:update -- <version>',
            '  npm run template:update -- --continue <version>',
            '  npm run template:update -- --abort <version>',
            '',
            'Requirements: Node 22, Git, npm, tar, and HTTPS access to GitHub.',
            'Exit codes: 0 success/current, 1 input/conflict/verify follow-up, 2 execution failure.',
            '',
        ].join('\n');
    }
}
