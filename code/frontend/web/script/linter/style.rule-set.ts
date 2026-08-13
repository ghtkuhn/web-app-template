import parseCssValue from 'postcss-value-parser';
import type {
    LintIssue,
    SourceAnalysis,
    StyleDeclaration,
} from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

type UnitContract = 'font-size' | 'box-spacing';
type CssValueNode = ReturnType<typeof parseCssValue>['nodes'][number];
type CssFunctionNode = Extract<CssValueNode, { type: 'function' }>;

interface VariableDefinition {
    readonly declaration: StyleDeclaration;
}

const GLOBAL_KEYWORDS = new Set([
    'inherit',
    'initial',
    'revert',
    'revert-layer',
    'unset',
]);
const MATH_FUNCTIONS = new Set(['calc', 'clamp', 'max', 'min']);
const MATH_OPERATORS = new Set(['+', '-', '*', '/']);
const PICO_SPACING_PROPERTIES = new Set(['--pico-spacing']);

/** Enforces units across complete CSS custom-property dependency chains. */
export class StyleRuleSet {
    private readonly paths: PathResolver;

    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    public evaluate(analyses: readonly SourceAnalysis[]): LintIssue[] {
        const applicationAnalyses = analyses.filter(
            (analysis) => !this.isBundledVendorStyle(analysis),
        );
        const variables = this.variableDefinitions(applicationAnalyses);
        return applicationAnalyses.flatMap((analysis) =>
            this.analysisIssues(analysis, variables),
        );
    }

    private analysisIssues(
        analysis: SourceAnalysis,
        variables: ReadonlyMap<string, readonly VariableDefinition[]>,
    ): LintIssue[] {
        const issues: LintIssue[] = [];
        for (const style of analysis.styles) {
            for (const declaration of style.declarations) {
                const property = declaration.property.toLowerCase();
                if (property === 'font-size') {
                    if (!this.validValue(
                        declaration.value,
                        'font-size',
                        property,
                        variables,
                        new Set(),
                    )) {
                        issues.push(this.issue(
                            analysis,
                            'FRONTEND_FONT_SIZE_UNIT',
                            'font-size accepts only rem values, unitless zero, CSS reset keywords, or resolvable variables using those values.',
                        ));
                    }
                    continue;
                }
                if (property === 'font') {
                    if (!GLOBAL_KEYWORDS.has(
                        declaration.value.trim().toLowerCase(),
                    )) {
                        issues.push(this.issue(
                            analysis,
                            'FRONTEND_FONT_SHORTHAND',
                            'Set font-size separately in rem; font shorthand is limited to CSS reset keywords.',
                        ));
                    }
                    continue;
                }
                if (this.isBoxSpacingProperty(property)) {
                    if (!this.validValue(
                        declaration.value,
                        'box-spacing',
                        property,
                        variables,
                        new Set(),
                    )) {
                        issues.push(this.issue(
                            analysis,
                            'FRONTEND_BOX_SPACING_UNIT',
                            `${property} accepts only px, percent, unitless zero, applicable semantic keywords, or resolvable variables using those values.`,
                        ));
                    }
                    continue;
                }
                if (PICO_SPACING_PROPERTIES.has(property)) {
                    if (!this.validValue(
                        declaration.value,
                        'box-spacing',
                        property,
                        variables,
                        new Set(),
                    )) {
                        issues.push(this.issue(
                            analysis,
                            'FRONTEND_BOX_SPACING_UNIT',
                            `${property} must resolve exclusively to px, percent, or unitless zero.`,
                        ));
                    }
                }
            }
        }
        return issues;
    }

