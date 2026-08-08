import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DoctorsService } from './doctors.service';
import { Doctor } from './schemas/doctor.schema';

function doctor(name: string, specialty: string, languages: string[] = []) {
  return { _id: name, name, specialty, languages, verified: true };
}

const ROSTER = [
  doctor('Ananya Banerjee', 'General Medicine', ['en', 'bn']),
  doctor('Rohan Mehta', 'Cardiology', ['en', 'hi']),
  doctor('Sneha Iyer', 'Pediatrics', ['en']),
];

describe('DoctorsService.findBestMatch', () => {
  let service: DoctorsService;

  const doctorModel = { find: jest.fn(), findById: jest.fn(), findOne: jest.fn() };

  function rosterIs(roster: unknown[]) {
    doctorModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(roster),
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorsService,
        { provide: getModelToken(Doctor.name), useValue: doctorModel },
      ],
    }).compile();
    service = module.get(DoctorsService);
  });

  it('only considers verified doctors', async () => {
    rosterIs(ROSTER);
    await service.findBestMatch('Cardiology');
    expect(doctorModel.find).toHaveBeenCalledWith({ verified: true });
  });

  it('matches an exact specialty', async () => {
    rosterIs(ROSTER);
    const match = await service.findBestMatch('Cardiology');
    expect(match?.name).toBe('Rohan Mehta');
  });

  it('matches case-insensitively', async () => {
    rosterIs(ROSTER);
    expect((await service.findBestMatch('CARDIOLOGY'))?.name).toBe(
      'Rohan Mehta',
    );
  });

  it('matches the wording the AI actually uses', async () => {
    rosterIs(ROSTER);
    // The model says "Cardiologist" / "Paediatric Medicine", not the roster's exact label.
    expect((await service.findBestMatch('Cardiologist'))?.name).toBe(
      'Rohan Mehta',
    );
    expect((await service.findBestMatch('Paediatrics'))?.name).toBe(
      'Sneha Iyer',
    );
    expect((await service.findBestMatch('Pediatric Medicine'))?.name).toBe(
      'Sneha Iyer',
    );
  });

  it('falls back to General Medicine for an unknown specialty', async () => {
    rosterIs(ROSTER);
    const match = await service.findBestMatch('Astrology');
    expect(match?.name).toBe('Ananya Banerjee');
  });

  it('breaks a specialty tie on the patient language', async () => {
    rosterIs([
      doctor('Amit Roy', 'Cardiology', ['en']),
      doctor('Zoya Khan', 'Cardiology', ['en', 'bn']),
    ]);
    const match = await service.findBestMatch('Cardiology', 'bn');
    expect(match?.name).toBe('Zoya Khan');
  });

  it('still returns a doctor when no specialty is given', async () => {
    rosterIs(ROSTER);
    const match = await service.findBestMatch();
    expect(match?.name).toBe('Ananya Banerjee');
  });

  it('returns null when nobody is verified', async () => {
    rosterIs([]);
    expect(await service.findBestMatch('Cardiology')).toBeNull();
  });

  it('does not blow up on punctuation or regex metacharacters', async () => {
    rosterIs(ROSTER);
    // Falls back rather than throwing an invalid-regex error.
    expect((await service.findBestMatch('c++ (*heart*)'))?.name).toBe(
      'Ananya Banerjee',
    );
  });
});
