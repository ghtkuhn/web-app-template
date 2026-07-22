import { BaseHandler } from './base.handler.ts';
import { HandlerResult } from './interfaces.ts';

/**
 * CliHandler adapts internal Controller logic to Command Line Interface calls.
 *
 * RESPONSIBILITIES:
 * - Parse CLI arguments/flags.
 * - Format results for terminal output (stdout).
 */
export abstract class CliHandler extends BaseHandler {
  protected async processRequest(input: string[]): Promise<HandlerResult> {
    throw new Error('processRequest must be implemented by a concrete CliHandler');
  }

  /**
   * Helper to print the result to the console.
   */
  protected printResponse(result: HandlerResult) {
    if (result.success) {
      console.log('✅ Success:', JSON.stringify(result.data, null, 2));
    } else {
      console.error('❌ Error:', result.error);
    }
  }
}
