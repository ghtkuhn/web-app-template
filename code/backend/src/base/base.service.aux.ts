import type { IBaseServiceAux } from './interfaces.ts';

/**
 * Marks private helper classes owned by one service.
 *
 * Service auxiliaries encapsulate business-logic details while retaining the
 * dependency boundaries of their owning service layer.
 */
export abstract class BaseServiceAux implements IBaseServiceAux {}
