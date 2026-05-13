import fs from 'node:fs/promises';
import path from 'node:path';
import { all } from '../db/database.js';
import { GenerationTask } from '../models/index.js';
import { storageUrl } from './StorageService.js';
import { parseCostLogMeta, safeRawResponse } from './AdminService.js';

function parseIds(value = '') {
  return String(value)
    .split(',')
    .map((item) => Number(item.trim()))
    .filter(Boolean);
}

export function selectQualityTasks({ taskIds = [], recentLimit = 10 } = {}) {
  if (taskIds.length) {
    const placeholders = taskIds.map(() => '?').join(', ');
    return all(`SELECT * FROM generation_tasks WHERE id IN (${placeholders}) ORDER BY id DESC`, taskIds);
  }
  return all('SELECT * FROM generation_tasks ORDER BY id DESC LIMIT ?', [Number(recentLimit || 10)]);
}

export function buildQualityReviewMarkdown(tasks) {
  const lines = ['# AI Creative Quality Review', ''];
  if (!tasks.length) {
    lines.push('_No tasks found for review._');
    return lines.join('\n');
  }

  tasks.forEach((task) => {
    const outputs = GenerationTask.images(task.id, 'output').map((image) => ({ ...image, url: storageUrl(image.storage_path) }));
    const log = GenerationTask.costLogs(task.id)[0] || null;
    const meta = parseCostLogMeta(log);
    const reviews = all('SELECT * FROM quality_reviews WHERE task_id = ? ORDER BY id DESC', [task.id]);
    const promptSummary = safeRawResponse(log?.raw_response_json)?.raw?.prompt || task.custom_prompt || '';
    lines.push(`## Task #${task.id}`);
    lines.push('');
    lines.push(`- status: ${task.status}`);
    lines.push(`- provider: ${meta.provider || '-'}`);
    lines.push(`- image_mode: ${meta.image_mode || '-'}`);
    lines.push(`- used_reference_image: ${meta.used_reference_image ? 'yes' : 'no'}`);
    lines.push(`- product: ${task.product_name || '-'} / ${task.main_title || '-'}`);
    lines.push(`- latency_ms: ${meta.latency_ms ?? '-'}`);
    lines.push(`- cost: ${meta.cost ?? '-'}`);
    lines.push(`- fallback: ${meta.fallback_used ? `yes (${meta.fallback_reason || 'no reason'})` : 'no'}`);
    lines.push(`- prompt summary: ${String(promptSummary || '').slice(0, 500) || '-'}`);
    lines.push('- output URLs:');
    if (outputs.length) {
      outputs.forEach((image) => lines.push(`  - ${image.url}`));
    } else {
      lines.push('  - _No output images_');
    }
    lines.push('');
    lines.push('| Review item | Result |');
    lines.push('| --- | --- |');
    lines.push('| product_preserved | pass/fail |');
    lines.push('| no_garbled_text | pass/fail |');
    lines.push('| composition_ok | pass/fail |');
    lines.push('| size_ok | pass/fail |');
    lines.push('| commercial_quality | 1-5 |');
    lines.push('| notes |  |');
    if (reviews.length) {
      lines.push('');
      lines.push('Saved reviews:');
      reviews.forEach((review) => {
        lines.push(`- image: ${review.task_image_id || 'task'}; status: ${review.approved ? 'approved' : review.needs_regeneration ? 'needs_regeneration' : 'pending'}; product_preserved: ${review.product_preserved || '-'}; no_garbled_text: ${review.no_garbled_text || '-'}; composition_ok: ${review.composition_ok || '-'}; size_ok: ${review.size_ok || '-'}; commercial_quality: ${review.commercial_quality || '-'}; regeneration_reason: ${review.regeneration_reason || '-'}; notes: ${review.notes || '-'}`);
      });
    }
    lines.push('');
  });
  return lines.join('\n');
}

export async function runQualityReview(env = process.env) {
  const taskIds = parseIds(env.QUALITY_TASK_IDS || '');
  const recentLimit = Number(env.QUALITY_RECENT_LIMIT || 10);
  const tasks = selectQualityTasks({ taskIds, recentLimit });
  const markdown = buildQualityReviewMarkdown(tasks);
  if (env.QUALITY_REVIEW_PATH) {
    await fs.mkdir(path.dirname(env.QUALITY_REVIEW_PATH), { recursive: true });
    await fs.writeFile(env.QUALITY_REVIEW_PATH, markdown);
  }
  return { tasks, markdown };
}
