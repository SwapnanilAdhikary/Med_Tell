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
  taskType: 'document' | 'certificate' | 'call-note' | 'appointment'
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

export interface AppNotification {
  _id: string
  title: string
  body: string
  type: string
  read: boolean
  createdAt: string
}
