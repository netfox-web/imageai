#!/usr/bin/env node
import { toFile } from 'openai';
import sharp from 'sharp';
import { config } from '../config/index.js';
import { OpenAIProvider } from '../services/OpenAIProvider.js';

async function main() {
  if (!config.openaiApiKey) {
    console.log('Skipped OpenAI cutout smoke: OPENAI_API_KEY is not configured.');
    process.exit(0);
  }

  const provider = new OpenAIProvider();
  const input = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: '#facc15',
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 140,
            height: 140,
            channels: 4,
            background: '#111827',
          },
        })
          .png()
          .toBuffer(),
        top: 58,
        left: 58,
      },
    ])
    .png()
    .toBuffer();

  const image = await toFile(input, 'openai-cutout-smoke-input.png', { type: 'image/png' });
  const response = await provider.imagesEdit({
    model: config.openaiImageModel,
    image,
    prompt: [
      'Remove the background from this simple product-like test image.',
      'Return only the foreground subject on a transparent background.',
    ].join('\n'),
    size: config.openaiImageSize || '1024x1024',
    n: 1,
    background: 'transparent',
    output_format: 'png',
    input_fidelity: 'high',
  });

  const output = response.data?.[0];
  if (!output?.b64_json && !output?.url) {
    throw new Error('OpenAI image edit did not return b64_json or url output.');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        provider: provider.providerName,
        model: config.openaiImageModel,
        endpoint: 'images.edit',
        background: 'transparent',
        output_format: 'png',
        input_fidelity: 'high',
        response_type: output.b64_json ? 'b64_json' : 'url',
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('OpenAI cutout smoke failed:', error.message);
  process.exit(1);
});
