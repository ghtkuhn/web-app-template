import { v4 as uuidv4 } from 'uuid';

import type { IBaseObject } from './interfaces.ts';

/**
 * BaseObject is the root for all Domain Objects in the system.
 *
 * RESPONSIBILITIES:
 * - Represent a business entity with its core properties and identity (UUID).
 * - Provide standardized metadata like timestamps and soft-delete flags.
 *
 * IMPORT RULES:
 * - ALLOWED: Basic TypeScript types, Base classes.
 * - FORBIDDEN: Services, Controllers, Stores (Objects are pure domain models).
 *
 * CONSTRAINTS:
 * - Must NOT contain logic for persisting itself to the database.
 */
export abstract class BaseObject implements IBaseObject {
    /** Stable identity assigned when the object is first constructed. */
    id: string = uuidv4();
    /** Creation time retained across persistence mappings. */
    createdAt: Date = new Date();
    /** Last domain-change time retained across persistence mappings. */
    updatedAt: Date = new Date();
    /** Whether the object has been logically deleted. */
    isDeleted: boolean = false;
    /** Time of logical deletion, when applicable. */
    deletedAt?: Date;

    /**
     * Initializes domain state from trusted, explicitly mapped values.
     *
     * @param data Initial identity, metadata, and subclass properties.
     */
    constructor(data: Partial<BaseObject>) {
        Object.assign(this, data);
    }

    /**
     * Validates the object.
     * Should be overridden in subclasses if specific rules exist.
     * @throws Error if validation fails.
     */
    validate(): void {
        // Default validation: ID must be present
        if (!this.id) {
            throw new Error(`${this.constructor.name} must have an id`);
        }
    }

    /**
     * Produces the object's controlled domain serialization.
     *
     * Domain objects are not public transport contracts. Services must map them
     * to DTOs before returning data through HTTP, WebSocket, CLI, or Node ports.
     * Subclasses containing sensitive fields must exclude those fields here.
     *
     * @returns A plain representation of non-sensitive domain state.
     */
    toJSON() {
        const json = { ...this };
        return json;
    }

    /**
     * Marks the object as deleted (Soft Delete).
     *
     * Updates both deletion and modification metadata.
     */
    softDelete(): void {
        this.isDeleted = true;
        this.deletedAt = new Date();
        this.updatedAt = new Date();
    }
}
