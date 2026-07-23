import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Generates or verifies checked-in OpenAPI TypeScript contracts. */
export class ApiContractCommand {
    private readonly repositoryRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../..',
    );
    private readonly source = path.join(
        this.repositoryRoot,
        'code/backend/openapi/openapi.yaml',
    );
    private readonly target = path.join(
        this.repositoryRoot,
        'code/frontend/web/src/core/api/generated/schema.ts',
    );

    /** Runs generation or drift detection and returns a stable exit code. */
    public run(mode: string | undefined): number {
        if (mode === 'generate') {
            this.generate(this.target);
            process.stdout.write('Generated frontend OpenAPI types.\n');
            return 0;
        }
        if (mode === 'check') {
            return this.check();
        }
        process.stderr.write('Usage: api-contract.ts <generate|check>\n');
        return 1;
    }

    private check(): number {
        const temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), 'frontend-openapi-'),
        );
        const temporaryTarget = path.join(temporaryDirectory, 'schema.ts');
        try {
            this.generate(temporaryTarget);
            if (
                fs.readFileSync(temporaryTarget, 'utf8') !==
                fs.readFileSync(this.target, 'utf8')
            ) {
                process.stderr.write(
                    'Generated frontend OpenAPI types are stale. Run npm run generate:api.\n',
                );
                return 1;
            }
            process.stdout.write('Frontend OpenAPI types are current.\n');
            return 0;
        } finally {
            fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        }
    }

    private generate(target: string): void {
        const result = spawnSync(
            process.execPath,
            [
                path.join(
                    this.repositoryRoot,
                    'node_modules/openapi-typescript/bin/cli.js',
                ),
                this.source,
                '--output',
                target,
            ],
            {
                cwd: this.repositoryRoot,
                stdio: 'pipe',
                encoding: 'utf8',
            },
        );
        if (result.status !== 0) {
            throw new Error(result.stderr || 'OpenAPI generation failed.');
        }
        const generated = fs.readFileSync(target, 'utf8');
        fs.writeFileSync(
            target,
            `// fallow-ignore-file unused-type\n${generated}`,
            'utf8',
        );
    }
}

process.exitCode = new ApiContractCommand().run(process.argv[2]);
