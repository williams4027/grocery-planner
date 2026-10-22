/* Meal plan — layout preview until Phase 4. */

export function mount(root) {
  const days = [
    ['Mon', 'Sheet-pan chicken', true],
    ['Tue', '', false],
    ['Wed', '', false],
    ['Thu', 'Tacos', true],
    ['Fri', '', false],
    ['Sat', '', false],
    ['Sun', '', false],
  ];

  const rows = days
    .map(
      ([day, meal, filled]) => `
        <div class="week__day">
          <span class="week__label">${day}</span>
          <div class="week__slot${filled ? ' is-filled' : ''}">
            ${meal || 'No dinner planned'}
          </div>
        </div>`
    )
    .join('');

  root.innerHTML = `
    <h1 class="page-title">Meal plan</h1>
    <p class="lede">Line up the week&rsquo;s dinners, then turn them into a shopping list in one tap.</p>

    <section class="card" aria-labelledby="week-title">
      <div class="card__head">
        <h2 id="week-title">This week</h2>
        <span class="badge">Preview</span>
      </div>
      <div class="week">${rows}</div>
      <p class="card__note">Planning arrives in Phase 4. The layout is here so we can see it on a real phone early.</p>
    </section>
  `;
}
