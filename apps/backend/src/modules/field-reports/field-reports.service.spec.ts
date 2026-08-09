import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { FieldReportsService } from './field-reports.service';
import type { SubmitFieldReportInput } from './field-reports.service';
import { FieldReport } from './schemas/field-report.schema';
import { AiService } from '../ai/ai.service';
import { AuthService } from '../auth/auth.service';
import { HealthWorkersService } from '../health-workers/health-workers.service';
import { FacilitiesService } from '../facilities/facilities.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { FieldNotesService } from '../field-notes/field-notes.service';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/unbound-method */

const WORKER = {
  _id: 'worker-1',
  user: 'user-1',
  name: 'Anjali Roy',
  cadre: 'ASHA',
  village: 'Beldanga',
  block: 'Beldanga I',
  district: 'Murshidabad',
  coordinates: [88.24, 23.92],
  languages: ['bn', 'hi'],
};

const FACILITY = { _id: 'facility-1', name: 'PHC Beldanga' };

const EMPTY_EXTRACTION = {
  kind: 'report' as const,
  subject: {},
  symptoms: [],
  vitals: {},
  dangerSigns: [],
  redFlags: [],
};

function input(
  over: Partial<SubmitFieldReportInput> = {},
): SubmitFieldReportInput {
  return {
    subject: { name: 'Sita Devi', phone: '+919555512345' },
    narrative: 'Fever for three days, not eating well.',
    ...over,
  };
}

