import type {
    HandlerResult,
    WebSocketHandlerInput,
} from '../../../base/interfaces.ts';
import { WebSocketHandler } from '../../../base/websocket.handler.ts';
import { HealthController } from '../controller/health.controller.ts';

/** Adapts the health `status` WebSocket event to the health controller. */
export class HealthWebSocketHandler extends WebSocketHandler {
    private readonly controller: HealthController;

    /** Creates the WebSocket adapter with its controller dependency. */
    constructor(controller: HealthController) {
        super();
        this.controller = controller;
    }

    /** Handles the supported health event. */
    protected async processRequest(
        input: WebSocketHandlerInput,
    ): Promise<HandlerResult> {
        if (input.event !== 'status') {
            return { success: false, error: 'Unknown health event' };
        }
        return this.controller.getHealth();
    }
}
