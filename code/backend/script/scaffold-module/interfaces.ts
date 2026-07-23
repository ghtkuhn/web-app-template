/** Writes scaffold status or diagnostics to a stream-like destination. */
export interface ScaffoldWriter {
    write(chunk: string): unknown;
}

/** Executes the automatic checks required after module generation. */
export interface ScaffoldVerification {
    verify(backendRoot: string): void;
}

/** Performs the mutating file-system operations of one scaffold transaction. */
export interface ScaffoldStorage {
    createDirectory(directory: string): void;
    writeFile(filePath: string, source: string): void;
    removeDirectory(directory: string): void;
    removeEmptyDirectory(directory: string): void;
    removeFile(filePath: string): void;
}

/** File-system and template locations used by the reusable scaffolder. */
export interface ModuleScaffolderConfig {
    projectRoot: string;
    templateRoot: string;
    verification: ScaffoldVerification;
    storage?: ScaffoldStorage;
}

/** Paths changed by one successful scaffold operation. */
export interface ModuleScaffoldResult {
    moduleName: string;
    files: string[];
}

/** File-system and template locations used by the file scaffolder. */
export interface FileScaffolderConfig {
    projectRoot: string;
    templatePath: string;
    verification: ScaffoldVerification;
    storage?: ScaffoldStorage;
}

/** User request for one architecture file in an existing module. */
export interface FileScaffoldRequest {
    moduleName: string;
    fileType: string;
    name: string;
    owner?: string;
}

/** Path and symbol created by one successful file scaffold operation. */
export interface FileScaffoldResult {
    moduleName: string;
    fileType: string;
    className: string;
    file: string;
}
