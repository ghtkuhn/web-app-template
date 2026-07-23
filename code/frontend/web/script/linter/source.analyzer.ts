import fs from 'node:fs';
import path from 'node:path';
import { parse as parseTypeScript } from '@babel/parser';
import { parse as parseVue } from '@vue/compiler-sfc';
import type { SFCDescriptor } from '@vue/compiler-sfc';
import type {
    SourceAnalysis,
    SourceDependency,
} from './interfaces.ts';

type AstNode = {
    type?: string;
    source?: { value?: unknown };
    callee?: AstNode;
    arguments?: AstNode[];
    object?: AstNode;
    property?: AstNode;
    name?: string;
    value?: unknown;
    [key: string]: unknown;
};

/** Extracts imports and ownership-sensitive calls from TS and Vue sources. */
export class SourceAnalyzer {
    public analyze(filePath: string): SourceAnalysis {
        const source = fs.readFileSync(filePath, 'utf8');
        const extension = path.extname(filePath);
        const analysis = this.empty(filePath, source);
        if (extension === '.css') {
            return analysis;
        }

        const script = extension === '.vue'
            ? this.vueScript(filePath, source, analysis)
            : source;
        if (script.trim()) {
            const ast = parseTypeScript(script, {
                sourceType: 'module',
                plugins: ['typescript'],
            });
            this.walk(ast.program, analysis);
        }
        return analysis;
    }

    private vueScript(
        filePath: string,
        source: string,
        analysis: SourceAnalysis,
    ): string {
        const result = parseVue(source, { filename: filePath });
        this.assertValidVue(result.errors);
        this.applyVueMetadata(result.descriptor, analysis);
        return this.vueContent(result.descriptor);
    }

    private assertValidVue(errors: readonly unknown[]): void {
        const firstError = errors[0];
        if (firstError) {
            throw new Error(String(firstError));
        }
    }

    private applyVueMetadata(
        descriptor: SFCDescriptor,
        analysis: SourceAnalysis,
    ): void {
        const scriptSetup = descriptor.scriptSetup;
        const script = descriptor.script;
        analysis.isVue = true;
        analysis.hasScript = Boolean(script || scriptSetup);
        analysis.hasNormalScript = Boolean(script);
        analysis.hasScriptSetup = Boolean(scriptSetup);
        analysis.scriptLanguage = scriptSetup?.lang ?? script?.lang ?? null;
        analysis.styles = descriptor.styles.map((style) => ({
            content: style.content,
            scoped: Boolean(style.scoped),
        }));
    }

    private vueContent(descriptor: SFCDescriptor): string {
        const script = descriptor.script?.content ?? '';
        const scriptSetup = descriptor.scriptSetup?.content ?? '';
        return `${script}\n${scriptSetup}`;
    }

    private empty(filePath: string, source: string): SourceAnalysis {
        return {
            filePath,
            source,
            dependencies: [],
            calls: [],
            members: [],
            isVue: false,
            hasScript: false,
            hasNormalScript: false,
            hasScriptSetup: false,
            scriptLanguage: null,
            styles: [],
        };
    }

    private walk(node: unknown, analysis: SourceAnalysis): void {
        if (!node || typeof node !== 'object') {
            return;
        }
        const astNode = node as AstNode;
        this.inspectNode(astNode, analysis);
        this.walkChildren(astNode, analysis);
    }

    private inspectNode(
        astNode: AstNode,
        analysis: SourceAnalysis,
    ): void {
        if (astNode.type === 'ImportDeclaration') {
            this.recordStaticDependency(
                astNode,
                'import',
                analysis.dependencies,
            );
            return;
        }
        if (
            astNode.type === 'ExportNamedDeclaration' ||
            astNode.type === 'ExportAllDeclaration'
        ) {
            this.recordStaticDependency(
                astNode,
                'export',
                analysis.dependencies,
            );
            return;
        }
        if (astNode.type === 'CallExpression') {
            this.inspectCall(astNode, analysis);
            return;
        }
        if (astNode.type === 'MemberExpression') {
            const name = this.expressionName(astNode.property);
            if (name) {
                analysis.members.push(name);
            }
        }
    }

    private inspectCall(
        astNode: AstNode,
        analysis: SourceAnalysis,
    ): void {
        const name = this.expressionName(astNode.callee);
        if (name) {
            analysis.calls.push(name);
        }
        const argument = astNode.arguments?.[0];
        if (
            astNode.callee?.type === 'Import' &&
            argument?.type === 'StringLiteral' &&
            typeof argument.value === 'string'
        ) {
            analysis.dependencies.push({
                source: argument.value,
                kind: 'dynamic-import',
            });
        }
    }

    private walkChildren(
        astNode: AstNode,
        analysis: SourceAnalysis,
    ): void {
        const metadataKeys = new Set(['loc', 'start', 'end']);
        for (const key of Object.keys(astNode)) {
            if (metadataKeys.has(key)) {
                continue;
            }
            const value = astNode[key];
            if (Array.isArray(value)) {
                value.forEach((child) => this.walk(child, analysis));
                continue;
            }
            this.walk(value, analysis);
        }
    }

    private recordStaticDependency(
        node: AstNode,
        kind: SourceDependency['kind'],
        dependencies: SourceDependency[],
    ): void {
        const source = node.source?.value;
        if (typeof source === 'string') {
            dependencies.push({ kind, source });
        }
    }

    private expressionName(node?: AstNode): string | null {
        if (!node) {
            return null;
        }
        if (node.type === 'Identifier') {
            return node.name ?? null;
        }
        if (node.type === 'MemberExpression') {
            const object = this.expressionName(node.object);
            const property = this.expressionName(node.property);
            return object && property ? `${object}.${property}` : property;
        }
        return null;
    }
}
