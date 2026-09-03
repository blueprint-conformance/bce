import test from 'node:test'; import assert from 'node:assert/strict'; import { formatTitle } from '../src/title.mjs'; test('title', () => assert.equal(formatTitle('hello world'), 'Hello World'));
