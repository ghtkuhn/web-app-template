import fs from 'node:fs';
import path from 'node:path';
import type {
    UpdateAction,
    UpdateConflict,
    UpdatePlan,
} from './interfaces.ts';
import { AgentInstructionPlanner } from './agent-instruction.planner.ts';
import {
    PACKAGE_MANIFEST_PATHS,
    PackageManifestMerger,
} from './package-manifest.merger.ts';
import { ProjectConfigMerger } from './project-config.merger.ts';

export const TEMPLATE_UPDATE_EXACT_IGNORES = new Set([
    '.git',
    '.template',
    'package.json',
    'package-lock.json',
    'CODEX-INBOX.md',
    '.env',
    '.credentials.env',
    'data/ai/MEMORY.md',
]);

const REQUIRED_TEMPLATE_FILES = new Set([
    '.gitignore',
]);

/** Produces a deterministic three-way update plan. */
export class UpdatePlanner {
    private readonly agentInstructions = new AgentInstructionPlanner();
    private readonly packageManifest = new PackageManifestMerger();
    private readonly projectConfig = new ProjectConfigMerger();

    /** Compares the old template, local project, and new template. */
    public plan(
        baseRoot: string,
        localRoot: string,
        incomingRoot: string,
    ): UpdatePlan {
        const baseFiles = this.files(baseRoot);
        const incomingFiles = this.files(incomingRoot);
        const paths = [...new Set([
            ...baseFiles,
            ...incomingFiles,
        ])]
            .filter((relativePath) =>
                !this.agentInstructions.owns(relativePath) &&
                relativePath !== ProjectConfigMerger.relativePath &&
                !PACKAGE_MANIFEST_PATHS.includes(
                    relativePath as typeof PACKAGE_MANIFEST_PATHS[number],
                ),
            )
            .sort();
        const actions: UpdateAction[] = [
            ...this.agentInstructions.plan(localRoot, incomingRoot),
        ];
        const conflicts: UpdateConflict[] = [];

        for (const relativePath of paths) {
            this.evaluate(
                relativePath,
                baseFiles,
                incomingFiles,
                baseRoot,
                localRoot,
                incomingRoot,
                actions,
                conflicts,
            );
        }
        for (const relativePath of PACKAGE_MANIFEST_PATHS) {
            const packagePlan = this.packageManifest.plan(
                baseRoot,
                localRoot,
                incomingRoot,
                relativePath,
            );
            if (packagePlan.action) {
                actions.push(packagePlan.action);
            }
            if (packagePlan.conflict) {
                conflicts.push(packagePlan.conflict);
            }
        }
        const projectConfigAction = this.projectConfig.plan(
            baseRoot,
            localRoot,
            incomingRoot,
        );
        if (projectConfigAction) {
            actions.push(projectConfigAction);
        }
        actions.sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath),
        );
        conflicts.sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath),
        );
        return { actions, conflicts };
    }

    private evaluate(
        relativePath: string,
        baseFiles: ReadonlySet<string>,
        incomingFiles: ReadonlySet<string>,
        baseRoot: string,
        localRoot: string,
        incomingRoot: string,
        actions: UpdateAction[],
        conflicts: UpdateConflict[],
    ): void {
        const basePath = this.managedPath(
            baseFiles,
            baseRoot,
            relativePath,
        );
        const incomingPath = this.managedPath(
            incomingFiles,
            incomingRoot,
            relativePath,
        );
        const localPath = path.join(localRoot, relativePath);
        const localConflict = this.localPathConflict(
            relativePath,
            localRoot,
            localPath,
            basePath,
            incomingPath,
        );
        if (localConflict) {
            conflicts.push(localConflict);
            return;
        }
        if (
            REQUIRED_TEMPLATE_FILES.has(relativePath) &&
            !fs.existsSync(localPath) &&
            incomingPath
        ) {
            actions.push(this.write(relativePath, incomingPath));
            return;
        }
        if (!basePath) {
            this.evaluateAddition(
                relativePath,
                localPath,
                incomingPath as string,
                actions,
                conflicts,
            );
        } else if (!incomingPath) {
            this.evaluateRemoval(
                relativePath,
                basePath,
                localPath,
                actions,
                conflicts,
            );
        } else {
            this.evaluateChange(
                relativePath,
                basePath,
                localPath,
                incomingPath,
                actions,
                conflicts,
            );
        }
    }

    private managedPath(
        files: ReadonlySet<string>,
        root: string,
        relativePath: string,
    ): string | undefined {
        return files.has(relativePath)
            ? path.join(root, relativePath)
            : undefined;
    }

    private localPathConflict(
        relativePath: string,
        localRoot: string,
        localPath: string,
        basePath?: string,
        incomingPath?: string,
    ): UpdateConflict | undefined {
        const obstacle = this.localObstacle(localRoot, relativePath);
        if (obstacle) {
            return this.conflict(
                relativePath,
                `Local parent path '${obstacle}' is not a directory.`,
                basePath,
                path.join(localRoot, obstacle),
                incomingPath,
            );
        }
        if (fs.existsSync(localPath) && !this.regularFile(localPath)) {
            return this.conflict(
                relativePath,
                'Local path is not a regular file.',
                basePath,
                localPath,
                incomingPath,
            );
        }
        return undefined;
    }

    private evaluateAddition(
        relativePath: string,
        localPath: string,
        incomingPath: string,
        actions: UpdateAction[],
        conflicts: UpdateConflict[],
    ): void {
        if (!fs.existsSync(localPath)) {
            actions.push(this.write(relativePath, incomingPath));
        } else if (!this.equal(localPath, incomingPath)) {
            conflicts.push(this.conflict(
                relativePath,
                'New template file collides with a local file.',
                undefined,
                localPath,
                incomingPath,
            ));
        }
    }

    private evaluateRemoval(
        relativePath: string,
        basePath: string,
        localPath: string,
        actions: UpdateAction[],
        conflicts: UpdateConflict[],
    ): void {
        if (!fs.existsSync(localPath)) {
            return;
        }
        if (this.equal(localPath, basePath)) {
            actions.push({ kind: 'delete', relativePath });
        } else {
            conflicts.push(this.conflict(
                relativePath,
                'Template removed a locally modified file.',
                basePath,
                localPath,
            ));
        }
    }

    private evaluateChange(
        relativePath: string,
        basePath: string,
        localPath: string,
        incomingPath: string,
        actions: UpdateAction[],
        conflicts: UpdateConflict[],
    ): void {
        if (!fs.existsSync(localPath)) {
            if (!this.equal(basePath, incomingPath)) {
                conflicts.push(this.conflict(
                    relativePath,
                    'Locally removed file changed in the template.',
                    basePath,
                    undefined,
                    incomingPath,
                ));
            }
            return;
        }
        const localChanged = !this.equal(localPath, basePath);
        const incomingChanged = !this.equal(incomingPath, basePath);
        if (!localChanged && incomingChanged) {
            actions.push(this.write(relativePath, incomingPath));
        } else if (
            localChanged &&
            incomingChanged &&
            !this.equal(localPath, incomingPath)
        ) {
            conflicts.push(this.conflict(
                relativePath,
                'Local and template versions both changed.',
                basePath,
                localPath,
                incomingPath,
            ));
        }
    }

    private files(root: string): Set<string> {
        const result = new Set<string>();
        this.collect(root, root, result);
        return result;
    }

    private collect(root: string, directory: string, result: Set<string>): void {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            const relativePath = path
                .relative(root, entryPath)
                .split(path.sep)
                .join('/');
            if (this.ignored(relativePath)) {
                continue;
            }
            if (entry.isDirectory()) {
                this.collect(root, entryPath, result);
            } else if (entry.isFile()) {
                result.add(relativePath);
            }
        }
    }

    private ignored(relativePath: string): boolean {
        const normalized = relativePath.split(path.sep).join('/');
        const segments = normalized.split('/');
        const prefixes = [
            '.git/',
            '.template/',
            'data/ai/kanban/todo/',
            'data/ai/kanban/done/',
            'data/sqlite/',
            'deployment/secrets/',
            'deployment/runtime/',
            'deployment/tmp/',
            'deployment/artifacts/',
            'deployment/releases/',
            'deployment/profiles/',
        ];
        const suffixes = [
            '.local.json',
            '/.env',
            '.key',
            '.pem',
            '.sqlite',
        ];
        return TEMPLATE_UPDATE_EXACT_IGNORES.has(normalized) ||
            prefixes.some((prefix) => normalized.startsWith(prefix)) ||
            suffixes.some((suffix) => normalized.endsWith(suffix)) ||
            ['dist', 'node_modules', '.cache'].some(
                (segment) => segments.includes(segment),
            );
    }

    private equal(first: string, second: string): boolean {
        return fs.readFileSync(first).equals(fs.readFileSync(second)) &&
            (fs.statSync(first).mode & 0o777) ===
                (fs.statSync(second).mode & 0o777);
    }

    private regularFile(filePath: string): boolean {
        const status = fs.lstatSync(filePath);
        return status.isFile() && !status.isSymbolicLink();
    }

    private localObstacle(
        localRoot: string,
        relativePath: string,
    ): string | undefined {
        const parts = relativePath.split('/');
        for (let index = 1; index < parts.length; index += 1) {
            const parent = parts.slice(0, index).join('/');
            const parentPath = path.join(localRoot, ...parts.slice(0, index));
            if (fs.existsSync(parentPath)) {
                const status = fs.lstatSync(parentPath);
                if (status.isSymbolicLink() || !status.isDirectory()) {
                    return parent;
                }
            }
        }
        return undefined;
    }

    private write(relativePath: string, sourcePath: string): UpdateAction {
        return {
            kind: 'write',
            relativePath,
            sourcePath,
            mode: fs.statSync(sourcePath).mode & 0o777,
        };
    }

    private conflict(
        relativePath: string,
        reason: string,
        basePath?: string,
        localPath?: string,
        incomingPath?: string,
    ): UpdateConflict {
        return {
            relativePath,
            reason,
            basePath,
            localPath,
            incomingPath,
        };
    }
}
