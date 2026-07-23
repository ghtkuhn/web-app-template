import type { IBaseApiAux } from './interfaces.ts';

/**
 * Marks private helper classes owned by one API handler group.
 *
 * API auxiliaries follow the same dependency restrictions as handlers and are
 * only instantiated or composed by their matching handler owner.
 */
export abstract class BaseApiAux implements IBaseApiAux {}
