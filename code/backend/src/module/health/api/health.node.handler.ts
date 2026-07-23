import type { HandlerResult } from '../../../base/interfaces.ts';
import { NodeHandler } from '../../../base/node.handler.ts';
import { HealthController } from '../controller/health.controller.ts';
import type { HealthStatusDTO } from '../dto/health-status.dto.ts';
import type { HealthNodeRequest } from '../types.ts';

/** Adapts typed in-process health requests to the health controller. */
export class HealthNodeHandler extends NodeHandler<
    HealthNodeRequest,
    HealthStatusDTO
> {
    private readonly controller: HealthController;

    /** Creates the Node adapter with its controller dependency. */
    constructor(controller: HealthController) {
        super();
        this.controller = controller;
    }

    /** Routes supported operations without exposing health internals. */
    protected async processRequest(
        input: HealthNodeRequest,
    ): Promise<HandlerResult<HealthStatusDTO>> {
        switch (input.operation) {
            case 'getStatus':
                return this.controller.getHealth();
            default:
                return {
                    success: false,
                    error: 'Unknown health operation',
                };
        }
    }
}
