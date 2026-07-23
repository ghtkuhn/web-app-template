import fs from 'node:fs';
import path from 'node:path';
import { ScaffoldExecutionError } from './errors.ts';
import type { FileTypeDefinition } from './file-type.catalog.ts';
import { ModuleName } from './module-name.ts';

/** Renders one architecture class from a validated file-type contract. */
export class FileTemplateRenderer {
    private readonly template: string;

    /** Loads the immutable architecture-file template once. */
    constructor(templatePath: string) {
        this.template = fs.readFileSync(templatePath, 'utf8');
    }

    /** Renders one class with its exact base import and naming convention. */
    public render(
        name: ModuleName,
        definition: FileTypeDefinition,
    ): string {
        const importDepth = definition.auxiliary ? '../../../..' : '../../..';
        const values = new Map([
            ['ABSTRACT', this.abstractKeyword(definition)],
            ['BASE_CLASS', definition.baseClass],
            ['BASE_FILE', definition.baseFilename],
            ['BASE_TYPE_ARGUMENTS', definition.baseTypeArguments],
            ['CLASS_NAME', `${name.pascalCase}${definition.classSuffix}`],
            ['DESCRIPTION', `${name.value} ${definition.type}`],
            ['IMPORT_DEPTH', importDepth],
        ]);
        let source = this.template;
        for (const [placeholder, value] of values) {
            source = source.split(`{{${placeholder}}}`).join(value);
        }
        this.assertResolved(source);
        return source;
    }

    /** Returns the optional class modifier for one file type. */
    private abstractKeyword(definition: FileTypeDefinition): string {
        return definition.abstract ? 'abstract ' : '';
    }

    /** Rejects template drift before a generated file is written. */
    private assertResolved(source: string): void {
        if (/{{[A-Z_]+}}/.test(source)) {
            throw new ScaffoldExecutionError(
                `Unresolved placeholder in ${path.basename('architecture-file.ts.template')}.`,
            );
        }
    }
}
