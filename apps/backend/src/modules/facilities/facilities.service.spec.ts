import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { FacilitiesService, isLngLat } from './facilities.service';
import { Facility } from './schemas/facility.schema';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

describe('FacilitiesService.findNearest', () => {
  let service: FacilitiesService;

  const facilityModel = { findOne: jest.fn(), find: jest.fn() };

  /** One queued result per findOne call, in order. */
  function findOneSequence(...values: unknown[]) {
    facilityModel.findOne.mockReset();
    for (const value of values) {
      facilityModel.findOne.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(value),
      });
    }
  }

  function findOneRejects(error: Error) {
    facilityModel.findOne.mockReturnValueOnce({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(error),
    });
  }

  /** The filter passed to the nth findOne call. */
  function filterOf(call: number): Record<string, any> {
    return facilityModel.findOne.mock.calls[call][0] as Record<string, any>;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacilitiesService,
        { provide: getModelToken(Facility.name), useValue: facilityModel },
      ],
    }).compile();
    service = module.get(FacilitiesService);
  });

  it('queries $near with the coordinates in [lng, lat] order', async () => {
    findOneSequence({ name: 'PHC Beldanga' });

    const found = await service.findNearest([88.25, 23.93]);

    expect(found).toEqual({ name: 'PHC Beldanga' });
    expect(filterOf(0).location.$near.$geometry).toEqual({
      type: 'Point',
      coordinates: [88.25, 23.93],
    });
  });

  it('defaults to a 25 km radius and honours an override', async () => {
    findOneSequence({ name: 'PHC Beldanga' }, { name: 'PHC Beldanga' });

    await service.findNearest([88.25, 23.93]);
    expect(filterOf(0).location.$near.$maxDistance).toBe(25_000);

    await service.findNearest([88.25, 23.93], { maxDistanceM: 5_000 });
    expect(filterOf(1).location.$near.$maxDistance).toBe(5_000);
  });

  it('never issues a $near when there are no coordinates', async () => {
    findOneSequence({ name: 'CHC Berhampore' });

    await service.findNearest(undefined, { village: 'Berhampore' });

    expect(filterOf(0)).toEqual({ village: 'Berhampore' });
  });

  it('tries village, then block, then district', async () => {
    findOneSequence(null, null, { name: 'Murshidabad District Hospital' });

    const found = await service.findNearest(undefined, {
      village: 'Nowhere',
      block: 'Nowhere I',
      district: 'Murshidabad',
    });

    expect(found).toEqual({ name: 'Murshidabad District Hospital' });
    expect(facilityModel.findOne.mock.calls.map((c) => c[0])).toEqual([
      { village: 'Nowhere' },
      { block: 'Nowhere I' },
      { district: 'Murshidabad' },
    ]);
  });

  it('falls back to area names when $near rejects, instead of propagating', async () => {
    // What a cold DB does before the 2dsphere index finishes building.
    findOneRejects(new Error('unable to find index for $geoNear query'));
    facilityModel.findOne.mockReturnValueOnce({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ name: 'PHC Beldanga' }),
    });

    const found = await service.findNearest([88.25, 23.93], {
      village: 'Beldanga',
    });

    expect(found).toEqual({ name: 'PHC Beldanga' });
    expect(filterOf(1)).toEqual({ village: 'Beldanga' });
  });

  it('returns null when neither coordinates nor area names match', async () => {
    findOneSequence(null, null);

    expect(
      await service.findNearest([88.25, 23.93], { village: 'Nowhere' }),
    ).toBeNull();
  });

  it('treats a bad coordinate pair as absent', async () => {
    for (const bad of [[200, 10], [10], [], undefined, [88.25, 200]]) {
      facilityModel.findOne.mockReset();
      findOneSequence({ name: 'CHC Berhampore' });

      await service.findNearest(bad, { village: 'Berhampore' });

      expect(filterOf(0)).toEqual({ village: 'Berhampore' });
    }
  });
});

describe('isLngLat', () => {
  it('accepts a valid pair and rejects a swapped or short one', () => {
    expect(isLngLat([88.25, 23.93])).toBe(true);
    expect(isLngLat([-180, -90])).toBe(true);
    expect(isLngLat([200, 10])).toBe(false);
    expect(isLngLat([10, 200])).toBe(false);
    expect(isLngLat([10])).toBe(false);
    expect(isLngLat([1, 2, 3])).toBe(false);
    expect(isLngLat(undefined)).toBe(false);
    expect(isLngLat([Number.NaN, 20])).toBe(false);
  });
});
