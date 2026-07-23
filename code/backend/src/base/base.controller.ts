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
     * Helper to create a successful result.
     */
    protected success<T>(data: T, statusCode = 200): HandlerResult<T> {
        return {
            success: true,
            data,
            statusCode,
        };
    }

    /**
     * Helper to create an error result.
     */
    protected error(message: string, statusCode = 500): HandlerResult {
        return {
            success: false,
            error: message,
            statusCode,
        };
    }
}
