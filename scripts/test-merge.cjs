const assert = require('node:assert/strict');

(async () => {
  const model = await import('../js/model.js');
  const { mergeStates, statesEqual } = await import('../js/merge.js');

  const CREATED = '2026-01-01T00:00:00.000Z';

  function makeState(overrides = {}) {
    return model.normalizeState({
      schemaVersion: 2,
      createdAt: CREATED,
      updatedAt: CREATED,
      lists: [
        {
          id: 'lst1',
          name: 'Groceries',
          storeKey: 'custom',
          createdAt: CREATED,
          updatedAt: CREATED,
          items: [],
        },
      ],
      recipes: [],
      plan: [],
      planTombstones: [],
      settings: {
        weekStart: 'sun',
        activeListId: 'lst1',
        theme: 'system',
        updatedAt: CREATED,
      },
      ...overrides,
    });
  }

  function item(id, name, qty, updatedAt) {
    return {
      id,
      name,
      qty,
      unit: '',
      aisle: 'Dairy',
      checked: false,
      note: null,
      sourceRecipeId: null,
      sourcePlanEntryId: null,
      planContributions: null,
      addedAt: CREATED,
      updatedAt,
      deletedAt: null,
    };
  }

  function plan(id, date, slot, title, updatedAt) {
    return {
      id,
      date,
      slot,
      recipeId: null,
      title,
      servings: 2,
      createdAt: CREATED,
      updatedAt,
    };
  }

  function tombstone(date, slot, deletedAt) {
    return { date, slot, deletedAt };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // Later item edit wins, while non-conflicting items from both phones survive.
  {
    const local = makeState();
    local.lists[0].items = [
      item('itm1', 'Milk', 1, '2026-01-02T00:00:00.000Z'),
      item('itm2', 'Eggs', 6, '2026-01-02T00:00:00.000Z'),
    ];
    local.updatedAt = '2026-01-02T00:00:00.000Z';

    const remote = clone(local);
    remote.lists[0].items = [
      item('itm1', 'Milk', 2, '2026-01-03T00:00:00.000Z'),
      item('itm3', 'Bread', 1, '2026-01-03T00:00:00.000Z'),
    ];
    remote.updatedAt = '2026-01-03T00:00:00.000Z';

    const merged = mergeStates(local, remote);
    const items = merged.lists[0].items;
    assert.equal(items.length, 3);
    assert.equal(items.find((entry) => entry.id === 'itm1').qty, 2);
    assert.equal(items.find((entry) => entry.id === 'itm2').name, 'Eggs');
    assert.equal(items.find((entry) => entry.id === 'itm3').name, 'Bread');
  }

  // A newer plan tombstone removes an older live meal.
  {
    const local = makeState({
      plan: [
        plan(
          'pln1',
          '2026-01-05',
          'dinner',
          'Tacos',
          '2026-01-02T00:00:00.000Z'
        ),
      ],
    });
    const remote = makeState({
      planTombstones: [
        tombstone('2026-01-05', 'dinner', '2026-01-03T00:00:00.000Z'),
      ],
    });

    const merged = mergeStates(local, remote);
    assert.equal(merged.plan.length, 0);
    assert.equal(merged.planTombstones.length, 1);
  }

  // A newer live meal revives a slot deleted earlier on the other phone.
  {
    const local = makeState({
      plan: [
        plan(
          'pln1',
          '2026-01-05',
          'dinner',
          'Tacos',
          '2026-01-04T00:00:00.000Z'
        ),
      ],
    });
    const remote = makeState({
      planTombstones: [
        tombstone('2026-01-05', 'dinner', '2026-01-03T00:00:00.000Z'),
      ],
    });

    const merged = mergeStates(local, remote);
    assert.equal(merged.plan.length, 1);
    assert.equal(merged.plan[0].title, 'Tacos');
    assert.equal(merged.planTombstones.length, 0);
  }

  // Newer list metadata wins, but both phones' items are unioned.
  {
    const local = makeState();
    local.lists[0].name = 'Home';
    local.lists[0].updatedAt = '2026-01-03T00:00:00.000Z';
    local.lists[0].items = [item('itm1', 'Milk', 1, '2026-01-03T00:00:00.000Z')];

    const remote = clone(local);
    remote.lists[0].name = 'Costco run';
    remote.lists[0].updatedAt = '2026-01-02T00:00:00.000Z';
    remote.lists[0].items = [item('itm2', 'Eggs', 6, '2026-01-02T00:00:00.000Z')];

    const merged = mergeStates(local, remote);
    assert.equal(merged.lists[0].name, 'Home');
    assert.equal(merged.lists[0].items.length, 2);
  }

  // Shared settings follow the newer settings object; device-local settings
  // stay with the phone that is applying the merge.
  {
    const local = makeState();
    local.settings.weekStart = 'sun';
    local.settings.theme = 'dark';
    local.settings.updatedAt = '2026-01-04T00:00:00.000Z';

    const remote = clone(local);
    remote.settings.weekStart = 'mon';
    remote.settings.theme = 'light';
    remote.settings.updatedAt = '2026-01-05T00:00:00.000Z';

    const merged = mergeStates(local, remote);
    assert.equal(merged.settings.weekStart, 'mon');
    assert.equal(merged.settings.theme, 'dark');
  }

  // A newer recipe deletion wins over an older live recipe.
  {
    const local = makeState({
      recipes: [
        {
          id: 'rcp1',
          title: 'Chili',
          category: 'Lunch/Dinner',
          servings: 4,
          ingredients: [],
          steps: [],
          notes: '',
          createdAt: CREATED,
          updatedAt: '2026-01-02T00:00:00.000Z',
          deletedAt: null,
        },
      ],
    });

    const remote = clone(local);
    remote.recipes[0].updatedAt = '2026-01-03T00:00:00.000Z';
    remote.recipes[0].deletedAt = '2026-01-03T00:00:00.000Z';

    const merged = mergeStates(local, remote);
    assert.equal(merged.recipes.length, 1);
    assert.equal(merged.recipes[0].deletedAt, '2026-01-03T00:00:00.000Z');
  }

  // Equal timestamps resolve identically regardless of merge direction.
  {
    const local = makeState();
    local.lists[0].items = [item('itm1', 'Milk', 1, '2026-01-02T00:00:00.000Z')];

    const remote = clone(local);
    remote.lists[0].items[0].qty = 2;

    const mergedAB = mergeStates(local, remote);
    const mergedBA = mergeStates(remote, local);
    assert.ok(statesEqual(mergedAB, mergedBA));
    assert.equal(mergedAB.lists[0].items[0].qty, 2);
  }

  // The merge is idempotent and stable for serialization equality.
  {
    const local = makeState();
    local.lists[0].items = [item('itm1', 'Milk', 1, '2026-01-02T00:00:00.000Z')];
    const remote = makeState();
    remote.lists[0].items = [item('itm2', 'Eggs', 6, '2026-01-02T00:00:00.000Z')];

    const first = mergeStates(local, remote);
    const second = mergeStates(first, first);
    assert.ok(statesEqual(first, second));
    assert.ok(statesEqual(first, clone(first)));
  }

  console.log('merge tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
