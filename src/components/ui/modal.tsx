'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Shared dialog chrome for the sign-in and add-vehicle popups. Closes on
 * Escape and backdrop click, and moves focus into the dialog while open.
 */
export function Modal({
  open,
  title,
  onClose,
  closeDisabled = false,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    const focusable =
      panel?.querySelector<HTMLElement>('input, select, textarea') ??
      panel?.querySelector<HTMLElement>('button, a[href]');
    (focusable ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !closeDisabled) {
        onCloseRef.current();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, closeDisabled]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!closeDisabled) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md rounded-[20px] border border-modalborder bg-modalbg p-6 outline-none"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id={titleId} className="text-2xl font-bold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            className="text-white/70 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
