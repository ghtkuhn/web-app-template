import { ScaffoldInputError } from './errors.ts';

/** Validates module names and derives their TypeScript identifiers. */
export class ModuleName {
    private static readonly pattern =
        /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
    private static readonly reservedNames = new Set(['module-template']);

    public readonly value: string;
    public readonly pascalCase: string;
    public readonly constantCase: string;

    /** Creates a validated module name from one CLI value. */
    constructor(value: string) {
        if (!ModuleName.pattern.test(value)) {
            throw new ScaffoldInputError(
                `Invalid module name '${value}'. Use lowercase kebab-case.`,
            );
        }
        if (ModuleName.reservedNames.has(value)) {
            throw new ScaffoldInputError(
                `Module name '${value}' is reserved.`,
            );
        }

        this.value = value;
        this.pascalCase = value
            .split('-')
            .map((segment) =>
                `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`,
            )
            .join('');
        this.constantCase = value.split('-').join('_').toUpperCase();
    }
}
