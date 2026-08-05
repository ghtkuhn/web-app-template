import fs from 'node:fs';
import path from 'node:path';
import { ScaffoldExecutionError } from './errors.ts';
import { ModuleName } from './module-name.ts';

/** Renders the four architecture-safe files of a minimal module. */
export class TemplateRenderer {
    private readonly templateRoot: string;

    /** Creates a renderer for one immutable template directory. */
    constructor(templateRoot: string) {
        this.templateRoot = templateRoot;
    }

    /** Returns rendered source keyed by its target module filename. */
    public render(moduleName: ModuleName): ReadonlyMap<string, string> {
        const values = new Map([
            ['MODULE_NAME', moduleName.value],
            ['PASCAL_NAME', moduleName.pascalCase],
            ['CONSTANT_NAME', moduleName.constantCase],
        ]);
        const files = new Map<string, string>();

        for (const filename of [
            'constants.ts',
            'index.ts',
            'interfaces.ts',
            'module.manifest.json',
            'types.ts',
        ]) {
            const templatePath = path.join(
                this.templateRoot,
                `${filename}.template`,
            );
            let source = fs.readFileSync(templatePath, 'utf8');
            for (const [placeholder, value] of values) {
                source = source.split(`{{${placeholder}}}`).join(value);
            }
            if (/{{[A-Z_]+}}/.test(source)) {
                throw new ScaffoldExecutionError(
                    `Unresolved placeholder in ${path.basename(templatePath)}.`,
                );
            }
            files.set(filename, source);
        }
        return files;
    }
}
