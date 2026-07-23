import type { IBaseStoreAux } from './interfaces.ts';

/**
 * Marks private helper classes owned by one store.
 *
 * Store auxiliaries encapsulate persistence details and use only the database
 * abstractions available to their owning store layer.
 */
export abstract class BaseStoreAux implements IBaseStoreAux {}
