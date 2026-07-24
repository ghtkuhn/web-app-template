import type { HandlerResult, IBaseController } from './interfaces.ts';

/**
 * BaseController provides a standardized foundation for all internal module controllers.
 *
 * RESPONSIBILITIES:
 * - Coordinate business logic by calling Services.
 * - Return transport-agnostic results (HandlerResult).
 * - Act as the single source of truth for "what" happens in a request.
 *
 * IMPORT RULES:
 * - ALLOWED: Services, DTOs, Base classes.
 * - FORBIDDEN: Handlers, Stores, Domain Objects (must use Services), Transport libraries (express, etc.).
 *
 * CONSTRAINTS:
 * - Must NOT handle HTTP responses or Socket emits directly.
 * - Must return a HandlerResult object.
 */
export abstract class BaseController implements IBaseController {
    /**
     * Creates a successful transport-neutral result.
     *
     * @param data Typed DTO or other approved application response data.
     * @param statusCode Optional transport compatibility status.
     * @returns A successful handler result.
     */
    protected success<T>(data: T, statusCode = 200): HandlerResult<T> {
        return {
            success: true,
            data,
            statusCode,
        };
    }

    /**
     * Creates a controlled transport-neutral failure result.
     *
     * @param message Safe caller-facing failure description.
     * @param statusCode Optional transport compatibility status.
     * @returns A failed handler result.
     */
    protected error(message: string, statusCode = 500): HandlerResult {
        return {
            success: false,
            error: message,
            statusCode,
        };
    }
}
