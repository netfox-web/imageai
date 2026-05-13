import sharp from 'sharp';

const white = { r: 255, g: 255, b: 255, alpha: 1 };

export function normalizeTargetFormat(format = {}) {
  const width = Number(format.requestedWidth || format.width || format.custom_width || format.customWidth);
  const height = Number(format.requestedHeight || format.height || format.custom_height || format.customHeight);
  return {
    ...format,
    requestedWidth: Number.isFinite(width) && width > 0 ? width : null,
    requestedHeight: Number.isFinite(height) && height > 0 ? height : null,
  };
}

export function formatSlug(format = {}) {
  const target = normalizeTargetFormat(format);
  const label = String(target.label || target.platform_key || target.platform_name || 'custom')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const size = target.requestedWidth && target.requestedHeight ? `${target.requestedWidth}x${target.requestedHeight}` : 'auto';
  return `${label || 'format'}-${size}`;
}

export function buildOutputFilename({ taskId, format, index, ext = 'png' }) {
  return `task-${taskId}-${formatSlug(format)}-${index}.${ext.replace(/^\./, '')}`;
}

export function aspectInstruction(format = {}) {
  const target = normalizeTargetFormat(format);
  const width = target.requestedWidth;
  const height = target.requestedHeight;
  if (!width || !height) return 'default square composition';

  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.02) return '1:1 square composition with balanced center product placement';
  if (Math.abs(ratio - 4 / 5) < 0.02) return '4:5 vertical social feed composition with product in the upper-middle safe area';
  if (Math.abs(ratio - 9 / 16) < 0.02) return '9:16 story/reel composition with vertical safe areas for text';
  if (Math.abs(ratio - 16 / 9) < 0.02) return '16:9 landscape composition with wide horizontal text safe area';
  if (width === 1200 && height === 628) return '1200x628 ad composition with strong left/right text safe zones';
  return `${width}x${height} custom composition with clear text safe zones`;
}

export async function postProcessImage(buffer, { taskId, format, index = 0, outputFormat = 'png' } = {}) {
  const target = normalizeTargetFormat(format);
  const source = sharp(buffer, { failOn: 'none' });
  const metadata = await source.metadata();
  const sourceWidth = Number(metadata.width || 0);
  const sourceHeight = Number(metadata.height || 0);
  const targetWidth = target.requestedWidth || sourceWidth || 1024;
  const targetHeight = target.requestedHeight || sourceHeight || 1024;
  const needsPadding = sourceWidth < targetWidth || sourceHeight < targetHeight;

  const pipeline = source.resize(targetWidth, targetHeight, {
    fit: needsPadding ? 'contain' : 'cover',
    position: 'centre',
    background: white,
    withoutEnlargement: needsPadding,
  });

  const outputBuffer =
    outputFormat === 'jpg' || outputFormat === 'jpeg'
      ? await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer()
      : await pipeline.png().toBuffer();
  const outputMetadata = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    filename: buildOutputFilename({ taskId, format: target, index, ext: outputFormat === 'jpg' ? 'jpg' : 'png' }),
    width: outputMetadata.width,
    height: outputMetadata.height,
    file_size: outputBuffer.length,
    mime_type: outputFormat === 'jpg' || outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
    postprocess: {
      source_width: sourceWidth || null,
      source_height: sourceHeight || null,
      target_width: targetWidth,
      target_height: targetHeight,
      strategy: needsPadding ? 'contain-pad' : 'cover-crop',
      output_format: outputFormat,
    },
  };
}
