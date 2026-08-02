/**
 * Exhaustiveness helper for discriminated unions and `switch` statements.
 *
 * Call in the `default` branch: if every case is handled, `value` narrows to
 * `never` and this compiles. If a case is missed, TypeScript errors at build
 * time. At runtime (should be unreachable) it throws with the offending value.
 *
 * @example
 * switch (result.status) {
 *   case 'verified': return renderVerified(result);
 *   case 'failed': return renderFailed(result);
 *   // ...
 *   default: return assertNever(result);
 * }
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(
    message ?? `Unexpected value did not match any case: ${String(value)}`,
  );
}
