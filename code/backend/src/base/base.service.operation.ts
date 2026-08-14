// fallow-ignore-file unused-file -- Operation scaffolds consume this public architecture base.
import type { IBaseServiceOperation } from './interfaces.ts';

/**
 * Base for one complete, owner-bound Service operation.
 *
 * Operations contain application validation, workflows, persistence calls, and
 * DTO mapping. Their owning Service only routes typed calls to `execute`.
 */
export abstract class BaseServiceOperation<
    TInput,
    TOutput,
    TDependencies extends object,
> implements IBaseServiceOperation<TInput, TOutput> {
    protected readonly dependencies: Readonly<TDependencies>;

    /** Receives the immutable dependency context shared by the owning Service. */
    constructor(dependencies: TDependencies) {
        this.dependencies = dependencies;
    }

    /** Executes the complete application operation. */
    public abstract execute(input: TInput): TOutput | Promise<TOutput>;
}
