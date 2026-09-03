import fs from 'node:fs';
import path from 'node:path';
import type { ComponentName } from './interfaces.ts';

export const LXC_INFRASTRUCTURE_SCHEMA_VERSION = 3;
export const LXC_PREVIOUS_INFRASTRUCTURE_SCHEMA_VERSION = 2;
export const LXC_RELEASE_SCHEMA_VERSION = 1;

export type LxcInfrastructureSchemaVersion =
    | typeof LXC_PREVIOUS_INFRASTRUCTURE_SCHEMA_VERSION
    | typeof LXC_INFRASTRUCTURE_SCHEMA_VERSION;

export interface LxcReleaseContractData {
    readonly schemaVersion: typeof LXC_RELEASE_SCHEMA_VERSION;
    readonly infrastructureSchemaVersion: LxcInfrastructureSchemaVersion;
    readonly component: ComponentName;
    readonly layout:
        | 'workspace-v1'
        | 'static-v1'
        | 'legacy-workspace-v0'
        | 'legacy-flat-v0';
    readonly launcher: 'start-backend.mjs' | null;
    readonly nodeVersion: string | null;
    readonly npmRange: string | null;
    readonly requiredFiles: readonly string[];
}

/** Owns the exact native-LXC artifact and runtime layout. */
export class LxcRuntimeContract {
    public static readonly manifest = 'release.contract.json';
    public static readonly backendLauncher = 'start-backend.mjs';
    public static readonly backendMaintenanceLauncher =
        'run-database-maintenance.mjs';

    /** Returns the allowlisted source paths for a release component. */
    public sourcePaths(component: ComponentName): readonly string[] {
        return component === 'backend'
            ? [
                  'package.json',
                  'package-lock.json',
                  'code/backend/package.json',
                  'code/backend/src',
                  'code/backend/script/database-maintenance.ts',
              ]
            : ['code/frontend/web/dist'];
    }

    /** Creates the immutable contract embedded in one release. */
    public release(
        component: ComponentName,
        nodeVersion: string,
        npmRange: string,
        infrastructureSchemaVersion: LxcInfrastructureSchemaVersion =
            LXC_INFRASTRUCTURE_SCHEMA_VERSION,
    ): LxcReleaseContractData {
        if (component === 'backend') {
            return {
                schemaVersion: LXC_RELEASE_SCHEMA_VERSION,
                infrastructureSchemaVersion,
                component,
                layout: 'workspace-v1',
                launcher: LxcRuntimeContract.backendLauncher,
                nodeVersion,
                npmRange,
                requiredFiles: [
                    LxcRuntimeContract.backendLauncher,
                    LxcRuntimeContract.backendMaintenanceLauncher,
                    'package.json',
                    'package-lock.json',
                    'code/backend/package.json',
                    'code/backend/src/index.ts',
                    'code/backend/script/database-maintenance.ts',
                ],
            };
        }
        return {
            schemaVersion: LXC_RELEASE_SCHEMA_VERSION,
            infrastructureSchemaVersion,
            component,
            layout: 'static-v1',
            launcher: null,
            nodeVersion: null,
            npmRange: null,
            requiredFiles: ['index.html'],
        };
    }

    /** Renders the stable systemd entrypoint contained in backend archives. */
    public backendLauncher(entrypoint = 'code/backend/src/index.ts'): string {
        return [
            `import { BackendApplication } from './${entrypoint}';`,
            'await new BackendApplication().start();',
            '',
        ].join('\n');
    }

    /** Renders the stable database-maintenance entrypoint. */
    public backendMaintenanceLauncher(
        entrypoint = 'code/backend/script/database-maintenance.ts',
    ): string {
        return `await import('./${entrypoint}');\n`;
    }

