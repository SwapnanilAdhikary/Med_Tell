import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Facility, FacilityDocument } from './schemas/facility.schema';

const DEFAULT_RADIUS_M = 25_000;

/** Area names are tried outward, so the narrowest match wins. */
const AREA_FIELDS = ['village', 'block', 'district'] as const;

export interface AreaHint {
  village?: string;
  block?: string;
  district?: string;
  maxDistanceM?: number;
}

/**
 * GeoJSON is [lng, lat] while `navigator.geolocation` hands back
 * `{latitude, longitude}`. The wire DTO uses named `{lat, lng}` so a tuple is
 * never posted; this range check is the backstop that catches a swap.
 */
export function isLngLat(value?: number[]): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [lng, lat] = value;
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
}

@Injectable()
export class FacilitiesService {
  private readonly logger = new Logger(FacilitiesService.name);

  constructor(
    @InjectModel(Facility.name)
    private readonly facilityModel: Model<Facility>,
  ) {}

  async findById(id: string | Types.ObjectId): Promise<FacilityDocument> {
    const facility = await this.facilityModel.findById(id).exec();
    if (!facility) throw new NotFoundException('Facility not found');
    return facility;
  }

  async list(): Promise<FacilityDocument[]> {
    return this.facilityModel.find().sort({ name: 1 }).exec();
  }

  /**
   * Coordinates first, then area names, then null. A report with no facility is
   * a degraded success, not a failure.
   */
  async findNearest(
    coordinates?: number[],
    area?: AreaHint,
  ): Promise<FacilityDocument | null> {
    if (isLngLat(coordinates)) {
      try {
        // No .sort(): $near already orders by distance and a sort overrides it.
        const near = await this.facilityModel
          .findOne({
            location: {
              $near: {
                $geometry: { type: 'Point', coordinates },
                $maxDistance: area?.maxDistanceM ?? DEFAULT_RADIUS_M,
              },
            },
          })
          .exec();
        if (near) return near;
      } catch (error) {
        this.logger.warn(
          `$near failed, falling back to area names: ${(error as Error).message}`,
        );
      }
    }

    // ponytail: exact match on the seeded spelling. A normalised slug on both
    // sides is the upgrade path; $regex is not, because a village name is user
    // input and would carry metacharacters into the query.
    for (const field of AREA_FIELDS) {
      const value = area?.[field];
      if (!value) continue;
      // Sorted, unlike the $near above: several facilities share a district, and
      // natural order is not stable across updates.
      const hit = await this.facilityModel
        .findOne({ [field]: value })
        .sort({ name: 1 })
        .exec();
      if (hit) return hit;
    }

    return null;
  }

  async create(data: Partial<Facility>): Promise<FacilityDocument> {
    return this.facilityModel.create(data);
  }
}
