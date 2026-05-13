import { config } from '../../config/index.js';
import { ExternalAIProvider } from '../ExternalAIProvider.js';
import { FakeAIProvider } from '../FakeAIProvider.js';

export class DevPilotGatewayProvider extends ExternalAIProvider {
  providerName = 'devpilot-gateway';
  modelName = config.devpilotGatewayModel || 'devpilot-gateway';

  constructor(fallbackProvider = new FakeAIProvider()) {
    super(fallbackProvider);
  }

  async request(endpoint, body) {
    if (!config.devpilotGatewayBaseUrl) {
      throw new Error('DEVPILOT_GATEWAY_BASE_URL is not configured.');
    }
    const response = await fetch(`${config.devpilotGatewayBaseUrl.replace(/\/+$/, '')}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.devpilotGatewayApiKey ? { Authorization: `Bearer ${config.devpilotGatewayApiKey}` } : {}),
      },
      body: JSON.stringify({
        ...body,
        model: config.devpilotGatewayModel || body?.model,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || `DevPilot Gateway request failed with ${response.status}`);
    }
    return payload;
  }
}
