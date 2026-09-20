import sharp from 'sharp';

// Keep text, colored stamps and faint signatures; no automatic edge trimming.
export function prepareDocumentImage(input) {
  return sharp(input)
    .rotate()
    .resize({ width: 3300, height: 3300, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
