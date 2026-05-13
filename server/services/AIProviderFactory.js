import { config } from '../config/index.js';
import { getProvider } from './AIProviderRegistry.js';

export function resolveAIProvider(providerName = config.aiProvider) {
  return getProvider(providerName || 'fake');
}
