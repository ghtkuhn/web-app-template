import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTH_MODULE_NAME, AuthModule } from '../index.ts';

test('Auth module exposes its inactive public module contract', () => {
    assert.equal(AuthModule.definition.name, AUTH_MODULE_NAME);
    assert.deepEqual(AuthModule.definition.dependencies, []);
});
