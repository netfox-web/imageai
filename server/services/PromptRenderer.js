import { GenerationTask, PromptTemplate, StylePreset } from '../models/index.js';

const supportedVariables = [
  'product_name',
  'main_title',
  'subtitle',
  'custom_prompt',
  'style_name',
  'language',
  'image_size',
  'formats',
];

export const fallbackPrompts = {
  analyze_product_images:
    'Analyze the uploaded ecommerce product images. Return JSON with productName, title, subtitle, customPrompt, and imageRoles.',
  banner_generation:
    'Create ecommerce advertising banner creatives for {{product_name}}. Main title: {{main_title}}. Subtitle: {{subtitle}}. Style: {{style_name}}. Language: {{language}}. Size: {{image_size}}. Formats: {{formats}}. Extra direction: {{custom_prompt}}.',
};

export function renderTemplateString(template, variables = {}) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  });
}

export function renderPromptByKey(key, variables = {}, fallback = '') {
  const template = PromptTemplate.activeByKey(key);
  const templateText = template?.user_prompt_template || fallback || fallbackPrompts[key] || '';
  return {
    key,
    template,
    systemPrompt: template?.system_prompt || null,
    userPrompt: renderTemplateString(templateText, variables),
    usedFallback: !template,
  };
}

export function taskPromptVariables(task) {
  const style = task.style_key ? StylePreset.findByKey(task.style_key) : null;
  const formats = GenerationTask.formats(task.id).map((format) => {
    if (format.platform_format_id) {
      return `${format.platform_name || format.platform_key} ${format.format_name} ${format.width}x${format.height}`;
    }
    return `Custom ${format.custom_width}x${format.custom_height}`;
  });

  return {
    product_name: task.product_name || '',
    main_title: task.main_title || '',
    subtitle: task.subtitle || '',
    custom_prompt: task.custom_prompt || '',
    style_name: style?.name || task.style_key || '',
    language: task.language || 'zh-TW',
    image_size: task.image_size || '2K',
    formats,
  };
}

export function supportedPromptVariables() {
  return [...supportedVariables];
}
