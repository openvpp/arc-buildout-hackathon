'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-reads the server page while a mint is still in flight. */
export function RefreshWhilePending({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => {
      router.refresh();
    }, 8_000);
    return () => {
      clearInterval(timer);
    };
  }, [active, router]);
  return null;
}
