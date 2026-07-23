import type { IBaseControllerAux } from './interfaces.ts';

/**
 * Marks private helper classes owned by one controller.
 *
 * Controller auxiliaries coordinate application-level work through services
 * and remain inaccessible outside their matching controller owner.
 */
export abstract class BaseControllerAux implements IBaseControllerAux {}
