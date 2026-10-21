/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');

// Fresh module state per test. Only explicit boundary stubs replace app code;
// an unexpected import fails instead of silently becoming an empty object.
function createLoader(stubs = {}, globals = {}) {
  const cache = new Map();
  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {} }, URL, AbortController, Error, TypeError,
    setTimeout, clearTimeout, __DEV__: false, process: { env: {} },
    fetch() { throw new Error('Unexpected network request in test'); },
    ...globals,
  });
  function load(relative) {
    let filename = path.resolve(root, relative);
    if (!path.extname(filename)) {
      filename = [filename + '.ts', filename + '.tsx', path.join(filename, 'index.ts')].find(fs.existsSync);
      if (!filename) throw new Error(`Cannot resolve ${relative}`);
    }
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
    }).outputText;
    const localRequire = (name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name));
      return createRequire(filename)(name);
    };
    vm.runInContext(`(function(require, module, exports) {\n${code}\n})`, context, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return load;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
module.exports = { createLoader, deferred, plain };
