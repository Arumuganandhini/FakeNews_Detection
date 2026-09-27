// Which provider runs which task is a measured property of the task.
//
// A local model is free, private and available when a quota is not, and weaker
// where a task needs a taxonomy held in mind or several documents compared at
// once. The routing table records where that line falls; these tests cover the
// mechanism that reads it, not the measurements themselves.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROUTING = path.join(__dirname, '..', 'data', 'taskRouting.json');
const PROVIDERS_PATH = require.resolve('../utils/llmProviders');

const withEnv = (vars, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

const freshProviders = () => {
  delete require.cache[PROVIDERS_PATH];
  return require(PROVIDERS_PATH);
};

test('a task with no routing entry uses the configured order', () => {
  withEnv({ LLM_PROVIDER: 'nim', NIM_API_KEY: 'x', GEMINI_API_KEY: '', OLLAMA_HOST: '' }, () => {
    const { resolveProviderChain } = freshProviders();
    const chain = resolveProviderChain('a task nobody has measured');
    assert.ok(chain.length > 0);
    assert.equal(chain[0].name, 'nim');
  });
});

test('routing is per task, not global', () => {
  if (!fs.existsSync(ROUTING)) return; // nothing measured yet; nothing to assert
  const table = JSON.parse(fs.readFileSync(ROUTING, 'utf8'));
  const entries = Object.values(table.tasks || {});
  if (entries.length < 2) return;

  // The point of the table is that it can differ per task. It is legitimate for
  // every task to land on one provider, but the structure must allow otherwise.
  for (const entry of entries) {
    assert.ok(Array.isArray(entry.chain) && entry.chain.length, 'every task names a chain');
    assert.ok(entry.reason, 'every routing decision states why');
  }
});

test('every routed task names a provider the gateway knows', () => {
  if (!fs.existsSync(ROUTING)) return;
  const table = JSON.parse(fs.readFileSync(ROUTING, 'utf8'));
  const { PROVIDERS } = freshProviders();
  for (const [task, entry] of Object.entries(table.tasks || {})) {
    for (const name of entry.chain) {
      assert.ok(PROVIDERS[name], `${task} routes to unknown provider "${name}"`);
    }
  }
});

// The failover guarantee: a provider that is configured must remain reachable
// even when the routing table does not mention it, or a table written before a
// new key was added would strand that provider.
test('a configured provider left out of the table is still a failover', () => {
  withEnv({ LLM_PROVIDER: 'ollama', NIM_API_KEY: 'x', GEMINI_API_KEY: '', OLLAMA_HOST: 'http://localhost:11434' }, () => {
    const { resolveProviderChain } = freshProviders();
    const chain = resolveProviderChain('clickbait').map(p => p.name);
    assert.ok(chain.includes('nim'), 'nim is configured and must remain reachable');
  });
});

test('an unconfigured provider never enters the chain', () => {
  withEnv({ LLM_PROVIDER: 'ollama,nim', NIM_API_KEY: '', GEMINI_API_KEY: '', OLLAMA_HOST: 'http://localhost:11434' }, () => {
    const { resolveProviderChain } = freshProviders();
    const chain = resolveProviderChain('clickbait').map(p => p.name);
    assert.deepEqual(chain, ['ollama']);
  });
});
