'use client';

import { Button } from '@/components/ui/button';

import type { ThemePreference } from './theme';
import { useTheme } from './theme-provider';

const OPTIONS: readonly {
  readonly value: ThemePreference;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Always use the light appearance.',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Always use the dark appearance.',
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow your operating system setting.',
  },
];

/**
 * Appearance control for /settings. Client-only — reads/writes theme preference.
 */
export function ThemePreferenceControl() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Appearance
      </legend>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Choose light, dark, or match your device. Current effective theme:{' '}
        <span className="font-medium text-slate-800 dark:text-slate-200">
          {resolved}
        </span>
        .
      </p>
      <div
        role="radiogroup"
        aria-label="Theme preference"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      >
        {OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              variant={selected ? 'primary' : 'secondary'}
              className="justify-start px-3 py-2 text-left text-sm sm:min-w-40"
              onClick={() => {
                setPreference(option.value);
              }}
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{option.label}</span>
                <span
                  className={
                    selected
                      ? 'text-[11px] font-normal text-slate-200 dark:text-slate-700'
                      : 'text-[11px] font-normal text-slate-500 dark:text-slate-400'
                  }
                >
                  {option.description}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}
