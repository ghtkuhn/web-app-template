import { CliHandler } from '../../../base/cli.handler.ts';
import type {
    CliHandlerInput,
    HandlerResult,
} from '../../../base/interfaces.ts';
import { HealthController } from '../controller/health.controller.ts';
import type { HealthStatusDTO } from '../dto/health-status.dto.ts';

/** Adapts the `health status` CLI command to the health controller. */
export class HealthCliHandler extends CliHandler {
    private readonly controller: HealthController;

    /** Creates the CLI adapter with its controller dependency. */
    constructor(controller: HealthController) {
        super();
        this.controller = controller;
    }

    /** Handles the supported health command. */
    protected async processRequest(
        input: CliHandlerInput,
    ): Promise<HandlerResult<HealthStatusDTO>> {
        if (input.command !== 'status') {
            return { success: false, error: 'Unknown health command' };
        }
        return this.controller.getHealth();
    }
}
