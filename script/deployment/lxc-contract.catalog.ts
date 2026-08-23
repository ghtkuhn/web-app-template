import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LXC_CONTRACT_FILES = [
    'script/deployment/lxc-runtime.contract.ts',
    'script/deployment/release.builder.ts',
    'script/deployment/ssh.release-driver.ts',
    'deployment/lxc/bootstrap-existing-lxc.sh',
    'deployment/lxc/install-backend.sh',
    'deployment/lxc/install-frontend.sh',
] as const;

interface LxcContractCatalogData {
    readonly schemaVersion: 1;
    readonly files: Readonly<Record<string, string>>;
}

/** Binds files that jointly implement the native-LXC runtime contract. */
export class LxcContractCatalog {
    public static readonly relativePath =
        'deployment/lxc/runtime-contract.catalog.json';

    public check(projectRoot: string): void {
        const catalog = this.read(projectRoot);
        const names = Object.keys(catalog.files).sort();
        if (JSON.stringify(names) !== JSON.stringify([...LXC_CONTRACT_FILES].sort())) {
            throw new Error('LXC runtime contract catalog file list is invalid.');
        }
        for (const relativePath of LXC_CONTRACT_FILES) {
            const expected = catalog.files[relativePath];
            const observed = this.hash(path.join(projectRoot, relativePath));
            if (expected !== observed) {
                throw new Error(
                    `LXC runtime contract drift detected in ${relativePath}; regenerate the contract catalog only after reviewing the complete cross-file contract.`,
                );
            }
        }
    }

    public generate(projectRoot: string): void {
        const files: Record<string, string> = {};
        for (const relativePath of LXC_CONTRACT_FILES) {
            files[relativePath] = this.hash(path.join(projectRoot, relativePath));
        }
        const target = path.join(
            projectRoot,
            LxcContractCatalog.relativePath,
        );
        fs.writeFileSync(
            target,
            `${JSON.stringify({ schemaVersion: 1, files }, null, 4)}\n`,
            'utf8',
        );
    }

    private read(projectRoot: string): LxcContractCatalogData {
        const target = path.join(
            projectRoot,
            LxcContractCatalog.relativePath,
        );
        const value = JSON.parse(fs.readFileSync(target, 'utf8')) as unknown;
        if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
            !(value as { files?: unknown }).files ||
            typeof (value as { files?: unknown }).files !== 'object' ||
            Array.isArray((value as { files?: unknown }).files)
        ) {
            throw new Error('LXC runtime contract catalog is invalid.');
        }
        return value as LxcContractCatalogData;
    }

    private hash(filePath: string): string {
        const status = fs.lstatSync(filePath);
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error(`${filePath} must be a regular LXC contract file.`);
        }
        return createHash('sha256')
            .update(fs.readFileSync(filePath))
            .digest('hex');
    }
}
