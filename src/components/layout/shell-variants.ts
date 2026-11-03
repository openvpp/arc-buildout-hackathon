/**
 * The two looks of one shared shell: the product (black, lime accent) and
 * the internal admin console (slate). Same structure, different palette.
 */
export const SHELL_VARIANTS = {
  app: {
    page: 'min-h-dvh bg-background text-white',
    header: 'border-b border-white/10 bg-itemground',
    brand: 'text-sm font-bold tracking-tight text-primary-500',
    skip: 'focus:bg-itemground',
    navActive: 'bg-primary-500/15 font-medium text-primary-400',
    navIdle: 'text-white/60 hover:bg-white/5 hover:text-white',
  },
  admin: {
    page: 'min-h-dvh bg-slate-950 text-slate-100',
    header: 'border-b border-slate-800 bg-slate-900',
    brand: 'text-sm font-semibold tracking-tight',
    skip: 'focus:bg-slate-900',
    navActive: 'bg-slate-800 font-medium text-white',
    navIdle: 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
  },
} as const;

export type ShellVariant = keyof typeof SHELL_VARIANTS;
