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

export function formatTimestamp(date: Date): string {
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
