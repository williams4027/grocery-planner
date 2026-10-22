/* Shared bottom-sheet controller for native <dialog> elements. */

const openDialogs = new Set();
const viewport = typeof window !== 'undefined' ? window.visualViewport : null;

function syncSheetLock() {
  document.body.classList.toggle('sheet-open', openDialogs.size > 0);
}

function syncViewportGap() {
  if (!viewport) return;

  const gap = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  for (const dialog of openDialogs) {
    dialog.style.setProperty('--keyboard-gap', `${Math.round(gap)}px`);
  }
}

if (viewport) {
  viewport.addEventListener('resize', syncViewportGap);
  viewport.addEventListener('scroll', syncViewportGap);
}

function resolveTarget(value) {
  return typeof value === 'function' ? value() : value;
}

export function createSheetController(dialog, options = {}) {
  const { trigger, initialFocus, selectOnOpen = false, onOpen, onClose } = options;
  let finalized = true;

  function focusTrigger() {
    const target = resolveTarget(trigger);
    if (target && target.isConnected) target.focus({ preventScroll: true });
  }

  function finalize() {
    if (finalized) return;

    finalized = true;
    openDialogs.delete(dialog);
    dialog.style.removeProperty('--keyboard-gap');
    syncSheetLock();
    if (onClose) onClose();

    // Let the native dialog finish restoring focus first, then put it where
    // this view wants it (for example, the newly active list chip).
    setTimeout(focusTrigger, 0);
  }

  function open() {
    if (dialog.open) return;

    dialog.showModal();
    finalized = false;
    openDialogs.add(dialog);
    syncSheetLock();
    syncViewportGap();
    if (onOpen) onOpen();

    const focusInitial = () => {
      const target = resolveTarget(initialFocus);
      if (!target) return;
      target.focus({ preventScroll: true });
      if (selectOnOpen && typeof target.select === 'function') target.select();
    };

    focusInitial();
    requestAnimationFrame(focusInitial);
  }

  function close() {
    if (dialog.open) dialog.close();
    finalize();
  }

  function destroy() {
    finalized = true;
    if (dialog.open) dialog.close();
    openDialogs.delete(dialog);
    dialog.style.removeProperty('--keyboard-gap');
    syncSheetLock();
  }

  dialog.addEventListener('close', finalize);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    // Clicks on buttons and fields bubble here. Only a click that lands on
    // the dialog itself can be a backdrop click; this also keeps keyboard
    // activation (whose synthetic click is at 0,0) from closing the sheet.
    if (event.target !== dialog) return;

    const rect = dialog.getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (outside) close();
  });

  return { open, close, destroy, isOpen: () => dialog.open };
}
