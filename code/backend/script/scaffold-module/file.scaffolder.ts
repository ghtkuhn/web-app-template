import fs from 'node:fs';
import path from 'node:path';
import {
    ScaffoldExecutionError,
    ScaffoldInputError,
} from './errors.ts';
import { FileTemplateRenderer } from './file-template.renderer.ts';
import {
    FileTypeCatalog,
    type FileTypeDefinition,
} from './file-type.catalog.ts';
import type {
    FileScaffolderConfig,
    FileScaffoldRequest,
    FileScaffoldResult,
    ScaffoldStorage,
} from './interfaces.ts';
import { ModuleName } from './module-name.ts';
import { NativeScaffoldStorage } from './scaffold.storage.ts';

type FileTransaction = {
    className: string;
    targetPath: string;
    source: string;
    directories: string[];
};

/** Creates and verifies one architecture file in an existing module. */
export class FileScaffolder {
    private readonly projectRoot: string;
    private readonly backendRoot: string;
    private readonly modulesRoot: string;
    private readonly verification: FileScaffolderConfig['verification'];
    private readonly storage: ScaffoldStorage;
    private readonly renderer: FileTemplateRenderer;
    private readonly catalog = new FileTypeCatalog();

    /** Creates a reusable file scaffolder for one repository root. */
    constructor(config: FileScaffolderConfig) {
        this.projectRoot = path.resolve(config.projectRoot);
        this.backendRoot = path.join(this.projectRoot, 'code/backend');
        this.modulesRoot = path.join(this.backendRoot, 'src/module');
        this.verification = config.verification;
        this.storage = config.storage ?? new NativeScaffoldStorage();
        this.renderer = new FileTemplateRenderer(config.templatePath);
    }

    /** Creates one validated file and rolls it back when verification fails. */
    public scaffold(request: FileScaffoldRequest): FileScaffoldResult {
        const transaction = this.prepare(request);
        this.commit(transaction);
        return {
            moduleName: request.moduleName,
            fileType: request.fileType,
            className: transaction.className,
            file: this.relative(transaction.targetPath),
        };
    }

    /** Validates the complete request before preparing mutations. */
    private prepare(request: FileScaffoldRequest): FileTransaction {
        const moduleName = new ModuleName(request.moduleName);
        const name = new ModuleName(request.name);
        const definition = this.catalog.get(request.fileType);
        const modulePath = path.join(this.modulesRoot, moduleName.value);
        this.requireExistingModule(moduleName, modulePath);
        const owner = this.validateOwner(request.owner, definition, modulePath);
        const targetDirectory = this.targetDirectory(
            modulePath,
            definition,
            owner,
        );
        const targetPath = path.join(
            targetDirectory,
            `${name.value}.${definition.filenameSuffix}.ts`,
        );
        this.rejectExistingTarget(targetPath);
        return {
            className: `${name.pascalCase}${definition.classSuffix}`,
            targetPath,
            source: this.renderer.render(name, definition),
            directories: this.missingDirectories(
                modulePath,
                targetDirectory,
            ),
        };
    }

    /** Writes and verifies one prepared file transaction. */
    private commit(transaction: FileTransaction): void {
        const createdDirectories: string[] = [];
        try {
            for (const directory of transaction.directories) {
                this.storage.createDirectory(directory);
                createdDirectories.push(directory);
            }
            this.storage.writeFile(transaction.targetPath, transaction.source);
            this.verification.verify(this.backendRoot);
        } catch (error: unknown) {
            this.rollback(transaction.targetPath, createdDirectories);
            throw this.executionError(error, transaction.targetPath);
        }
    }

    /** Requires an existing module with a public entry point. */
    private requireExistingModule(
        moduleName: ModuleName,
        modulePath: string,
    ): void {
        const entryPoint = path.join(modulePath, 'index.ts');
        if (!fs.existsSync(entryPoint)) {
            throw new ScaffoldInputError(
                `Module '${moduleName.value}' does not exist or has no index.ts.`,
            );
        }
    }

