export interface GeoFix {
  lat: number
  lng: number
  accuracyM?: number
}

export type GeoState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ready'; fix: GeoFix }
  | { status: 'unavailable'; reason: string }

/**
 * Never rejects. A denied or timed-out fix is a normal outcome here: the server
 * stamps the worker's assigned area instead, so filing must never be blocked.
 *
 * navigator.geolocation needs a secure context. localhost is fine, but
 * http://192.168.x.x - exactly how you would demo on a phone - silently fails
 * and lands in `unavailable`.
 */
export function getFix(): Promise<GeoState> {
  if (!('geolocation' in navigator)) {
    return Promise.resolve({
      status: 'unavailable',
      reason: 'This browser cannot share a location',
    })
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          status: 'ready',
          fix: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: Number.isFinite(pos.coords.accuracy)
              ? Math.round(pos.coords.accuracy)
              : undefined,
          },
        }),
      (err) => resolve({ status: 'unavailable', reason: REASONS[err.code] ?? err.message }),
      // The worker is standing in the village while they file, so a cached fix
      // from the last few minutes is genuinely the right location.
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300_000 },
    )
  })
}

const REASONS: Record<number, string> = {
  1: 'Location permission was denied',
  2: 'Location is unavailable right now',
  3: 'Location took too long to arrive',
}
