'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api/client';

import {
  AddressFields,
  toAddressPayload,
  type AddressValue,
} from './address-fields';
import { createLocationApi } from './client-api';

/** Owner-only add/change address form for a device page. */
export function DeviceAddressEditor({
  deviceId,
  hasAddress,
  currentUnit,
}: {
  deviceId: string;
  hasAddress: boolean;
  currentUnit: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!hasAddress);
  const [value, setValue] = useState<AddressValue>({
    query: '',
    unit: currentUnit ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setEditing(true);
          }}
        >
          Change address
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            await createLocationApi().setDeviceAddress(
              deviceId,
              toAddressPayload(value),
            );
            setEditing(false);
            setValue({ query: '', unit: value.unit });
            router.refresh();
          } catch (e) {
            setError(
              e instanceof ApiRequestError
                ? e.message
                : 'Could not save the address. Try again.',
            );
          }
        });
      }}
    >
      <AddressFields
        value={value}
        onChange={setValue}
        disabled={pending}
        required
        showPrivacyNote={!hasAddress}
      />
      {error !== null ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending || value.query.trim().length < 5}
        >
          {pending ? 'Saving…' : 'Save address'}
        </Button>
        {hasAddress ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
