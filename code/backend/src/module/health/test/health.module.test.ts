import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    HEALTH_MODULE_NAME,
    HealthModule,
} from '../index.ts';

test('Health module exposes its stable public definition', () => {
    assert.equal(HealthModule.definition.name, HEALTH_MODULE_NAME);
    assert.deepEqual(HealthModule.definition.dependencies, []);
});
