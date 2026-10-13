export function mintStatusTone(
  status: string,
): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'minted':
      return 'success';
    case 'pending':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function truncateHash(hash: string, head = 8, tail = 6): string {
  if (hash.length <= head + tail) {
    return hash;
  }
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/**
 * Rendered on the server, so the time zone is the server's (UTC in
 * production). Always label it rather than imply the viewer's local time.
 */
export function formatTimestamp(date: Date): string {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}
