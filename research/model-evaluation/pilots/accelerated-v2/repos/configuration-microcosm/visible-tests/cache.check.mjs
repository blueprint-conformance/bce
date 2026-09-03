import test from 'node:test'; import assert from 'node:assert/strict'; import { cacheKey } from '../src/cache.mjs'; test('cache', () => assert.equal(cacheKey('User 7'), 'user-7'));
