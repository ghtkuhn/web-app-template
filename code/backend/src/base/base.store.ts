import type { BaseObject } from './base.object.ts';
import type { IBaseStore } from './interfaces.ts';
import type { Kysely } from 'kysely';
import type { Database } from '../database.ts';

/**
 * BaseStore retains the application-owned typed database client.
 *
 * RESPONSIBILITIES:
 * - Support Store-specific, fully scoped persistence queries.
 * - Map database rows to Domain Objects.
 *
 * IMPORT RULES:
 * - ALLOWED: The provided Kysely database abstraction, Domain Objects, Base classes.
 * - FORBIDDEN: Database drivers, connection creation, DTOs, Service routers, Operations, Controllers, Handlers.
 *
 * CONSTRAINTS:
 * - Must NOT contain business logic or validation rules beyond data integrity.
 * - Must NOT create or own a database connection.
 * - Must receive the application-owned client through constructor injection.
 */
export abstract class BaseStore<T extends BaseObject> implements IBaseStore<T> {
    protected readonly db: Kysely<Database>;

    /**
     * Receives the application-owned database client.
     *
     * @param database Shared Kysely client supplied through module composition.
     */
    constructor(database: Kysely<Database>) {
        this.db = database;
    }
}
