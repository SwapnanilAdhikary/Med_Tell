export const HOME: Record<string, string> = {
  patient: '/chat',
  doctor: '/doctor',
  health_worker: '/field',
  admin: '/doctor',
}

export const homeFor = (role?: string): string => HOME[role ?? ''] ?? '/login'

export const ROLE_LABEL: Record<string, string> = {
  patient: 'Patient',
  doctor: 'Doctor',
  health_worker: 'ASHA / ANM worker',
  admin: 'Administrator',
}

export const SUBTITLE: Record<string, string> = {
  patient: 'Your personal health assistant',
  doctor: 'Doctor workspace',
  health_worker: 'Field reporting',
  admin: 'Doctor workspace',
}
