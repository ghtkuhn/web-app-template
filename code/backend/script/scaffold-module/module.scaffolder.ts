import fs from 'node:fs';
import path from 'node:path';
import { CatalogRenderer } from './catalog.renderer.ts';
import { ConfigEditor } from './config.editor.ts';
import {
    ScaffoldExecutionError,
    ScaffoldInputError,
} from './errors.ts';
import type {
    ModuleScaffolderConfig,
    ModuleScaffoldResult,
    ScaffoldStorage,
} from './interfaces.ts';
import { ModuleName } from './module-name.ts';
import { NativeScaffoldStorage } from './scaffold.storage.ts';
import { TemplateRenderer } from './template.renderer.ts';

type ScaffoldTransaction = {
    moduleName: ModuleName;
    modulePath: string;
    renderedFiles: ReadonlyMap<string, string>;
    catalogSource: string;
    configSource: string;
    originalCatalog: string | null;
    originalConfig: string;
};

/** Creates, registers, activates, verifies, and rolls back minimal modules. */
export class ModuleScaffolder {
    private readonly projectRoot: string;
    private readonly backendRoot: string;
    private readonly modulesRoot: string;
    private readonly catalogPath: string;
    private readonly configPath: string;
    private readonly verification: ModuleScaffolderConfig['verification'];
    private readonly storage: ScaffoldStorage;
    private readonly templates: TemplateRenderer;
    private readonly catalog = new CatalogRenderer();
    private readonly configEditor = new ConfigEditor();

    /** Creates a reusable scaffolder for one repository root. */
    constructor(config: ModuleScaffolderConfig) {
        this.projectRoot = path.resolve(config.projectRoot);
        this.backendRoot = path.join(this.projectRoot, 'code/backend');
        this.modulesRoot = path.join(this.backendRoot, 'src/module');
        this.catalogPath = path.join(
            this.backendRoot,
            'src/module.catalog.ts',
        );
        this.configPath = path.join(this.backendRoot, 'src/config.ts');
        this.verification = config.verification;
        this.storage = config.storage ?? new NativeScaffoldStorage();
        this.templates = new TemplateRenderer(config.templateRoot);
    }

    /** Performs one atomic scaffold operation for a validated module name. */
    public scaffold(rawModuleName: string): ModuleScaffoldResult {
        const moduleName = new ModuleName(rawModuleName);
        const modulePath = path.join(this.modulesRoot, moduleName.value);
        this.rejectExistingModule(moduleName, modulePath);
        const transaction = this.prepareTransaction(moduleName, modulePath);
        this.commitTransaction(transaction);
        return this.result(transaction);
    }

    /** Rejects an existing target without permitting overwrite behavior. */
    private rejectExistingModule(
        moduleName: ModuleName,
        modulePath: string,
    ): void {
        if (fs.existsSync(modulePath)) {
            throw new ScaffoldInputError(
                `Module '${moduleName.value}' already exists.`,
            );
        }
    }

    /** Prepares and validates all content before the first mutation. */
    private prepareTransaction(
        moduleName: ModuleName,
        modulePath: string,
    ): ScaffoldTransaction {
        const renderedFiles = this.templates.render(moduleName);
        const catalogSource = this.catalog.render([
            ...this.readExistingModuleNames(),
            moduleName,
        ]);
        const originalConfig = fs.readFileSync(this.configPath, 'utf8');
        const configSource = this.configEditor.addActiveModule(
            originalConfig,
            moduleName.value,
        );
        return {
            moduleName,
            modulePath,
            renderedFiles,
            catalogSource,
            configSource,
            originalCatalog: this.readOriginalCatalog(),
            originalConfig,
        };
    }

    /** Applies one prepared transaction and rolls it back on every failure. */
    private commitTransaction(transaction: ScaffoldTransaction): void {
        try {
            this.writeTransaction(transaction);
            this.verification.verify(this.backendRoot);
        } catch (error: unknown) {
            this.rollback(
                transaction.modulePath,
                transaction.originalCatalog,
                transaction.originalConfig,
            );
            throw this.executionError(error, transaction.moduleName);
        }
    }

    /** Writes the generated module and both managed composition files. */
    private writeTransaction(transaction: ScaffoldTransaction): void {
        this.storage.createDirectory(transaction.modulePath);
        for (const [filename, source] of transaction.renderedFiles) {
            this.storage.writeFile(
                path.join(transaction.modulePath, filename),
                source,
            );
        }
        this.storage.writeFile(this.catalogPath, transaction.catalogSource);
        this.storage.writeFile(this.configPath, transaction.configSource);
    }

    /** Returns a normalized result for one committed transaction. */
    private result(transaction: ScaffoldTransaction): ModuleScaffoldResult {
        const files = [...transaction.renderedFiles.keys()].map((filename) =>
            path.join(transaction.modulePath, filename),
        );
        return {
            moduleName: transaction.moduleName.value,
            files: files.map((filePath) =>
                path
                    .relative(this.projectRoot, filePath)
                    .split(path.sep)
                    .join('/'),
            ),
        };
    }

    /** Reads the optional managed catalog snapshot. */
    private readOriginalCatalog(): string | null {
        if (!fs.existsSync(this.catalogPath)) {
            return null;
        }
        return fs.readFileSync(this.catalogPath, 'utf8');
    }

    /** Preserves known execution errors and translates unexpected failures. */
    private executionError(
        error: unknown,
        moduleName: ModuleName,
    ): ScaffoldExecutionError {
        if (error instanceof ScaffoldExecutionError) {
            return error;
        }
        const message =
            error instanceof Error ? error.message : 'unknown failure';
        return new ScaffoldExecutionError(
            `Unable to scaffold module '${moduleName.value}': ${message}`,
        );
    }

    /** Reads valid registered-module conventions from public module folders. */
    private readExistingModuleNames(): ModuleName[] {
        return fs
            .readdirSync(this.modulesRoot, { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isDirectory() &&
                    fs.existsSync(
                        path.join(this.modulesRoot, entry.name, 'index.ts'),
                    ),
            )
            .map((entry) => new ModuleName(entry.name));
    }

    /** Restores managed files and removes only the newly validated module path. */
    private rollback(
        modulePath: string,
        originalCatalog: string | null,
        originalConfig: string,
    ): void {
        this.storage.removeDirectory(modulePath);
        this.storage.writeFile(this.configPath, originalConfig);
        if (originalCatalog === null) {
            this.storage.removeFile(this.catalogPath);
        } else {
            this.storage.writeFile(this.catalogPath, originalCatalog);
        }
    }
}
