import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Facility, FacilitySchema } from './schemas/facility.schema';
import { FacilitiesService } from './facilities.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Facility.name, schema: FacilitySchema },
    ]),
  ],
  providers: [FacilitiesService],
  exports: [FacilitiesService],
})
export class FacilitiesModule {}
