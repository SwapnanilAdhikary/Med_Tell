import type { FieldReport, FieldReportVitals, Urgency } from '../../api/types'

/** Label + unit for every vital, shared by the capture form and the detail view. */
export const VITALS: Array<{
  key: keyof FieldReportVitals
  label: string
  unit: string
  min: number
  max: number
  step?: string
}> = [
  { key: 'temperatureC', label: 'Temperature', unit: '°C', min: 30, max: 45, step: '0.1' },
  { key: 'spo2', label: 'SpO₂', unit: '%', min: 50, max: 100 },
  { key: 'pulse', label: 'Pulse', unit: '/min', min: 20, max: 250 },
  { key: 'respRate', label: 'Respiration', unit: '/min', min: 5, max: 80 },
  { key: 'systolic', label: 'Systolic BP', unit: 'mmHg', min: 50, max: 300 },
  { key: 'diastolic', label: 'Diastolic BP', unit: 'mmHg', min: 20, max: 200 },
  { key: 'weightKg', label: 'Weight', unit: 'kg', min: 0.5, max: 300, step: '0.1' },
  { key: 'glucoseMgDl', label: 'Blood glucose', unit: 'mg/dL', min: 10, max: 900 },
]

export const URGENCIES: Array<{ value: Urgency; label: string; cls: string }> = [
  { value: 'routine', label: 'Routine', cls: 'pill-neutral' },
  { value: 'semi-urgent', label: 'Semi-urgent', cls: 'pill-info' },
  { value: 'urgent', label: 'Urgent', cls: 'pill-warning' },
  { value: 'emergency', label: 'Emergency', cls: 'pill-danger' },
]

/** Hex rather than a token: the map draws pins outside the CSS cascade. */
export const PIN_COLOR: Record<Urgency, string> = {
  routine: '#64748b',
  'semi-urgent': '#1d4ed8',
  urgent: '#b45309',
  emergency: '#dc2626',
}

export const STATUS_PILL: Record<FieldReport['status'], { cls: string; label: string }> = {
  extracting: { cls: 'pill-neutral', label: 'Processing' },
  submitted: { cls: 'pill-info', label: 'Filed' },
  routed: { cls: 'pill-success', label: 'Doctor notified' },
  failed: { cls: 'pill-danger', label: 'Needs attention' },
}

export function vitalLines(vitals?: FieldReportVitals): Array<{ label: string; value: string }> {
  if (!vitals) return []
  return VITALS.filter((v) => vitals[v.key] != null).map((v) => ({
    label: v.label,
    value: `${vitals[v.key]!} ${v.unit}`,
  }))
}

export function subjectName(report: FieldReport): string {
  return typeof report.patient === 'string' ? 'Patient' : report.patient.name
}

export function ageLabel(ageMonths?: number): string {
  if (ageMonths == null) return ''
  return ageMonths < 24 ? `${ageMonths} months` : `${Math.floor(ageMonths / 12)} years`
}
