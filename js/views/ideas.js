/* Ideas — free-form notes for meals to plan in future weeks. */

import * as store from '../store.js';

const SAVE_DELAY_MS = 500;

function wordCount(text) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length;
}

export function mount(root) {
  let saveTimer = null;

  root.innerHTML = `
    <header class="page-head">
      <div class="page-head__text">
        <h1 class="page-title">Ideas</h1>
        <p class="list-count">Meals for future weeks</p>
      </div>
    </header>

    <p class="lede">
      Jot down dinners, snacks, or recipes you want to remember. This page is just for notes;
      nothing here is added to your grocery list.
    </p>

    <section class="card ideas-card" aria-labelledby="ideas-title">
      <h2 id="ideas-title" class="sr-only">Meal ideas</h2>
      <label class="sr-only" for="ideas-text">Meal ideas notes</label>
      <textarea
        id="ideas-text"
        class="ideas-text"
        placeholder="Meals to try, links to save, or a rough plan for next week…"
        autocapitalize="sentences"
        spellcheck="true"
      ></textarea>
      <div class="ideas-foot">
        <span id="ideas-status" class="ideas-status" role="status" aria-live="polite">
          Saved automatically
        </span>
        <span id="ideas-count" class="ideas-count"></span>
      </div>
    </section>
  `;

  const textarea = root.querySelector('#ideas-text');
  const status = root.querySelector('#ideas-status');
  const count = root.querySelector('#ideas-count');

  function updateCount() {
    const words = wordCount(textarea.value);
    count.textContent = words ? `${words} ${words === 1 ? 'word' : 'words'}` : '';
  }

  function save() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    store.setIdeas(textarea.value);
    status.textContent = 'Saved automatically';
    updateCount();
  }

  function scheduleSave() {
    status.textContent = 'Saving…';
    updateCount();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  textarea.value = store.getIdeas().text;
  updateCount();

  textarea.addEventListener('input', scheduleSave);
  textarea.addEventListener('blur', save);

  return () => {
    if (saveTimer) save();
  };
}
