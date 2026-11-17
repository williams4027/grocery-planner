/* Device-local list history: capture, restore, undo, and reload. */

const assert = require('node:assert/strict');

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

// Node has no IndexedDB; the store falls back to localStorage and warns once.
const warn = console.warn;
console.warn = (message, ...args) => {
  if (String(message).includes('IndexedDB unavailable')) return;
  warn(message, ...args);
};

(async () => {
  const store = await import('../js/store.js');
  await store.init();

  const list = store.getActiveList();
  assert.equal(store.getListHistory(list.id).length, 0);

  const milk = store.addItem(list.id, { name: 'Milk', qty: 2 });
  let history = store.getListHistory(list.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].label, 'Before adding an item');
  assert.equal(history[0].itemCount, 0);

  store.renameList(list.id, 'Weekly shop');
  store.deleteItem(list.id, milk.id);

  history = store.getListHistory(list.id);
  const beforeDelete = history.find((entry) => entry.label === 'Before deleting an item');
  assert.ok(beforeDelete, 'expected a version from before the delete');
  assert.equal(beforeDelete.itemCount, 1);
  assert.equal(beforeDelete.items[0].name, 'Milk');

  const restored = store.restoreListRevision(list.id, beforeDelete.id);
  assert.ok(restored);
  assert.equal(store.visibleItems(list).length, 1);
  assert.equal(store.visibleItems(list)[0].id, milk.id, 'restored rows keep their identity');
  assert.equal(list.name, 'Weekly shop');

  const undone = store.restoreListRevision(list.id, restored.undoRevisionId);
  assert.ok(undone);
  assert.equal(store.visibleItems(list).length, 0);

  // A version from before the rename brings the old name back too.
  const beforeRename = store
    .getListHistory(list.id)
    .find((entry) => entry.label === 'Before renaming the list');
  store.restoreListRevision(list.id, beforeRename.id);
  assert.equal(list.name, 'Groceries');

  await store.flush();

  // History is device-local and must not leak into backups.
  const backup = JSON.stringify(store.createBackup());
  assert.equal(backup.includes('rev_'), false);

  // A fresh start reads the saved versions back.
  const reloaded = await import('../js/store.js?history-test=1');
  await reloaded.init();
  assert.ok(reloaded.getListHistory(list.id).length > 0);
  assert.equal(reloaded.getActiveList().name, 'Groceries');

  console.log('history tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
