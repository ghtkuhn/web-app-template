import { BaseObject } from './base.object.ts';
import { BaseStore } from './base.store.ts';
import { IBaseService } from './interfaces.ts';

/**
 * BaseService implements the business logic layer of a module.
 *
 * RESPONSIBILITIES:
 * - Orchestrate workflows between Controllers and Stores.
 * - Perform validation, calculations, and complex business rules.
 * - Map Domain Objects to DTOs for API responses.
 *
 * IMPORT RULES:
 * - ALLOWED: Stores, Domain Objects, DTOs, Base classes.
 * - FORBIDDEN: Controllers (Services must be independent of the delivery mechanism).
 *
 * CONSTRAINTS:
 * - Must NOT access the database directly; all data access must go through a Store.
 */
export abstract class BaseService<T extends BaseObject, S extends BaseStore<T>> implements IBaseService<T> {
  constructor(protected store: S) {}

  /**
   * Standard method to save an object after validation.
   */
  async createOrUpdate(object: T): Promise<T> {
    object.validate();
    return this.store.save(object);
  }

  /**
   * Fetches an object by ID and throws an error if not found.
   */
  async getById(id: string): Promise<T> {
    const object = await this.store.findById(id);
    if (!object) {
      throw new Error(`${this.constructor.name}: Object with id ${id} not found`);
    }
    return object;
  }

  /**
   * Returns all objects of the domain type.
   */
  async getAll(): Promise<T[]> {
    return this.store.findAll();
  }

  protected logError(error: any, context: string) {
    console.error(`[${this.constructor.name}] Error in ${context}:`, error);
  }
}
