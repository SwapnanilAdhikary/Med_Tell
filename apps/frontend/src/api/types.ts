export interface AuthUser {
  id: string
  phone: string
  name?: string
  role: 'patient' | 'doctor' | 'health_worker' | 'admin'
  patientId?: string
  doctorId?: string
  workerId?: string
}

export interface Patient {
  _id: string
  user: string
  name: string
  gender?: string
  bloodGroup?: string
  language: string
  healthProfile?: { allergies: string[]; conditions: string[]; medications: string[] }
  family: Array<{ name: string; relation: string; age?: number }>
  consentGranted: boolean
}

export interface Doctor {
  _id: string
  user: string
  name: string
  title?: string
  specialty: string
  registrationNumber?: string
  languages: string[]
  verified: boolean
}

export interface DoctorRef {
  _id: string
  name: string
  title?: string
  specialty: string
}

export interface Appointment {
  _id: string
  patient: { _id: string; name: string } | string
  doctor?: DoctorRef | string
  /** Best specialty match from AI triage, before a doctor claims the case. */
  suggestedDoctor?: DoctorRef | string
  suggestedSpecialty?: string
  type: string
  reason?: string
  status: 'requested' | 'assigned' | 'completed' | 'cancelled'
  aiNotes?: {
    summary?: string
    symptoms?: string[]
    recommendedAction?: string
    urgency?: string
  }
  callBackJob?: {
    preferredWindow?: string
    bestContactNumber?: string
    consultNotes?: string
    completedAt?: string
  }
  createdAt: string
}

export interface MedicalDocument {
  _id: string
  patient: { _id: string; name: string } | string
  filename: string
  mimeType?: string
  docType?: string
  status: 'pending' | 'ai-reviewed' | 'awaiting-doctor' | 'approved' | 'rejected'
  aiFindings?: {
    docType: string
    text: string
    summary: string
    abnormalFindings: string[]
    recommendations: string[]
    confidence: number
    disclaimer: string
    language: string
  }
  doctorReview?: {
    doctor?: string
    decision?: 'approved' | 'rejected'
    comment?: string
    reviewedAt?: string
  }
  createdAt: string
}

export interface Certificate {
  _id: string
  patient: { _id: string; name: string } | string
  doctor?: { _id: string; name: string; specialty: string } | string
  type: 'sick-leave' | 'fitness' | 'medical' | 'insurance'
  language: string
  draftContent?: { title?: string; body?: string; notes?: string }
  status: 'draft' | 'awaiting-doctor' | 'issued' | 'rejected'
  signedBy?: string
  rejectReason?: string
  issuedAt?: string
  createdAt: string
}

export interface VerificationTask {
  _id: string
  taskType: 'document' | 'certificate' | 'prescription' | 'call-note' | 'appointment'
  refId: string
  patient: { _id: string; name: string } | string
  aiOutput?: Record<string, unknown>
  status: 'pending' | 'approved' | 'edited' | 'rejected'
  doctorComment?: string
  reviewedAt?: string
  createdAt: string
}

export interface CallSession {
  _id: string
  vapiCallId: string
  phoneNumber?: string
  source?: string
  patient?: { _id: string; name: string } | string
  status: string
  transcriptText?: string
  summary?: Record<string, unknown>
  createdAt: string
}

/** A tool the agent actually ran, with the real outcome. */
export interface ChatAction {
  name: string
  args: Record<string, unknown>
  result?: {
    error?: string
    appointmentId?: string
    certificateId?: string
    type?: string
    emergency?: boolean
    emergencyNumbers?: string[]
    suggestedDoctor?: { name: string; title?: string; specialty: string } | null
  }
}

export interface ChatMessage {
  _id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: unknown[]
  metadata?: { actions?: ChatAction[]; source?: string }
  createdAt: string
}

export type Urgency = 'routine' | 'semi-urgent' | 'urgent' | 'emergency'

export interface HealthWorker {
  _id: string
  name: string
  cadre: 'ASHA' | 'ANM'
  workerCode?: string
  village?: string
  block?: string
  district?: string
  state?: string
  coordinates?: number[]
  languages: string[]
  active: boolean
}

export interface Facility {
  _id: string
  name: string
  type: 'PHC' | 'CHC' | 'sub-centre' | 'district-hospital'
  village?: string
  district?: string
  phone?: string
  location?: { type: 'Point'; coordinates: number[] }
}

/** Community-mapped from OpenStreetMap - unverified, often without a phone. */
export interface PublicFacility {
  osmId: string
  name: string
  kind: 'hospital' | 'clinic' | 'doctors' | 'pharmacy'
  lat: number
  lng: number
  phone?: string
  source: 'osm'
}

export interface PublicFacilityResult {
  facilities: PublicFacility[]
  /** 'unavailable' means OpenStreetMap did not answer, not that none exist. */
  status: 'ok' | 'unavailable'
  radiusM: number
}

export interface FieldReportVitals {
  temperatureC?: number
  spo2?: number
  systolic?: number
  diastolic?: number
  pulse?: number
  respRate?: number
  weightKg?: number
  glucoseMgDl?: number
}

export interface FieldReport {
  _id: string
  worker: string
  patient: { _id: string; name: string } | string
  channel: 'voice' | 'web'
  language: string
  rawTranscript?: string
  extraction: {
    symptoms: string[]
    vitals: FieldReportVitals
    duration?: string
    trend?: string
    urgency?: Urgency
    suspectedCondition?: string
    suggestedSpecialty?: string
    pregnancyStatus?: boolean
    ageMonths?: number
    gender?: string
    dangerSigns: string[]
    redFlags: string[]
    summary?: string
    confidence?: number
  }
  location: {
    /** GeoJSON order: [lng, lat]. */
    point?: { type: 'Point'; coordinates: number[] }
    source: 'gps' | 'picked' | 'assigned' | 'spoken'
    accuracyM?: number
    village?: string
    block?: string
    district?: string
  }
  facility?: Facility | string
  appointment?: string
  matchedDoctor?: { name: string; specialty: string; title?: string }
  prescription?: SignedPrescription | string
  status: 'extracting' | 'submitted' | 'routed' | 'failed'
  aiError?: string
  routingError?: string
  createdAt: string
}

export interface PrescriptionItem {
  name: string
  dose?: string
  frequency?: string
  durationDays?: number
  instructions?: string
}

/** What the worker is shown: the signed items only, never the AI's draft. */
export interface SignedPrescription {
  _id: string
  status: 'awaiting-doctor' | 'issued' | 'rejected'
  items?: PrescriptionItem[]
  signedBy?: string
  issuedAt?: string
  consultMode?: string
}

export interface FieldNote {
  _id: string
  title: string
  body: string
  point?: { type: 'Point'; coordinates: number[] }
  village?: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface AppNotification {
  _id: string
  title: string
  body: string
  type: string
  read: boolean
  createdAt: string
}
