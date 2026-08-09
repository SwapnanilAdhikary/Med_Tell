import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { api } from '../../api/client'
import type {
  Facility,
  FieldReport,
  HealthWorker,
  PublicFacilityResult,
} from '../../api/types'
import { PIN_COLOR, URGENCIES, ageLabel, subjectName } from './labels'
import { CaptureSheet, type PickedPoint } from './CaptureSheet'
import { getFix } from '../../api/geo'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

function plottable(reports: FieldReport[]) {
  return reports.filter((r) => r.location.point?.coordinates?.length === 2)
}

/** A tabbable, activatable pin - a bare <div> marker is invisible to a keyboard. */
function pinElement(report: FieldReport, onOpen: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'map-pin'
  el.style.background = PIN_COLOR[report.extraction.urgency ?? 'routine']
  if (report.location.source !== 'gps') el.classList.add('map-pin-assigned')
  el.setAttribute(
    'aria-label',
    `${subjectName(report)}, ${report.extraction.urgency ?? 'routine'}. Open report.`,
  )
  el.addEventListener('click', onOpen)
  return el
}

function popupHtml(report: FieldReport): string {
  const e = report.extraction
  const escape = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `
    <div class="map-popup">
      <strong>${escape(subjectName(report))}</strong>
      ${e.ageMonths != null ? `<div>${escape(ageLabel(e.ageMonths))}</div>` : ''}
      ${e.symptoms.length ? `<div>${escape(e.symptoms.join(', '))}</div>` : ''}
      <div>${escape(e.urgency ?? 'routine')} · ${escape(report.location.source === 'gps' ? 'GPS' : 'assigned area')}</div>
    </div>`
}

function Legend({ counts }: { counts: Record<string, number> }) {
  return (
    <ul className="map-legend" aria-label="Pin colours by urgency">
      {URGENCIES.map((u) => (
        <li key={u.value}>
          <span className="map-legend-dot" style={{ background: PIN_COLOR[u.value] }} />
          {u.label}
          <span className="map-legend-count">{counts[u.value] ?? 0}</span>
        </li>
      ))}
      <li>
        <span className="map-legend-dot map-legend-facility" />
        Health facility
      </li>
    </ul>
  )
}

/**
 * A labelled square, so a facility never reads as a report and cannot be lost
 * under one: a report pin sits within metres of PHC Beldanga, and a bare dot
 * simply vanished beneath it.
 */
