import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SafeProjectRemover } from './safe-remove/safe-project.remover.ts';

/** Non-interactive CLI for project-scoped removal. */
class SafeRemoveCli {
    /** Parses flags, removes validated targets, and returns a stable exit code. */
    public run(arguments_: readonly string[]): number {
        if (arguments_.includes('--help')) {
            process.stdout.write(this.help());
            return 0;
        }
        return this.remove(arguments_);
    }

    /** Executes removal and translates expected input failures to exit code one. */
    private remove(arguments_: readonly string[]): number {
        try {
            this.execute(arguments_);
            return 0;
        } catch (error: unknown) {
            process.stderr.write(`${this.errorMessage(error)}\n`);
            return 1;
        }
    }

    /** Resolves CLI arguments and reports each validated target. */
    private execute(arguments_: readonly string[]): void {
        const dryRun = arguments_.includes('--dry-run');
        const targets = arguments_.filter((value) => value !== '--dry-run');
        const removed = new SafeProjectRemover(
            this.projectRoot(),
        ).remove(targets, dryRun);
        for (const target of removed) {
            process.stdout.write(
                `${this.action(dryRun)} ${target.relativePath}\n`,
            );
        }
    }

    /** Returns the stable action label for normal and preview runs. */
    private action(dryRun: boolean): string {
        return dryRun ? 'Would remove' : 'Removed';
    }

    /** Normalizes thrown values for concise CLI output. */
    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    /** Returns the repository root derived from this checked-in script. */
    private projectRoot(): string {
        return path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '..',
        );
    }

    /** Documents syntax and safety boundaries. */
    private help(): string {
        return [
            'Usage: npm run rm -- <project-relative-path> [path...] [--dry-run]',
            '',
            'Removes explicit files, directories, or symlinks inside the project.',
            'Rejects absolute paths, traversal, glob patterns, project root,',
            'Git metadata, and paths below symbolic-link parents.',
            '',
        ].join('\n');
    }
}

process.exitCode = new SafeRemoveCli().run(process.argv.slice(2));
