export function pinColorForMintStatus(mintStatus: string): string {
  switch (mintStatus) {
    case 'minted':
      return '#10b981'; // emerald-500
    case 'pending':
      return '#f59e0b'; // amber-500
    case 'failed':
      return '#ef4444'; // red-500
    default:
      return '#94a3b8'; // slate-400
  }
}