    /** Validates owner usage and returns the validated owner name. */
    private validateOwner(
        rawOwner: string | undefined,
        definition: FileTypeDefinition,
        modulePath: string,
    ): ModuleName | null {
        if (!definition.auxiliary) {
            this.rejectUnexpectedOwner(rawOwner);
            return null;
        }
        if (!rawOwner) {
            throw new ScaffoldInputError(
                `File type '${definition.type}' requires --owner <name>.`,
            );
        }
        const owner = new ModuleName(rawOwner);
        this.requireOwnerFile(modulePath, definition, owner);
        return owner;
    }

    /** Rejects owner arguments for non-auxiliary file types. */
    private rejectUnexpectedOwner(rawOwner: string | undefined): void {
        if (rawOwner !== undefined) {
            throw new ScaffoldInputError(
                '--owner is allowed for auxiliary file types only.',
            );
        }
    }

    /** Requires the direct owner file prescribed by the architecture. */
    private requireOwnerFile(
        modulePath: string,
        definition: FileTypeDefinition,
        owner: ModuleName,
    ): void {
        const layerPath = path.join(modulePath, definition.layer);
        const exists =
            definition.layer === 'api'
                ? this.apiOwnerExists(layerPath, owner)
                : fs.existsSync(
                      path.join(
                          layerPath,
                          `${owner.value}.${definition.layer}.ts`,
                      ),
                  );
        if (!exists) {
            throw new ScaffoldInputError(
                `Owner '${owner.value}' does not exist in ${definition.layer}/.`,
            );
        }
    }

    /** Returns whether an API handler prefix owns the requested Aux folder. */
    private apiOwnerExists(layerPath: string, owner: ModuleName): boolean {
        if (!fs.existsSync(layerPath)) {
            return false;
        }
        return fs.readdirSync(layerPath, { withFileTypes: true }).some(
            (entry) =>
                entry.isFile() &&
                entry.name.startsWith(`${owner.value}.`) &&
                entry.name.endsWith('.handler.ts'),
        );
    }

    /** Resolves the layer or owner directory for the target file. */
    private targetDirectory(
        modulePath: string,
        definition: FileTypeDefinition,
        owner: ModuleName | null,
    ): string {
        const layerPath = path.join(modulePath, definition.layer);
        return owner ? path.join(layerPath, owner.value) : layerPath;
    }

    /** Returns missing directories from parent to child below the module. */
    private missingDirectories(
        modulePath: string,
        targetDirectory: string,
    ): string[] {
        const directories: string[] = [];
        let current = targetDirectory;
        while (current !== modulePath && !fs.existsSync(current)) {
            directories.unshift(current);
            current = path.dirname(current);
        }
        return directories;
    }

    /** Rejects every existing target without a force mode. */
    private rejectExistingTarget(targetPath: string): void {
        if (fs.existsSync(targetPath)) {
            throw new ScaffoldInputError(
                `Target file '${this.relative(targetPath)}' already exists.`,
            );
        }
    }

    /** Removes the generated file and only newly created empty directories. */
    private rollback(targetPath: string, createdDirectories: string[]): void {
        this.storage.removeFile(targetPath);
        for (const directory of [...createdDirectories].reverse()) {
            this.storage.removeEmptyDirectory(directory);
        }
    }

    /** Translates unexpected failures into stable execution errors. */
    private executionError(
        error: unknown,
        targetPath: string,
    ): ScaffoldExecutionError {
        if (error instanceof ScaffoldExecutionError) {
            return error;
        }
        const message =
            error instanceof Error ? error.message : 'unknown failure';
        return new ScaffoldExecutionError(
            `Unable to scaffold '${this.relative(targetPath)}': ${message}`,
        );
    }

    /** Returns a portable project-relative path. */
    private relative(filePath: string): string {
        return path
            .relative(this.projectRoot, filePath)
            .split(path.sep)
            .join('/');
    }
}