    private validValue(
        value: string,
        contract: UnitContract,
        property: string,
        variables: ReadonlyMap<string, readonly VariableDefinition[]>,
        resolving: ReadonlySet<string>,
    ): boolean {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return false;
        }
        if (GLOBAL_KEYWORDS.has(normalized)) {
            return true;
        }
        return this.validNodes(
            parseCssValue(value).nodes,
            contract,
            property,
            variables,
            resolving,
            false,
        );
    }

    private validNodes(
        nodes: readonly CssValueNode[],
        contract: UnitContract,
        property: string,
        variables: ReadonlyMap<string, readonly VariableDefinition[]>,
        resolving: ReadonlySet<string>,
        insideMath: boolean,
    ): boolean {
        return nodes.every((node) => {
            if (
                node.type === 'space' ||
                node.type === 'comment' ||
                node.type === 'div'
            ) {
                return true;
            }
            if (node.type === 'function') {
                return this.validFunction(
                    node,
                    contract,
                    property,
                    variables,
                    resolving,
                );
            }
            if (node.type !== 'word') {
                return false;
            }
            const word = node.value.toLowerCase();
            if (insideMath && MATH_OPERATORS.has(word)) {
                return true;
            }
            if (
                contract === 'box-spacing' &&
                property.startsWith('margin') &&
                word === 'auto'
            ) {
                return true;
            }
            const dimension = parseCssValue.unit(word);
            if (!dimension) {
                return false;
            }
            if (Number(dimension.number) === 0 && !dimension.unit) {
                return true;
            }
            const unit = dimension.unit.toLowerCase();
            return contract === 'font-size'
                ? unit === 'rem'
                : unit === 'px' || unit === '%';
        });
    }

    private validFunction(
        node: CssFunctionNode,
        contract: UnitContract,
        property: string,
        variables: ReadonlyMap<string, readonly VariableDefinition[]>,
        resolving: ReadonlySet<string>,
    ): boolean {
        const functionName = node.value.toLowerCase();
        if (functionName === 'var') {
            return this.validVariable(
                node,
                contract,
                property,
                variables,
                resolving,
            );
        }
        return MATH_FUNCTIONS.has(functionName) && this.validNodes(
            node.nodes,
            contract,
            property,
            variables,
            resolving,
            true,
        );
    }

    private validVariable(
        node: CssFunctionNode,
        contract: UnitContract,
        property: string,
        variables: ReadonlyMap<string, readonly VariableDefinition[]>,
        resolving: ReadonlySet<string>,
    ): boolean {
        const separator = node.nodes.findIndex(
            (child) => child.type === 'div' && child.value === ',',
        );
        const nameNodes = separator === -1
            ? node.nodes
            : node.nodes.slice(0, separator);
        const name = parseCssValue.stringify(nameNodes).trim();
        if (!name.startsWith('--') || resolving.has(name)) {
            return false;
        }
        const definitions = variables.get(name) ?? [];
        const nextResolving = new Set(resolving);
        nextResolving.add(name);
        const definitionsValid = definitions.length === 0 || definitions.every(
            ({ declaration }) => this.validValue(
                declaration.value,
                contract,
                property,
                variables,
                nextResolving,
            ),
        );
        if (!definitionsValid) {
            return false;
        }
        if (separator === -1) {
            return definitions.length > 0;
        }
        const fallback = node.nodes.slice(separator + 1);
        return fallback.length > 0 && this.validNodes(
            fallback,
            contract,
            property,
            variables,
            nextResolving,
            false,
        );
    }

    private variableDefinitions(
        analyses: readonly SourceAnalysis[],
    ): ReadonlyMap<string, readonly VariableDefinition[]> {
        const variables = new Map<string, VariableDefinition[]>();
        for (const analysis of analyses) {
            for (const style of analysis.styles) {
                for (const declaration of style.declarations) {
                    if (!declaration.property.startsWith('--')) {
                        continue;
                    }
                    const definitions = variables.get(declaration.property) ?? [];
                    definitions.push({ declaration });
                    variables.set(declaration.property, definitions);
                }
            }
        }
        return variables;
    }

    private isBoxSpacingProperty(property: string): boolean {
        return /^(?:gap|row-gap|column-gap|(?:margin|padding)(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?|(?:scroll-margin|scroll-padding)(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?)$/u.test(
            property,
        );
    }

    private isBundledVendorStyle(analysis: SourceAnalysis): boolean {
        return this.paths.relative(analysis.filePath).endsWith(
            'code/frontend/web/src/shared/styles/tabler/tabler-icons.css',
        );
    }

    private issue(
        analysis: SourceAnalysis,
        ruleId: string,
        message: string,
    ): LintIssue {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(analysis.filePath),
            message,
        };
    }
}
