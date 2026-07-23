/** Controlled updater error carrying a stable CLI exit code. */
export class TemplateUpdateError extends Error {
    public readonly exitCode: 1 | 2;

    public constructor(message: string, exitCode: 1 | 2) {
        super(message);
        this.exitCode = exitCode;
    }
}
