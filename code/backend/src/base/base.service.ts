import { BaseObject } from './base.object.ts';
import { BaseStore } from './base.store.ts';
import type { IBaseService } from './interfaces.ts';

/**
 * BaseService provides common behavior for a module's business-logic layer.
 *
 * RESPONSIBILITIES:
 * - Orchestrate workflows between Controllers and Stores.
 * - Perform validation, calculations, and complex business rules.
 * - Map Domain Objects to DTOs for API responses.
 *
 * IMPORT RULES:
 * - ALLOWED: Stores, Domain Objects, DTOs, Base classes.
 * - FORBIDDEN: Controllers and Handlers (Services remain independent of delivery mechanisms).
 *
 * CONSTRAINTS:
 * - Must NOT access the database directly; all data access must go through a Store.
 */
export abstract class BaseService<
    T extends BaseObject,
    S extends BaseStore<T>,
> implements IBaseService<T> {
    protected store: S;

    /**
     * Receives the Service's private persistence dependency.
     *
     * @param store Typed Store used for all persistence operations.
     */
    constructor(store: S) {
        this.store = store;
    }

    /**
     * Validates and persists a domain object.
     *
     * @param object Domain object to create or update.
     * @returns The persisted domain object.
     */
    async createOrUpdate(object: T): Promise<T> {
        object.validate();
        return this.store.save(object);
    }

    /**
     * Fetches an object by ID.
     *
     * @param id Stable domain-object identifier.
     * @returns The matching object.
     * @throws Error when no object exists for the identifier.
     */
    async getById(id: string): Promise<T> {
        const object = await this.store.findById(id);
        if (!object) {
            throw new Error(
                `${this.constructor.name}: Object with id ${id} not found`,
            );
        }
        return object;
    }

    /**
     * Returns all objects of the domain type.
     *
     * @returns All objects visible through the Store contract.
     */
    async getAll(): Promise<T[]> {
        return this.store.findAll();
    }
}
