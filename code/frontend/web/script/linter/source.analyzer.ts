import fs from 'node:fs';
import path from 'node:path';
import { parse as parseTypeScript } from '@babel/parser';
import { parse as parseVue } from '@vue/compiler-sfc';
import type { SFCBlock, SFCDescriptor } from '@vue/compiler-sfc';
import { parse as parseCss } from 'postcss';
import { parse as parseScss } from 'postcss-scss';
import parseCssValue from 'postcss-value-parser';
import type {
    SourceAnalysis,
    SourceDependency,
    SourceSpan,
    StyleBlock,
} from './interfaces.ts';

type AstNode = {
    type?: string;
    source?: AstNode & { value?: unknown };
    callee?: AstNode;
    arguments?: AstNode[];
    object?: AstNode;
    property?: AstNode;
    name?: string;
    value?: unknown;
    start?: number | null;
    end?: number | null;
    [key: string]: unknown;
};

type CssSource = {
    start?: { offset?: number; line?: number; column?: number };
    end?: { offset?: number; line?: number; column?: number };
};

/** Extracts architecture facts while preserving original-file source spans. */
export class SourceAnalyzer {
    public analyze(filePath: string): SourceAnalysis {
        const source = fs.readFileSync(filePath, 'utf8');
        const extension = path.extname(filePath);
        const analysis = this.empty(filePath, source);
        if (extension === '.html') {
            return analysis;
        }
        if (extension === '.css' || extension === '.scss') {
            analysis.styles = [
                this.styleBlock(
                    filePath,
                    source,
                    false,
                    source,
                    0,
                    extension === '.scss',
                ),
            ];
            return analysis;
        }
        if (extension === '.vue') {
            this.analyzeVue(filePath, source, analysis);
            return analysis;
        }
        this.analyzeScript(source, analysis, 0);
        return analysis;
    }

    private analyzeVue(
        filePath: string,
        source: string,
        analysis: SourceAnalysis,
    ): void {
        const result = parseVue(source, { filename: filePath });
        this.assertValidVue(result.errors);
        this.applyVueMetadata(result.descriptor, analysis);
        for (const block of [
            result.descriptor.script,
            result.descriptor.scriptSetup,
        ]) {
            if (block?.content.trim()) {
                this.analyzeScript(
                    block.content,
                    analysis,
                    block.loc.start.offset,
                );
            }
        }
    }

    private analyzeScript(
        content: string,
        analysis: SourceAnalysis,
        baseOffset: number,
    ): void {
        if (!content.trim()) {
            return;
        }
        const ast = parseTypeScript(content, {
            sourceType: 'module',
            plugins: ['typescript'],
        });
        this.walk(ast.program, analysis, baseOffset);
    }

