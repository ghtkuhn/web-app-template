import fs from 'node:fs';
import path from 'node:path';
import { TestCatalogRenderer } from './catalog.renderer.ts';
import { BackendTestDiscovery } from './test.discovery.ts';

/** Generates and checks the checked-in backend test catalog. */
export class TestCatalogManager {
    private readonly catalogPath: string;
    private readonly discovery: BackendTestDiscovery;
    private readonly renderer = new TestCatalogRenderer();

    /** Creates a catalog manager for one backend workspace. */
    constructor(backendRoot: string) {
        const normalizedRoot = path.resolve(backendRoot);
        this.catalogPath = path.join(normalizedRoot, 'test.catalog.ts');
        this.discovery = new BackendTestDiscovery(normalizedRoot);
    }

    /** Writes the exact deterministic catalog and returns its file count. */
    public generate(): number {
        const files = this.discovery.discover();
        fs.writeFileSync(this.catalogPath, this.renderer.render(files), 'utf8');
        return files.length;
    }

    /** Throws when the checked-in catalog differs from discovery. */
    public check(): number {
        const files = this.discovery.discover();
        const expected = this.renderer.render(files);
        const actual = fs.existsSync(this.catalogPath)
            ? fs.readFileSync(this.catalogPath, 'utf8')
            : '';
        if (actual !== expected) {
            throw new Error(
                'Backend test catalog is stale. Run `npm run generate:test-catalog`.',
            );
        }
        return files.length;
    }
}
