import fs from 'node:fs';
import path from 'node:path';
import { LxcContractCatalog } from '../deployment/lxc-contract.catalog.ts';

interface EngineContract {
    readonly name?: unknown;
    readonly version?: unknown;
    readonly onFail?: unknown;
}

interface PackageManifest {
    readonly packageManager?: unknown;
    readonly engines?: Record<string, unknown>;
    readonly devEngines?: {
        readonly runtime?: EngineContract;
        readonly packageManager?: EngineContract;
    };
}

export interface RuntimeCheckResult {
    readonly nodeVersion: string;
    readonly npmVersion: string;
}

const WORKSPACE_MANIFESTS = [
    'code/backend/package.json',
    'code/frontend/web/package.json',
] as const;

const NODE_DOCKERFILES = [
    'deployment/docker/backend.Dockerfile',
    'deployment/docker/frontend.Dockerfile',
] as const;

/** Enforces one exact Node.js runtime across local tooling and deployments. */
export class RuntimeContract {
    private readonly projectRoot: string;
    private readonly validateDeploymentContract: boolean;

    public constructor(projectRoot: string, validateDeploymentContract = true) {
        this.projectRoot = projectRoot;
        this.validateDeploymentContract = validateDeploymentContract;
    }

    /** Validates checked-in contracts and the active process runtime. */
    public check(
        currentNodeVersion = process.versions.node,
        currentNpmVersion = this.activeNpmVersion(),
    ): RuntimeCheckResult {
        const nodeVersion = this.nodeVersion();
        const root = this.manifest('package.json');
        const npmVersion = this.packageManagerVersion(root);
        const npmRange = this.engine(root, 'npm', 'package.json');

        this.assertEngine(root, 'package.json', nodeVersion, npmRange);
        this.assertDeveloperEngines(root, nodeVersion, npmRange);
        this.assertNpmConfiguration();
        for (const relativePath of WORKSPACE_MANIFESTS) {
            this.assertEngine(
                this.manifest(relativePath),
                relativePath,
                nodeVersion,
                npmRange,
            );
        }
        for (const relativePath of NODE_DOCKERFILES) {
            this.assertDockerImage(relativePath, nodeVersion);
        }
        if (this.validateDeploymentContract) {
            new LxcContractCatalog().check(this.projectRoot);
        }
        if (currentNodeVersion !== nodeVersion) {
            throw new Error(
                `Node.js ${nodeVersion} is required; running ${currentNodeVersion}. ` +
                'Activate .nvmrc and run npm ci before continuing.',
            );
        }
        if (currentNpmVersion && !this.matchesNpmMajor(currentNpmVersion)) {
            throw new Error(
                `npm 11 is required; running ${currentNpmVersion}.`,
            );
        }

        return {
            nodeVersion,
            npmVersion: currentNpmVersion ?? npmVersion,
        };
    }

    private nodeVersion(): string {
        const value = this.read('.nvmrc').trim();
        if (!/^\d+\.\d+\.\d+$/.test(value)) {
            throw new Error('.nvmrc must contain one exact Node.js version.');
        }
        return value;
    }

    private assertEngine(
        manifest: PackageManifest,
        relativePath: string,
        nodeVersion: string,
        npmRange: string,
    ): void {
        if (this.engine(manifest, 'node', relativePath) !== nodeVersion) {
            throw new Error(
                `${relativePath} engines.node must equal ${nodeVersion}.`,
            );
        }
        if (this.engine(manifest, 'npm', relativePath) !== npmRange) {
            throw new Error(
                `${relativePath} engines.npm must equal '${npmRange}'.`,
            );
        }
    }

    private assertDeveloperEngines(
        manifest: PackageManifest,
        nodeVersion: string,
        npmRange: string,
    ): void {
        this.assertDeveloperEngine(
            manifest.devEngines?.runtime,
            'node',
            nodeVersion,
        );
        this.assertDeveloperEngine(
            manifest.devEngines?.packageManager,
            'npm',
            npmRange,
        );
    }

    private assertDeveloperEngine(
        contract: EngineContract | undefined,
        name: string,
        version: string,
    ): void {
        if (
            contract?.name !== name ||
            contract.version !== version ||
            contract.onFail !== 'error'
        ) {
            throw new Error(
                `package.json devEngines.${name === 'node' ? 'runtime' : 'packageManager'} ` +
                `must require ${name} '${version}' with onFail 'error'.`,
            );
        }
    }

    private assertNpmConfiguration(): void {
        const activeLines = this.read('.npmrc')
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'));
        if (!activeLines.includes('engine-strict=true')) {
            throw new Error('.npmrc must enable engine-strict=true.');
        }
        if (!activeLines.includes('ignore-scripts=true')) {
            throw new Error(
                '.npmrc must enable ignore-scripts=true; run trusted root ' +
                'lifecycle scripts explicitly.',
            );
        }
    }

    private assertDockerImage(
        relativePath: string,
        nodeVersion: string,
    ): void {
        const firstInstruction = this.read(relativePath)
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .find(Boolean);
        const expected = `FROM node:${nodeVersion}-bookworm-slim`;
        if (!firstInstruction?.startsWith(expected)) {
            throw new Error(
                `${relativePath} must start with '${expected}'.`,
            );
        }
    }

    private packageManagerVersion(manifest: PackageManifest): string {
        if (typeof manifest.packageManager !== 'string') {
            throw new Error('package.json packageManager must pin npm exactly.');
        }
        const match = /^npm@(\d+\.\d+\.\d+)$/u.exec(
            manifest.packageManager,
        );
        if (!match?.[1] || !this.matchesNpmMajor(match[1])) {
            throw new Error(
                'package.json packageManager must pin an npm 11 release.',
            );
        }
        return match[1];
    }

    private engine(
        manifest: PackageManifest,
        name: 'node' | 'npm',
        relativePath: string,
    ): string {
        const value = manifest.engines?.[name];
        if (typeof value !== 'string') {
            throw new Error(`${relativePath} engines.${name} is required.`);
        }
        return value;
    }

    private manifest(relativePath: string): PackageManifest {
        const value = JSON.parse(this.read(relativePath)) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${relativePath} must contain a JSON object.`);
        }
        return value as PackageManifest;
    }

    private activeNpmVersion(): string | undefined {
        const match = /(?:^|\s)npm\/(\d+\.\d+\.\d+)(?:\s|$)/u.exec(
            process.env.npm_config_user_agent ?? '',
        );
        return match?.[1];
    }

    private matchesNpmMajor(version: string): boolean {
        return /^11\.\d+\.\d+$/u.test(version);
    }

    private read(relativePath: string): string {
        return fs.readFileSync(
            path.join(this.projectRoot, relativePath),
            'utf8',
        );
    }
}
