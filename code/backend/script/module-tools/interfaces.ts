/** Writable stream used by focused module commands. */
export interface ModuleToolWriter {
    write(chunk: string): void;
}

/** Result of one synchronously executed focused command. */
export interface ModuleCommandResult {
    readonly status: number | null;
    readonly error?: Error;
}

/** Injectable process boundary for focused module verification. */
export interface ModuleCommandRunner {
    run(
        command: string,
        arguments_: readonly string[],
        cwd: string,
    ): ModuleCommandResult;
}
