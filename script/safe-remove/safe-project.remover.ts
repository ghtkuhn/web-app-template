import fs from 'node:fs';
import path from 'node:path';

const SHELL_PATTERN = /[*?[\]{}]/;

/** One validated project-local removal target. */
export interface RemovalTarget {
    readonly relativePath: string;
    readonly absolutePath: string;
}

/** Removes explicit paths without allowing access outside the project root. */
export class SafeProjectRemover {
    private readonly projectRoot: string;

    /** Creates a remover bound to one canonical project root. */
    public constructor(projectRoot: string) {
        this.projectRoot = fs.realpathSync(projectRoot);
    }

    /** Validates every target before deleting any of them. */
    public remove(
        requestedPaths: readonly string[],
        dryRun = false,
    ): readonly RemovalTarget[] {
        if (requestedPaths.length === 0) {
            throw new Error('At least one project-relative path is required.');
        }
        const targets = requestedPaths.map((requestedPath) =>
            this.resolve(requestedPath),
        );
        this.assertDistinctTargets(targets);
        if (!dryRun) {
            for (const target of targets) {
                fs.rmSync(target.absolutePath, {
                    recursive: true,
                    force: false,
                });
            }
        }
        return targets;
    }

    /** Resolves and validates one explicit relative target. */
    private resolve(requestedPath: string): RemovalTarget {
        this.assertSafeSyntax(requestedPath);
        const absolutePath = path.resolve(this.projectRoot, requestedPath);
        const relativePath = path.relative(this.projectRoot, absolutePath);
        this.assertProjectChild(requestedPath, relativePath);
        const segments = relativePath.split(path.sep);
        this.assertOutsideGitMetadata(segments);
        this.assertSafeAncestry(segments);
        this.assertExists(absolutePath, relativePath);
        return {
            relativePath: segments.join('/'),
            absolutePath,
        };
    }

    /** Rejects shell syntax, flags, absolute paths, and empty targets. */
    private assertSafeSyntax(requestedPath: string): void {
        if (
            !requestedPath ||
            path.isAbsolute(requestedPath) ||
            requestedPath.startsWith('-') ||
            requestedPath.includes('\0') ||
            SHELL_PATTERN.test(requestedPath)
        ) {
            throw new Error(
                `Unsafe removal target '${requestedPath}'. Use an explicit project-relative path without flags or glob patterns.`,
            );
        }
    }

    /** Requires the resolved target to be a child of the project root. */
    private assertProjectChild(
        requestedPath: string,
        relativePath: string,
    ): void {
        if (
            !relativePath ||
            relativePath === '..' ||
            relativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativePath)
        ) {
            throw new Error(
                `Removal target '${requestedPath}' is outside the project or is the project root.`,
            );
        }
    }

    /** Protects the complete Git metadata tree. */
    private assertOutsideGitMetadata(segments: readonly string[]): void {
        if (segments.includes('.git')) {
            throw new Error('Git metadata may not be removed.');
        }
    }

    /** Requires a regular target or a dangling final symbolic link. */
    private assertExists(absolutePath: string, relativePath: string): void {
        if (!fs.existsSync(absolutePath) && !this.symbolicLinkExists(absolutePath)) {
            throw new Error(
                `Removal target '${relativePath}' does not exist.`,
            );
        }
    }

    /** Rejects duplicate and nested targets before any removal begins. */
    private assertDistinctTargets(targets: readonly RemovalTarget[]): void {
        const sortedPaths = targets
            .map((target) => target.absolutePath)
            .sort((left, right) => left.localeCompare(right));
        for (let index = 1; index < sortedPaths.length; index += 1) {
            const previousPath = sortedPaths[index - 1];
            const currentPath = sortedPaths[index];
            if (
                previousPath === currentPath ||
                currentPath.startsWith(`${previousPath}${path.sep}`)
            ) {
                throw new Error(
                    'Removal targets must be distinct and must not overlap.',
                );
            }
        }
    }

    /** Rejects symlinked parent directories while allowing link removal itself. */
    private assertSafeAncestry(segments: readonly string[]): void {
        let current = this.projectRoot;
        for (const segment of segments.slice(0, -1)) {
            current = path.join(current, segment);
            if (
                fs.existsSync(current) &&
                fs.lstatSync(current).isSymbolicLink()
            ) {
                throw new Error(
                    `Removal target traverses symbolic-link parent '${path.relative(this.projectRoot, current)}'.`,
                );
            }
        }
    }

    /** Detects a dangling final symlink without following it. */
    private symbolicLinkExists(filePath: string): boolean {
        try {
            return fs.lstatSync(filePath).isSymbolicLink();
        } catch {
            return false;
        }
    }
}
