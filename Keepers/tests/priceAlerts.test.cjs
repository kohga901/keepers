const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, deferred, plain } = require('./helpers/load.cjs');
const { validateAlertTarget } = createLoader()('utils/priceAlerts.ts');

test('target validation supports increases and decreases, preserves cents and rejects equal targets', () => {
  assert.equal(validateAlertTarget('19.99', '$20'), 19.99);
  assert.equal(validateAlertTarget('USD 1,234.50', '$2,000'), 1234.5);
  assert.equal(validateAlertTarget('21.50', '$20'), 21.5);
  assert.equal(validateAlertTarget('0.01', '$0'), 0.01);
  for (const target of ['', '0', '-1', '20', 'NaN', '10.999', '$10-15', '€10']) {
    assert.throws(() => validateAlertTarget(target, '$20'));
  }
  assert.throws(() => validateAlertTarget('10', 'Price unavailable'), /supported USD/);
});

function setup(results = [], rpcError = null) {
  const calls = [];
  const supabase = {
    from(table) {
      const call = { table, operations: [] }; calls.push(call);
      const query = { then(resolve) { return Promise.resolve(results.shift() ?? { data: [], error: null }).then(resolve); } };
      for (const operation of ['select', 'eq', 'is', 'order', 'range', 'limit', 'abortSignal', 'delete', 'update']) {
        query[operation] = (...args) => { call.operations.push([operation, ...args]); return query; };
      }
      return query;
    },
    async rpc(name, args) { calls.push({ rpc: name, args }); return { error: rpcError }; },
  };
  return { calls, api: createLoader({ '../utils/supabase': { supabase } })('services/priceAlertsService.ts') };
}

test('loading alerts pages past 1000 rows, scopes all reads, and counts unread beyond the latest 50', async () => {
  const page = Array.from({ length: 500 }, (_, clothes_id) => ({ clothes_id }));
  const app = setup([
    { data: page }, { data: page }, { data: [{ clothes_id: 1001 }] },
    { data: [{ id: 'notice' }] }, { data: null, count: 71 },
  ]);
  const controller = new AbortController();
  const result = await app.api.getPriceAlertState('alice', controller.signal);
  assert.equal(result.alerts.length, 1001);
  assert.equal(result.unreadCount, 71);
  assert.equal(result.notifications[0].id, 'notice');
  assert.deepEqual(plain(app.calls.slice(0, 3).map(call => call.operations.find(op => op[0] === 'range'))),
    [['range', 0, 499], ['range', 500, 999], ['range', 1000, 1499]]);
  for (const call of app.calls) {
    assert.ok(call.operations.some(op => op[0] === 'eq' && op[1] === 'user_id' && op[2] === 'alice'));
    assert.ok(call.operations.some(op => op[0] === 'abortSignal' && op[1] === controller.signal));
  }
  assert.ok(app.calls[4].operations.some(op => op[0] === 'select' && op[2].head && op[2].count === 'exact'));
  assert.ok(app.calls[0].operations.some(op => op[0] === 'select' && op[1].includes('direction')));
  assert.ok(app.calls[3].operations.some(op => op[0] === 'select' && op[1].includes('direction')));
  for (const call of app.calls.slice(3)) {
    assert.ok(call.operations.some(op => op[0] === 'is' && op[1] === 'dismissed_at' && op[2] === null));
  }
});

test('clearing one or all notifications hides only the caller\'s visible notifications', async () => {
  const app = setup();
  await app.api.clearPriceNotifications('alice', 'notice');
  await app.api.clearPriceNotifications('alice');
  for (const call of app.calls) {
    assert.equal(call.table, 'Price_Notifications');
    assert.ok(call.operations.some(op => op[0] === 'eq' && op[1] === 'user_id' && op[2] === 'alice'));
    assert.ok(call.operations.some(op => op[0] === 'is' && op[1] === 'dismissed_at' && op[2] === null));
    assert.deepEqual(Object.keys(call.operations.find(op => op[0] === 'update')[1]), ['dismissed_at']);
    assert.ok(!call.operations.some(op => op[0] === 'limit' || op[0] === 'delete'));
  }
  assert.ok(app.calls[0].operations.some(op => op[0] === 'eq' && op[1] === 'id' && op[2] === 'notice'));
  assert.ok(!app.calls[1].operations.some(op => op[0] === 'eq' && op[1] === 'id'));
  const failure = setup([{ error: { code: 'offline', message: 'internal details' } }]);
  await assert.rejects(failure.api.clearPriceNotifications('alice'), /Check your connection/);
});

