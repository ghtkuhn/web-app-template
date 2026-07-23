import { BaseObject } from './base.object.ts';
import type { IBaseStore } from './interfaces.ts';
import type { Kysely } from 'kysely';
import type { Database } from '../database.ts';

/**
 * BaseStore provides a generic interface for data persistence and retrieval.
 *
 * RESPONSIBILITIES:
 * - Execute raw database queries (CRUD operations).
 * - Map database rows to Domain Objects.
 *
 * IMPORT RULES:
 * - ALLOWED: The provided Kysely database abstraction, Domain Objects, Base classes.
 * - FORBIDDEN: Database drivers, connection creation, DTOs, Services, Controllers, Handlers.
 *
 * CONSTRAINTS:
 * - Must NOT contain business logic or validation rules beyond data integrity.
 * - Must NOT create or own a database connection.
 * - Must receive the application-owned client through constructor injection.
 */
export abstract class BaseStore<T extends BaseObject> implements IBaseStore<T> {
    protected readonly db: Kysely<Database>;

    /** Receives the application-owned database client. */
    constructor(database: Kysely<Database>) {
        this.db = database;
    }

    abstract save(object: T): Promise<T>;
    abstract findById(id: string): Promise<T | null>;
    abstract findAll(): Promise<T[]>;
    abstract delete(id: string): Promise<void>;
}
