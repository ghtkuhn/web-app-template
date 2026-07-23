/** Parses and compares strict stable semantic versions. */
export class SemanticVersion {
    public readonly value: string;
    private readonly parts: readonly [number, number, number];

    public constructor(value: string) {
        const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
        if (!match) {
            throw new Error(`Invalid stable semantic version '${value}'.`);
        }
        this.parts = [
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
        ];
        this.value = this.parts.join('.');
    }

    /** Compares this version with another semantic version. */
    public compare(other: SemanticVersion): number {
        for (let index = 0; index < this.parts.length; index += 1) {
            const difference = this.parts[index] - other.parts[index];
            if (difference !== 0) {
                return Math.sign(difference);
            }
        }
        return 0;
    }
}
