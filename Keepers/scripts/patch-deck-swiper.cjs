const fs = require('node:fs');

const filename = require.resolve('react-native-deck-swiper/Swiper.js');
const source = fs.readFileSync(filename, 'utf8');

// SDK 58 removed InteractionManager; this short unmount cleanup can run immediately.
if (source.includes('InteractionManager')) {
  const patched = source
    .replace(', InteractionManager }', ' }')
    .replace(
      'InteractionManager.runAfterInteractions(this.componentWillUnmountAfterInteractions.bind(this));',
      'this.componentWillUnmountAfterInteractions();',
    );

  if (patched.includes('InteractionManager')) {
    throw new Error('react-native-deck-swiper changed; review the SDK 58 unmount patch.');
  }

  fs.writeFileSync(filename, patched);
}
