import { Types } from 'mongoose';

/**
 * Builds a filter for a Mongo reference field that matches records regardless
 * of whether the stored value is a string or an ObjectId.
 *
 * Mongoose 9 does not cast a bare string to ObjectId in some query paths, so a
 * field stored as ObjectId would never match `{ field: 'string' }`. Matching
 * against both forms keeps legacy (string) and new (ObjectId) data reachable.
 */
export function idFilter(
  field: string,
  id: string | Types.ObjectId,
): Record<string, unknown> {
  const str = String(id);
  const objId =
    id instanceof Types.ObjectId
      ? id
      : Types.ObjectId.isValid(str)
        ? new Types.ObjectId(str)
        : null;
  const candidates: Array<string | Types.ObjectId> = [str];
  if (objId) candidates.unshift(objId);
  return { [field]: { $in: candidates } };
}
