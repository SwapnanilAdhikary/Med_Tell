import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FieldNote, FieldNoteSchema } from './schemas/field-note.schema';
import { FieldNotesService } from './field-notes.service';
import { FieldNotesController } from './field-notes.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FieldNote.name, schema: FieldNoteSchema },
    ]),
  ],
  controllers: [FieldNotesController],
  providers: [FieldNotesService],
  exports: [FieldNotesService],
})
export class FieldNotesModule {}
