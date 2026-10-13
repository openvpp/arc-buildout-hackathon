'use client';

import { useId, useRef, useState } from 'react';

import { logger } from '@/lib/logger/logger';

import {
  canSuggestAddresses,
  suggestAddresses,
  type AddressSuggestion,
} from './client-api';

const SUGGEST_DEBOUNCE_MS = 250;

export type AddressValue = { query: string; unit: string };

/** Shown wherever an address is collected; keep wording in sync with docs. */
export function AddressPrivacyNote() {
  return (
    <p className="text-xs text-white/60">
      Your address stays anonymous. Only you can see it. On the public map your
      vehicle is shown at an approximate spot within 2 km of it, and it is never
      published on-chain.
    </p>
  );
}

/**
 * Street address with Mapbox suggestions plus an optional unit. Suggestions
 * only fill the text; the server geocodes whatever is submitted.
 */
export function AddressFields({
  value,
  onChange,
  disabled = false,
  required = false,
  showPrivacyNote = true,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  disabled?: boolean;
  required?: boolean;
  /** Off when the surrounding UI already shows the note. */
  showPrivacyNote?: boolean;
}) {
  const inputId = useId();
  const listId = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  function requestSuggestions(query: string) {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    inFlight.current?.abort();
    if (!canSuggestAddresses() || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    timer.current = setTimeout(() => {
      const controller = new AbortController();
      inFlight.current = controller;
      suggestAddresses(query, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) {
            setSuggestions(next);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            // Suggestions are a convenience; typing still works without them.
            logger.warn('address.suggest_failed', {
              errorName: error instanceof Error ? error.name : 'unknown',
            });
            setSuggestions([]);
          }
        });
    }, SUGGEST_DEBOUNCE_MS);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex flex-col gap-1 text-sm">
        <label htmlFor={inputId} className="font-medium text-white/80">
          Street address{required ? '' : ' (optional)'}
        </label>
        <input
          id={inputId}
          value={value.query}
          required={required}
          maxLength={300}
          autoComplete="street-address"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder="Start typing your street address"
          onChange={(event) => {
            onChange({ ...value, query: event.target.value });
            requestSuggestions(event.target.value);
          }}
          className="rounded-md border border-white/15 bg-black px-3 py-2 text-sm text-white placeholder:text-white/60 focus:border-primary-500 focus:outline-none"
        />
        {suggestions.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-md border border-white/15 bg-black shadow-lg"
          >
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                  onClick={() => {
                    onChange({ ...value, query: suggestion.label });
                    setSuggestions([]);
                  }}
                >
                  {suggestion.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-white/80">
          Unit / apartment (optional)
        </span>
        <input
          value={value.unit}
          maxLength={40}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...value, unit: event.target.value });
          }}
          className="rounded-md border border-white/15 bg-black px-3 py-2 text-sm text-white placeholder:text-white/60 focus:border-primary-500 focus:outline-none"
        />
      </label>
      {showPrivacyNote ? <AddressPrivacyNote /> : null}
    </div>
  );
}

/** Trimmed payload for the API, omitting an empty unit. */
export function toAddressPayload(value: AddressValue): {
  query: string;
  unit?: string;
} {
  const unit = value.unit.trim();
  return {
    query: value.query.trim(),
    ...(unit.length > 0 ? { unit } : {}),
  };
}
