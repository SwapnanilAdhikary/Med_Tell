import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FieldNote, FieldNoteDocument } from './schemas/field-note.schema';
import { idFilter } from '../../common/mongoose.util';

export interface NoteInput {
  title?: string;
  body?: string;
  village?: string;
  pinned?: boolean;
  geo?: { lat: number; lng: number };
}

/** First line of the body, the way a notes app titles an untitled note. */
function deriveTitle(input: NoteInput): string {
  const first = (input.title ?? input.body ?? '').trim().split('\n')[0];
  return first.slice(0, 120) || 'New note';
}

@Injectable()
export class FieldNotesService {
  constructor(
    @InjectModel(FieldNote.name)
    private readonly noteModel: Model<FieldNote>,
  ) {}

  private requireWorker(workerId?: string): string {
    if (!workerId) {
      throw new ForbiddenException('No health worker linked to this account');
    }
    return workerId;
  }

  async create(workerId: string | undefined, input: NoteInput) {
    const worker = this.requireWorker(workerId);
    return this.noteModel.create({
      worker,
      title: deriveTitle(input),
      body: input.body ?? '',
      village: input.village,
      pinned: input.pinned ?? false,
      point: input.geo
        ? { type: 'Point', coordinates: [input.geo.lng, input.geo.lat] }
        : undefined,
    });
  }

  async list(workerId: string | undefined) {
    const worker = this.requireWorker(workerId);
    return this.noteModel
      .find(idFilter('worker', worker))
      .sort({ pinned: -1, updatedAt: -1 })
      .lean()
      .exec();
  }

  private async own(workerId: string, id: string): Promise<FieldNoteDocument> {
    const note = await this.noteModel.findById(id).exec();
    // 404 not 403: a worker must not learn that another worker's note id exists.
    if (!note || String(note.worker) !== String(workerId)) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  async update(workerId: string | undefined, id: string, input: NoteInput) {
    const note = await this.own(this.requireWorker(workerId), id);
    if (input.body != null) note.body = input.body;
    if (input.title != null || input.body != null) {
      note.title = deriveTitle({ title: input.title, body: note.body });
    }
    if (input.pinned != null) note.pinned = input.pinned;
    await note.save();
    return note;
  }

  async remove(workerId: string | undefined, id: string) {
    const note = await this.own(this.requireWorker(workerId), id);
    await note.deleteOne();
    return { ok: true };
  }
}
