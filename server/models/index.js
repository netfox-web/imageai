import { all, get, insert, now, run } from '../db/database.js';

function insertRow(table, attributes) {
  const timestamp = now();
  const row = { ...attributes, created_at: attributes.created_at || timestamp, updated_at: timestamp };
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  return insert(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    columns.map((column) => row[column]),
  );
}

function updateRow(table, id, attributes) {
  const row = { ...attributes, updated_at: now() };
  const columns = Object.keys(row);
  run(
    `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
    [...columns.map((column) => row[column]), id],
  );
}

export class User {
  static find(id) {
    return get('SELECT id, name, email, google_id, role, credits_balance, status, last_login_at, created_at, updated_at FROM users WHERE id = ?', [
      Number(id),
    ]);
  }

  static findWithPasswordByEmail(email) {
    return get('SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
  }

  static create(attributes) {
    return insertRow('users', attributes);
  }

  static update(id, attributes) {
    updateRow('users', id, attributes);
    return this.find(id);
  }

  static creditTransactions(userId, limit = 50, offset = 0) {
    return all(
      'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      [Number(userId), Number(limit), Number(offset)],
    );
  }

  static tasks(userId, filters = {}) {
    const params = [Number(userId)];
    const where = ['user_id = ?', 'deleted_at IS NULL'];
    if (filters.tool_type) {
      where.push('tool_type = ?');
      params.push(filters.tool_type);
    }
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters.q) {
      where.push('(product_name LIKE ? OR main_title LIKE ? OR CAST(id AS TEXT) = ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`, filters.q);
    }
    params.push(Number(filters.limit || 20), Number(filters.offset || 0));
    return all(
      `SELECT * FROM generation_tasks WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`,
      params,
    );
  }

  static brandSettings(userId) {
    return get('SELECT * FROM user_brand_settings WHERE user_id = ?', [Number(userId)]);
  }
}

export class CreditTransaction {
  static create(attributes) {
    return insertRow('credit_transactions', attributes);
  }
}

export class Tool {
  static active() {
    return all('SELECT * FROM tools WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
  }
}

export class GenerationTask {
  static create(attributes) {
    return insertRow('generation_tasks', attributes);
  }

  static find(id) {
    return get('SELECT * FROM generation_tasks WHERE id = ? AND deleted_at IS NULL', [Number(id)]);
  }

  static update(id, attributes) {
    updateRow('generation_tasks', id, attributes);
    return this.find(id);
  }

  static images(id, type = null) {
    const params = [Number(id)];
    let where = 'task_id = ? AND deleted_at IS NULL';
    if (type) {
      where += ' AND type = ?';
      params.push(type);
    }
    return all(`SELECT * FROM task_images WHERE ${where} ORDER BY sort_order ASC, id ASC`, params);
  }

  static formats(id) {
    return all(
      `SELECT task_formats.*, platform_formats.platform_key, platform_formats.platform_name,
              platform_formats.category, platform_formats.format_name, platform_formats.width, platform_formats.height
       FROM task_formats
       LEFT JOIN platform_formats ON platform_formats.id = task_formats.platform_format_id
       WHERE task_formats.task_id = ?
       ORDER BY task_formats.id ASC`,
      [Number(id)],
    );
  }

  static costLogs(id) {
    return all('SELECT * FROM ai_cost_logs WHERE task_id = ? ORDER BY id DESC', [Number(id)]);
  }

  static artifacts(id) {
    return all(
      'SELECT * FROM task_artifacts WHERE task_id = ? AND deleted_at IS NULL ORDER BY id ASC',
      [Number(id)],
    );
  }
}

export class TaskImage {
  static create(attributes) {
    return insertRow('task_images', attributes);
  }

  static forUser(userId, type = null, limit = 60, offset = 0) {
    const params = [Number(userId)];
    let where = 'generation_tasks.user_id = ? AND task_images.deleted_at IS NULL';
    if (type && type !== 'all') {
      where += ' AND task_images.type = ?';
      params.push(type);
    }
    params.push(Number(limit), Number(offset));
    return all(
      `SELECT task_images.*, generation_tasks.product_name, generation_tasks.main_title
       FROM task_images
       INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
       WHERE ${where}
       ORDER BY task_images.id DESC
       LIMIT ? OFFSET ?`,
      params,
    );
  }
}

export class TaskFormat {
  static create(attributes) {
    return insertRow('task_formats', attributes);
  }
}

export class TaskArtifact {
  static create(attributes) {
    return insertRow('task_artifacts', attributes);
  }
}

export class AiCostLog {
  static create(attributes) {
    return insertRow('ai_cost_logs', attributes);
  }
}

export class StylePreset {
  static active() {
    return all('SELECT * FROM style_presets WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
  }

  static findByKey(key) {
    return get('SELECT * FROM style_presets WHERE key = ?', [key]);
  }
}

export class TextStylePreset {
  static active() {
    return all('SELECT * FROM text_style_presets WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
  }
}

export class PlatformFormat {
  static active() {
    return all('SELECT * FROM platform_formats WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
  }
}

export class CreditPackage {
  static active() {
    return all('SELECT * FROM credit_packages WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
  }
}

export class Order {
  static create(attributes) {
    return insertRow('orders', attributes);
  }

  static find(id) {
    return get('SELECT * FROM orders WHERE id = ?', [Number(id)]);
  }

  static update(id, attributes) {
    updateRow('orders', id, attributes);
    return this.find(id);
  }
}

export class PromptTemplate {
  static activeByKey(key) {
    return get('SELECT * FROM prompt_templates WHERE key = ? AND is_active = 1 ORDER BY version DESC, id DESC LIMIT 1', [key]);
  }

  static activeByTool(toolType) {
    return get('SELECT * FROM prompt_templates WHERE tool_type = ? AND is_active = 1 ORDER BY version DESC, id DESC LIMIT 1', [
      toolType,
    ]);
  }
}