    private assertValidVue(errors: readonly unknown[]): void {
        const firstError = errors[0];
        if (firstError) {
            throw firstError;
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
        analysis.scriptLocation = this.blockSpan(analysis.source, script);
        analysis.scriptSetupLocation = this.blockSpan(
            analysis.source,
            scriptSetup,
        );
        analysis.styles = descriptor.styles.map((style, index) =>
            this.styleBlock(
                `${analysis.filePath}?style=${index}`,
                style.content,
                Boolean(style.scoped),
                analysis.source,
                style.loc.start.offset,
                style.lang === 'scss',
            ),
        );
    }

    private blockSpan(
        source: string,
        block: SFCBlock | null,
    ): SourceSpan | null {
        return block
            ? this.span(
                  source,
                  block.loc.start.offset,
                  block.loc.end.offset,
              )
            : null;
    }

    private styleBlock(
        filePath: string,
        content: string,
        scoped: boolean,
        source: string,
        baseOffset: number,
        scss = false,
    ): StyleBlock {
        const root = scss
            ? parseScss(content, { from: filePath })
            : parseCss(content, { from: filePath });
        const declarations: StyleBlock['declarations'] = [];
        const atRules: StyleBlock['atRules'] = [];
        const imports: string[] = [];
        const importEvidence: StyleBlock['importEvidence'] = [];
        root.walkDecls((declaration) => {
            declarations.push({
                property: declaration.prop,
                value: declaration.value,
                location: this.cssSpan(
                    declaration.source,
                    content,
                    source,
                    baseOffset,
                ),
            });
        });
        root.walkAtRules((atRule) => {
            const location = this.cssSpan(
                atRule.source,
                content,
                source,
                baseOffset,
            );
            atRules.push({
                name: atRule.name,
                parameters: atRule.params,
                location,
            });
            if (['import', 'use'].includes(atRule.name.toLowerCase())) {
                const importedSource = this.importedStyleSource(atRule.params);
                if (importedSource) {
                    imports.push(importedSource);
                    importEvidence.push({ source: importedSource, location });
                }
            }
        });
        return {
            content,
            scoped,
            declarations,
            atRules,
            imports,
            importEvidence,
            location: this.span(source, baseOffset, baseOffset + content.length),
        };
    }

    private cssSpan(
        cssSource: CssSource | undefined,
        content: string,
        source: string,
        baseOffset: number,
    ): SourceSpan {
        const start = cssSource?.start;
        const end = cssSource?.end;
        const localStart = typeof start?.offset === 'number'
            ? start.offset
            : this.offsetFromLineColumn(
                  content,
                  start?.line ?? 1,
                  start?.column ?? 1,
              );
        const localEnd = typeof end?.offset === 'number'
            ? end.offset + 1
            : this.offsetFromLineColumn(
                  content,
                  end?.line ?? start?.line ?? 1,
                  (end?.column ?? start?.column ?? 1) + 1,
              );
        return this.span(
            source,
            baseOffset + localStart,
            baseOffset + Math.max(localStart + 1, localEnd),
        );
    }

    private importedStyleSource(parameters: string): string | null {
        const parsed = parseCssValue(parameters);
        const first = parsed.nodes.find((node) => node.type !== 'space');
        if (!first) {
            return null;
        }
        if (first.type === 'string' || first.type === 'word') {
            return first.value;
        }
        if (first.type === 'function' && first.value === 'url') {
            return parseCssValue.stringify(first.nodes).replace(
                /^(?:['"])(.*)(?:['"])$/u,
                '$1',
            );
        }
        return null;
    }

    private empty(filePath: string, source: string): SourceAnalysis {
        return {
            filePath,
            source,
            dependencies: [],
            calls: [],
            members: [],
            callEvidence: [],
            memberEvidence: [],
            isVue: false,
            hasScript: false,
            hasNormalScript: false,
            hasScriptSetup: false,
            scriptLanguage: null,
            scriptLocation: null,
            scriptSetupLocation: null,
            styles: [],
        };
    }

    private walk(
        node: unknown,
        analysis: SourceAnalysis,
        baseOffset: number,
    ): void {
        if (!node || typeof node !== 'object') {
            return;
        }
        const astNode = node as AstNode;
        this.inspectNode(astNode, analysis, baseOffset);
        this.walkChildren(astNode, analysis, baseOffset);
    }

    private inspectNode(
        astNode: AstNode,
        analysis: SourceAnalysis,
        baseOffset: number,
    ): void {
        if (astNode.type === 'ImportDeclaration') {
            this.recordStaticDependency(
                astNode,
                'import',
                analysis,
                baseOffset,
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
                analysis,
                baseOffset,
            );
            return;
        }
        if (astNode.type === 'CallExpression') {
            this.inspectCall(astNode, analysis, baseOffset);
            return;
        }
        if (astNode.type === 'MemberExpression') {
            const name = this.expressionName(astNode.property);
            if (name) {
                analysis.members.push(name);
                analysis.memberEvidence.push({
                    name,
                    location: this.nodeSpan(
                        analysis.source,
                        astNode,
                        baseOffset,
                    ),
                });
            }
        }
    }

    private inspectCall(
        astNode: AstNode,
        analysis: SourceAnalysis,
        baseOffset: number,
    ): void {
        const name = this.expressionName(astNode.callee);
        if (name) {
            analysis.calls.push(name);
            analysis.callEvidence.push({
                name,
                location: this.nodeSpan(
                    analysis.source,
                    astNode.callee ?? astNode,
                    baseOffset,
                ),
            });
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
                location: this.nodeSpan(
                    analysis.source,
                    argument,
                    baseOffset,
                ),
            });
        }
    }

    private walkChildren(
        astNode: AstNode,
        analysis: SourceAnalysis,
        baseOffset: number,
    ): void {
        const metadataKeys = new Set(['loc', 'start', 'end']);
        for (const key of Object.keys(astNode)) {
            if (metadataKeys.has(key)) {
                continue;
            }
            const value = astNode[key];
            if (Array.isArray(value)) {
                value.forEach((child) =>
                    this.walk(child, analysis, baseOffset),
                );
                continue;
            }
            this.walk(value, analysis, baseOffset);
        }
    }

    private recordStaticDependency(
        node: AstNode,
        kind: SourceDependency['kind'],
        analysis: SourceAnalysis,
        baseOffset: number,
    ): void {
        const source = node.source?.value;
        if (typeof source === 'string') {
            analysis.dependencies.push({
                kind,
                source,
                location: this.nodeSpan(
                    analysis.source,
                    node.source ?? node,
                    baseOffset,
                ),
            });
        }
    }

    private nodeSpan(
        source: string,
        node: AstNode,
        baseOffset: number,
    ): SourceSpan {
        const start = baseOffset + (node.start ?? 0);
        const end = baseOffset + (node.end ?? (node.start ?? 0) + 1);
        return this.span(source, start, Math.max(start + 1, end));
    }

    private span(source: string, start: number, end: number): SourceSpan {
        return {
            start: this.position(source, start),
            end: this.position(source, end),
        };
    }

    private position(
        source: string,
        rawOffset: number,
    ): { line: number; column: number } {
        const offset = Math.max(0, Math.min(rawOffset, source.length));
        const before = source.slice(0, offset);
        const line = before.split('\n').length;
        const previousNewline = before.lastIndexOf('\n');
        return {
            line,
            column: offset - previousNewline,
        };
    }

    private offsetFromLineColumn(
        source: string,
        line: number,
        column: number,
    ): number {
        const lines = source.split('\n');
        let offset = 0;
        for (let index = 0; index < line - 1; index += 1) {
            offset += (lines[index]?.length ?? 0) + 1;
        }
        return offset + Math.max(0, column - 1);
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
