/** Serializes JSON-compatible OpenAPI data as deterministic YAML. */
export class YamlSerializer {
    /** Renders one complete document with four-space indentation. */
    public serialize(value: unknown): string {
        return `${this.render(value, 0)}\n`;
    }

    /** Renders one value at the requested indentation depth. */
    private render(value: unknown, depth: number): string {
        if (Array.isArray(value)) {
            return value.map((item) => this.arrayItem(item, depth)).join('\n');
        }
        if (this.isRecord(value)) {
            return Object.keys(value)
                .sort((left, right) => left.localeCompare(right))
                .map((key) => this.objectEntry(key, value[key], depth))
                .join('\n');
        }
        return `${this.indent(depth)}${this.scalar(value)}`;
    }

    /** Renders one object property. */
    private objectEntry(key: string, value: unknown, depth: number): string {
        const prefix = `${this.indent(depth)}${this.key(key)}:`;
        if (Array.isArray(value) && value.length === 0) {
            return `${prefix} []`;
        }
        if (this.isRecord(value) && Object.keys(value).length === 0) {
            return `${prefix} {}`;
        }
        return this.isCollection(value)
            ? `${prefix}\n${this.render(value, depth + 1)}`
            : `${prefix} ${this.scalar(value)}`;
    }

    /** Renders one array item. */
    private arrayItem(value: unknown, depth: number): string {
        const prefix = `${this.indent(depth)}-`;
        if (Array.isArray(value) && value.length === 0) {
            return `${prefix} []`;
        }
        if (this.isRecord(value) && Object.keys(value).length === 0) {
            return `${prefix} {}`;
        }
        return this.isCollection(value)
            ? `${prefix}\n${this.render(value, depth + 1)}`
            : `${prefix} ${this.scalar(value)}`;
    }

    /** Returns a stable YAML scalar. */
    private scalar(value: unknown): string {
        if (value === null) {
            return 'null';
        }
        if (typeof value === 'boolean' || typeof value === 'number') {
            return String(value);
        }
        return JSON.stringify(String(value));
    }

    /** Quotes mapping keys when plain YAML would be ambiguous. */
    private key(value: string): string {
        return /^(?:[A-Za-z_][A-Za-z0-9_-]*|\/[A-Za-z0-9_./{}:-]+)$/u.test(value)
            ? value
            : JSON.stringify(value);
    }

    /** Returns indentation for one YAML nesting level. */
    private indent(depth: number): string {
        return '    '.repeat(depth);
    }

    /** Identifies nested structures. */
    private isCollection(value: unknown): boolean {
        return Array.isArray(value) || this.isRecord(value);
    }

    /** Narrows plain JSON-compatible objects. */
    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
