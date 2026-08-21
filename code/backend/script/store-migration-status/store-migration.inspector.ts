import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

export interface StoreMigrationFinding {
    readonly file: string;
    readonly kind: 'store-method' | 'operation-call';
    readonly line: number;
    readonly method: string;
}

const GENERIC_METHODS = ['save', 'findById', 'findAll', 'delete', 'upsert'];

/** Reports generic persistence APIs without attempting domain renames. */
export class StoreMigrationInspector {
    private readonly backendRoot: string;

    public constructor(backendRoot: string) {
        this.backendRoot = path.resolve(backendRoot);
    }

    /** Lists declarations and Operation call sites in deterministic order. */
    public inspect(): StoreMigrationFinding[] {
        const moduleRoot = path.join(this.backendRoot, 'src/module');
        if (!fs.existsSync(moduleRoot)) {
            return [];
        }
        const files: string[] = [];
        this.collect(moduleRoot, files);
        return files.flatMap((filePath) => this.inspectFile(filePath)).sort(
            (left, right) =>
                left.file.localeCompare(right.file) || left.line - right.line,
        );
    }

    private inspectFile(filePath: string): StoreMigrationFinding[] {
        const relative = path.relative(this.backendRoot, filePath)
            .split(path.sep)
            .join('/');
        const store = relative.includes('/store/') &&
            relative.endsWith('.store.ts');
        const operation = relative.includes('/service/') &&
            relative.endsWith('.operation.ts');
        if (!store && !operation) {
            return [];
        }
        const source = fs.readFileSync(filePath, 'utf8');
        const ast = parse(source, {
            sourceType: 'module',
            plugins: ['typescript'],
        });
        const findings: StoreMigrationFinding[] = [];
        this.walk(ast, (node) => {
            const method = store
                ? this.declaredMethod(node)
                : this.calledMethod(node);
            if (method && GENERIC_METHODS.includes(method)) {
                findings.push({
                    file: relative,
                    kind: store ? 'store-method' : 'operation-call',
                    line: this.line(node),
                    method,
                });
            }
        });
        return findings;
    }

    private declaredMethod(node: Record<string, unknown>): string | undefined {
        if (node.type !== 'ClassMethod') {
            return undefined;
        }
        return this.identifierName(node.key);
    }

    private calledMethod(node: Record<string, unknown>): string | undefined {
        if (node.type !== 'CallExpression' &&
            node.type !== 'OptionalCallExpression') {
            return undefined;
        }
        const callee = this.node(node.callee);
        if (!callee ||
            (callee.type !== 'MemberExpression' &&
                callee.type !== 'OptionalMemberExpression')) {
            return undefined;
        }
        return this.identifierName(callee.property);
    }

    private identifierName(value: unknown): string | undefined {
        const node = this.node(value);
        return node?.type === 'Identifier' && typeof node.name === 'string'
            ? node.name
            : undefined;
    }

    private line(node: Record<string, unknown>): number {
        const location = this.node(node.loc);
        const start = this.node(location?.start);
        return typeof start?.line === 'number' ? start.line : 1;
    }

    private walk(
        value: unknown,
        visitor: (node: Record<string, unknown>) => void,
    ): void {
        if (Array.isArray(value)) {
            for (const child of value) {
                this.walk(child, visitor);
            }
            return;
        }
        const node = this.node(value);
        if (!node) {
            return;
        }
        if (typeof node.type === 'string') {
            visitor(node);
        }
        for (const [key, child] of Object.entries(node)) {
            if (!['loc', 'start', 'end', 'extra'].includes(key)) {
                this.walk(child, visitor);
            }
        }
    }

    private node(value: unknown): Record<string, unknown> | undefined {
        return typeof value === 'object' && value !== null
            ? value as Record<string, unknown>
            : undefined;
    }

    private collect(directory: string, files: string[]): void {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                this.collect(entryPath, files);
            } else if (entry.isFile() && entry.name.endsWith('.ts')) {
                files.push(entryPath);
            }
        }
    }
}
