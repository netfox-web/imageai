import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { all, asyncTransaction } from '../db/database.js';
import { GenerationTask, TaskFormat, TaskImage, User } from '../models/index.js';
import { creditService } from './CreditService.js';
import { validateImageFiles } from './FileValidation.js';
import { resolveStoragePath, storageService, storageUrl } from './StorageService.js';
import { queueService } from './QueueService.js';
import { resolveProviderSelection } from './ProviderSelectionService.js';

const validTools = new Set(['banner', 'translation', 'cutout', 'removal']);
const validRoles = new Set(['cover', 'white_bg', 'feature', 'scenario', 'detail', 'comparison', 'multi_use', 'info']);

function parseJsonField(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const parsed = parseJsonField(value, null);
  if (Array.isArray(parsed)) return parsed;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function taskPayloadFromRequest(body, files) {
  const formatIds = asArray(body.platform_format_ids || body.format_ids).map(Number).filter(Boolean);
  const customFormats = asArray(body.custom_formats || body.customFormats)
    .map((format) => ({
      custom_width: Number(format.custom_width || format.width),
      custom_height: Number(format.custom_height || format.height),
    }))
    .filter((format) => format.custom_width && format.custom_height);

  return {
    tool_type: body.tool_type || 'banner',
    product_name: body.product_name || null,
    main_title: body.main_title || null,
    subtitle: body.subtitle || null,
    custom_prompt: body.custom_prompt || null,
    style_key: body.style_key || null,
    title_style_key: body.title_style_key || null,
    subtitle_style_key: body.subtitle_style_key || null,
    text_mode: body.text_mode || null,
    language: body.language || 'zh-TW',
    image_size: body.image_size || '2K',
    logo_mode: body.logo_mode || 'keep',
    quantity: Math.min(Math.max(Number(body.quantity || 1), 1), 4),
    input_roles: asArray(body.input_roles),
    platform_format_ids: formatIds,
    custom_formats: customFormats,
    image_count: files.length,
    provider: body.provider || body.requested_provider || '',
    model: body.model || body.requested_model || '',
    capability: body.capability || body.requested_capability || 'generate',
    strict_provider: body.strict_provider === 'true' || body.strict_provider === true || body.strict_provider === '1',
    quality_review_required:
      body.quality_review_required === 'true' || body.quality_review_required === true || body.quality_review_required === '1',
  };
}

function validateTaskPayload(payload, files) {
  validateImageFiles(files);

  if (!validTools.has(payload.tool_type)) {
    throw validationError('不支援的工具類型');
  }

  if (payload.tool_type === 'banner') {
    if (!payload.style_key) throw validationError('請選擇圖片風格');
    if (!payload.text_mode || !['merged', 'scene_only'].includes(payload.text_mode)) {
      throw validationError('請選擇文字生成模式');
    }
    const selectedCount = payload.platform_format_ids.length + payload.custom_formats.length;
    if (selectedCount < 1) {
      throw validationError('請至少選擇一個平台尺寸、固定比例或自訂尺寸');
    }
  }

  payload.custom_formats.forEach((format) => {
    if (
      format.custom_width < 100 ||
      format.custom_width > 4096 ||
      format.custom_height < 100 ||
      format.custom_height > 4096
    ) {
      throw validationError('自訂尺寸需介於 100 到 4096');
    }
  });
}

async function writeInputFile(file, taskId, index) {
  const ext = path.extname(file.originalname).toLowerCase();
  const filename = `task-${taskId}-${index}-${randomUUID()}${ext}`;
  return storageService.putUpload(file, filename);
}

async function cleanup(files) {
  for (const storagePath of files) {
    await storageService.delete(storagePath).catch(() => {
      if (storagePath.startsWith('uploads/') || storagePath.startsWith('outputs/')) {
        const absolutePath = resolveStoragePath(storagePath);
        if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
      }
    });
  }
}

export class TaskService {
  async createTask(userId, body, files) {
    const user = User.find(userId);
    if (!user) {
      throw validationError('請先登入', 401);
    }
    if (user.status !== 'active') {
      throw validationError('帳號已停權，無法建立任務', 403);
    }

    const payload = taskPayloadFromRequest(body, files || []);
    validateTaskPayload(payload, files || []);
    if (Number(user.credits_balance || 0) < Number(config.minCreditsToCreateTask || 0)) {
      throw validationError(`點數不足，至少需要 ${config.minCreditsToCreateTask} 點才能建立任務。`, 422);
    }
    const providerSelection = resolveProviderSelection({
      requestedProvider: payload.provider,
      requestedModel: payload.model,
      capability: payload.capability,
      strict: payload.provider ? payload.strict_provider : config.aiStrictProvider,
    });
    payload.provider = providerSelection.resolved_provider || 'fake';
    const creditsCost = creditService.calculateTaskCost(payload);
    if (!creditService.hasEnoughCredits(user, creditsCost)) {
      throw validationError(`點數不足，本次需要 ${creditsCost} 點`, 422);
    }

    const savedFiles = [];
    let taskId;
    try {
      await asyncTransaction(async () => {
        taskId = GenerationTask.create({
          user_id: user.id,
          tool_type: payload.tool_type,
          status: 'pending',
          product_name: payload.product_name,
          main_title: payload.main_title,
          subtitle: payload.subtitle,
          custom_prompt: payload.custom_prompt,
          style_key: payload.style_key,
          title_style_key: payload.title_style_key,
          subtitle_style_key: payload.subtitle_style_key,
          text_mode: payload.text_mode,
          language: payload.language,
          image_size: payload.image_size,
          logo_mode: payload.logo_mode,
          quantity: payload.quantity,
          credits_cost: creditsCost,
          failure_refunded: 0,
          error_message: null,
          started_at: null,
          finished_at: null,
          deleted_at: null,
          requested_provider: providerSelection.requested_provider,
          resolved_provider: providerSelection.resolved_provider,
          requested_model: providerSelection.requested_model,
          resolved_model: providerSelection.resolved_model,
          requested_capability: providerSelection.requested_capability,
          provider_config_source: providerSelection.provider_config_source,
          provider_selection_reason: providerSelection.provider_selection_reason,
          fallback_reason: providerSelection.fallback_reason,
          strict_provider: payload.strict_provider ? 1 : 0,
          quality_review_required: payload.quality_review_required ? 1 : 0,
        });

        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const storagePath = await writeInputFile(file, taskId, index);
          savedFiles.push(storagePath);
          const requestedRole = payload.input_roles[index];
          TaskImage.create({
            task_id: taskId,
            type: 'input',
            role: validRoles.has(requestedRole) ? requestedRole : null,
            storage_path: storagePath,
            width: null,
            height: null,
            file_size: file.size,
            mime_type: file.mimetype,
            sort_order: index,
          });
        }

        payload.platform_format_ids.forEach((formatId) => {
          TaskFormat.create({
            task_id: taskId,
            platform_format_id: formatId,
            custom_width: null,
            custom_height: null,
          });
        });

        payload.custom_formats.forEach((format) => {
          TaskFormat.create({
            task_id: taskId,
            platform_format_id: null,
            custom_width: format.custom_width,
            custom_height: format.custom_height,
          });
        });

        creditService.consume(user, creditsCost, taskId, '建立生成任務扣點');
      });
    } catch (error) {
      await cleanup(savedFiles);
      throw error;
    }

    queueService.dispatchGenerateTask(taskId);
    return {
      task_id: taskId,
      redirect_url: `/tasks/${taskId}`,
      credits_cost: creditsCost,
    };
  }

  serializeTask(task, currentUser) {
    if (!task) return null;
    if (task.user_id !== currentUser.id && currentUser.role !== 'admin') {
      throw validationError('沒有權限查看此任務', 403);
    }
    const images = GenerationTask.images(task.id).map((image) => ({
      ...image,
      url: storageUrl(image.storage_path),
    }));
    return {
      ...task,
      images,
      input_images: images.filter((image) => image.type === 'input'),
      output_images: images.filter((image) => image.type === 'output'),
      formats: GenerationTask.formats(task.id),
      ai_cost_logs: GenerationTask.costLogs(task.id),
      quality_reviews: all('SELECT * FROM quality_reviews WHERE task_id = ? ORDER BY id DESC', [Number(task.id)]),
    };
  }
}

function validationError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export const taskService = new TaskService();
