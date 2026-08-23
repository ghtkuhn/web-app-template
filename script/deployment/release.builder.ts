import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ComponentName } from './interfaces.ts';
import { LxcRuntimeContract } from './lxc-runtime.contract.ts';
import { ProcessRunner } from './process.runner.ts';

/** Produces checksummed release archives for native LXC installations. */
export class ReleaseBuilder {
    private readonly projectRoot: string;
    private readonly processes: ProcessRunner;
    private readonly contract = new LxcRuntimeContract();

    public constructor(
        projectRoot: string,
        processes = new ProcessRunner(),
    ) {
        this.projectRoot = projectRoot;
        this.processes = processes;
    }

    public build(component: ComponentName): {
        readonly archive: string;
        readonly release: string;
        readonly checksum: string;
    } {
        if (component === 'frontend') {
            this.processes.run(
                'npm',
                ['run', 'build', '--workspace', '@app/web'],
                { cwd: this.projectRoot },
            );
        }
        const release = new Date().toISOString().replace(/[-:.TZ]/g, '');
        const directory = fs.mkdtempSync(
            path.join(os.tmpdir(), 'web-app-release-'),
        );
        const archive = path.join(directory, `${component}-${release}.tgz`);
        const staging = path.join(directory, 'release');
        fs.mkdirSync(staging);
        try {
            this.stage(component, staging);
            this.processes.run(
                'tar',
                ['-czf', archive, '-C', staging, '.'],
                {
                    cwd: this.projectRoot,
                    env: {
                        ...process.env,
                        COPYFILE_DISABLE: '1',
                    },
                },
            );
        } finally {
            fs.rmSync(staging, { recursive: true, force: true });
        }
        const checksum = createHash('sha256')
            .update(fs.readFileSync(archive))
            .digest('hex');
        fs.writeFileSync(
            `${archive}.sha256`,
            `${checksum}  ${path.basename(archive)}\n`,
        );
        return { archive, release, checksum };
    }

    private stage(component: ComponentName, staging: string): void {
        for (const relativePath of this.contract.sourcePaths(component)) {
            const source = path.join(this.projectRoot, relativePath);
            const destination = component === 'frontend'
                ? staging
                : path.join(staging, relativePath);
            if (component === 'frontend') {
                this.copyTree(source, destination, false);
            } else {
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                const status = fs.lstatSync(source);
                if (status.isDirectory()) {
                    this.copyTree(source, destination, true);
                } else {
                    this.copyFile(source, destination);
                }
            }
        }
        const nodeVersion = fs.readFileSync(
            path.join(this.projectRoot, '.nvmrc'),
            'utf8',
        ).trim();
        const rootManifest = JSON.parse(fs.readFileSync(
            path.join(this.projectRoot, 'package.json'),
            'utf8',
        )) as { engines?: { npm?: unknown } };
        const npmRange = rootManifest.engines?.npm;
        if (!/^\d+\.\d+\.\d+$/u.test(nodeVersion) || typeof npmRange !== 'string') {
            throw new Error('Release runtime contract is invalid.');
        }
        const releaseContract = this.contract.release(
            component,
            nodeVersion,
            npmRange,
        );
        fs.writeFileSync(
            path.join(staging, LxcRuntimeContract.manifest),
            this.contract.render(releaseContract),
            'utf8',
        );
        if (component === 'backend') {
            fs.writeFileSync(
                path.join(staging, LxcRuntimeContract.backendLauncher),
                this.contract.backendLauncher(),
                'utf8',
            );
            fs.writeFileSync(
                path.join(
                    staging,
                    LxcRuntimeContract.backendMaintenanceLauncher,
                ),
                this.contract.backendMaintenanceLauncher(),
                'utf8',
            );
        }
        this.contract.validate(staging, releaseContract);
    }

    private copyTree(
        source: string,
        destination: string,
        backendSourcesOnly: boolean,
    ): void {
        fs.mkdirSync(destination, { recursive: true });
        for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
            if (entry.name === '.DS_Store' || entry.name === 'node_modules') {
                continue;
            }
            const sourcePath = path.join(source, entry.name);
            const destinationPath = path.join(destination, entry.name);
            const status = fs.lstatSync(sourcePath);
            if (status.isSymbolicLink()) {
                throw new Error(`Release source symlink is forbidden: ${sourcePath}`);
            }
            if (status.isDirectory()) {
                this.copyTree(sourcePath, destinationPath, backendSourcesOnly);
            } else if (
                status.isFile() &&
                (!backendSourcesOnly || /\.(?:json|ts)$/u.test(entry.name))
            ) {
                this.copyFile(sourcePath, destinationPath);
            }
        }
    }

    private copyFile(source: string, destination: string): void {
        const status = fs.lstatSync(source);
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error(`Release source must be a regular file: ${source}`);
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
        fs.chmodSync(destination, status.mode & 0o777);
    }
}
