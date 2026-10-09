/** Machine callers: SYNC_TOKEN everywhere, Yaara's own token on the agent API only (9 October 2026). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { machineCallerAuthorised } from '../src/lib/machine-auth'

const req = (path: string, token?: string) =>
  new Request(`https://x.example${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })

test('SYNC_TOKEN opens every machine route; Yaara\'s token only the agent API', () => {
  process.env.SYNC_TOKEN = 'sync-secret'
  process.env.YAARA_SYNC_TOKEN = 'yaara-secret'
  assert.equal(machineCallerAuthorised(req('/api/sync/linear', 'sync-secret')), true)
  assert.equal(machineCallerAuthorised(req('/api/agent/items', 'sync-secret')), true)
  assert.equal(machineCallerAuthorised(req('/api/agent/items', 'yaara-secret')), true)
  assert.equal(machineCallerAuthorised(req('/api/sync/linear', 'yaara-secret')), false)
  assert.equal(machineCallerAuthorised(req('/api/digest', 'yaara-secret')), false)
  assert.equal(machineCallerAuthorised(req('/api/agent/items', 'wrong')), false)
  assert.equal(machineCallerAuthorised(req('/api/agent/items')), false)
})

test('with no Yaara token set, hers is never accepted', () => {
  process.env.SYNC_TOKEN = 'sync-secret'
  delete process.env.YAARA_SYNC_TOKEN
  assert.equal(machineCallerAuthorised(req('/api/agent/items', '')), false)
  assert.equal(machineCallerAuthorised(req('/api/agent/items', 'undefined')), false)
})