function facilityElement(label: string, verified: boolean): HTMLElement {
  const el = document.createElement('span')
  el.className = verified ? 'map-facility map-facility-verified' : 'map-facility'
  el.title = label
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', `${label}${verified ? ', verified facility' : ''}`)

  const dot = document.createElement('span')
  dot.className = 'map-facility-dot'
  const text = document.createElement('span')
  text.className = 'map-facility-label'
  text.textContent = label
  el.append(dot, text)
  return el
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function FieldMap() {
  const navigate = useNavigate()
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markers = useRef<mapboxgl.Marker[]>([])

  const [reports, setReports] = useState<FieldReport[] | null>(null)
  const [worker, setWorker] = useState<HealthWorker | null>(null)
  const [seeded, setSeeded] = useState<Facility[]>([])
  const [osm, setOsm] = useState<PublicFacilityResult | null>(null)
  const [point, setPoint] = useState<PickedPoint | null>(null)
  const [ready, setReady] = useState(false)
  const [showFacilities, setShowFacilities] = useState(true)
  const [showReports, setShowReports] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, me, facilities] = await Promise.all([
        api<FieldReport[]>('/api/field-reports/mine'),
        api<HealthWorker>('/api/health-workers/me'),
        api<Facility[]>('/api/facilities'),
      ])
      setReports(list)
      setWorker(me)
      setSeeded(facilities)
      setError('')

      // OpenStreetMap is a shared free service and can be slow, so it loads
      // after the screen is already usable and never blocks it.
      const centre = me.coordinates?.length === 2 ? me.coordinates : null
      if (centre) {
        api<PublicFacilityResult>(
          `/api/facilities/nearby?lat=${centre[1]}&lng=${centre[0]}`,
        )
          .then(setOsm)
          .catch(() =>
            setOsm({ facilities: [], status: 'unavailable', radiusM: 15_000 }),
          )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the map data')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const useMyLocation = async () => {
    const fix = await getFix()
    if (fix.status === 'ready') {
      setPoint({ ...fix.fix, picked: false, label: 'Your location' })
    } else if (fix.status === 'unavailable') {
      setError(fix.reason)
    }
  }

  const pins = useMemo(() => plottable(reports ?? []), [reports])
  const counts = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const r of pins) {
      const key = r.extraction.urgency ?? 'routine'
      acc[key] = (acc[key] ?? 0) + 1
    }
    return acc
  }, [pins])

  // Create the map once, then keep markers in step with the data.
  useEffect(() => {
    if (!TOKEN || !container.current || map.current || !worker) return
    mapboxgl.accessToken = TOKEN
    setReady(false)
    map.current = new mapboxgl.Map({
      container: container.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: (worker.coordinates?.length === 2
        ? worker.coordinates
        : [88.25, 23.93]) as [number, number],
      zoom: 11,
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.current.addControl(
      new mapboxgl.GeolocateControl({ trackUserLocation: false }),
      'top-right',
    )
    // Tap anywhere to act on that spot. This is the point of the screen.
    map.current.on('click', (e) =>
      setPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng, picked: true }),
    )
    // `ready` is state, not a ref: the marker effects below must re-run once the
    // map exists, and a ref assignment does not trigger that.
    map.current.on('load', () => setReady(true))
    return () => {
      map.current?.remove()
      map.current = null
      setReady(false)
    }
  }, [worker])

  // Facility layers, kept separate from the report markers so a data refresh of
  // one does not tear down the other.
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready || !showFacilities) return
    const placed: mapboxgl.Marker[] = []

    for (const f of seeded) {
      const coords = f.location?.coordinates
      if (coords?.length !== 2) continue
      placed.push(
        new mapboxgl.Marker({ element: facilityElement(f.name, true) })
          .setLngLat(coords as [number, number])
          .setPopup(
            new mapboxgl.Popup({ offset: 12 }).setHTML(
              `<div class="map-popup"><strong>${escapeHtml(f.name)}</strong><div>${escapeHtml(f.type)} · verified</div>${f.phone ? `<div>${escapeHtml(f.phone)}</div>` : ''}</div>`,
            ),
          )
          .addTo(instance),
      )
    }

    for (const f of osm?.facilities ?? []) {
      placed.push(
        new mapboxgl.Marker({ element: facilityElement(f.name, false) })
          .setLngLat([f.lng, f.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 12 }).setHTML(
              `<div class="map-popup"><strong>${escapeHtml(f.name)}</strong><div>${escapeHtml(f.kind)} · OpenStreetMap, unverified</div>${f.phone ? `<div>${escapeHtml(f.phone)}</div>` : ''}</div>`,
            ),
          )
          .addTo(instance),
      )
    }

    return () => placed.forEach((m) => m.remove())
  }, [seeded, osm, ready, showFacilities])

  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return

    // No manual clear needed: the cleanup below runs before this body re-runs.
    markers.current = showReports
      ? pins.map((report) => {
          const [lng, lat] = report.location.point!.coordinates
          return new mapboxgl.Marker({
            element: pinElement(report, () => navigate(`/field/reports/${report._id}`)),
          })
            .setLngLat([lng, lat])
            .setPopup(new mapboxgl.Popup({ offset: 14 }).setHTML(popupHtml(report)))
            .addTo(instance)
        })
      : []

    return () => markers.current.forEach((m) => m.remove())
  }, [pins, navigate, ready, showReports])

  /**
   * Fit over reports AND facilities. Fitting reports alone parked the camera on
   * one village and left the CHC and district hospital 19 km off-screen.
   */
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return

    const all: Array<[number, number]> = [
      ...pins.map((r) => r.location.point!.coordinates as [number, number]),
      ...seeded
        .filter((f) => f.location?.coordinates?.length === 2)
        .map((f) => f.location!.coordinates as [number, number]),
    ]
    if (all.length === 0) return
    if (all.length === 1) {
      instance.setCenter(all[0])
      instance.setZoom(13)
      return
    }
    const bounds = new mapboxgl.LngLatBounds()
    all.forEach((c) => bounds.extend(c))
    instance.fitBounds(bounds, { padding: 72, maxZoom: 13, duration: 0 })
  }, [pins, seeded, ready])

  const unplotted = (reports?.length ?? 0) - pins.length

  return (
    <div className="content">
      <div className="card">
        <div className="notes-head">
          <div>
            <h2 className="card-title">
              {TOKEN ? 'Tap the map to start' : 'Start a report'}
            </h2>
            <div className="card-sub">
              {worker?.village
                ? `Your area is ${worker.village}${worker.district ? `, ${worker.district}` : ''}.`
                : 'Pick a place, then choose how to capture it.'}
              {TOKEN ? ' Tap anywhere to note, record or file a report there.' : ''}
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={useMyLocation}>
            Use my location
          </button>
        </div>
        {reports && <Legend counts={counts} />}
        {TOKEN && (
          <div className="layer-toggles">
            <button
              type="button"
              className={`chip${showReports ? ' is-on' : ''}`}
              aria-pressed={showReports}
              onClick={() => setShowReports((v) => !v)}
            >
              Reports ({pins.length})
            </button>
            <button
              type="button"
              className={`chip${showFacilities ? ' is-on' : ''}`}
              aria-pressed={showFacilities}
              onClick={() => setShowFacilities((v) => !v)}
            >
              Facilities ({seeded.length + (osm?.facilities.length ?? 0)})
            </button>
          </div>
        )}
        {/* Never a silent zero: say which kind of zero it is. */}
        <div className="field-hint" style={{ marginTop: 10 }} role="status">
          {seeded.length} verified {seeded.length === 1 ? 'facility' : 'facilities'}
          {!osm && ' · checking OpenStreetMap…'}
          {osm?.status === 'unavailable' &&
            ' · OpenStreetMap could not be reached, so community facilities are missing'}
          {osm?.status === 'ok' &&
            ` · ${osm.facilities.length} from OpenStreetMap within ${osm.radiusM / 1000} km${
              osm.facilities.length === 0 ? ' (nobody has mapped one here yet)' : ', unverified'
            }`}
        </div>
      </div>

      {error && (
        <div className="auth-error" role="alert" style={{ marginTop: 16 }}>
          {error}{' '}
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {!TOKEN ? (
        <div className="card map-fallback" style={{ marginTop: 16 }}>
          {/* This screen is the worker's home, so it must stay usable without a
              map: "Use my location" above opens the same capture sheet. */}
          <div className="empty-state">
            <div className="empty-title">Map not configured</div>
            <div>
              Add <span className="mono">VITE_MAPBOX_TOKEN</span> to{' '}
              <span className="mono">apps/frontend/.env</span> and restart the dev server to see the
              map. Everything else still works — use <strong>Use my location</strong> above, or go
              straight to a capture option.
            </div>
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 16,
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <Link className="btn btn-primary" to="/field">
                Fill in the form
              </Link>
              <Link className="btn btn-secondary" to="/field/notes/new">
                Quick note
              </Link>
              <Link className="btn btn-secondary" to="/field/reports">
                My reports
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="map-wrap" style={{ marginTop: 16 }}>
            <div ref={container} className="map-canvas" />
            {!reports && (
              <div className="loading" role="status">
                Loading the map…
              </div>
            )}
          </div>
          {reports && pins.length === 0 && (
            <div className="empty-state">
              <div className="empty-title">Nothing to plot yet</div>
              <div>Reports appear here once you have filed one with a location.</div>
            </div>
          )}
        </>
      )}

      {unplotted > 0 && (
        <div className="item-meta" style={{ marginTop: 12 }}>
          {unplotted} report{unplotted === 1 ? '' : 's'} could not be plotted because no location
          was recorded.
        </div>
      )}

      {/* The canvas is not reachable by screen readers, so the same data is a list. */}
      {pins.length > 0 && (
        <details className="collapse" style={{ marginTop: 16 }}>
          <summary>List the plotted reports</summary>
          <ul className="item-list" style={{ marginTop: 12 }}>
            {pins.map((r) => (
              <li className="item" key={r._id}>
                <div className="item-main">
                  <div className="item-title">{subjectName(r)}</div>
                  <div className="item-meta">
                    {r.extraction.urgency ?? 'routine'} ·{' '}
                    {r.location.source === 'gps' ? 'GPS' : 'assigned area'} ·{' '}
                    {r.location.village ?? 'unknown village'}
                  </div>
                </div>
                <div className="item-actions">
                  <Link className="btn btn-secondary btn-sm" to={`/field/reports/${r._id}`}>
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Renders with or without a map token, so the facility data is always
          inspectable - and readable by a screen reader, which a canvas is not. */}
      {(seeded.length > 0 || osm) && (
        <details className="collapse" style={{ marginTop: 16 }}>
          <summary>
            List every facility on this map (
            {seeded.length + (osm?.facilities.length ?? 0)})
          </summary>
          <ul className="item-list" style={{ marginTop: 12 }}>
            {seeded.map((f) => (
              <li className="item" key={f._id}>
                <div className="item-main">
                  <div className="item-title">
                    {f.name} <span className="pill pill-primary">Verified</span>
                  </div>
                  <div className="item-meta">
                    {f.type}
                    {f.village ? ` · ${f.village}` : ''}
                    {f.phone ? ` · ${f.phone}` : ''}
                    {f.location ? ` · ${f.location.coordinates[1].toFixed(4)}, ${f.location.coordinates[0].toFixed(4)}` : ' · no coordinates'}
                  </div>
                </div>
              </li>
            ))}
            {(osm?.facilities ?? []).map((f) => (
              <li className="item" key={f.osmId}>
                <div className="item-main">
                  <div className="item-title">
                    {f.name} <span className="pill pill-neutral">OpenStreetMap</span>
                  </div>
                  <div className="item-meta">
                    {f.kind}
                    {f.phone ? ` · ${f.phone}` : ' · no phone recorded'} ·{' '}
                    {f.lat.toFixed(4)}, {f.lng.toFixed(4)}
                  </div>
                </div>
                <div className="item-actions">
                  <a
                    className="btn btn-secondary btn-sm"
                    href={`https://www.openstreetmap.org/${f.osmId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Check on OSM
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {point && <CaptureSheet point={point} onClose={() => setPoint(null)} />}
    </div>
  )
}
