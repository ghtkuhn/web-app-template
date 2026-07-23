import { BaseHandler } from './base.handler.ts';
import type { HandlerResult } from './interfaces.ts';

/**
 * Provides a typed in-process entry point for module-to-module communication.
 * Callers access it exclusively through the owning module's `dispatch('node', ...)` port.
 */
export abstract class NodeHandler<TInput, TOutput> extends BaseHandler<
    TInput,
    TOutput
> {
    /** Processes one typed request from another module. */
    protected async processRequest(
        input: TInput,
    ): Promise<HandlerResult<TOutput>> {
        throw new Error(
            'processRequest must be implemented by a concrete NodeHandler',
        );
    }
}
