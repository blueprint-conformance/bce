import test from 'node:test'; import assert from 'node:assert/strict'; import { runJob } from '../src/worker.mjs'; test('job', () => assert.equal(runJob('42'), 'job:42:eu'));
