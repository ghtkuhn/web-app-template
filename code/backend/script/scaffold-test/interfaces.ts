/** Minimal writable stream used by the test-scaffold CLI. */
export interface TestScaffoldWriter {
    write(chunk: string): void;
}

/** Verification boundary used after a test scaffold transaction. */
export interface TestScaffoldVerification {
    verify(backendRoot: string): void;
}

/** Result returned after one test was created and cataloged. */
export interface TestScaffoldResult {
    readonly moduleName: string;
    readonly file: string;
}
