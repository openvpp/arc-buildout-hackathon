'use client';

import { Button } from '@/components/ui/button';

const ADMIN_LOGOUT_PATH = '/admin/logout';

/**
 * Header control to clear the admin session cookie and return to the login form.
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
