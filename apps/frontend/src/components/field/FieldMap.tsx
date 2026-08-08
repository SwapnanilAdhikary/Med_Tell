import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { api } from '../../api/client'
import type { FieldReport, HealthWorker } from '../../api/types'
import { PIN_COLOR, URGENCIES, ageLabel, subjectName } from './labels'

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
    </ul>
  )
}

export function FieldMap() {
  const navigate = useNavigate()
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markers = useRef<mapboxgl.Marker[]>([])

  const [reports, setReports] = useState<FieldReport[] | null>(null)
  const [worker, setWorker] = useState<HealthWorker | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, me] = await Promise.all([
        api<FieldReport[]>('/api/field-reports/mine'),
        api<HealthWorker>('/api/health-workers/me'),
      ])
      setReports(list)
      setWorker(me)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the map data')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
    map.current = new mapboxgl.Map({
      container: container.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: (worker.coordinates?.length === 2
        ? worker.coordinates
        : [88.25, 23.93]) as [number, number],
      zoom: 11,
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [worker])

  useEffect(() => {
    const instance = map.current
    if (!instance) return

    markers.current.forEach((m) => m.remove())
    markers.current = pins.map((report) => {
      const [lng, lat] = report.location.point!.coordinates
      return new mapboxgl.Marker({
        element: pinElement(report, () => navigate(`/field/reports/${report._id}`)),
      })
        .setLngLat([lng, lat])
        .setPopup(new mapboxgl.Popup({ offset: 14 }).setHTML(popupHtml(report)))
        .addTo(instance)
    })

    if (pins.length > 1) {
      const bounds = new mapboxgl.LngLatBounds()
      pins.forEach((r) => bounds.extend(r.location.point!.coordinates as [number, number]))
      instance.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 })
    } else if (pins.length === 1) {
      instance.setCenter(pins[0].location.point!.coordinates as [number, number])
      instance.setZoom(13)
    }
  }, [pins, navigate])

  const unplotted = (reports?.length ?? 0) - pins.length

  return (
    <div className="content">
      <div className="card">
        <h2 className="card-title">Where you have reported</h2>
        <div className="card-sub">
          {worker?.village
            ? `Your assigned area is ${worker.village}, ${worker.district ?? ''}.`
            : 'Reports you have filed, plotted by location.'}
        </div>
        {reports && <Legend counts={counts} />}
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
          <div className="empty-state">
            <div className="empty-title">Map not configured</div>
            <div>
              Add <span className="mono">VITE_MAPBOX_TOKEN</span> to{' '}
              <span className="mono">apps/frontend/.env</span> and restart the dev server to see the
              map. Every report is still listed under My reports.
            </div>
            <Link className="btn btn-primary" style={{ marginTop: 16 }} to="/field/reports">
              Go to my reports
            </Link>
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
    </div>
  )
}
