import { BaseHandler } from './base.handler.ts';
import { HandlerResult } from './interfaces.ts';

/**
 * NodeHandler provides a programmatic API for module-to-module interaction.
 *
 * RESPONSIBILITIES:
 * - Allow other backend modules to call this module's logic without HTTP/WS overhead.
 * - Ensure that all Controller validation and business rules are still applied.
 */
export abstract class NodeHandler extends BaseHandler {
  protected async processRequest(input: any): Promise<HandlerResult> {
    throw new Error('processRequest must be implemented by a concrete NodeHandler');
  }

  /**
   * Since this is programmatic, it simply returns the HandlerResult directly.
   */
  async execute(params: any): Promise<HandlerResult> {
    return this.handle(params);
  }
}
