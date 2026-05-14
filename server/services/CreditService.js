import { get, now, run } from '../db/database.js';
import { CreditTransaction, GenerationTask, User } from '../models/index.js';
import { config } from '../config/index.js';

const bannerRates = {
  '2K': 15,
  '4K': 30,
};

export class CreditService {
  calculateTaskCost(payload) {
    const toolType = payload.tool_type || payload.toolType;
    const imageCount = Number(payload.image_count || payload.imageCount || payload.files?.length || 0);

    if (toolType === 'banner') {
      const imageSize = payload.image_size || payload.imageSize || '2K';
      const selectedFormats = Number(
        payload.selected_format_count ||
          payload.selectedFormatCount ||
          payload.formatIds?.length ||
          payload.platform_format_ids?.length ||
          payload.formats?.length ||
          0,
      );
      const customFormatCount = Number(payload.custom_formats?.length || payload.customFormats?.length || 0);
      const quantity = Math.min(Math.max(Number(payload.quantity || 1), 1), 4);
      const totalOutputs = imageCount * (selectedFormats + customFormatCount) * quantity;
      const provider = payload.provider || config.aiProvider || 'fake';
      if (provider === 'fake') return totalOutputs * Number(config.fakeTaskCost || 0);
      if (provider === 'openai') return totalOutputs * Number(config.openaiTaskEstimatedCostCredits || 0);
      if (provider === 'gemini') return totalOutputs * Number(config.geminiTaskEstimatedCostCredits || 0);
      if (provider === 'claude') return totalOutputs * Number(config.claudeTaskEstimatedCostCredits || 0);
      return totalOutputs * (bannerRates[imageSize] || bannerRates['2K']);
    }

    return (config.aiProvider === 'fake' ? Number(config.fakeTaskCost || 0) : 1) * imageCount;
  }

  hasEnoughCredits(user, cost) {
    return Number(user?.credits_balance || 0) >= Number(cost || 0);
  }

  consume(user, amount, relatedTaskId = null, note = '建立生成任務') {
    const current = User.find(user.id);
    if (!this.hasEnoughCredits(current, amount)) {
      const error = new Error('點數不足');
      error.status = 422;
      throw error;
    }

    const balanceAfter = Number(current.credits_balance) - Number(amount);
    run('UPDATE users SET credits_balance = ?, updated_at = ? WHERE id = ?', [balanceAfter, now(), current.id]);
    CreditTransaction.create({
      user_id: current.id,
      type: 'consume',
      amount: -Math.abs(Number(amount)),
      balance_after: balanceAfter,
      related_task_id: relatedTaskId,
      note,
    });
    return balanceAfter;
  }

  refund(user, amount, relatedTaskId = null, note = '任務失敗退點') {
    const current = User.find(user.id);
    const balanceAfter = Number(current.credits_balance) + Number(amount);
    run('UPDATE users SET credits_balance = ?, updated_at = ? WHERE id = ?', [balanceAfter, now(), current.id]);
    CreditTransaction.create({
      user_id: current.id,
      type: 'refund',
      amount: Math.abs(Number(amount)),
      balance_after: balanceAfter,
      related_task_id: relatedTaskId,
      note,
    });
    return balanceAfter;
  }

  adminAdjust(userId, amount, note, options = {}) {
    const user = User.find(userId);
    if (!user) {
      const error = new Error('找不到使用者');
      error.status = 404;
      throw error;
    }
    if (!note || !String(note).trim()) {
      const error = new Error('補點 / 扣點必須填寫 note');
      error.status = 422;
      throw error;
    }
    const nextBalance = Number(user.credits_balance) + Number(amount);
    if (nextBalance < 0 && !options.allowNegativeBalance) {
      const error = new Error('Credit balance cannot become negative without explicit override.');
      error.status = 422;
      throw error;
    }
    const balanceAfter = options.allowNegativeBalance ? nextBalance : Math.max(0, nextBalance);
    run('UPDATE users SET credits_balance = ?, updated_at = ? WHERE id = ?', [balanceAfter, now(), user.id]);
    CreditTransaction.create({
      user_id: user.id,
      type: 'admin_adjust',
      amount: Number(amount),
      balance_after: balanceAfter,
      related_task_id: null,
      note,
    });
    return User.find(user.id);
  }

  refundFailedTask(taskId, errorMessage = 'AI provider failed') {
    const task = GenerationTask.find(taskId);
    if (!task) return null;

    if (config.refundOnFailure && !Number(task.failure_refunded) && Number(task.credits_cost) > 0) {
      const user = User.find(task.user_id);
      this.refund(user, task.credits_cost, task.id, '任務失敗自動退點');
      GenerationTask.update(task.id, {
        failure_refunded: 1,
        status: 'failed',
        error_message: errorMessage,
        finished_at: now(),
      });
      return GenerationTask.find(task.id);
    }

    GenerationTask.update(task.id, {
      status: 'failed',
      error_message: errorMessage,
      finished_at: now(),
    });
    return GenerationTask.find(task.id);
  }
}

export const creditService = new CreditService();
