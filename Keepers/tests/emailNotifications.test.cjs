const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, plain } = require('./helpers/load.cjs');
const { deferred } = require('./helpers/load.cjs');

test('email preferences use authenticated identity-free RPCs and report failures', async () => {
  const calls = [];
  let result = { data: false, error: null };
  const api = createLoader({ '../utils/supabase': { supabase: {
    rpc: async (...args) => { calls.push(args); return result; },
  } } })('services/emailNotificationsService.ts');
  assert.equal(await api.getEmailNotificationsEnabled(), false);
  await api.setEmailNotificationsEnabled(true);
  assert.deepEqual(plain(calls), [['get_price_alert_email_enabled'], ['set_price_alert_email_enabled', { p_enabled: true }]]);
  result = { data: null, error: null };
  await assert.rejects(api.getEmailNotificationsEnabled(), /try again/);
  result = { data: true, error: { message: 'offline' } };
  await assert.rejects(api.getEmailNotificationsEnabled(), /try again/);
  await assert.rejects(api.setEmailNotificationsEnabled(false), /try again/);
});

test('email switch waits for load/save, preserves state on errors and ignores unmounted responses', async () => {
  const slots = [], effects = [];
  let cursor = 0;
  const loadTask = deferred(), saves = [];
  const hooks = {
    useState(value) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value, set(next) { slots[i].value = next; } };
      return [slots[i].value, slots[i].set];
    },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(fn) { const i = cursor++; if (!slots[i]) { slots[i] = {}; effects.push(() => { slots[i].cleanup = fn(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const Component = createLoader({ react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Switch: 'Switch', Pressable: 'Pressable', ActivityIndicator: 'Spinner', StyleSheet: { create: s => s } },
    './Text': { Text: 'Text' }, '../hooks/useAppTheme': { useAppTheme: () => ({ theme: {} }) },
    '../services/emailNotificationsService': {
      getEmailNotificationsEnabled: () => loadTask.promise,
      setEmailNotificationsEnabled: enabled => { const task = deferred(); saves.push({ enabled, ...task }); return task.promise; },
    },
  })('components/EmailNotificationSettings.tsx').EmailNotificationSettings;
  const render = () => { cursor = 0; const tree = Component(); effects.splice(0).forEach(fn => fn()); return tree; };
  function findSwitch(node) {
    if (node?.type === 'Switch') return node;
    const children = node?.props?.children;
    return (Array.isArray(children) ? children : [children]).filter(Boolean).map(findSwitch).find(Boolean);
  }
  assert.equal(findSwitch(render()).props.disabled, true);
  loadTask.resolve(true); await new Promise(setImmediate);
  let control = findSwitch(render());
  assert.equal(control.props.value, true); assert.equal(control.props.disabled, false);
  control.props.onValueChange(false);
  control.props.onValueChange(false);
  assert.equal(saves.length, 1);
  assert.equal(findSwitch(render()).props.disabled, true);
  saves[0].reject(new Error('offline')); await new Promise(setImmediate);
  control = findSwitch(render());
  assert.equal(control.props.value, true); assert.equal(control.props.disabled, false);
  control.props.onValueChange(false); saves[1].resolve(); await new Promise(setImmediate);
  assert.equal(findSwitch(render()).props.value, false);
  findSwitch(render()).props.onValueChange(true);
  slots.forEach(slot => slot.cleanup?.());
  saves[2].resolve(); await new Promise(setImmediate);
  assert.equal(findSwitch(render()).props.value, false);
});