    /** Returns supported migrated legacy contracts for explicit rollback. */
    public legacyBackendReleases(
        nodeVersion: string,
        npmRange: string,
        infrastructureSchemaVersion: LxcInfrastructureSchemaVersion =
            LXC_INFRASTRUCTURE_SCHEMA_VERSION,
    ): readonly LxcReleaseContractData[] {
        return [
            this.legacyBackendRelease(
                'legacy-workspace-v0',
                'code/backend/src/index.ts',
                nodeVersion,
                npmRange,
                infrastructureSchemaVersion,
            ),
            this.legacyBackendRelease(
                'legacy-flat-v0',
                'src/index.ts',
                nodeVersion,
                npmRange,
                infrastructureSchemaVersion,
            ),
        ];
    }

    /** Renders a deterministic release contract. */
    public render(data: LxcReleaseContractData): string {
        return `${JSON.stringify(data, null, 4)}\n`;
    }

    /** Validates one extracted release without trusting its embedded file list. */
    public validate(
        releaseRoot: string,
        expected: LxcReleaseContractData,
    ): void {
        const rootStatus = fs.lstatSync(releaseRoot);
        if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
            throw new Error('Release candidate root must be a real directory.');
        }
        this.rejectUnsafeSymlinks(releaseRoot, releaseRoot);
        const manifestPath = path.join(
            releaseRoot,
            LxcRuntimeContract.manifest,
        );
        this.assertRegular(releaseRoot, manifestPath);
        const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
        if (JSON.stringify(value) !== JSON.stringify(expected)) {
            throw new Error('Release candidate contract does not match the expected LXC contract.');
        }
        for (const relativePath of expected.requiredFiles) {
            this.assertRegular(releaseRoot, path.join(releaseRoot, relativePath));
        }
    }

    /** Produces the dependency-free validator uploaded alongside an archive. */
    public candidateValidator(): string {
        return [
            "import fs from 'node:fs';",
            "import path from 'node:path';",
            "const [root, expectedJson] = process.argv.slice(2);",
            "const fail = (message) => { process.stderr.write(`${message}\\n`); process.exit(65); };",
            "if (!root || !expectedJson) fail('Release validation arguments are missing.');",
            "const expectedValue = JSON.parse(expectedJson);",
            "const expectedContracts = Array.isArray(expectedValue) ? expectedValue : [expectedValue];",
            "const replacementValue = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;",
            "const replacements = replacementValue === undefined ? undefined : (Array.isArray(replacementValue) ? replacementValue : [replacementValue]);",
            "if (replacements && replacements.length !== expectedContracts.length) fail('Release contract migration mapping is invalid.');",
            "const rootStatus = fs.lstatSync(root);",
            "if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) fail('Release candidate root is unsafe.');",
            "const rootReal = fs.realpathSync(root);",
            "const inside = (target) => { const relative = path.relative(rootReal, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };",
            "const dependencyPath = (target) => path.relative(rootReal, target).split(path.sep).includes('node_modules');",
            "const safeDependencyLink = (target) => { if (!dependencyPath(target)) return false; try { return inside(fs.realpathSync(target)); } catch { return false; } };",
            "const regular = (target) => { const status = fs.lstatSync(target); if (!status.isFile() || status.isSymbolicLink() || !inside(fs.realpathSync(target))) fail(`Required release file is unsafe: ${target}`); };",
            "const walk = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); const status = fs.lstatSync(target); if (status.isSymbolicLink()) { if (!safeDependencyLink(target)) fail(`Release symlink is forbidden: ${target}`); continue; } if (status.isDirectory()) walk(target); } };",
            "walk(root);",
            `const manifestPath = path.join(root, '${LxcRuntimeContract.manifest}');`,
            "regular(manifestPath);",
            "const actual = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));",
            "const expectedIndex = expectedContracts.findIndex((candidate) => JSON.stringify(actual) === JSON.stringify(candidate));",
            "const expected = expectedContracts[expectedIndex];",
            "if (!expected) fail('Release contract mismatch.');",
            "for (const relativePath of expected.requiredFiles) regular(path.join(root, relativePath));",
            "const replacement = replacements?.[expectedIndex];",
            "if (replacement && JSON.stringify(actual) !== JSON.stringify(replacement)) {",
            "  const { infrastructureSchemaVersion: sourceSchema, ...sourceContract } = actual;",
            "  const { infrastructureSchemaVersion: targetSchema, ...targetContract } = replacement;",
            `  if (sourceSchema !== ${LXC_PREVIOUS_INFRASTRUCTURE_SCHEMA_VERSION} || targetSchema !== ${LXC_INFRASTRUCTURE_SCHEMA_VERSION} || JSON.stringify(sourceContract) !== JSON.stringify(targetContract)) fail('Release contract migration is unsafe.');`,
            "  for (const relativePath of replacement.requiredFiles) regular(path.join(root, relativePath));",
            "  const status = fs.lstatSync(manifestPath);",
            "  const temporary = `${manifestPath}.new`;",
            "  if (fs.existsSync(temporary)) fail('Release contract migration staging file already exists.');",
            "  try {",
            "    fs.writeFileSync(temporary, `${JSON.stringify(replacement, null, 4)}\\n`, { flag: 'wx', mode: status.mode & 0o777 });",
            "    fs.chownSync(temporary, status.uid, status.gid);",
            "    fs.chmodSync(temporary, status.mode & 0o777);",
            "    fs.renameSync(temporary, manifestPath);",
            "  } catch (error) {",
            "    fs.rmSync(temporary, { force: true });",
            "    throw error;",
            "  }",
            "}",
            '',
        ].join('\n');
    }

    private legacyBackendRelease(
        layout: 'legacy-workspace-v0' | 'legacy-flat-v0',
        entrypoint: string,
        nodeVersion: string,
        npmRange: string,
        infrastructureSchemaVersion: LxcInfrastructureSchemaVersion,
    ): LxcReleaseContractData {
        return {
            schemaVersion: LXC_RELEASE_SCHEMA_VERSION,
            infrastructureSchemaVersion,
            component: 'backend',
            layout,
            launcher: LxcRuntimeContract.backendLauncher,
            nodeVersion,
            npmRange,
            requiredFiles: [
                LxcRuntimeContract.backendLauncher,
                LxcRuntimeContract.backendMaintenanceLauncher,
                entrypoint,
                layout === 'legacy-workspace-v0'
                    ? 'code/backend/script/database-maintenance.ts'
                    : 'script/database-maintenance.ts',
            ],
        };
    }

    private rejectUnsafeSymlinks(root: string, directory: string): void {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            const status = fs.lstatSync(target);
            if (status.isSymbolicLink()) {
                if (!this.safeDependencyLink(root, target)) {
                    throw new Error(
                        `Release candidate contains forbidden symlink '${path.relative(root, target)}'.`,
                    );
                }
                continue;
            }
            if (status.isDirectory()) {
                this.rejectUnsafeSymlinks(root, target);
            }
        }
    }

    /** Allows npm links only when their resolved target remains in the release. */
    private safeDependencyLink(root: string, target: string): boolean {
        if (!path.relative(root, target).split(path.sep).includes('node_modules')) {
            return false;
        }
        try {
            const relative = path.relative(
                fs.realpathSync(root),
                fs.realpathSync(target),
            );
            return relative !== '..' &&
                !relative.startsWith(`..${path.sep}`) &&
                !path.isAbsolute(relative);
        } catch {
            return false;
        }
    }

    private assertRegular(root: string, target: string): void {
        let status: fs.Stats;
        try {
            status = fs.lstatSync(target);
        } catch {
            throw new Error(
                `Required release file '${path.relative(root, target)}' is missing.`,
            );
        }
        const relative = path.relative(
            fs.realpathSync(root),
            fs.realpathSync(target),
        );
        if (
            !status.isFile() ||
            status.isSymbolicLink() ||
            relative === '..' ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
        ) {
            throw new Error(
                `Required release file '${path.relative(root, target)}' is unsafe.`,
            );
        }
    }
}
