import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MedicalDocument, AiFindings } from './schemas/medical-document.schema';
import { AiService } from '../ai/ai.service';
import { VerificationService } from '../verification/verification.service';
import { PatientsService } from '../patients/patients.service';
import { NotificationsService } from '../notifications/notifications.service';
import { idFilter } from '../../common/mongoose.util';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(MedicalDocument.name)
    private readonly documentModel: Model<MedicalDocument>,
    private readonly aiService: AiService,
    @Inject(forwardRef(() => VerificationService))
    private readonly verificationService: VerificationService,
    private readonly patientsService: PatientsService,
    private readonly notificationsService: NotificationsService,
  ) {}


  async analyzeUpload(
    patientId: string | Types.ObjectId,
    file: Express.Multer.File,
    language = 'en',
  ) {
    // The image lives in file.buffer and is never written to disk — we keep
    // only what the AI read. See ARCHITECTURE.md §5C.
   const isPdf = file.mimetype === 'application/pdf';
    const findings = (await (isPdf
      ? this.aiService.analyzePdf(file.buffer, language)
      : this.aiService.analyzeDocument(
          file.buffer,
          file.mimetype,
          language,
        ))) as unknown as AiFindings;

    // A refusal parses to {}. Save nothing, queue nothing, tell the patient.
    if (!findings?.text?.trim() && !findings?.confidence) {
      throw new UnprocessableEntityException(
        "We couldn't read that document. Please upload a clearer photo of the report and try again.",
      );
    }

    const doc = await this.documentModel.create({
      patient: patientId,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      status: 'ai-reviewed',
      aiFindings: { ...findings, language },
    });

    doc.status = 'awaiting-doctor';
    await doc.save();

    await this.verificationService.create({
      taskType: 'document',
      refId: doc._id,
      patient: doc.patient,
      aiOutput: doc.aiFindings as unknown as Record<string, unknown>,
    });

    return doc;
  }

  async approve(
    id: string | Types.ObjectId,
    doctor: string | Types.ObjectId,
    comment?: string,
  ) {
    return this.review(id, doctor, 'approved', comment);
  }

  async reject(
    id: string | Types.ObjectId,
    doctor: string | Types.ObjectId,
    comment?: string,
  ) {
    return this.review(id, doctor, 'rejected', comment);
  }

  private async review(
    id: string | Types.ObjectId,
    doctor: string | Types.ObjectId,
    decision: 'approved' | 'rejected',
    comment?: string,
  ) {
    const doc = await this.documentModel
      .findByIdAndUpdate(
        id,
        {
          status: decision,
          doctorReview: { doctor, decision, comment, reviewedAt: new Date() },
        },
        { new: true },
      )
      .exec();
    if (!doc) return null;

    const patient = await this.patientsService
      .findById(doc.patient)
      .catch(() => null);
    if (patient) {
      await this.notificationsService.create({
        user: patient.user,
        title:
          decision === 'approved'
            ? 'Your report has been reviewed'
            : 'Your report needs attention',
        body:
          comment?.trim() ||
          (decision === 'approved'
            ? `A doctor reviewed "${doc.filename}" and confirmed the AI findings.`
            : `A doctor could not confirm the AI findings for "${doc.filename}". Please book a consultation.`),
        type: 'document',
        ref: { documentId: doc._id.toString() },
      });
    }

    return doc;
  }

  async listForPatient(patientId: string | Types.ObjectId) {
    return this.documentModel
      .find(idFilter('patient', patientId))
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async listAll(filter: Record<string, unknown> = {}) {
    return this.documentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('patient')
      .lean()
      .exec();
  }

  async findById(id: string | Types.ObjectId) {
    const doc = await this.documentModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  /**
   * Same as findById but refuses documents belonging to another patient.
   * Pass no patientId (doctors) to skip the ownership check.
   */
  async findOwned(id: string | Types.ObjectId, patientId?: string) {
    const doc = await this.findById(id);
    if (patientId && doc.patient.toString() !== patientId) {
      // 404, not 403 - don't confirm the document exists.
      throw new NotFoundException('Document not found');
    }
    return doc;
  }
}
