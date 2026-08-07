import type { ReactNode } from 'react';

/**
 * Admin route group root. Auth shell lives under admin/(protected).
 */
export default function AdminGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
