import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Appointment } from '../appointments/schemas/appointment.schema';
import { MedicalDocument } from '../documents/schemas/medical-document.schema';
import { Certificate } from '../certificates/schemas/certificate.schema';
import { CallSession } from '../calls/schemas/call-session.schema';
import { VerificationTask } from '../verification/schemas/verification-task.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { Doctor } from '../doctors/schemas/doctor.schema';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
    @InjectModel(MedicalDocument.name)
    private readonly documentModel: Model<MedicalDocument>,
    @InjectModel(Certificate.name)
    private readonly certificateModel: Model<Certificate>,
    @InjectModel(CallSession.name)
    private readonly callModel: Model<CallSession>,
    @InjectModel(VerificationTask.name)
    private readonly verificationModel: Model<VerificationTask>,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(Doctor.name) private readonly doctorModel: Model<Doctor>,
  ) {}

  async overview() {
    const [
      patients,
      doctors,
      appointments,
      pendingAppointments,
      calls,
      documentsPending,
      certificatesPending,
      verificationPending,
      issuedCertificates,
    ] = await Promise.all([
      this.patientModel.countDocuments(),
      this.doctorModel.countDocuments(),
      this.appointmentModel.countDocuments(),
      this.appointmentModel.countDocuments({
        status: { $in: ['requested', 'assigned'] },
      }),
      this.callModel.countDocuments(),
      this.documentModel.countDocuments({ status: 'awaiting-doctor' }),
      this.certificateModel.countDocuments({ status: 'awaiting-doctor' }),
      this.verificationModel.countDocuments({ status: 'pending' }),
      this.certificateModel.countDocuments({ status: 'issued' }),
    ]);

    const recentAppointments = await this.appointmentModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('patient')
      .populate('doctor')
      .lean()
      .exec();

    const recentCalls = await this.callModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('patient')
      .lean()
      .exec();

    return {
      patients,
      doctors,
      appointments,
      pendingAppointments,
      calls,
      documentsPending,
      certificatesPending,
      verificationPending,
      issuedCertificates,
      recentAppointments,
      recentCalls,
    };
  }
}
