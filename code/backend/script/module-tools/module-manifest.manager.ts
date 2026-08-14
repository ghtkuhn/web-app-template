import fs from 'node:fs';
import path from 'node:path';
import { ModuleName } from '../scaffold-module/module-name.ts';
import { ServiceRouterManager } from './service-router.manager.ts';

interface ModuleManifest {
    readonly schemaVersion: 1;
    readonly name: string;
    readonly dependencies: readonly string[];
}

/** Synchronizes the generated registry fields owned by module manifests. */
export class ModuleManifestManager {
    private readonly modulesRoot: string;
    private readonly serviceRouters: ServiceRouterManager;

    /** Creates a manager for one repository. */
    constructor(projectRoot: string) {
        this.modulesRoot = path.join(
            path.resolve(projectRoot),
            'code/backend/src/module',
        );
        this.serviceRouters = new ServiceRouterManager(projectRoot);
    }

    /** Synchronizes one module and returns whether its entry changed. */
    public sync(rawModuleName: string): boolean {
        const moduleName = new ModuleName(rawModuleName);
        const manifest = this.read(moduleName);
        const entryPath = path.join(
            this.modulesRoot,
            moduleName.value,
            'index.ts',
        );
        const source = fs.readFileSync(entryPath, 'utf8');
        const synchronized = this.synchronizeSource(source, moduleName, manifest);
        let changed = false;
        if (synchronized !== source) {
            fs.writeFileSync(entryPath, synchronized, 'utf8');
            changed = true;
        }
        return this.serviceRouters.syncModule(moduleName.value) || changed;
    }

    /** Checks all manifests without changing source. */
    public check(): string[] {
        return this.moduleNames().filter((name) => {
            const moduleName = new ModuleName(name);
            const manifest = this.read(moduleName);
            const entryPath = path.join(this.modulesRoot, name, 'index.ts');
            const source = fs.readFileSync(entryPath, 'utf8');
            return (
                this.synchronizeSource(source, moduleName, manifest) !== source ||
                this.serviceRouters.hasDrift(moduleName.value)
            );
        });
    }

    /** Adds one required public module dependency and synchronizes metadata. */
    public addDependency(rawConsumer: string, rawProvider: string): boolean {
        const consumer = new ModuleName(rawConsumer);
        const provider = new ModuleName(rawProvider);
        if (consumer.value === provider.value) {
            throw new Error('A module cannot depend on itself.');
        }
        this.requireModule(provider);
        const manifest = this.read(consumer);
        const dependencies = [...new Set([
            ...manifest.dependencies,
            provider.value,
        ])].sort((left, right) => left.localeCompare(right));
        const changed = dependencies.join('\n') !== manifest.dependencies.join('\n');
        if (changed) {
            this.write(consumer, { ...manifest, dependencies });
            this.sync(consumer.value);
        }
        return changed;
    }

    /** Replaces the generated name and dependency fields inside sync markers. */
    private synchronizeSource(
        source: string,
        moduleName: ModuleName,
        manifest: ModuleManifest,
    ): string {
        const start = source.indexOf('    // module-sync:start');
        const endMarker = '    // module-sync:end';
        const end = source.indexOf(endMarker);
        if (start < 0 || end < start) {
            throw new Error(
                `Module '${moduleName.value}' has no generated definition markers.`,
            );
        }
        const blockEnd = end + endMarker.length;
        const current = source.slice(start, blockEnd);
        const nameLine = `        name: ${moduleName.constantCase}_MODULE_NAME,`;
        const dependencyValues = manifest.dependencies
            .map((dependency) => `'${dependency}'`)
            .join(', ');
        const synchronized = current
            .replace(/^        name:.*$/mu, nameLine)
            .replace(
                /^        dependencies:.*$/mu,
                `        dependencies: [${dependencyValues}],`,
            );
        return `${source.slice(0, start)}${synchronized}${source.slice(blockEnd)}`;
    }

    /** Reads and validates one manifest. */
    private read(moduleName: ModuleName): ModuleManifest {
        this.requireModule(moduleName);
        const manifestPath = this.manifestPath(moduleName);
        const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!this.isManifest(parsed, moduleName.value)) {
            throw new Error(
                `Invalid module manifest for '${moduleName.value}'.`,
            );
        }
        return parsed;
    }

    /** Writes one canonical manifest. */
    private write(moduleName: ModuleName, manifest: ModuleManifest): void {
        fs.writeFileSync(
            this.manifestPath(moduleName),
            `${JSON.stringify(manifest, null, 4)}\n`,
            'utf8',
        );
    }

    /** Returns whether parsed JSON is the exact supported manifest shape. */
    private isManifest(value: unknown, expectedName: string): value is ModuleManifest {
        if (typeof value !== 'object' || value === null) {
            return false;
        }
        const candidate = value as Record<string, unknown>;
        return candidate.schemaVersion === 1 &&
            candidate.name === expectedName &&
            Array.isArray(candidate.dependencies) &&
            candidate.dependencies.every(
                (dependency) =>
                    typeof dependency === 'string' &&
                    new ModuleName(dependency).value === dependency,
            ) &&
            new Set(candidate.dependencies).size === candidate.dependencies.length;
    }

    /** Lists modules with manifests deterministically. */
    private moduleNames(): string[] {
        return fs.readdirSync(this.modulesRoot, { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isDirectory() &&
                    fs.existsSync(
                        path.join(
                            this.modulesRoot,
                            entry.name,
                            'module.manifest.json',
                        ),
                    ),
            )
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right));
    }

    /** Requires the module entry and manifest. */
    private requireModule(moduleName: ModuleName): void {
        if (
            !fs.existsSync(
                path.join(this.modulesRoot, moduleName.value, 'index.ts'),
            ) ||
            !fs.existsSync(this.manifestPath(moduleName))
        ) {
            throw new Error(
                `Module '${moduleName.value}' has no managed manifest.`,
            );
        }
    }

    /** Returns one module manifest path. */
    private manifestPath(moduleName: ModuleName): string {
        return path.join(
            this.modulesRoot,
            moduleName.value,
            'module.manifest.json',
        );
    }
}
