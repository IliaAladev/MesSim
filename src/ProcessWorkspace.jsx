import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function ProcessWorkspace({ title, onClose, children }) {
  const root = useRef(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.focus();
    const keydown = (event) => {
      // Confirmation dialogs own the keyboard while they are open.
      if (document.querySelector('.modal-backdrop')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const elements = [
        ...root.current.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
      const first = elements[0],
        last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === root.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !root.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div className="process-workspace-backdrop">
      <section
        ref={root}
        tabIndex={-1}
        className="process-workspace"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}
