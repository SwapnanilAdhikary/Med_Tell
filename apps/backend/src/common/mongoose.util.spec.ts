import { Types } from 'mongoose';
import { idFilter } from './mongoose.util';

describe('idFilter', () => {
  it('matches both ObjectId and string stored refs for a valid id', () => {
    const filter = idFilter('patient', '6a755626c917485504d08ea7');
    const candidates = (
      filter.patient as { $in: Array<string | Types.ObjectId> }
    ).$in;

    expect(candidates).toHaveLength(2);
    expect(String(candidates[0])).toBe('6a755626c917485504d08ea7');
    expect(candidates[0]).toBeInstanceOf(Types.ObjectId);
    expect(candidates[1]).toBe('6a755626c917485504d08ea7');
  });

  it('accepts an existing ObjectId instance', () => {
    const id = new Types.ObjectId('6a755626c917485504d08ea7');
    const filter = idFilter('doctor', id);
    const candidates = (
      filter.doctor as { $in: Array<string | Types.ObjectId> }
    ).$in;

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe(id);
    expect(candidates[1]).toBe(id.toString());
  });

  it('only uses the string form when the id is not a valid ObjectId', () => {
    const filter = idFilter('user', 'legacy-string-id');
    const candidates = (filter.user as { $in: Array<string | Types.ObjectId> })
      .$in;

    expect(candidates).toEqual(['legacy-string-id']);
  });

  it('uses the requested field name', () => {
    const filter = idFilter('refId', '6a755626c917485504d08ea7');
    expect(filter.refId).toBeDefined();
    expect(filter.patient).toBeUndefined();
  });
});
