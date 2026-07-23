import { HttpHandler } from '../../../base/http.handler.ts';
import type { HandlerResult } from '../../../base/interfaces.ts';
import { HealthController } from '../controller/health.controller.ts';
import type { HealthStatusDTO } from '../dto/health-status.dto.ts';

/**
 * Adapts `GET /api/health` requests to the health controller.
 */
export class HealthHttpHandler extends HttpHandler {
    private readonly controller: HealthController;

    /** Creates the HTTP adapter with its controller dependency. */
    constructor(controller: HealthController) {
        super();
        this.controller = controller;
    }

    /**
     * Validates the health route and forwards supported requests.
     */
    protected async processRequest(
        request: Request,
    ): Promise<HandlerResult<HealthStatusDTO>> {
        const url = new URL(request.url);
        if (request.method !== 'GET' || url.pathname !== '/api/health') {
            return { success: false, error: 'Not found', statusCode: 404 };
        }
        return this.controller.getHealth();
    }
}
