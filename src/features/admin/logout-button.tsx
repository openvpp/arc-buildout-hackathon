'use client';

import { Button } from '@/components/ui/button';

const ADMIN_LOGOUT_PATH = '/admin/logout';

/**
 * Header control to leave the Basic Auth admin session (matches dashboard
 * Disconnect placement/style). Navigates to /admin/logout, which returns 401
 * without a re-prompt and redirects to the dashboard.
 */
export function AdminLogoutButton() {
  return (
    <Button
      type="button"
      variant="secondary"
      className="px-2 py-1 text-xs"
      onClick={() => {
        window.location.assign(ADMIN_LOGOUT_PATH);
      }}
    >
      Log out
    </Button>
  );
}
