import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { TEMPLATE_UPDATE_EXACT_IGNORES } from '../template-update/update.planner.ts';

const CREDENTIAL_FILE = '.credentials.env';
const CREDENTIAL_IGNORE = '/.credentials.env';

/** Owns creation, validation, and process-local loading of credentials. */
export class CredentialManager {
    private readonly projectRoot: string;

    public constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /** Creates the local credential file without replacing any path. */
    public initialize(): void {
        const target = this.credentialPath();
        this.rejectExistingPath(target);
        const example = path.join(
            this.projectRoot,
            '.credentials.example.env',
        );
        const temporary = path.join(
            this.projectRoot,
            `.credentials.env.${process.pid}.${Date.now()}.tmp`,
        );
        let createdTemporary = false;
        try {
            const descriptor = fs.openSync(
                temporary,
                fs.constants.O_CREAT |
                    fs.constants.O_EXCL |
                    fs.constants.O_WRONLY,
                0o600,
            );
            createdTemporary = true;
            try {
                fs.writeFileSync(descriptor, fs.readFileSync(example));
                fs.fsyncSync(descriptor);
            } finally {
                fs.closeSync(descriptor);
            }
            fs.linkSync(temporary, target);
            fs.chmodSync(target, 0o600);
        } finally {
            if (createdTemporary) {
                fs.unlinkSync(temporary);
            }
        }
    }

    /** Validates metadata and repository safeguards without reading secrets. */
    public check(): void {
        this.checkIgnoreFile('.gitignore');
        this.checkIgnoreFile('.dockerignore');
        if (!TEMPLATE_UPDATE_EXACT_IGNORES.has(CREDENTIAL_FILE)) {
            throw new Error(
                '.credentials.env is missing from the template updater ignore list.',
            );
        }
        this.checkCredentialMetadata();
        this.checkGitState();
    }

    /** Loads secrets only into a child npm process. */
    public run(script: string, args: readonly string[]): number {
        if (!/^[A-Za-z0-9:_-]+$/.test(script)) {
            throw new Error(`Invalid npm script name '${script}'.`);
        }
        this.check();
        const values = parseEnv(fs.readFileSync(
            this.credentialPath(),
            'utf8',
        ));
        const environment = { ...values, ...process.env };
        const result = spawnSync(
            'npm',
            ['run', script, ...(args.length > 0 ? ['--', ...args] : [])],
            {
                cwd: this.projectRoot,
                env: environment,
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
            },
        );
        if (result.error) {
            throw result.error;
        }
        const sensitiveValues = Object.keys(values)
            .map((name) => environment[name])
            .filter((value): value is string => Boolean(value));
        process.stdout.write(this.redact(result.stdout, sensitiveValues));
        process.stderr.write(this.redact(result.stderr, sensitiveValues));
        return result.status ?? 1;
    }

    private credentialPath(): string {
        return path.join(this.projectRoot, CREDENTIAL_FILE);
    }

    private redact(
        output: string | null,
        values: readonly string[],
    ): string {
        let redacted = output ?? '';
        for (const value of [...new Set(values)].sort(
            (left, right) => right.length - left.length,
        )) {
            redacted = redacted.split(value).join('[REDACTED]');
        }
        return redacted;
    }

    private rejectExistingPath(target: string): void {
        try {
            const status = fs.lstatSync(target);
            const kind = status.isSymbolicLink() ? 'symlink' : 'path';
            throw new Error(
                `Refusing to replace existing ${kind} '${CREDENTIAL_FILE}'.`,
            );
        } catch (error) {
            if (
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
            ) {
                return;
            }
            throw error;
        }
    }

    private checkIgnoreFile(relativePath: string): void {
        const lines = fs.readFileSync(
            path.join(this.projectRoot, relativePath),
            'utf8',
        ).split(/\r?\n/u);
        if (!lines.includes(CREDENTIAL_IGNORE)) {
            throw new Error(
                `${relativePath} must contain the exact '${CREDENTIAL_IGNORE}' rule.`,
            );
        }
    }

    private checkCredentialMetadata(): void {
        const target = this.credentialPath();
        try {
            const status = fs.lstatSync(target);
            if (status.isSymbolicLink() || !status.isFile()) {
                throw new Error(
                    `${CREDENTIAL_FILE} must be a regular non-symlink file.`,
                );
            }
            if ((status.mode & 0o777) !== 0o600) {
                throw new Error(`${CREDENTIAL_FILE} must have mode 0600.`);
            }
        } catch (error) {
            if (
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
            ) {
                return;
            }
            throw error;
        }
    }

    private checkGitState(): void {
        const repository = spawnSync(
            'git',
            ['rev-parse', '--is-inside-work-tree'],
            { cwd: this.projectRoot, encoding: 'utf8' },
        );
        if (repository.status !== 0) {
            return;
        }
        const tracked = spawnSync(
            'git',
            ['ls-files', '--error-unmatch', '--', CREDENTIAL_FILE],
            { cwd: this.projectRoot, encoding: 'utf8' },
        );
        const staged = spawnSync(
            'git',
            [
                'diff',
                '--cached',
                '--name-only',
                '--diff-filter=ACMR',
                '--',
                CREDENTIAL_FILE,
            ],
            { cwd: this.projectRoot, encoding: 'utf8' },
        );
        if (tracked.status === 0 || staged.stdout.trim() === CREDENTIAL_FILE) {
            throw new Error(
                `${CREDENTIAL_FILE} must not be tracked or staged by Git.`,
            );
        }
    }
}
