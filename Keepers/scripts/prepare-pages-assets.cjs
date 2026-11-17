const fs = require('node:fs');
const path = require('node:path');

function preparePagesAssets(directory) {
  const root = path.resolve(directory);
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Expected an exported web directory containing index.html');
  const source = path.join(root, 'assets', 'node_modules');
  const destination = path.join(root, 'assets', 'vendor');
  // Wrangler excludes every node_modules directory, including Expo's exported fonts and icons.
  if (fs.existsSync(source)) fs.renameSync(source, destination);

  const contents = new Map();
  const renames = new Map();
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(filename);
      else if (entry.isFile() && /\.(js|json|html|css|map)$/.test(entry.name)) {
        const text = fs.readFileSync(filename, 'utf8');
        contents.set(filename, text);
        if (entry.name.endsWith('.js') && !entry.name.endsWith('.pages.js')) {
          renames.set(entry.name, entry.name.replace(/\.js$/, '.pages.js'));
        }
      }
    }
  }
  collect(root);
  // Changed bundles need new URLs so existing browser/CDN caches cannot retain the old asset paths.
  for (const [filename, text] of contents) {
    let updated = text.replaceAll('assets/node_modules/', 'assets/vendor/');
    for (const [oldName, newName] of renames) updated = updated.replaceAll(oldName, newName);
    const newName = renames.get(path.basename(filename));
    const target = newName ? path.join(path.dirname(filename), newName) : filename;
    if (target !== filename || updated !== text) fs.writeFileSync(target, updated);
    if (target !== filename) fs.unlinkSync(filename);
  }
}

if (require.main === module) preparePagesAssets(process.argv[2] || 'dist');
module.exports = { preparePagesAssets };
