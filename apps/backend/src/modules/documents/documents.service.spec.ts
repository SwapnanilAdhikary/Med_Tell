import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UnprocessableEntityException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { MedicalDocument } from './schemas/medical-document.schema';
import { AiService } from '../ai/ai.service';
import { VerificationService } from '../verification/verification.service';
import { PatientsService } from '../patients/patients.service';
import { NotificationsService } from '../notifications/notifications.service';

const GOOD_FINDINGS = {
  docType: 'lab-report',
  text: 'Haemoglobin 9.1 g/dL',
  summary: 'Low haemoglobin.',
  abnormalFindings: ['Low haemoglobin'],
  recommendations: ['See a doctor.'],
  confidence: 0.95,
  disclaimer: 'AI generated.',
};

function fakeFile(mimetype = 'image/png'): Express.Multer.File {
  return {
    buffer: Buffer.from('fake-image-bytes'),
    mimetype,
    originalname: 'report.png',
    size: 26033,
  } as Express.Multer.File;
}

describe('DocumentsService.analyzeUpload', () => {
  let service: DocumentsService;
  let aiService: { analyzeDocument: jest.Mock };
  let verificationService: { create: jest.Mock };
  let documentModel: { create: jest.Mock };

  beforeEach(async () => {
    aiService = { analyzeDocument: jest.fn() };
    verificationService = { create: jest.fn().mockResolvedValue({}) };
    documentModel = {
      create: jest.fn(async (doc: Record<string, unknown>) => ({
        ...doc,
        _id: 'doc-1',
        save: jest.fn(),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: getModelToken(MedicalDocument.name), useValue: documentModel },
        { provide: AiService, useValue: aiService },
        { provide: VerificationService, useValue: verificationService },
        { provide: PatientsService, useValue: { findById: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get(DocumentsService);
  });

  // THE BUG. Before Phase 2 this saved a blank record and queued an empty
  // task, so a doctor opened their list and found nothing in it.
  it('does not queue a report for a doctor when the AI read nothing', async () => {
    aiService.analyzeDocument.mockResolvedValue({
      text: '',
      confidence: 0,
      summary: 'No text available for analysis.',
    });

    await expect(
      service.analyzeUpload('patient-1', fakeFile()),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(documentModel.create).not.toHaveBeenCalled();
    expect(verificationService.create).not.toHaveBeenCalled();
  });

  it('saves findings and queues one doctor task for a readable image', async () => {
    aiService.analyzeDocument.mockResolvedValue(GOOD_FINDINGS);

    await service.analyzeUpload('patient-1', fakeFile());

    expect(documentModel.create).toHaveBeenCalledTimes(1);
    expect(verificationService.create).toHaveBeenCalledTimes(1);
  });

  // Phase 3: the buffer goes to the AI, never a file path.
  it('passes the buffer and the real MIME type to the AI', async () => {
    aiService.analyzeDocument.mockResolvedValue(GOOD_FINDINGS);

    await service.analyzeUpload('patient-1', fakeFile('image/webp'), 'en');

    expect(aiService.analyzeDocument).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/webp',
      'en',
    );
  });

  // Phase 3: no filePath is ever written, because no file is ever stored.
  it('never stores a file path on the document', async () => {
    aiService.analyzeDocument.mockResolvedValue(GOOD_FINDINGS);

    await service.analyzeUpload('patient-1', fakeFile());

    const saved = documentModel.create.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.filePath).toBeUndefined();
  });
});