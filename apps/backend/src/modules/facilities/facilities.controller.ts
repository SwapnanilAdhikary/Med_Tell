import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FacilitiesService } from './facilities.service';

class NearbyQuery {
  // Query strings need @Type to reach the numeric validators at all.
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lng!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(500)
  @Max(50_000)
  radiusM?: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('facilities')
export class FacilitiesController {
  constructor(private readonly facilitiesService: FacilitiesService) {}

  /** The seeded, authoritative facilities - the ones doctors are attached to. */
  @Get()
  @Roles('health_worker', 'doctor', 'admin')
  list() {
    return this.facilitiesService.list();
  }

  /** Community-mapped facilities from OpenStreetMap. Empty array if Overpass is down. */
  @Get('nearby')
  @Roles('health_worker', 'doctor', 'admin')
  nearby(@Query() query: NearbyQuery) {
    return this.facilitiesService.listPublicNearby(
      query.lat,
      query.lng,
      query.radiusM,
    );
  }
}
