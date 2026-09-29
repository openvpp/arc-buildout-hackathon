'use client';

import { useState } from 'react';

/**
 * "Add vehicle" popup — starts an Enode Link session for the current
 * wallet. Modeled on CircleAuthModal's styling/backdrop pattern so the two
 * popups feel like one design language. Submitting redirects the whole page
 * to Enode's OAuth flow (`window.location.href`), so there is no in-modal
 * loading state beyond the initial "Starting…" while the link session is
 * created server-side.
 */
export function DeviceOnboardModal({
  open,
  onClose,
  isSubmitting,
  error,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (brand: string) => void;
}) {
  const [brand, setBrand] = useState('');

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[20px] border border-modalborder bg-modalbg p-6"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Add vehicle</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-white/70 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className="mb-6 text-white/50">
          Connect an EV through Enode Link. You will be redirected to your
          vehicle brand&apos;s login, then back here to finish.
        </p>

        {error !== null ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-500 bg-red-500/20 p-3 text-sm text-red-400"
          >
            {error}
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(brand);
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-white/80">
              Brand / vendor (optional)
            </span>
            <input
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
              }}
              placeholder="TESLA"
              disabled={isSubmitting}
              className="rounded-lg border border-white/15 bg-black px-4 py-3 text-white placeholder:text-white/40 focus:border-primary-500 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center justify-center gap-3 rounded-lg bg-primary-500 px-4 py-3 font-medium text-black transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Starting…' : 'Connect with Enode'}
          </button>
        </form>
      </div>
    </div>
  );
}