describe('FieldReportsService', () => {
  let service: FieldReportsService;

  const reportModel = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
  };
  const aiService = { extractFieldReport: jest.fn() };
  const authService = { findOrCreatePatientByPhone: jest.fn() };
  const healthWorkersService = { findById: jest.fn() };
  const facilitiesService = { findNearest: jest.fn() };
  const appointmentsService = { book: jest.fn() };
  const fieldNotesService = { create: jest.fn() };

  /** The document handed to reportModel.create. */
  const createdWith = () => reportModel.create.mock.calls[0][0];
  /** The input book() was called with. */
  const bookedWith = () => appointmentsService.book.mock.calls[0][0];

  beforeEach(async () => {
    jest.clearAllMocks();

    healthWorkersService.findById.mockResolvedValue({ ...WORKER });
    authService.findOrCreatePatientByPhone.mockResolvedValue({
      patientId: 'patient-1',
      userId: 'user-1',
      created: true,
    });
    facilitiesService.findNearest.mockResolvedValue({ ...FACILITY });
    aiService.extractFieldReport.mockResolvedValue({ ...EMPTY_EXTRACTION });
    fieldNotesService.create.mockResolvedValue({ _id: 'note-1' });
    appointmentsService.book.mockResolvedValue({
      appointment: { _id: 'appt-1' },
      doctor: { name: 'Ananya Banerjee', specialty: 'General Medicine' },
    });
    // Echo the created document so the service can mutate and save it.
    reportModel.create.mockImplementation(async (doc: object) => ({
      ...doc,
      _id: 'report-1',
      save: jest.fn().mockResolvedValue(undefined),
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FieldReportsService,
        { provide: getModelToken(FieldReport.name), useValue: reportModel },
        { provide: AiService, useValue: aiService },
        { provide: AuthService, useValue: authService },
        { provide: HealthWorkersService, useValue: healthWorkersService },
        { provide: FacilitiesService, useValue: facilitiesService },
        { provide: AppointmentsService, useValue: appointmentsService },
        { provide: FieldNotesService, useValue: fieldNotesService },
      ],
    }).compile();

    service = module.get(FieldReportsService);
  });

  describe('location', () => {
    it('stores browser {lat, lng} as GeoJSON [lng, lat]', async () => {
      await service.submit(
        'worker-1',
        input({ geo: { lat: 23.93, lng: 88.25 } }),
      );

      expect(createdWith().location.point).toEqual({
        type: 'Point',
        coordinates: [88.25, 23.93],
      });
      expect(createdWith().location.source).toBe('gps');
    });

    it('passes the same [lng, lat] order to findNearest', async () => {
      await service.submit(
        'worker-1',
        input({ geo: { lat: 23.93, lng: 88.25 } }),
      );

      expect(facilitiesService.findNearest).toHaveBeenCalledWith(
        [88.25, 23.93],
        expect.objectContaining({ village: 'Beldanga' }),
      );
    });

    it('falls back to the assigned area when there is no GPS', async () => {
      await service.submit('worker-1', input());

      expect(createdWith().location).toEqual(
        expect.objectContaining({
          source: 'assigned',
          village: 'Beldanga',
          block: 'Beldanga I',
          district: 'Murshidabad',
          point: { type: 'Point', coordinates: [88.24, 23.92] },
        }),
      );
    });

    it('ignores coordinates from an untrusted transport, so a fix is never faked', async () => {
      // The predicate is trust, not modality: nothing but an authenticated
      // browser session can produce a coordinate.
      await service.submit('worker-1', input({ geo: { lat: 1, lng: 2 } }), {
        channel: 'voice',
        trustGeo: false,
      });

      expect(createdWith().location.source).toBe('assigned');
      expect(createdWith().location.point.coordinates).toEqual([88.24, 23.92]);
      expect(createdWith().channel).toBe('voice');
    });

    it('keeps the tapped point on an in-browser voice call', async () => {
      // A worker calling from the map has a real browser and a real pin, so
      // gating on channel would have thrown the location away.
      await service.submit(
        'worker-1',
        input({ geo: { lat: 23.93, lng: 88.25, picked: true } }),
        { channel: 'voice', trustGeo: true },
      );

      expect(createdWith().channel).toBe('voice');
      expect(createdWith().location.source).toBe('picked');
      expect(createdWith().location.point.coordinates).toEqual([88.25, 23.93]);
    });

    it('falls back to the assigned area when a call carries no point', async () => {
      await service.submit('worker-1', input(), { channel: 'voice' });
      expect(createdWith().location.source).toBe('assigned');
    });

    it('records a tapped pin as picked, not gps, and drops the accuracy', async () => {
      await service.submit(
        'worker-1',
        input({ geo: { lat: 23.93, lng: 88.25, accuracyM: 12, picked: true } }),
      );

      expect(createdWith().location.source).toBe('picked');
      // A tapped point has no measured accuracy, so claiming one would be a lie.
      expect(createdWith().location.accuracyM).toBeUndefined();
      expect(createdWith().location.point.coordinates).toEqual([88.25, 23.93]);
    });

    it('keeps the area denormalised on the report', async () => {
      await service.submit(
        'worker-1',
        input({ geo: { lat: 23.93, lng: 88.25 } }),
      );
      // A worker gets reassigned; the report must keep where it happened.
      expect(createdWith().location.village).toBe('Beldanga');
    });
  });

  describe('the subject', () => {
    it('normalises the phone and passes the typed name through', async () => {
      await service.submit(
        'worker-1',
        input({ subject: { name: 'Sita Devi', phone: '+91 95555-12345' } }),
      );

      expect(authService.findOrCreatePatientByPhone).toHaveBeenCalledWith(
        '+919555512345',
        { name: 'Sita Devi', language: 'bn' },
      );
    });

    it('resolves the same phone identically on a second report', async () => {
      await service.submit('worker-1', input());
      await service.submit('worker-1', input());

      const [first, second] =
        authService.findOrCreatePatientByPhone.mock.calls.map((c) => c[0]);
      expect(first).toBe(second);
      expect(authService.findOrCreatePatientByPhone).toHaveBeenCalledTimes(2);
    });

    it('does not attach a phone that belongs to a doctor', async () => {
      authService.findOrCreatePatientByPhone.mockRejectedValue(
        new ConflictException('Phone number belongs to a doctor account'),
      );

      await expect(service.submit('worker-1', input())).rejects.toThrow(
        ConflictException,
      );
      expect(reportModel.create).not.toHaveBeenCalled();
    });

    it('keeps the typed phone even when the model reads a different one', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        subject: { phone: '9999999999', name: 'Someone Else' },
      });

      await service.submit('worker-1', input());

      expect(authService.findOrCreatePatientByPhone).toHaveBeenCalledWith(
        '+919555512345',
        expect.objectContaining({ name: 'Sita Devi' }),
      );
    });

    it('lets typed vitals override the model and keeps the model’s extras', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        // The prompt asks for null on anything unmeasured; nulls must not persist.
        vitals: { temperatureC: 37, spo2: 99, pulse: null, systolic: null },
      });

      const report = await service.submit(
        'worker-1',
        input({ vitals: { temperatureC: 39.2 } }),
      );

      expect(report.extraction.vitals).toEqual({
        temperatureC: 39.2,
        spo2: 99,
      });
    });

    it('never downgrades the worker’s own urgency judgement', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        urgency: 'routine',
      });

      const report = await service.submit(
        'worker-1',
        input({ urgency: 'urgent' }),
      );

      expect(report.extraction.urgency).toBe('urgent');
    });

    it('accepts an escalation from the model', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        urgency: 'emergency',
      });

      const report = await service.submit(
        'worker-1',
        input({ urgency: 'routine' }),
      );

      expect(report.extraction.urgency).toBe('emergency');
    });
  });

  describe('when the model fails', () => {
    it('keeps the report with aiError set and does not throw', async () => {
      aiService.extractFieldReport.mockRejectedValue(
        new Error('429 rate limit'),
      );

      const report = await service.submit('worker-1', input());

      expect(report.aiError).toBe('429 rate limit');
      expect(report.status).toBe('routed');
      expect(appointmentsService.book).toHaveBeenCalled();
    });

    it('persists the report before extracting', async () => {
      const order: string[] = [];
      reportModel.create.mockImplementation(async (doc: object) => {
        order.push('create');
        return { ...doc, _id: 'report-1', save: jest.fn() };
      });
      aiService.extractFieldReport.mockImplementation(async () => {
        order.push('extract');
        return { ...EMPTY_EXTRACTION };
      });

      await service.submit('worker-1', input());

      expect(order).toEqual(['create', 'extract']);
      expect(createdWith().status).toBe('extracting');
    });
  });

  describe('routing', () => {
    it('marks the report routed and links the appointment', async () => {
      const report = await service.submit('worker-1', input());

      expect(report.status).toBe('routed');
      expect(report.appointment).toBe('appt-1');
    });

    it('denormalises the matched doctor so the worker screens need no populate', async () => {
      const report = await service.submit('worker-1', input());

      expect(report.matchedDoctor).toEqual({
        name: 'Ananya Banerjee',
        specialty: 'General Medicine',
        title: undefined,
      });
    });

    it('leaves matchedDoctor unset when nobody was matched', async () => {
      appointmentsService.book.mockResolvedValue({
        appointment: { _id: 'appt-1' },
        doctor: null,
      });

      const report = await service.submit('worker-1', input());

      expect(report.matchedDoctor).toBeUndefined();
      expect(report.status).toBe('routed');
    });

    it('leaves status failed and returns normally when book() throws', async () => {
      appointmentsService.book.mockRejectedValue(new Error('roster empty'));

      const report = await service.submit('worker-1', input());

      expect(report.status).toBe('failed');
      expect(report.routingError).toBe('roster empty');
      expect(report.save).toHaveBeenCalled();
    });

    it('books in-person only when a facility resolved and the case is urgent', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        urgency: 'urgent',
      });
      await service.submit('worker-1', input());
      expect(bookedWith().type).toBe('in-person');
    });

    it('stays a call-back for an urgent case with no facility', async () => {
      facilitiesService.findNearest.mockResolvedValue(null);
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        urgency: 'emergency',
      });
      await service.submit('worker-1', input());
      expect(bookedWith().type).toBe('call-back');
      expect(bookedWith().facility).toBeUndefined();
    });

    it('stays a call-back for a semi-urgent case with a facility', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        urgency: 'semi-urgent',
      });
      await service.submit('worker-1', input());
      expect(bookedWith().type).toBe('call-back');
    });

    it('forwards the facility so proximity can score', async () => {
      await service.submit('worker-1', input());
      expect(bookedWith().facility).toBe('facility-1');
    });

    it('names the worker, cadre, village and facility for the doctor brief', async () => {
      await service.submit('worker-1', input());
      expect(bookedWith().reportedBy).toEqual({
        workerName: 'Anjali Roy',
        cadre: 'ASHA',
        village: 'Beldanga',
        facilityName: 'PHC Beldanga',
      });
    });

    it('formats vitals as lines so empty ones disappear', async () => {
      await service.submit(
        'worker-1',
        input({ vitals: { temperatureC: 39.2, spo2: 94 } }),
      );
      expect(bookedWith().vitals).toEqual(['temp 39.2 °C', 'SpO2 94%']);
    });
  });

  describe('specialty routing', () => {
    it('prefers what the model suggested', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        suggestedSpecialty: 'Cardiology',
      });
      await service.submit(
        'worker-1',
        input({ subject: { name: 'X', phone: '1', pregnant: true } }),
      );
      expect(bookedWith().specialty).toBe('Cardiology');
    });

    it('routes a pregnancy to Obstetrics', async () => {
      await service.submit(
        'worker-1',
        input({
          subject: {
            name: 'Sita Devi',
            phone: '+919555512345',
            pregnant: true,
          },
        }),
      );
      expect(bookedWith().specialty).toBe('Obstetrics');
    });

    it('routes an infant to Pediatrics', async () => {
      await service.submit(
        'worker-1',
        input({
          subject: { name: 'Baby Devi', phone: '+919555512345', ageMonths: 8 },
        }),
      );
      expect(bookedWith().specialty).toBe('Pediatrics');
    });

    it('converts typed years to months for the paediatric cut-off', async () => {
      await service.submit(
        'worker-1',
        input({
          subject: { name: 'Child Devi', phone: '+919555512345', ageYears: 4 },
        }),
      );
      expect(bookedWith().specialty).toBe('Pediatrics');
    });

    it('leaves an adult unspecified so General Medicine wins on score', async () => {
      await service.submit(
        'worker-1',
        input({
          subject: { name: 'Sita Devi', phone: '+919555512345', ageYears: 34 },
        }),
      );
      expect(bookedWith().specialty).toBeUndefined();
    });
  });

  describe('ingestFromCall', () => {
    const call = {
      transcript: 'Sita Devi, 34, fever three days, getting worse.',
      geo: { lat: 23.93, lng: 88.25, picked: true },
      workerPhone: '+919700000001',
    };

    it('files a report when the call is about a person', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        subject: { name: 'Sita Devi', phone: '+919555512345', ageYears: 34 },
        symptoms: ['fever'],
      });

      const out = await service.ingestFromCall('worker-1', call);

      expect(out.kind).toBe('report');
      expect(fieldNotesService.create).not.toHaveBeenCalled();
      expect(createdWith().channel).toBe('voice');
      // The tapped pin survives, unlike a phone-in call.
      expect(createdWith().location.source).toBe('picked');
      expect(createdWith().subjectReachable).toBe(true);
    });

    it('calls the model once, not once per layer', async () => {
      await service.ingestFromCall('worker-1', call);
      expect(aiService.extractFieldReport).toHaveBeenCalledTimes(1);
    });

    it('saves a note when the call is not about a person', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        kind: 'note',
        noteTitle: 'BP cuff broken',
      });

      const out = await service.ingestFromCall('worker-1', call);

      expect(out).toEqual(
        expect.objectContaining({ kind: 'note', noteId: 'note-1' }),
      );
      expect(reportModel.create).not.toHaveBeenCalled();
      expect(appointmentsService.book).not.toHaveBeenCalled();
      expect(fieldNotesService.create).toHaveBeenCalledWith(
        'worker-1',
        expect.objectContaining({
          title: 'BP cuff broken',
          body: call.transcript,
          geo: { lat: 23.93, lng: 88.25 },
        }),
      );
    });

    it('files a REPORT when classification fails, never a note', async () => {
      // A note reaches no doctor, so an outage must not silently demote a visit.
      aiService.extractFieldReport.mockRejectedValue(new Error('503'));

      const out = await service.ingestFromCall('worker-1', call);

      expect(out.kind).toBe('report');
      expect(fieldNotesService.create).not.toHaveBeenCalled();
      expect(createdWith().rawTranscript).toBe(call.transcript);
      expect(appointmentsService.book).toHaveBeenCalled();
    });

    describe('when the call captured no phone number', () => {
      beforeEach(() => {
        aiService.extractFieldReport.mockResolvedValue({
          ...EMPTY_EXTRACTION,
          subject: { name: 'Sita Devi', phone: null },
        });
      });

      it('uses a synthetic local identity that is not dialable', async () => {
        await service.ingestFromCall('worker-1', call);

        const [phone] = authService.findOrCreatePatientByPhone.mock.calls[0];
        expect(phone).toBe('local:worker-1:sita-devi');
        expect(createdWith().subjectReachable).toBe(false);
      });

      it('resolves the same person to one patient across two calls', async () => {
        await service.ingestFromCall('worker-1', call);
        await service.ingestFromCall('worker-1', call);

        const [[first], [second]] =
          authService.findOrCreatePatientByPhone.mock.calls;
        expect(first).toBe(second);
      });

      it('sends the reply to the worker and gives the doctor their number', async () => {
        await service.ingestFromCall('worker-1', call);

        expect(bookedWith().notifyUser).toBe('user-1');
        expect(bookedWith().bestContactNumber).toBe('+919700000001');
      });

      it('still names the subject rather than deriving one from the key', async () => {
        // placeholderName would turn local:…:sita-devi into "Caller devi".
        await service.ingestFromCall('worker-1', call);
        expect(authService.findOrCreatePatientByPhone).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ name: 'Sita Devi' }),
        );
      });
    });

    it('notifies the patient normally when a real number was captured', async () => {
      aiService.extractFieldReport.mockResolvedValue({
        ...EMPTY_EXTRACTION,
        subject: { name: 'Sita Devi', phone: '+919555512345' },
      });

      await service.ingestFromCall('worker-1', call);

      expect(bookedWith().notifyUser).toBeUndefined();
    });

    it('refuses a token with no worker id', async () => {
      await expect(service.ingestFromCall(undefined, call)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('the worker id', () => {
    it('refuses a token with no worker id instead of writing worker: undefined', async () => {
      await expect(service.submit(undefined, input())).rejects.toThrow(
        ForbiddenException,
      );
      expect(reportModel.create).not.toHaveBeenCalled();
    });

    it('refuses to list without one', async () => {
      await expect(service.listForWorker(undefined)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('findForWorker', () => {
    function findByIdReturns(value: unknown) {
      reportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(value),
      });
    }

    it('returns the worker’s own report', async () => {
      findByIdReturns({ _id: 'report-1', worker: 'worker-1' });
      expect(await service.findForWorker('worker-1', 'report-1')).toEqual(
        expect.objectContaining({ _id: 'report-1' }),
      );
    });

    it('404s on another worker’s report rather than 403', async () => {
      findByIdReturns({ _id: 'report-9', worker: 'worker-2' });
      // A 403 would confirm the id exists.
      await expect(
        service.findForWorker('worker-1', 'report-9'),
      ).rejects.toThrow('Field report not found');
    });
  });
});
