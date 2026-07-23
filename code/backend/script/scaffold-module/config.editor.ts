import { parse } from '@babel/parser';
import { ScaffoldExecutionError } from './errors.ts';

type AstNode = {
    type?: string;
    name?: string;
    value?: unknown;
    start?: number | null;
    end?: number | null;
    declaration?: AstNode | null;
    declarations?: AstNode[];
    id?: AstNode | null;
    init?: AstNode | null;
    expression?: AstNode | null;
    properties?: AstNode[];
    key?: AstNode | null;
    computed?: boolean;
    elements?: Array<AstNode | null>;
};

/** Updates only the validated `config.modules.active` array expression. */
export class ConfigEditor {
    /** Appends one active module name while preserving all surrounding source. */
    public addActiveModule(source: string, moduleName: string): string {
        const activeArray = this.findActiveArray(this.parseBody(source));
        const names = this.readNames(activeArray);
        this.rejectDuplicate(names, moduleName);
        const start = this.sourcePosition(activeArray.start);
        const end = this.sourcePosition(activeArray.end);
        const rendered = this.renderNames([...names, moduleName]);
        return `${source.slice(0, start)}${rendered}${source.slice(end)}`;
    }

    /** Parses TypeScript source and translates parser failures. */
    private parseBody(source: string): AstNode[] {
        try {
            const ast = parse(source, {
                sourceType: 'module',
                plugins: ['typescript'],
            }) as unknown as { program: { body: AstNode[] } };
            return ast.program.body;
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'unknown parser error';
            throw new ScaffoldExecutionError(
                `Unable to parse config.ts: ${message}`,
            );
        }
    }

    /** Traverses the known config declaration shape to its active array. */
    private findActiveArray(body: readonly AstNode[]): AstNode {
        const configObject = this.findConfigObject(body);
        const modulesObject = this.unwrapExpression(
            this.propertyValue(configObject, 'modules'),
        );
        const activeArray = this.unwrapExpression(
            this.propertyValue(modulesObject, 'active'),
        );
        if (activeArray?.type !== 'ArrayExpression') {
            throw new ScaffoldExecutionError(
                'Unable to locate config.modules.active array.',
            );
        }
        return activeArray;
    }

    /** Finds the exported `config` variable's object initializer. */
    private findConfigObject(body: readonly AstNode[]): AstNode {
        for (const statement of body) {
            const configObject = this.configObject(statement);
            if (configObject) {
                return configObject;
            }
        }
        throw new ScaffoldExecutionError(
            'Unable to locate exported config declaration.',
        );
    }

    /** Returns a config initializer from one top-level statement. */
    private configObject(statement: AstNode): AstNode | null {
        const declaration = this.exportedDeclaration(statement);
        for (const variable of this.variableDeclarations(declaration)) {
            if (this.identifierName(variable.id) === 'config') {
                return this.unwrapExpression(variable.init);
            }
        }
        return null;
    }

    /** Returns variables only from a variable declaration statement. */
    private variableDeclarations(declaration: AstNode): readonly AstNode[] {
        if (declaration.type !== 'VariableDeclaration') {
            return [];
        }
        return declaration.declarations ?? [];
    }

    /** Unwraps an export declaration when present. */
    private exportedDeclaration(statement: AstNode): AstNode {
        if (statement.type === 'ExportNamedDeclaration') {
            if (statement.declaration) {
                return statement.declaration;
            }
            return {};
        }
        return statement;
    }

    /** Returns an identifier name without compound AST predicates. */
    private identifierName(node: AstNode | null | undefined): string | null {
        if (node?.type !== 'Identifier') {
            return null;
        }
        if (node.name) {
            return node.name;
        }
        return null;
    }

    /** Returns a named non-computed object-property value. */
    private propertyValue(
        object: AstNode | null,
        name: string,
    ): AstNode | null {
        for (const property of this.objectProperties(object)) {
            if (this.propertyName(property) === name) {
                return property.value as AstNode;
            }
        }
        return null;
    }

    /** Returns properties only from an object expression. */
    private objectProperties(object: AstNode | null): readonly AstNode[] {
        if (object?.type !== 'ObjectExpression') {
            return [];
        }
        return object.properties ?? [];
    }

    /** Reads one non-computed identifier or string property name. */
    private propertyName(property: AstNode): string | null {
        if (property.type !== 'ObjectProperty') {
            return null;
        }
        if (property.computed) {
            return null;
        }
        return this.propertyKeyName(property.key);
    }

    /** Returns a supported object-property key name. */
    private propertyKeyName(key: AstNode | null | undefined): string | null {
        if (key?.type === 'Identifier') {
            return this.identifierName(key);
        }
        return this.stringKeyName(key);
    }

    /** Returns a string-literal property key name when present. */
    private stringKeyName(key: AstNode | null | undefined): string | null {
        if (key?.type !== 'StringLiteral') {
            return null;
        }
        return typeof key.value === 'string' ? key.value : null;
    }

    /** Removes transparent TypeScript expression wrappers. */
    private unwrapExpression(node: AstNode | null | undefined): AstNode | null {
        if (!node) {
            return null;
        }
        if (this.isTransparentWrapper(node)) {
            return this.unwrapExpression(node.expression);
        }
        return node;
    }

    /** Identifies expression wrappers that do not change the array value. */
    private isTransparentWrapper(node: AstNode): boolean {
        return [
            'TSAsExpression',
            'TSSatisfiesExpression',
            'TSNonNullExpression',
        ].includes(node.type ?? '');
    }

    /** Reads and validates the current literal module names. */
    private readNames(array: AstNode): string[] {
        return (array.elements ?? []).map((element) =>
            this.stringValue(element),
        );
    }

    /** Returns one required string literal value. */
    private stringValue(element: AstNode | null): string {
        if (element?.type !== 'StringLiteral') {
            throw new ScaffoldExecutionError(
                'config.modules.active must contain string literals only.',
            );
        }
        if (typeof element.value !== 'string') {
            throw new ScaffoldExecutionError(
                'config.modules.active contains an invalid string literal.',
            );
        }
        return element.value;
    }

    /** Rejects activation duplicates before any file is changed. */
    private rejectDuplicate(names: readonly string[], moduleName: string): void {
        if (names.includes(moduleName)) {
            throw new ScaffoldExecutionError(
                `Module '${moduleName}' is already active.`,
            );
        }
    }

    /** Returns one required Babel source position. */
    private sourcePosition(position: number | null | undefined): number {
        if (typeof position !== 'number') {
            throw new ScaffoldExecutionError(
                'The active module array has no source location.',
            );
        }
        return position;
    }

    /** Renders the validated active module names as one literal array. */
    private renderNames(names: readonly string[]): string {
        return `[${names.map((name) => `'${name}'`).join(', ')}]`;
    }
}
