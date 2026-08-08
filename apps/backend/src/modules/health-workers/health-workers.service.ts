import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  HealthWorker,
  HealthWorkerDocument,
} from './schemas/health-worker.schema';
import { idFilter } from '../../common/mongoose.util';

@Injectable()
export class HealthWorkersService {
  constructor(
    @InjectModel(HealthWorker.name)
    private readonly workerModel: Model<HealthWorker>,
  ) {}

  async findByUser(
    userId: string | Types.ObjectId,
  ): Promise<HealthWorkerDocument | null> {
    return this.workerModel.findOne(idFilter('user', userId)).exec();
  }

  async findById(id: string | Types.ObjectId): Promise<HealthWorkerDocument> {
    const worker = await this.workerModel.findById(id).exec();
    if (!worker) throw new NotFoundException('Health worker not found');
    return worker;
  }

  async create(data: Partial<HealthWorker>): Promise<HealthWorkerDocument> {
    return this.workerModel.create(data);
  }
}
