/**
 * Name off a possibly-populated Mongo reference.
 *
 * A ref can arrive three ways: populated, an unpopulated id string, or NULL
 * when the row it pointed at is gone. `typeof null === 'object'`, so the
 * obvious `typeof ref === 'object' ? ref.name : fallback` reads `.name` off
 * null and takes the whole screen down.
 */
export function refName(
  ref: { name?: string } | string | null | undefined,
  fallback = 'Patient',
): string {
  return (ref && typeof ref === 'object' ? ref.name : '') || fallback
}