test('saving uses an identity-free RPC; cancelling and read updates keep explicit ownership filters', async () => {
  const app = setup();
  await app.api.savePriceAlert('7', 19.99);
  assert.deepEqual(plain(app.calls[0]), { rpc: 'set_price_alert', args: { p_clothes_id: '7', p_target_price: 19.99 } });
  await app.api.deletePriceAlert('alice', '7');
  await app.api.markPriceNotificationsRead('alice', 'notice');
  await app.api.markPriceNotificationsRead('alice');
  for (const call of app.calls.slice(1)) assert.ok(call.operations.some(op => op[0] === 'eq' && op[1] === 'user_id' && op[2] === 'alice'));
  assert.ok(app.calls[2].operations.some(op => op[0] === 'eq' && op[1] === 'id' && op[2] === 'notice'));
  assert.ok(!app.calls[3].operations.some(op => op[0] === 'eq' && op[1] === 'id'));
  for (const call of app.calls.slice(2)) {
    assert.ok(call.operations.some(op => op[0] === 'is' && op[1] === 'read_at' && op[2] === null));
    const update = call.operations.find(op => op[0] === 'update')[1];
    assert.deepEqual(Object.keys(update), ['read_at']);
  }
});

test('failed reads/writes never become empty inboxes or successful saves', async () => {
  const missing = setup([{ error: { code: 'PGRST205', message: 'missing' } }]);
  await assert.rejects(missing.api.getPriceAlertState('alice', new AbortController().signal), /not available yet/);
  const denied = setup([], { code: 'P0001', message: 'Choose a target above or below the current catalog price.' });
  await assert.rejects(denied.api.savePriceAlert('7', 40), /above or below the current/);
  const failure = setup([{ error: { code: 'offline', message: 'internal details' } }]);
  await assert.rejects(failure.api.deletePriceAlert('alice', '7'), /Check your connection/);
});

test('alert provider refreshes in foreground, ignores stale requests and stops after sign-out', async () => {
  const slots = [], effects = [], requests = [];
  let cursor = 0, appChanged, interval, removed = false, cleared = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    createContext: () => ({ Provider: 'Provider' }),
    useState(value) {
      const i = cursor++;
      slots[i] ??= { value, set(next) { slots[i].value = next; } };
      return [slots[i].value, slots[i].set];
    },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn, deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) {
        const previous = slots[i]; slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const AppState = { currentState: 'active', addEventListener(_, callback) {
    appChanged = state => { AppState.currentState = state; callback(state); };
    return { remove() { removed = true; } };
  } };
  const jsx = (type, props) => ({ type, props });
  const load = createLoader({
    react: hooks, 'react/jsx-runtime': { jsx }, 'react-native': { AppState },
    '../services/priceAlertsService': { getPriceAlertState(userId, signal) {
      const task = deferred(); requests.push({ userId, signal, ...task }); return task.promise;
    } },
  }, { setInterval(fn, delay) { interval = fn; assert.equal(delay, 60000); return 1; }, clearInterval() { cleared = true; } });
  const { PriceAlertsProvider } = load('contexts/PriceAlertsContext.tsx');
  const render = () => { cursor = 0; const tree = PriceAlertsProvider({ userId: 'alice', children: null });
    effects.splice(0).forEach(effect => effect()); return tree.props.value; };
  const snapshot = unreadCount => ({ alerts: [], notifications: [], unreadCount });
  render();
  assert.equal(requests[0].userId, 'alice');
  requests[0].resolve(snapshot(1)); await new Promise(setImmediate);
  assert.equal(render().unreadCount, 1);
  const first = render().refresh(), second = render().refresh();
  assert.equal(requests[1].signal.aborted, true);
  requests[2].resolve(snapshot(3)); await second;
  requests[1].resolve(snapshot(2)); await first;
  assert.equal(render().unreadCount, 3);
  appChanged('background'); interval();
  assert.equal(requests.length, 3);
  appChanged('active');
  assert.equal(requests.length, 4);
  interval();
  assert.equal(requests.length, 5);
  assert.equal(requests[3].signal.aborted, true);
  const state = render();
  slots.forEach(slot => slot?.cleanup?.());
  assert.equal(removed, true); assert.equal(cleared, true);
  assert.equal(requests[4].signal.aborted, true);
  await state.refresh();
  assert.equal(requests.length, 5);
  requests[3].resolve(snapshot(4)); requests[4].resolve(snapshot(5));
  await new Promise(setImmediate);
  assert.equal(render().unreadCount, 3);
});
