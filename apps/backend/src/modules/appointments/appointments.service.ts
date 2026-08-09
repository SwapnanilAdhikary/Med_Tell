import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment } from './schemas/appointment.schema';
import type { AppointmentType } from './schemas/appointment.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';
import type { DoctorDocument } from '../doctors/schemas/doctor.schema';
import { idFilter } from '../../common/mongoose.util';

export interface BookAppointmentInput {
  patientId: string | Types.ObjectId;
  reason?: string;
  preferredWindow?: string;
  bestContactNumber?: string;
  specialty?: string;
  symptoms?: string[];
  urgency?: string;
  callSessionId?: string | Types.ObjectId;
  aiNotes?: Record<string, unknown>;
  type?: AppointmentType;
  facility?: string | Types.ObjectId;
  /** Pre-formatted lines, so empty vitals disappear via bullet(). */
  vitals?: string[];
  /**
   * A value object, not a ref: this is what keeps AppointmentsModule from
   * importing HealthWorkersModule, so FieldReports -> Appointments stays a
   * one-way edge with no forwardRef.
   */
  reportedBy?: {
    workerName: string;
    cadre?: string;
    village?: string;
    facilityName?: string;
  };
  /**
   * Who gets the "consultation requested" message. Defaults to the patient's
   * own user; a villager with no phone has no account they can ever log into,
   * so the reporting worker is told instead.
   */
  notifyUser?: string | Types.ObjectId;
}

/** What the AI hands back to the caller after routing a consultation. */
export interface MatchedDoctorSummary {
  id: string;
  name: string;
  title?: string;
  specialty: string;
}

