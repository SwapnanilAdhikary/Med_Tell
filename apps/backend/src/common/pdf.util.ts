import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** Strip/replace codepoints pdf-lib Helvetica (WinAnsi) cannot encode. */
export function winAnsiSafe(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    out += cp <= 0xff ? ch : '?';
  }
  return out;
}

export function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  font: PDFFont,
) {
  const words = text.split(/\s+/);
  let line = '';
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, 11) > maxWidth) {
      page.drawText(line, {
        x,
        y: cy,
        size: 11,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
      line = word;
      cy -= lineHeight;
    } else {
      line = test;
    }
  }
  if (line)
    page.drawText(line, {
      x,
      y: cy,
      size: 11,
      font,
      color: rgb(0.15, 0.15, 0.15),
    });
}
