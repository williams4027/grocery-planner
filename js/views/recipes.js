/* Recipes — empty state until Phase 3. */

import { ICONS } from '../ui.js';

export function mount(root) {
  root.innerHTML = `
    <h1 class="page-title">Recipes</h1>
    <p class="lede">Keep the handful of meals you actually cook, with ingredients ready to add to a list.</p>

    <section class="card empty">
      <div class="empty__icon">${ICONS.recipes}</div>
      <h2>No recipes yet</h2>
      <p>Recipe capture lands in Phase 3, after the list and backup basics are solid.</p>
    </section>
  `;
}
