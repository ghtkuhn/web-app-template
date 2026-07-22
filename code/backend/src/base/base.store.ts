import { BaseObject } from './base.object.ts';
import { IBaseStore } from './interfaces.ts';
import { Kysely } from 'kysely';
import { Database } from '../database.ts';

/**
 * BaseStore provides a generic interface for data persistence and retrieval.
 *
 * RESPONSIBILITIES:
 * - Execute raw database queries (CRUD operations).
 * - Map database rows to Domain Objects.
 *
 * IMPORT RULES:
 * - ALLOWED: Database drivers, Domain Objects, Base classes.
 * - FORBIDDEN: Services, Controllers, DTOs (Stores only care about the DB and Domain Objects).
 *
 * CONSTRAINTS:
 * - Must NOT contain business logic or validation rules beyond data integrity.
 */
export abstract class BaseStore<T extends BaseObject> implements IBaseStore<T> {
  protected db: Kysely<Database>;

  constructor() {
    // In a real implementation, the DB instance would be injected via a DI container
    // or retrieved from DatabaseManager. For simplicity in this base class, we assume it's handled by the subclass.
  }

  abstract save(object: T): Promise<T>;
  abstract findById(id: string): Promise<T | null>;
  abstract findAll(): Promise<T[]>;
  abstract delete(id: string): Promise<void>;
}
