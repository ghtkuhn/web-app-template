import { BaseHandler } from './base.handler.ts';
import { HandlerResult } from './interfaces.ts';

/**
 * WebSocketHandler adapts internal Controller logic to WebSocket events.
 *
 * RESPONSIBILITIES:
 * - Map incoming socket messages/events to controller calls.
 * - Send results back via the socket connection.
 */
export abstract class WebSocketHandler extends BaseHandler {
  protected async processRequest(input: { event: string; data: any; socket: any }): Promise<HandlerResult> {
    throw new Error('processRequest must be implemented by a concrete WebSocketHandler');
  }

  /**
   * Helper to send the result back through the websocket.
   */
  protected sendSocketResponse(socket: any, event: string, result: HandlerResult) {
    socket.emit(event + '_response', {
      success: result.success,
      data: result.data,
      error: result.error,
    });
  }
}
