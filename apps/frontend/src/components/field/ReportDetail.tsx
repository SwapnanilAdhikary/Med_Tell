import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, openAuthedFile } from '../../api/client'
import type { FieldReport, SignedPrescription } from '../../api/types'
import { ageLabel, subjectName, vitalLines } from './labels'
import { GeoChip, StatusPill, UrgencyPill } from './pills'

function facilityOf(report: FieldReport) {
  return report.facility && typeof report.facility !== 'string' ? report.facility : null
}

function prescriptionOf(report: FieldReport): SignedPrescription | null {
  const rx = report.prescription
  return rx && typeof rx !== 'string' ? rx : null
}

export function ReportDetail() {
  const { id } = useParams<{ id: string }>()
  const [report, setReport] = useState<FieldReport | null>(null)
  const [error, setError] = useState('')
  const [pdfError, setPdfError] = useState('')

  useEffect(() => {
    if (!id) return
    api<FieldReport>(`/api/field-reports/${id}`)
      .then(setReport)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load this report'),
      )
  }, [id])

  if (error) {
    return (
      <div className="content">
        <div className="auth-error" role="alert">
          {error}
        </div>
        <Link className="btn btn-secondary" style={{ marginTop: 16 }} to="/field/reports">
          Back to my reports
        </Link>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="loading" role="status">
        Loading the report…
      </div>
    )
  }

  const e = report.extraction
  const vitals = vitalLines(e.vitals)
  const facility = facilityOf(report)
  const rx = prescriptionOf(report)
  const point = report.location.point?.coordinates

  return (
    <div className="content">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="card-title">{subjectName(report)}</h2>
          {e.ageMonths != null && <span className="card-sub">{ageLabel(e.ageMonths)}</span>}
          {e.gender && <span className="card-sub">{e.gender}</span>}
          {e.pregnancyStatus && <span className="pill pill-primary">Pregnant</span>}
        </div>
        <div className="status-timeline">
          <StatusPill status={report.status} />
          <UrgencyPill urgency={e.urgency} />
          <GeoChip location={report.location} />
          <span className="item-meta">{new Date(report.createdAt).toLocaleString()}</span>
        </div>
        <div className="item-meta" style={{ marginTop: 8 }}>
          {[report.location.village, report.location.block, report.location.district]
            .filter(Boolean)
            .join(' · ')}
          {facility ? ` — nearest: ${facility.name}` : ' — no facility matched'}
        </div>
        {point && (
          <a
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 12 }}
            href={`https://www.google.com/maps/search/?api=1&query=${point[1]},${point[0]}`}
            target="_blank"
            rel="noreferrer"
          >
            Open location in Maps
          </a>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="card-title">What you reported</h3>
        {e.symptoms.length > 0 && (
          <div className="item-desc">
            <strong>Symptoms:</strong> {e.symptoms.join(', ')}
          </div>
        )}
        {e.duration && (
          <div className="item-desc">
            <strong>Duration:</strong> {e.duration}
            {e.trend ? ` · getting ${e.trend}` : ''}
          </div>
        )}
        {e.dangerSigns.length > 0 && (
          <div className="status-timeline">
            {e.dangerSigns.map((sign) => (
              <span className="pill pill-danger" key={sign}>
                {sign}
              </span>
            ))}
          </div>
        )}

        {vitals.length > 0 ? (
          <div className="grid grid-4" style={{ marginTop: 16 }}>
            {vitals.map((v) => (
              <div className="stat" key={v.label}>
                <div className="stat-label">{v.label}</div>
                <div className="stat-value" style={{ fontSize: 22 }}>
                  {v.value}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="item-meta" style={{ marginTop: 12 }}>
            No vitals were measured.
          </div>
        )}

        {report.rawTranscript && (
          <>
            <div className="stat-label" style={{ marginTop: 18 }}>
              In your words
            </div>
            <div className="cert-preview">{report.rawTranscript}</div>
          </>
        )}
        {report.aiError && (
          <div className="item-meta" style={{ marginTop: 12 }}>
            The assistant could not read these notes, so the doctor sees them exactly as written.
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="card-title">What the doctor said</h3>
        {report.matchedDoctor ? (
          <>
            <div className="item-desc">
              Sent to Dr. {report.matchedDoctor.name} ({report.matchedDoctor.specialty}).
            </div>
            {rx?.status === 'issued' ? (
              <>
                <div className="pill pill-success" style={{ marginTop: 10 }}>
                  Prescription signed
                </div>
                <ol className="rx-read">
                  {(rx.items ?? []).map((item, i) => (
                    <li key={`${item.name}-${i}`}>
                      <strong>{item.name}</strong>
                      {[
                        item.dose,
                        item.frequency,
                        item.durationDays != null ? `${item.durationDays} days` : '',
                        item.instructions,
                      ]
                        .filter(Boolean)
                        .map((token) => (
                          <span key={token} className="rx-token">
                            {token}
                          </span>
                        ))}
                    </li>
                  ))}
                </ol>
                {rx.signedBy && <div className="item-meta">{rx.signedBy}</div>}
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 12 }}
                  onClick={() => {
                    setPdfError('')
                    openAuthedFile(`/api/field-reports/${report._id}/prescription/pdf`).catch(
                      (e) => setPdfError(e instanceof Error ? e.message : 'Download failed'),
                    )
                  }}
                >
                  Download the PDF
                </button>
                {pdfError && <div className="form-error">{pdfError}</div>}
                <div className="item-meta" style={{ marginTop: 8 }}>
                  Read this out to the household and hand them the PDF. Do not change the
                  doses.
                </div>
              </>
            ) : rx?.status === 'rejected' ? (
              <div className="empty-state">
                <div className="empty-title">No prescription</div>
                <div>
                  The doctor did not approve a prescription for this case. Check your
                  notifications for their reason.
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-title">Waiting for the doctor</div>
                <div>You will see their reply here as soon as they review this report.</div>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-title">Not sent to a doctor</div>
            <div>
              {report.routingError
                ? 'Routing failed, so no doctor was notified. Tell your supervisor.'
                : 'No doctor has been matched to this report yet.'}
            </div>
          </div>
        )}
      </div>

      <Link className="btn btn-secondary" style={{ marginTop: 16 }} to="/field/reports">
        Back to my reports
      </Link>
    </div>
  )
}
