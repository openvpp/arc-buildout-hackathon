'use client';

import { useEffect, useState } from 'react';

import { Modal } from '@/components/ui/modal';

import type { PasswordSignInIntent } from './session-api';

const inputClassName =
  'rounded-lg border border-white/15 bg-black px-4 py-3 text-white placeholder:text-white/60 focus:border-primary-500 focus:outline-none';

/**
 * Sign-up and sign-in popup for the Circle developer-controlled wallet.
 * Email plus password is checked server-side. A wallet address is not
 * accepted.
 */
export function CircleAuthModal({
  open,
  onClose,
  isSubmitting,
  sessionError,
  onPasswordSubmit,
}: {
  open: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  sessionError: string | null;
  onPasswordSubmit: (input: {
    email: string;
    password: string;
    intent: PasswordSignInIntent;
  }) => void;
}) {
  const [intent, setIntent] = useState<PasswordSignInIntent>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const displayedError = localError ?? sessionError;
  const creating = intent === 'register';

  useEffect(() => {
    if (open) {
      return;
    }
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setLocalError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      title="Connect Wallet"
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <p className="mb-6 text-white/70">
        {creating
          ? 'Create an account to open your Circle wallet and connect a device.'
          : 'Sign in to open the Circle wallet for this account.'}
      </p>

      {displayedError !== null ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-500 bg-red-500/20 p-3 text-sm text-red-300"
        >
          {displayedError}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedEmail = email.trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            setLocalError('Enter a valid email address.');
            return;
          }
          if (password.length < 8 || password.length > 128) {
            setLocalError('Password must be 8 to 128 characters.');
            return;
          }
          if (creating && password !== confirmPassword) {
            setLocalError('Passwords do not match.');
            return;
          }
          setLocalError(null);
          onPasswordSubmit({
            email: trimmedEmail,
            password,
            intent,
          });
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-white/80">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            maxLength={320}
            required
            disabled={isSubmitting}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            className={inputClassName}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-white/80">Password</span>
          <input
            type="password"
            name="password"
            autoComplete={creating ? 'new-password' : 'current-password'}
            value={password}
            maxLength={128}
            required
            disabled={isSubmitting}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            className={inputClassName}
          />
        </label>
        {creating ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-white/80">Confirm password</span>
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              maxLength={128}
              required
              disabled={isSubmitting}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
              }}
              className={inputClassName}
            />
          </label>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center justify-center rounded-lg bg-primary-500 px-4 py-3 font-medium text-black transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Working…' : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => {
          setIntent(creating ? 'login' : 'register');
          setLocalError(null);
          setConfirmPassword('');
        }}
        className="mt-4 text-sm text-white/70 hover:text-white disabled:opacity-50"
      >
        {creating
          ? 'Already have an account? Sign in'
          : 'Need an account? Create one'}
      </button>
    </Modal>
  );
}
