import { listProviders } from './AIProviderRegistry.js';

const sensitiveToolTypes = new Set(['voice_clone', 'lip_sync', 'face_swap', 'avatar_video']);

const toolDefinitions = [
  {
    tool_type: 'banner',
    label: '產品圖文設計',
    required_capability: 'image_generation',
    notes: '產生多尺寸商品廣告素材。',
  },
  {
    tool_type: 'post_generator',
    label: '社群貼文',
    required_capability: 'post_generation',
    notes: '透過文字模型生成貼文與 CTA。',
  },
  {
    tool_type: 'cutout',
    label: '智慧去背',
    required_capability: 'image_editing',
    notes: 'OpenAI 會驗證輸出 PNG 真的含透明背景。',
  },
  {
    tool_type: 'removal',
    label: '智慧去字',
    required_capability: 'image_editing',
    notes: '圖片編修能力；未實作 live provider 時不得誤顯示為成功。',
  },
  {
    tool_type: 'image_mix',
    label: '圖片混合',
    required_capability: 'image_mix',
    notes: '多張參考圖混合生成。',
  },
  {
    tool_type: 'image_to_video',
    label: '圖生影片',
    required_capability: 'image_to_video',
    notes: 'OpenAI 不支援；未設定 live provider 會 failed + refund。',
  },
  {
    tool_type: 'voice_clone',
    label: '聲音克隆',
    required_capability: 'sensitive_media',
    notes: '需 consent，private-by-default，建議只接有審核能力的 live provider。',
  },
  {
    tool_type: 'lip_sync',
    label: '對嘴影片',
    required_capability: 'sensitive_media',
    notes: '需 consent，private-by-default，建議只接有審核能力的 live provider。',
  },
  {
    tool_type: 'face_swap',
    label: '人臉交換',
    required_capability: 'sensitive_media',
    notes: '需 consent，private-by-default，建議只接有審核能力的 live provider。',
  },
  {
    tool_type: 'avatar_video',
    label: 'Avatar 影片',
    required_capability: 'sensitive_media',
    notes: '需 consent，private-by-default，建議只接有審核能力的 live provider。',
  },
  {
    tool_type: 'copywriting',
    label: '文案生成',
    required_capability: 'generate',
    notes: '一般文字生成能力，可支援商品文案與短文案。',
  },
];

function providerNotes(provider, tool) {
  if (provider.name === 'fake') return 'Dev/test placeholder';
  if (tool.tool_type === 'cutout' && provider.name === 'openai') return 'Uses image edit with transparent PNG validation';
  if (tool.tool_type === 'image_to_video' && !provider.capabilities?.includes(tool.required_capability)) {
    return 'Does not expose live image_to_video capability';
  }
  if (['external', 'devpilot-gateway'].includes(provider.name) && provider.capabilities?.includes(tool.required_capability)) {
    return provider.configured ? 'Live/configured provider endpoint' : 'Live capable; requires provider configuration';
  }
  if (!provider.configured && provider.name !== 'fake') return 'Provider credentials are not configured';
  return provider.capabilities?.includes(tool.required_capability) ? 'Supported by registry capability' : 'Not supported by registry capability';
}

function matrixProvider(provider, tool) {
  const supported = Boolean(provider.capabilities?.includes(tool.required_capability));
  const fakeOnly = provider.name === 'fake' && supported;
  return {
    name: provider.name,
    label: provider.label || provider.name,
    supported,
    configured: Boolean(provider.configured),
    live: Boolean(supported && provider.name !== 'fake' && provider.configured),
    fake_only: fakeOnly,
    dev_only: fakeOnly,
    notes: providerNotes(provider, tool),
  };
}

export function buildProviderCapabilityMatrix(currentConfig = undefined) {
  const providers = listProviders(currentConfig);
  return {
    tools: toolDefinitions.map((tool) => ({
      ...tool,
      consent_required: sensitiveToolTypes.has(tool.tool_type),
      private_by_default: sensitiveToolTypes.has(tool.tool_type),
      providers: providers.map((provider) => matrixProvider(provider, tool)),
    })),
  };
}
