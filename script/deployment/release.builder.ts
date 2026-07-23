import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ComponentName } from './interfaces.ts';
import { ProcessRunner } from './process.runner.ts';

/** Produces checksummed release archives for native LXC installations. */
export class ReleaseBuilder {
    private readonly projectRoot: string;
    private readonly processes: ProcessRunner;

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
        const source = component === 'frontend'
            ? 'code/frontend/web/dist'
            : 'code/backend';
        const release = new Date().toISOString().replace(/[-:.TZ]/g, '');
        const directory = fs.mkdtempSync(
            path.join(os.tmpdir(), 'web-app-release-'),
        );
        const archive = path.join(directory, `${component}-${release}.tgz`);
        this.processes.run(
            'tar',
            [
                '--exclude=node_modules',
                '--exclude=test',
                '--exclude=.env',
                '-czf',
                archive,
                '-C',
                source,
                '.',
            ],
            {
                cwd: this.projectRoot,
                env: {
                    ...process.env,
                    COPYFILE_DISABLE: '1',
                },
            },
        );
        const checksum = createHash('sha256')
            .update(fs.readFileSync(archive))
            .digest('hex');
        fs.writeFileSync(
            `${archive}.sha256`,
            `${checksum}  ${path.basename(archive)}\n`,
        );
        return { archive, release, checksum };
    }
}
