'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { createOnboardingApi } from '@/features/onboarding/client-api';

export default function DeviceOnboardPage() {
  const [brand, setBrand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const api = createOnboardingApi();
        const data = await api.startLink(
          brand.trim().length > 0 ? { brand: brand.trim() } : {},
        );
        window.location.href = data.linkUrl;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unexpected error');
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add vehicle"
        description="Connect an EV through Enode Link."
      />
      <Card>
        <CardTitle>Enode vehicle link</CardTitle>
        <CardDescription>
          You will be redirected to your vehicle brand&apos;s login, then back
          here to finish.
        </CardDescription>

        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-800">
              Brand / vendor (optional)
            </span>
            <input
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
              }}
              placeholder="TESLA"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>

          {error !== null ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Starting…' : 'Connect with Enode'}
            </Button>
            <Link
              href="/devices"
              className="inline-flex items-center px-3.5 py-2 text-sm text-slate-600 underline"
            >
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
