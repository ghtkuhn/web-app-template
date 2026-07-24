type ConstantNode = {
    type?: string;
    expression?: ConstantNode | null;
    argument?: ConstantNode | null;
    elements?: Array<ConstantNode | null>;
    properties?: ConstantNode[];
    expressions?: ConstantNode[];
    object?: ConstantNode | null;
    property?: ConstantNode | null;
    value?: ConstantNode | unknown;
    computed?: boolean;
    operator?: string;
    left?: ConstantNode | null;
    right?: ConstantNode | null;
    test?: ConstantNode | null;
    consequent?: ConstantNode | null;
    alternate?: ConstantNode | null;
};

type ConstantValidator = (node: ConstantNode) => boolean;

/** Determines whether a TypeScript initializer represents passive data only. */
export class PassiveConstantAnalyzer {
    private readonly validators = new Map<string, ConstantValidator>();

    /** Registers the supported passive AST node shapes. */
    public constructor() {
        this.registerAlwaysPassive();
        this.registerExpressionWrappers();
        this.validators.set('ArrayExpression', (node) =>
            this.allPassive(node.elements),
        );
        this.validators.set('ObjectExpression', (node) =>
            this.passiveObject(node),
        );
        this.validators.set('TemplateLiteral', (node) =>
            this.allPassive(node.expressions),
        );
        for (const type of [
            'BinaryExpression',
            'LogicalExpression',
            'ConditionalExpression',
        ]) {
            this.validators.set(type, (node) =>
                this.passiveBranches(node),
            );
        }
        this.validators.set('UnaryExpression', (node) =>
            this.passiveUnary(node),
        );
        for (const type of [
            'MemberExpression',
            'OptionalMemberExpression',
        ]) {
            this.validators.set(type, (node) =>
                this.passiveMember(node),
            );
        }
    }

    /** Checks one initializer recursively, rejecting unknown node shapes. */
    public isPassive(node: unknown): boolean {
        const constantNode = (
            node ?? { type: 'EmptyConstantValue' }
        ) as ConstantNode;
        const validator =
            this.validators.get(constantNode.type ?? '') ??
            this.reject;
        return validator(constantNode);
    }

    /** Registers literal and reference nodes that contain no execution. */
    private registerAlwaysPassive(): void {
        for (const type of [
            'StringLiteral',
            'NumericLiteral',
            'BooleanLiteral',
            'NullLiteral',
            'BigIntLiteral',
            'DecimalLiteral',
            'RegExpLiteral',
            'Identifier',
            'EmptyConstantValue',
        ]) {
            this.validators.set(type, () => true);
        }
    }

    /** Registers TypeScript and syntax wrappers around another expression. */
    private registerExpressionWrappers(): void {
        for (const type of [
            'TSAsExpression',
            'TSSatisfiesExpression',
            'TSNonNullExpression',
            'TypeCastExpression',
            'ParenthesizedExpression',
        ]) {
            this.validators.set(type, (node) =>
                this.isPassive(node.expression),
            );
        }
    }

    /** Requires every present child node to remain passive. */
    private allPassive(
        nodes: Array<ConstantNode | null | undefined> | undefined,
    ): boolean {
        const children = nodes ?? [];
        return children.every((node) => this.isPassive(node));
    }

    /** Accepts plain object properties and rejects methods or computed keys. */
    private passiveObject(node: ConstantNode): boolean {
        return node.properties?.every((property) =>
            this.passiveProperty(property),
        ) ?? true;
    }

    /** Checks one non-computed object property value. */
    private passiveProperty(property: ConstantNode): boolean {
        if (property.type !== 'ObjectProperty' || property.computed) {
            return false;
        }
        return this.isPassive(property.value);
    }

    /** Checks the possible children of binary and conditional expressions. */
    private passiveBranches(node: ConstantNode): boolean {
        return this.allPassive([
            node.left,
            node.right,
            node.test,
            node.consequent,
            node.alternate,
        ]);
    }

    /** Allows passive unary values except the mutating delete operator. */
    private passiveUnary(node: ConstantNode): boolean {
        return (
            node.operator !== 'delete' &&
            this.isPassive(node.argument)
        );
    }

    /** Allows passive property lookup without executing a call. */
    private passiveMember(node: ConstantNode): boolean {
        return (
            this.isPassive(node.object) &&
            (
                !node.computed ||
                this.isPassive(node.property)
            )
        );
    }

    /** Rejects every unregistered or executable AST node shape. */
    private reject(): boolean {
        return false;
    }
}
