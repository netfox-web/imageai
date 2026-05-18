import { describe, expect, it } from 'vitest';
import { parseTaskCostMeta } from '../src/lib/taskMeta.js';

describe('provider trace metadata', () => {
  it('parses provider trace, transparent PNG output, and fallback source', () => {
    const meta = parseTaskCostMeta({
      provider: 'fake',
      model: 'fake',
      image_count: 1,
      cost_usd: 0,
      raw_response_json: JSON.stringify({
        provider: 'fake',
        model: 'fake',
        output_format: 'png',
        transparent_background: true,
        image_mode: 'edit',
        used_reference_image: true,
        fallback_used: true,
        fallback_from: 'openai',
        fallback_reason: 'OpenAI image edit failed',
        requested_provider: 'openai',
        resolved_provider: 'openai',
        effective_provider: 'fake',
        requested_capability: 'image_editing',
        edit_options: {
          background: 'transparent',
          output_format: 'png',
          input_fidelity: 'high',
        },
        outputs: [
          {
            mime_type: 'image/png',
            output_format: 'png',
            transparent_background: true,
            image_mode: 'edit',
            used_reference_image: true,
          },
        ],
        provider_trace: {
          requested_provider: 'openai',
          resolved_provider: 'openai',
          effective_provider: 'fake',
          fallback_used: true,
          fallback_from: 'openai',
        },
      }),
    });

    expect(meta.outputFormat).toBe('png');
    expect(meta.transparentBackground).toBe(true);
    expect(meta.imageMode).toBe('edit');
    expect(meta.usedReferenceImage).toBe(true);
    expect(meta.fallbackUsed).toBe(true);
    expect(meta.fallbackFrom).toBe('openai');
    expect(meta.requestedProvider).toBe('openai');
    expect(meta.resolvedProvider).toBe('openai');
    expect(meta.effectiveProvider).toBe('fake');
    expect(meta.requestedCapability).toBe('image_editing');
    expect(meta.editOptions.background).toBe('transparent');
    expect(meta.outputs[0].mime_type).toBe('image/png');
  });
});
