import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';

const RESOURCE_DIR = path.resolve(config.rootDir, 'server/resources/integration-toolbox');

const resources = Object.freeze({
  'external-project-admin-integration-instructions': Object.freeze({
    resource_id: 'external-project-admin-integration-instructions',
    display_name: 'External Project Admin Integration Instructions',
    download_filename: 'external_project_admin_integration_instructions.md',
    content_type: 'text/markdown; charset=utf-8',
    file_path: path.join(RESOURCE_DIR, 'external_project_admin_integration_instructions.md'),
  }),
});

export function listIntegrationToolboxResources() {
  return Object.values(resources).map(({ resource_id, display_name, download_filename }) => ({
    resource_id,
    display_name,
    download_filename,
  }));
}

export function getIntegrationToolboxResource(resourceId) {
  const resource = resources[String(resourceId || '')];
  if (!resource) return null;
  const content = fs.readFileSync(resource.file_path, 'utf8');
  return {
    resource_id: resource.resource_id,
    display_name: resource.display_name,
    download_filename: resource.download_filename,
    content_type: resource.content_type,
    content,
  };
}

export default {
  getIntegrationToolboxResource,
  listIntegrationToolboxResources,
};
