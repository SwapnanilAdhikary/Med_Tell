/**
 * Demo seed for MedAssist.
 *
 * Creates demo doctors, patients, call-back appointments, and a pending
 * verification queue (documents + certificates with AI drafts) so every
 * screen in the app has data to show at the hackathon.
 *
 * Run with: npm run seed --workspace @iem-hacks/backend
 * All demo accounts use the password: demo123
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import * as crypto from 'node:crypto';
import * as mongoose from 'mongoose';
import 'dotenv/config';

const SCRYPT_KEYLEN = 64;

const MONGO_URI =
  process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27018/iem-hacks';

const DEMO_PASSWORD = 'demo123';

function scryptAsync(
  password: string,
  salt: string,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, SCRYPT_KEYLEN)).toString(
    'hex',
  );
  return `${salt}:${hash}`;
}

type SeedRole = 'patient' | 'doctor' | 'health_worker';

interface SeedUser {
  phone: string;
  name: string;
  role: SeedRole;
}

const USERS: SeedUser[] = [
  { phone: '+919876543210', name: 'Priya Sharma', role: 'patient' },
  { phone: '+919876543211', name: 'Rahul Verma', role: 'patient' },
  { phone: '+919876543212', name: 'Meera Das', role: 'patient' },
  { phone: '+919800000001', name: 'Ananya Banerjee', role: 'doctor' },
  { phone: '+919800000002', name: 'Rohan Mehta', role: 'doctor' },
  { phone: '+919800000003', name: 'Sneha Iyer', role: 'doctor' },
  { phone: '+919800000004', name: 'Kavita Ghosh', role: 'doctor' },
  { phone: '+919700000001', name: 'Anjali Roy', role: 'health_worker' },
];


// Coordinates are [lng, lat] and approximate - demo only.
const FACILITIES = [
  {
    name: 'PHC Beldanga',
    type: 'PHC',
    village: 'Beldanga',
    block: 'Beldanga I',
    district: 'Murshidabad',
    state: 'West Bengal',
    coordinates: [88.25, 23.93],
    phone: '+913482250101',
    specialties: ['General Medicine'],
  },
  {
    name: 'CHC Berhampore',
    type: 'CHC',
    village: 'Berhampore',
    block: 'Berhampore',
    district: 'Murshidabad',
    state: 'West Bengal',
    coordinates: [88.25, 24.1],
    phone: '+913482250202',
    specialties: ['General Medicine', 'Pediatrics', 'Obstetrics & Gynaecology'],
  },
  {
    name: 'Murshidabad District Hospital',
    type: 'district-hospital',
    village: 'Berhampore',
    block: 'Berhampore',
    district: 'Murshidabad',
    state: 'West Bengal',
    coordinates: [88.27, 24.11],
    phone: '+913482250303',
    specialties: ['General Medicine', 'Cardiology', 'Surgery'],
  },
];

const DOCTOR_FACILITY: Record<string, string> = {
  '+919800000001': 'PHC Beldanga',
  '+919800000002': 'Murshidabad District Hospital',
  '+919800000003': 'CHC Berhampore',
  '+919800000004': 'CHC Berhampore',
};

// Coordinates are [lng, lat] and approximate - demo only.
const WORKERS: Record<string, Record<string, unknown>> = {
  '+919700000001': {
    cadre: 'ASHA',
    workerCode: 'WB-MSD-ASHA-0142',
    village: 'Beldanga',
    block: 'Beldanga I',
    district: 'Murshidabad',
    state: 'West Bengal',
    coordinates: [88.25, 23.93],
    languages: ['bn', 'hi'],
  },
};

// ponytail: 1x1 PNG stands in for the scanned report - the demo only needs the
// file route to serve something valid. Drop real sample scans in uploads/ to
// exercise the vision model.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const DOCTORS = [
  { phone: '+919800000001', title: 'MBBS, MD', specialty: 'General Medicine' },
  { phone: '+919800000002', title: 'MBBS, DM', specialty: 'Cardiology' },
  { phone: '+919800000003', title: 'MBBS, MD', specialty: 'Pediatrics' },
  // Without her the pregnancy path degrades silently to General Medicine.
  {
    phone: '+919800000004',
    title: 'MBBS, MS',
    specialty: 'Obstetrics & Gynaecology',
  },
];

const PATIENT_DETAILS: Record<
  string,
  { gender: string; bloodGroup: string; language: string }
> = {
  '+919876543210': { gender: 'female', bloodGroup: 'B+', language: 'en' },
  '+919876543211': { gender: 'male', bloodGroup: 'O+', language: 'hi' },
  '+919876543212': { gender: 'female', bloodGroup: 'A+', language: 'bn' },
};

const APPOINTMENTS = [
  {
    patient: '+919876543211',
    reason: 'Persistent headache and mild fever for 3 days',
    aiNotes: {
      symptoms: ['headache', 'fever'],
      recommendedAction: 'General medicine call-back',
    },
  },
  {
    patient: '+919876543212',
    reason: 'Child has had a cough and cold for a week',
    aiNotes: {
      symptoms: ['cough', 'cold'],
      recommendedAction: 'Pediatric call-back',
    },
  },
];

const DOCUMENTS = [
  {
    patient: '+919876543210',
    filename: 'blood-report-priya.png',
    docType: 'Blood Report',
    aiFindings: {
      docType: 'Blood Report',
      text: 'CBC panel: Hb 11.2, WBC 9.4, platelets 240k, ESR 32.',
      summary:
        'Haemoglobin is slightly low (11.2 g/dL), consistent with mild anaemia. Other values are within normal range.',
      abnormalFindings: ['Mild anaemia (Hb 11.2 g/dL)'],
      recommendations: ['Repeat CBC after iron supplementation in 4 weeks'],
      confidence: 0.89,
      disclaimer: 'AI-generated analysis for doctor review. Not a diagnosis.',
      language: 'en',
    },
  },
  {
    patient: '+919876543211',
    filename: 'ecg-report-ravi.png',
    docType: 'ECG',
    aiFindings: {
      docType: 'ECG',
      text: '12-lead ECG, rate 88 bpm. Sinus rhythm. No ST elevation.',
      summary:
        'Normal sinus rhythm at 88 bpm. No acute ischaemic changes detected on the tracing.',
      abnormalFindings: ['Borderline tachycardia (88 bpm)'],
      recommendations: ['Clinical correlation advised for ongoing symptoms'],
      confidence: 0.84,
      disclaimer: 'AI-generated analysis for doctor review. Not a diagnosis.',
      language: 'en',
    },
  },
];

const CERTIFICATES = [
  {
    patient: '+919876543211',
    type: 'sick-leave' as const,
    draft: {
      title: 'Sick Leave Certificate',
      body: 'This is to certify that Mr. Rahul Verma is under my medical care and was advised rest for 3 days due to an upper respiratory tract infection.',
      validFrom: '2026-08-06',
      validTo: '2026-08-09',
    },
  },
  {
    patient: '+919876543212',
    type: 'medical' as const,
    draft: {
      title: 'Medical Certificate',
      body: 'This is to certify that the above-named patient was examined and prescribed medication for a lower respiratory tract infection on this date.',
      validFrom: '2026-08-05',
      validTo: '2026-08-08',
    },
  },
];

async function ensureUser(
  phone: string,
  name: string,
  role: SeedRole,
  userModel: mongoose.Model<any>,
) {
  let user = await userModel.findOne({ phone }).exec();
  if (!user) {
    user = await userModel.create({
      phone,
      name,
      role,
      passwordHash: await hashPassword(DEMO_PASSWORD),
    });
    console.log(`  + user ${phone} (${role})`);
  }
  return user;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI}`);

  const userModel = mongoose.model(
    'User',
    new mongoose.Schema({
      phone: String,
      name: String,
      role: String,
      passwordHash: String,
    }),
    'users',
  );
  const patientModel = mongoose.model(
    'Patient',
    new mongoose.Schema({
      user: mongoose.Schema.Types.ObjectId,
      name: String,
      gender: String,
      bloodGroup: String,
      language: String,
    }),
    'patients',
  );
  const doctorModel = mongoose.model(
    'Doctor',
    new mongoose.Schema({
      user: mongoose.Schema.Types.ObjectId,
      name: String,
      title: String,
      specialty: String,
      facility: mongoose.Schema.Types.ObjectId,
      verified: Boolean,
    }),
    'doctors',
  );
  const facilitySchema = new mongoose.Schema({
    name: String,
    type: String,
    village: String,
    block: String,
    district: String,
    state: String,
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: [Number],
    },
    phone: String,
    specialties: [String],
  });
  facilitySchema.index({ location: '2dsphere' });
  const facilityModel = mongoose.model(
    'Facility',
    facilitySchema,
    'facilities',
  );
  // autoIndex builds asynchronously, so wait for it here or the first $near
  // after a fresh seed can fail with "unable to find index for $geoNear query".
  await facilityModel.createIndexes();
  const healthWorkerModel = mongoose.model(
    'HealthWorker',
    new mongoose.Schema({
      user: mongoose.Schema.Types.ObjectId,
      name: String,
      cadre: String,
      workerCode: String,
      village: String,
      block: String,
      district: String,
      state: String,
      coordinates: [Number],
      languages: [String],
      active: Boolean,
    }),
    'healthworkers',
  );
  const appointmentModel = mongoose.model(
    'Appointment',
    new mongoose.Schema({
      patient: mongoose.Schema.Types.ObjectId,
      doctor: mongoose.Schema.Types.ObjectId,
      type: String,
      status: String,
      reason: String,
      aiNotes: mongoose.Schema.Types.Mixed,
    }),
    'appointments',
  );
  const documentModel = mongoose.model(
    'MedicalDocument',
    new mongoose.Schema({
      patient: mongoose.Schema.Types.ObjectId,
      filename: String,
      mimeType: String,
      size: Number,
      docType: String,
      status: String,
      aiFindings: mongoose.Schema.Types.Mixed,
    }),
    'medicaldocuments',
  );
  const certificateModel = mongoose.model(
    'Certificate',
    new mongoose.Schema({
      patient: mongoose.Schema.Types.ObjectId,
      doctor: mongoose.Schema.Types.ObjectId,
      type: String,
      language: String,
      draftContent: mongoose.Schema.Types.Mixed,
      status: String,
      validFrom: Date,
      validTo: Date,
    }),
    'certificates',
  );
  const verificationModel = mongoose.model(
    'VerificationTask',
    new mongoose.Schema({
      taskType: String,
      refId: mongoose.Schema.Types.ObjectId,
      patient: mongoose.Schema.Types.ObjectId,
      aiOutput: mongoose.Schema.Types.Mixed,
      doctor: mongoose.Schema.Types.ObjectId,
      status: String,
      doctorComment: String,
      reviewedAt: Date,
    }),
    'verificationtasks',
  );
  const notificationModel = mongoose.model(
    'AppNotification',
    new mongoose.Schema({
      user: mongoose.Schema.Types.ObjectId,
      title: String,
      body: String,
      type: String,
      read: Boolean,
      ref: mongoose.Schema.Types.Mixed,
    }),
    'appnotifications',
  );

  // 0. Facilities - doctors reference them, so they come first
  const facilityIds = new Map<string, mongoose.Types.ObjectId>();
  for (const f of FACILITIES) {
    const { coordinates, ...rest } = f;
    let facility = await facilityModel.findOne({ name: f.name }).exec();
    if (!facility) {
      facility = await facilityModel.create({
        ...rest,
        location: { type: 'Point', coordinates },
      });
      console.log(`  + facility ${f.name}`);
    }
    facilityIds.set(f.name, facility._id);
  }

  // 1. Users + profiles
  const userIds = new Map<string, mongoose.Types.ObjectId>();
  const patientIds = new Map<string, mongoose.Types.ObjectId>();
  const doctorIds = new Map<string, mongoose.Types.ObjectId>();

  for (const u of USERS) {
    const user = await ensureUser(u.phone, u.name, u.role, userModel);
    userIds.set(u.phone, user._id);

    if (u.role === 'patient') {
      const detail = PATIENT_DETAILS[u.phone] ?? {
        gender: 'unspecified',
        bloodGroup: 'Unknown',
        language: 'en',
      };
      let patient = await patientModel.findOne({ user: user._id }).exec();
      if (!patient) {
        patient = await patientModel.create({
          user: user._id,
          name: u.name,
          gender: detail.gender,
          bloodGroup: detail.bloodGroup,
          language: detail.language,
        });
        console.log(`  + patient ${u.name}`);
      }
      patientIds.set(u.phone, patient._id);
    } else if (u.role === 'health_worker') {
      const exists = await healthWorkerModel.findOne({ user: user._id }).exec();
      if (!exists) {
        await healthWorkerModel.create({
          user: user._id,
          name: u.name,
          active: true,
          ...WORKERS[u.phone],
        });
        console.log(`  + health worker ${u.name}`);
      }
    } else {
      const d = DOCTORS.find((x) => x.phone === u.phone)!;
      let doctor = await doctorModel.findOne({ user: user._id }).exec();
      if (!doctor) {
        doctor = await doctorModel.create({
          user: user._id,
          name: u.name,
          title: d.title,
          specialty: d.specialty,
          facility: facilityIds.get(DOCTOR_FACILITY[u.phone] ?? ''),
          verified: true,
        });
        console.log(`  + doctor Dr. ${u.name}`);
      }
      doctorIds.set(u.phone, doctor._id);
    }
  }

  // 2. Ensure all doctors are marked verified (self-heals older seeds)
  await doctorModel.updateMany(
    { verified: { $ne: true } },
    { $set: { verified: true } },
  );

  // The findOne guard above skips already-seeded doctors, so backfill the
  // facility link separately or an existing DB never gets one.
  for (const [phone, facilityName] of Object.entries(DOCTOR_FACILITY)) {
    const doctorId = doctorIds.get(phone);
    const facilityId = facilityIds.get(facilityName);
    if (doctorId && facilityId) {
      await doctorModel.updateOne(
        { _id: doctorId, facility: { $ne: facilityId } },
        { $set: { facility: facilityId } },
      );
    }
  }

  // 3. Call-back appointments
  for (const a of APPOINTMENTS) {
    const pid = patientIds.get(a.patient)!;
    const exists = await appointmentModel
      .findOne({ patient: pid, status: 'requested' })
      .exec();
    if (!exists) {
      await appointmentModel.create({
        patient: pid,
        type: 'call-back',
        status: 'requested',
        reason: a.reason,
        aiNotes: a.aiNotes,
      });
      console.log(`  + appointment (${a.patient})`);
    }
  }

  // 3. Documents + verification tasks


  for (const d of DOCUMENTS) {
    const pid = patientIds.get(d.patient)!;
    const exists = await documentModel.findOne({ filename: d.filename }).exec();
    if (!exists) {
      
      const doc = await documentModel.create({
        patient: pid,
        filename: d.filename,
        mimeType: 'image/png',
        size: 0,
        docType: d.docType,
        status: 'awaiting-doctor',
        aiFindings: d.aiFindings,
      });
      await verificationModel.create({
        taskType: 'document',
        refId: doc._id,
        patient: pid,
        aiOutput: d.aiFindings,
        status: 'pending',
      });
      console.log(`  + document ${d.filename}`);
    }
  }

  // 4. Certificates + verification tasks
  for (const c of CERTIFICATES) {
    const pid = patientIds.get(c.patient)!;
    const exists = await certificateModel
      .findOne({ type: c.type, patient: pid, status: 'awaiting-doctor' })
      .exec();
    if (!exists) {
      const cert = await certificateModel.create({
        patient: pid,
        type: c.type,
        language: 'en',
        draftContent: c.draft,
        status: 'awaiting-doctor',
        validFrom: c.draft.validFrom ? new Date(c.draft.validFrom) : undefined,
        validTo: c.draft.validTo ? new Date(c.draft.validTo) : undefined,
      });
      await verificationModel.create({
        taskType: 'certificate',
        refId: cert._id,
        patient: pid,
        aiOutput: { type: c.type, draft: c.draft },
        status: 'pending',
      });
      console.log(`  + certificate (${c.type})`);
    }
  }

  // 5. Notify doctors of pending work
  const pendingCount = await verificationModel.countDocuments({
    status: 'pending',
  });
  // Doctors only - patients must not see the review queue notification.
  for (const phone of doctorIds.keys()) {
    const doctorUserId = userIds.get(phone)!;
    const exists = await notificationModel
      .findOne({
        user: doctorUserId,
        type: 'verification',
        title: 'AI drafts awaiting review',
      })
      .exec();
    if (!exists && pendingCount > 0) {
      await notificationModel.create({
        user: doctorUserId,
        title: 'AI drafts awaiting review',
        body: `${pendingCount} AI-generated draft(s) are waiting for your verification.`,
        type: 'verification',
        read: false,
      });
      console.log(`  + notification for doctor`);
    }
  }

  const summary = await verificationModel.countDocuments({ status: 'pending' });
  console.log('\nSeed complete.');
  console.log(`  Users: ${await userModel.countDocuments()}`);
  console.log(`  Patients: ${await patientModel.countDocuments()}`);
  console.log(`  Doctors: ${await doctorModel.countDocuments()}`);
  console.log(`  Health workers: ${await healthWorkerModel.countDocuments()}`);
  console.log(`  Facilities: ${await facilityModel.countDocuments()}`);
  console.log(`  Pending verification tasks: ${summary}`);
  console.log('\nAll accounts use password: demo123');
  console.log('  Patient demo: +919876543210  | Doctor demo: +919800000001');
  console.log('  ASHA worker demo: +919700000001');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
