const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadServiceWorker({ responseHeaders = {} } = {}) {
  const listeners = new Map();
  const stored = new Map();
  const cacheWrites = [];
  const requestsFetched = [];
  const self = {
    location: new URL('https://coach.test/treinador/'),
    registration: { scope: 'https://coach.test/treinador/' },
    clients: { claim: async () => {} },
    addEventListener: (name, callback) => listeners.set(name, callback),
    skipWaiting: async () => {},
  };
  const caches = {
    open: async (name) => {
      if (!stored.has(name)) stored.set(name, new Map());
      const entries = stored.get(name);
      return {
        addAll: async () => {},
        match: async (request) => entries.get(typeof request === 'string' ? request : request.url),
        put: async (request, response) => {
          const key = typeof request === 'string' ? request : request.url;
          cacheWrites.push({ name, key });
          entries.set(key, response);
        },
        keys: async () => [],
      };
    },
    keys: async () => [],
    delete: async () => true,
  };
  const fetch = async (request, options) => {
    requestsFetched.push({ request, options });
    return new Response('asset', { status: 200, headers: responseHeaders });
  };
  const context = { self, caches, fetch, URL, Request, Response, Promise };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context, { filename: 'sw.js' });
  return { listeners, cacheWrites, requestsFetched };
}

function dispatchFetch(listeners, request) {
  let responsePromise;
  listeners.get('fetch')({ request, respondWith: (promise) => { responsePromise = Promise.resolve(promise); } });
  return responsePromise;
}

test('service worker never intercepts cross-origin signed URLs or unknown API requests', async () => {
  const worker = loadServiceWorker();
  const signedUrl = new Request('https://project.supabase.co/storage/v1/object/sign/private/photo?token=temporary');
  const apiUrl = new Request('https://coach.test/treinador/rest/v1/players');

  assert.equal(dispatchFetch(worker.listeners, signedUrl), undefined);
  assert.equal(dispatchFetch(worker.listeners, apiUrl), undefined);
  assert.deepEqual(worker.requestsFetched, []);
  assert.deepEqual(worker.cacheWrites, []);
});

test('service worker caches only public allowlisted shell assets', async () => {
  const worker = loadServiceWorker();
  const asset = new Request('https://coach.test/treinador/js/app.js');
  await dispatchFetch(worker.listeners, asset);
  assert.deepEqual(worker.cacheWrites, [{ name: 'vision-coach-v181', key: asset.url }]);

  const privateResponseWorker = loadServiceWorker({ responseHeaders: { 'cache-control': 'private, no-store' } });
  await dispatchFetch(privateResponseWorker.listeners, asset);
  assert.deepEqual(privateResponseWorker.cacheWrites, []);

  const authorizedWorker = loadServiceWorker();
  const authorizedAsset = new Request(asset.url, { headers: { authorization: 'Bearer session-token' } });
  await dispatchFetch(authorizedWorker.listeners, authorizedAsset);
  assert.deepEqual(authorizedWorker.cacheWrites, []);
});
