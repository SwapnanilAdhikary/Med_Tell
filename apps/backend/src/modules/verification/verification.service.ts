import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  VerificationTask,
  VerificationTaskType,
} from './schemas/verification-task.schema';
import { DocumentsService } from '../documents/documents.service';
import { CertificatesService } from '../certificates/certificates.service';
import { PatientsService } from '../patients/patients.service';
import { NotificationsService } from '../notifications/notifications.service';
import { idFilter } from '../../common/mongoose.util';

@Injectable()
export class VerificationService {
  constructor(
    @InjectModel(VerificationTask.name)
    private readonly taskModel: Model<VerificationTask>,
    @Inject(forwardRef(() => DocumentsService))
    private readonly documentsService: DocumentsService,
    @Inject(forwardRef(() => CertificatesService))
    private readonly certificatesService: CertificatesService,
    private readonly patientsService: PatientsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(input: {
    taskType: VerificationTaskType;
    refId: string | Types.ObjectId;
    patient: string | Types.ObjectId;
    aiOutput?: Record<string, unknown>;
  }) {
    return this.taskModel.create({
      taskType: input.taskType,
      refId: input.refId,
      patient: input.patient,
      aiOutput: input.aiOutput,
    });
  }

  async listPending() {
    return this.taskModel
      .find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .populate('patient')
      .populate('doctor')
      .lean()
      .exec();
  }

  async listReviewed(doctorId: string | Types.ObjectId) {
    return this.taskModel
      .find({ ...idFilter('doctor', doctorId), status: { $ne: 'pending' } })
      .sort({ reviewedAt: -1 })
      .populate('patient')
      .lean()
      .exec();
  }

  async approve(
    taskId: string,
    doctorId: string | Types.ObjectId,
    comment?: string,
  ) {
    const task = await this.taskModel.findById(taskId).exec();
    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== 'pending') return this.decidedError(task.status);

    task.doctor = doctorId as Types.ObjectId;
    task.doctorComment = comment;
    task.reviewedAt = new Date();

    await this.applyDecision(task);
    task.status = 'approved';
    await task.save();
    return task;
  }

  async reject(
    taskId: string,
    doctorId: string | Types.ObjectId,
    comment?: string,
  ) {
    const task = await this.taskModel.findById(taskId).exec();
    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== 'pending') return this.decidedError(task.status);

    task.doctor = doctorId as Types.ObjectId;
    task.doctorComment = comment;
    task.reviewedAt = new Date();

    if (task.taskType === 'document') {
      await this.documentsService.reject(task.refId, doctorId, comment);
    } else if (task.taskType === 'certificate') {
      await this.certificatesService.reject(task.refId, doctorId, comment);
    }
    task.status = 'rejected';
    await task.save();
    return task;
  }

  async summary() {
    const [pending, approved, rejected, total] = await Promise.all([
      this.taskModel.countDocuments({ status: 'pending' }),
      this.taskModel.countDocuments({ status: 'approved' }),
      this.taskModel.countDocuments({ status: 'rejected' }),
      this.taskModel.countDocuments(),
    ]);
    return { pending, approved, rejected, total };
  }

  private async applyDecision(task: VerificationTask) {
    if (task.taskType === 'document') {
      await this.documentsService.approve(
        task.refId,
        task.doctor!,
        task.doctorComment,
      );
    } else if (task.taskType === 'certificate') {
      await this.certificatesService.issue(task.refId, task.doctor!);
    } else {
      // call-note and appointment tasks have nothing to mutate, but the patient
      // should still learn a doctor read their case.
      // ponytail: notification only, no CallSession write - avoids a
      // Calls <-> Verification module cycle.
      await this.notifyPatient(
        task,
        'A doctor reviewed your call',
        task.doctorComment?.trim() ||
          'A doctor has reviewed the notes from your call. Check your consultations for next steps.',
      );
    }
  }

  private async notifyPatient(
    task: VerificationTask,
    title: string,
    body: string,
  ) {
    const patient = await this.patientsService
      .findById(task.patient)
      .catch(() => null);
    if (!patient) return;
    await this.notificationsService.create({
      user: patient.user,
      title,
      body,
      type: 'verification',
      ref: { taskType: task.taskType, refId: task.refId.toString() },
    });
  }

  private decidedError(status: string): never {
    throw new ConflictException(`Task already decided (${status})`);
  }
}