function bullet(label: string, values?: string[]): string {
  const list = (values ?? []).filter(Boolean);
  return list.length ? `${label}: ${list.join(', ')}` : '';
}

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
    private readonly notificationsService: NotificationsService,
    private readonly patientsService: PatientsService,
    private readonly doctorsService: DoctorsService,
  ) {}

  /**
   * Books a call-back and routes it: the best-matched doctor is recorded as
   * `suggestedDoctor` and receives the patient brief, while the patient is told
   * who was matched. Status stays `requested` - the doctor still claims it.
   */
  async book(input: BookAppointmentInput) {
    const patient = await this.patientsService.findById(input.patientId);
    const doctor = await this.doctorsService.findBestMatch(
      input.specialty,
      patient.language,
      { facility: input.facility },
    );

    const appointment = await this.appointmentModel.create({
      patient: input.patientId,
      // Every pre-existing caller omits `type`, so behaviour is unchanged.
      type: input.type ?? 'call-back',
      reason: input.reason,
      suggestedDoctor: doctor?._id,
      suggestedSpecialty: input.specialty,
      callSession: input.callSessionId,
      aiNotes: {
        ...(input.aiNotes ?? {}),
        ...(input.symptoms?.length ? { symptoms: input.symptoms } : {}),
        ...(input.urgency ? { urgency: input.urgency } : {}),
      },
      callBackJob: {
        preferredWindow: input.preferredWindow,
        bestContactNumber: input.bestContactNumber,
      },
    });

    const ref = { appointmentId: appointment._id.toString() };

    if (doctor) {
      // The patient brief - everything the doctor needs before calling back.
      await this.notificationsService.create({
        user: doctor.user,
        title: `New call-back matched to you: ${patient.name}`,
        body: [
          input.reportedBy
            ? `Reported by ${input.reportedBy.workerName}${input.reportedBy.cadre ? ` (${input.reportedBy.cadre})` : ''}`
            : '',
          `Patient: ${patient.name}${patient.gender ? ` (${patient.gender})` : ''}`,
          input.reportedBy?.village
            ? `Village: ${input.reportedBy.village}`
            : '',
          input.reportedBy?.facilityName
            ? `Nearest facility: ${input.reportedBy.facilityName}`
            : '',
          input.urgency ? `Urgency: ${input.urgency}` : '',
          input.reason ? `Reason: ${input.reason}` : '',
          bullet('Symptoms', input.symptoms),
          bullet('Vitals', input.vitals),
          bullet('Allergies', patient.healthProfile?.allergies),
          bullet('Conditions', patient.healthProfile?.conditions),
          bullet('Medications', patient.healthProfile?.medications),
          input.preferredWindow
            ? `Preferred window: ${input.preferredWindow}`
            : '',
          input.bestContactNumber ? `Contact: ${input.bestContactNumber}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        type: 'appointment',
        ref: { ...ref, patientId: patient._id.toString() },
      });
    }

    // The doctor's details, back to the patient.
    const inPerson = (input.type ?? 'call-back') === 'in-person';
    await this.notificationsService.create({
      user: input.notifyUser ?? patient.user,
      title: 'Consultation requested',
      body: inPerson
        ? // Deliberately unnamed: the facility is the nearest one, the matched
          // doctor may work elsewhere, and promising both sends people wrong.
          `Please visit ${input.reportedBy?.facilityName ?? 'your nearest health facility'} as soon as you can. Show this message when you arrive.`
        : doctor
          ? `You have been matched with ${this.doctorLabel(doctor)}. They will confirm and call you back${input.preferredWindow ? ` (${input.preferredWindow})` : ''}.`
          : `A doctor will call you back${input.preferredWindow ? ` (${input.preferredWindow})` : ''}.`,
      type: 'appointment',
      ref: doctor ? { ...ref, doctorId: doctor._id.toString() } : ref,
    });

    return { appointment, doctor: this.doctorSummary(doctor) };
  }

  /** `title` is a qualification ("MBBS, MD"), not an honorific - keep "Dr." separate. */
  private doctorLabel(doctor: { name: string; specialty: string }): string {
    return `Dr. ${doctor.name} (${doctor.specialty})`;
  }

  private doctorSummary(
    doctor: DoctorDocument | null,
  ): MatchedDoctorSummary | null {
    if (!doctor) return null;
    return {
      id: doctor._id.toString(),
      name: doctor.name,
      title: doctor.title,
      specialty: doctor.specialty,
    };
  }

  async listForPatient(patientId: string | Types.ObjectId) {
    return this.appointmentModel
      .find(idFilter('patient', patientId))
      .sort({ createdAt: -1 })
      .populate('doctor')
      .populate('suggestedDoctor')
      .lean()
      .exec();
  }

  async listCallBackQueue() {
    return this.appointmentModel
      .find({ status: { $in: ['requested', 'assigned'] } })
      .sort({ createdAt: 1 })
      .populate('doctor')
      .populate('suggestedDoctor')
      .populate('patient')
      .lean()
      .exec();
  }

  async listForDoctor(doctorId: string | Types.ObjectId) {
    return this.appointmentModel
      .find(idFilter('doctor', doctorId))
      .sort({ createdAt: -1 })
      .populate('patient')
      .lean()
      .exec();
  }

  async assign(doctorId: string | Types.ObjectId, appointmentId: string) {
    const appointment = await this.appointmentModel
      .findByIdAndUpdate(
        appointmentId,
        { doctor: doctorId, status: 'assigned' },
        { new: true },
      )
      .exec();
    if (!appointment) throw new NotFoundException('Appointment not found');

    const doctor = await this.doctorsService
      .findById(doctorId)
      .catch(() => null);
    const patient = await this.patientsService.findById(appointment.patient);
    await this.notificationsService.create({
      user: patient.user,
      title: 'Your doctor is confirmed',
      body: `${doctor ? this.doctorLabel(doctor) : 'A doctor'} has taken your case and will call you back${appointment.callBackJob?.preferredWindow ? ` (${appointment.callBackJob.preferredWindow})` : ''}.`,
      type: 'appointment',
      ref: {
        appointmentId: appointment._id.toString(),
        doctorId: doctor?._id.toString(),
      },
    });

    return appointment.populate('patient');
  }

  async complete(
    doctorId: string | Types.ObjectId,
    appointmentId: string,
    consultNotes: string,
  ) {
    const appointment = await this.appointmentModel
      .findById(appointmentId)
      .exec();
    if (!appointment) throw new NotFoundException('Appointment not found');

    appointment.status = 'completed';
    appointment.callBackJob = {
      ...appointment.callBackJob,
      consultNotes,
      completedAt: new Date(),
    };
    await appointment.save();

    const doctor = await this.doctorsService
      .findById(doctorId)
      .catch(() => null);
    const patient = await this.patientsService.findById(appointment.patient);
    await this.notificationsService.create({
      user: patient.user,
      title: 'Consultation completed',
      body: `${doctor ? this.doctorLabel(doctor) : 'Your doctor'} completed your consultation.`,
      type: 'appointment',
      ref: { appointmentId: appointment._id.toString() },
    });

    return appointment;
  }

  async summary() {
    const [requested, assigned, completed, total] = await Promise.all([
      this.appointmentModel.countDocuments({ status: 'requested' }),
      this.appointmentModel.countDocuments({ status: 'assigned' }),
      this.appointmentModel.countDocuments({ status: 'completed' }),
      this.appointmentModel.countDocuments(),
    ]);
    return { requested, assigned, completed, total };
  }
}
