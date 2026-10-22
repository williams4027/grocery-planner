/* Tiny DOM helpers and shared chrome (icons, toast). */

export const ICONS = {
  check: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>`,
  trash: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M6.5 7l.8 12.1A1.9 1.9 0 0 0 9.2 21h5.6a1.9 1.9 0 0 0 1.9-1.9L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>`,
  list: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 6.5h2.2l1.9 9.2h9.6l2-6.9H7.2" />
      <circle cx="10" cy="19.2" r="1.4" />
      <circle cx="17" cy="19.2" r="1.4" />
    </svg>`,
  recipes: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" />
      <path d="M8.5 8.5h5M8.5 12h5M8.5 15.5h3" />
    </svg>`,
  plus: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>`,
  close: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>`,
  calendar: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>`,
  pencil: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m4.5 19.5 4.2-1 9.9-9.9a2.1 2.1 0 0 0-3-3L5.7 15.5l-1.2 4Z" />
      <path d="m13.8 7.4 3 3" />
    </svg>`,
  chevron: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 5 7 7-7 7" />
    </svg>`,
  ellipsis: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>`,
};

/** Creates an element. Children may be nodes, strings, arrays, or null. */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key === 'on' && typeof value === 'object') {
      for (const [event, handler] of Object.entries(value)) {
        element.addEventListener(event, handler);
      }
    } else if (key in element) element[key] = value;
    else element.setAttribute(key, value);
  }

  appendChildren(element, children);
  return element;
}

function appendChildren(element, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(element, child);
    else if (child instanceof Node) element.append(child);
    else element.append(document.createTextNode(String(child)));
  }
}

/** Returns a fresh instance of a static inline SVG icon. */
export function icon(name) {
  const template = document.createElement('template');
  template.innerHTML = (ICONS[name] || '').trim();
  return template.content.firstElementChild;
}

/** Quantity + unit, e.g. "2 lb". Empty string when neither is set. */
export function formatQuantity(item) {
  const parts = [];
  if (item && item.qty !== null && item.qty !== undefined) parts.push(String(item.qty));
  if (item && item.unit) parts.push(item.unit);
  return parts.join(' ');
}

let toastTimer = null;

function hideToast() {
  const toast = document.getElementById('toast');
  if (!toast) return;

  clearTimeout(toastTimer);
  toastTimer = null;
  toast.hidden = true;
  toast.replaceChildren();
}

/**
 * Shows a transient message. An optional action (for example Undo) keeps the
 * toast visible longer and invokes onAction when tapped.
 */
export function showToast(message, options = 2400) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  const config =
    typeof options === 'number' ? { duration: options } : { duration: 2400, ...options };
  const hasAction =
    typeof config.actionLabel === 'string' &&
    config.actionLabel &&
    typeof config.onAction === 'function';

  clearTimeout(toastTimer);
  toastTimer = null;
  toast.replaceChildren(document.createTextNode(String(message)));

  if (hasAction) {
    const action = document.createElement('button');
    action.className = 'toast__action';
    action.type = 'button';
    action.textContent = config.actionLabel;
    action.addEventListener(
      'click',
      () => {
        hideToast();
        config.onAction();
      },
      { once: true }
    );
    toast.append(action);
  }

  toast.hidden = false;
  toastTimer = setTimeout(hideToast, hasAction ? Math.max(config.duration, 5000) : config.duration);
}
