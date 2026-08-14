import type { ScaffoldVerification } from '../scaffold-module/interfaces.ts';

/** User input accepted by the Service Operation scaffold. */
export interface OperationScaffoldRequest {
    readonly moduleName: string;
    readonly serviceName: string;
    readonly operationName: string;
    readonly inputType: string;
    readonly outputType: string;
}

/** File and symbol produced by one successful scaffold transaction. */
export interface OperationScaffoldResult {
    readonly className: string;
    readonly file: string;
}

/** Injectable output stream used by the operation CLI. */
export interface OperationScaffoldWriter {
    write(chunk: string): unknown;
}

/** Construction options for a reusable operation scaffolder. */
export interface OperationScaffolderConfig {
    readonly projectRoot: string;
    readonly verification: ScaffoldVerification;
}
