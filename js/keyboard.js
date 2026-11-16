/* Keyboard dismissal — hide the on-screen keyboard when the user scrolls or
 * taps somewhere other than the field they are typing in. */

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function isTextEntry(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName !== 'INPUT') return false;
  const type = (target.getAttribute('type') || 'text').toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}

function focusedTextEntry() {
  const active = document.activeElement;
  return isTextEntry(active) ? active : null;
}

function dismiss() {
  const active = focusedTextEntry();
  if (active) active.blur();
}

export function initKeyboardDismissal() {
  let touchStartedInField = false;

  document.addEventListener(
    'touchstart',
    (event) => {
      touchStartedInField = isTextEntry(event.target);
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'touchmove',
    () => {
      // A drag that starts inside the field is probably text selection, not a
      // scroll, so leave the keyboard alone.
      if (!touchStartedInField) dismiss();
    },
    { capture: true, passive: true }
  );

  document.addEventListener('wheel', dismiss, { capture: true, passive: true });

  // Dismiss on the next tap that is not inside a text field. Using capture
  // means the blur happens before the tapped control handles the click.
  document.addEventListener(
    'click',
    (event) => {
      if (!focusedTextEntry()) return;
      if (isTextEntry(event.target)) return;
      dismiss();
    },
    { capture: true }
  );
}
