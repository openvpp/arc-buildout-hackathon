import type { ReactNode } from 'react';

import { EXTERNAL_LINK_REL, parseSafeExternalUrl } from '@/lib/utils/url';

/**
 * Renders an external link only if the href is a safe `http(s)` URL. Unsafe or
 * malformed URLs (e.g. `javascript:`) fall back to plain text — an untrusted
 * transaction/anchor URL from an API is never blindly turned into a live link.
 * Always applies safe `rel` and `target="_blank"`.
 */
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const safeUrl = parseSafeExternalUrl(href);

  if (!safeUrl) {
    return (
      <span className={className} title="Link unavailable (invalid URL)">
        {children}
      </span>
    );
  }

  return (
    <a
      href={safeUrl.toString()}
      target="_blank"
      rel={EXTERNAL_LINK_REL}
      className={className}
    >
      {children}
    </a>
  );
}
