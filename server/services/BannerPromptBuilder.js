import { aspectInstruction, normalizeTargetFormat } from './ImagePostProcessor.js';

function stripBase64LikeText(value) {
  return String(value || '').replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g, '[image omitted]');
}

export function buildBannerPrompt({
  task,
  promptText = '',
  style = null,
  format = {},
  generationSize = '1024x1024',
  input = null,
} = {}) {
  const target = normalizeTargetFormat(format);
  const textInstruction =
    task?.text_mode === 'scene_only'
      ? 'Do not render any words, letters, captions, price tags, watermark text, or typographic marks. Leave clean negative space for later text overlay.'
      : `Render only the intended ad copy clearly: main title "${task?.main_title || ''}" and subtitle "${task?.subtitle || ''}". Do not invent extra words, random glyphs, mojibake, misspellings, fake badges, or illegible text.`;

  return [
    stripBase64LikeText(promptText),
    `Product: ${stripBase64LikeText(task?.product_name || 'Product')}.`,
    `Product analysis summary: ${stripBase64LikeText(task?.custom_prompt || 'Use the uploaded product as the visual source of truth.')}.`,
    input?.role ? `Reference image role: ${input.role}. Preserve the product features visible in this reference.` : '',
    'Preserve the product subject exactly: do not alter its shape, color, material, proportions, packaging, logo placement, brand marks, or recognizable details.',
    'Create a clean, polished commercial advertising background that supports the product without distracting from it.',
    `Style: ${style?.name || task?.style_key || 'default'}${style?.prompt ? `. ${stripBase64LikeText(style.prompt)}` : ''}`,
    `Format: ${target.label || 'custom'} ${target.requestedWidth || 'auto'}x${target.requestedHeight || 'auto'}.`,
    `Aspect guidance: ${aspectInstruction(target)}.`,
    'Text safe area: reserve uncluttered space with enough contrast for headline and subtitle; keep important product details away from edges and platform crop zones.',
    textInstruction,
    `Output language: ${task?.language || 'zh-TW'}.`,
    `OpenAI generation size: ${generationSize}. Compose for the requested final format even if generation size differs.`,
    `Image quality target: ${task?.image_size || '2K'}.`,
    'Avoid distorted products, extra limbs/hands, fake UI, unsafe content, watermarks, QR codes, and low-resolution artifacts.',
  ]
    .filter(Boolean)
    .join('\n');
}
