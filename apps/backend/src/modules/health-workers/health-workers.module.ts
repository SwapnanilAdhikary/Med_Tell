import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  HealthWorker,
  HealthWorkerSchema,
} from './schemas/health-worker.schema';
import { HealthWorkersService } from './health-workers.service';
import { HealthWorkersController } from './health-workers.controller';

// Deliberately imports nothing but its own model: AuthModule imports this, so
// any dependency back on Auth would need forwardRef.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HealthWorker.name, schema: HealthWorkerSchema },
    ]),
  ],
  controllers: [HealthWorkersController],
  providers: [HealthWorkersService],
  exports: [HealthWorkersService],
})
export class HealthWorkersModule {}
