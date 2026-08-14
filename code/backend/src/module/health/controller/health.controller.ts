import { BaseController } from '../../../base/base.controller.ts';
import type { HandlerResult } from '../../../base/interfaces.ts';
import type { HealthStatusDTO } from '../dto/health-status.dto.ts';
import { HealthService } from '../service/health.service.ts';

/**
 * Coordinates the health use case and returns a transport-neutral result.
 */
export class HealthController extends BaseController {
    private readonly service: HealthService;

    /** Creates the controller with its health service dependency. */
    constructor(service: HealthService) {
        super();
        this.service = service;
    }

    /** Returns the application's current health state. */
    public getHealth(): HandlerResult<HealthStatusDTO> {
        return this.success(this.service.getHealth());
    }
}
