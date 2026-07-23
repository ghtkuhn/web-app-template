import { BaseHandler } from './base.handler.ts';
import type { HandlerResult, WebSocketHandlerInput } from './interfaces.ts';

/**
 * Adapts structured WebSocket events to a module controller.
 * Response framing and socket operations remain inside `WebSocketServer`.
 */
export abstract class WebSocketHandler extends BaseHandler<WebSocketHandlerInput> {
    /** Processes one validated event received from the WebSocket transport. */
    protected async processRequest(
        input: WebSocketHandlerInput,
    ): Promise<HandlerResult> {
        throw new Error(
            'processRequest must be implemented by a concrete WebSocketHandler',
        );
    }
}
