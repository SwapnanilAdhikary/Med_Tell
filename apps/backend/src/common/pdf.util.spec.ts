import { describe, expect, it } from '@jest/globals';
import { winAnsiSafe } from './pdf.util';

describe('winAnsiSafe', () => {
  it('strips Devanagari so no codepoint is above 0xFF', () => {
    const out = winAnsiSafe('प्रिया शर्मा');
    for (const ch of out) {
      expect(ch.codePointAt(0)!).toBeLessThanOrEqual(0xff);
    }
  });

  it('leaves ASCII untouched', () => {
    expect(winAnsiSafe('Priya Sharma')).toBe('Priya Sharma');
  });

  it('preserves Latin-1 characters', () => {
    expect(winAnsiSafe('José café')).toBe('José café');
  });
});
