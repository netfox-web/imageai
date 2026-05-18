import { all, get, run } from './database.js';

function tableColumns(table) {
  return all(`PRAGMA table_info(${table})`).map((row) => row.name);
}

function addColumnIfMissing(table, column, definition) {
  const columns = tableColumns(table);
  if (!columns.includes(column)) {
    run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function hasTable(table) {
  return Boolean(
    get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]),
  );
}

export async function migrate() {
  run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      google_id TEXT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      credits_balance INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  if (hasTable('users')) {
    addColumnIfMissing('users', 'google_id', 'TEXT NULL');
    addColumnIfMissing('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
    addColumnIfMissing('users', 'credits_balance', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
    addColumnIfMissing('users', 'last_login_at', 'TEXT NULL');
    addColumnIfMissing('users', 'created_at', 'TEXT NULL');
    addColumnIfMissing('users', 'updated_at', 'TEXT NULL');
  }

  run(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('grant', 'purchase', 'consume', 'refund', 'admin_adjust')),
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      related_task_id INTEGER NULL,
      note TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS generation_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tool_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'canceled')),
      product_name TEXT NULL,
      main_title TEXT NULL,
      subtitle TEXT NULL,
      custom_prompt TEXT NULL,
      style_key TEXT NULL,
      title_style_key TEXT NULL,
      subtitle_style_key TEXT NULL,
      text_mode TEXT NULL CHECK (text_mode IS NULL OR text_mode IN ('merged', 'scene_only')),
      language TEXT NOT NULL DEFAULT 'zh-TW',
      image_size TEXT NOT NULL DEFAULT '2K',
      logo_mode TEXT NOT NULL DEFAULT 'keep',
      quantity INTEGER NOT NULL DEFAULT 1,
      credits_cost INTEGER NOT NULL DEFAULT 0,
      failure_refunded INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NULL,
      started_at TEXT NULL,
      finished_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  if (hasTable('generation_tasks')) {
    addColumnIfMissing('generation_tasks', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('generation_tasks', 'max_retries', 'INTEGER NOT NULL DEFAULT 2');
    addColumnIfMissing('generation_tasks', 'last_error_code', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'last_error_message', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'failed_at', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'completed_at', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'processing_started_at', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'requested_provider', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'resolved_provider', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'requested_model', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'resolved_model', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'requested_capability', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'provider_config_source', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'provider_selection_reason', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'fallback_reason', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'strict_provider', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('generation_tasks', 'quality_review_required', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('generation_tasks', 'input_metadata_json', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'output_metadata_json', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'consent_required', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('generation_tasks', 'consent_granted', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('generation_tasks', 'consent_statement', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'consent_granted_at', 'TEXT NULL');
    addColumnIfMissing('generation_tasks', 'privacy_mode', "TEXT NOT NULL DEFAULT 'private'");
  }

  run(`
    CREATE TABLE IF NOT EXISTS task_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('input', 'output', 'thumbnail', 'frame', 'watermark')),
      role TEXT NULL CHECK (role IS NULL OR role IN ('cover', 'white_bg', 'feature', 'scenario', 'detail', 'comparison', 'multi_use', 'info')),
      storage_path TEXT NOT NULL,
      width INTEGER NULL,
      height INTEGER NULL,
      file_size INTEGER NULL,
      mime_type TEXT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT NULL,
      FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS task_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('text', 'video', 'audio', 'json', 'external_ref')),
      title TEXT NULL,
      content_text TEXT NULL,
      storage_path TEXT NULL,
      mime_type TEXT NULL,
      metadata_json TEXT NULL,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT NULL,
      FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS style_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      prompt TEXT NULL,
      negative_prompt TEXT NULL,
      preview_image TEXT NULL,
      default_title_style TEXT NULL,
      default_subtitle_style TEXT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS text_style_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('title', 'subtitle')),
      name TEXT NOT NULL,
      prompt TEXT NULL,
      css_preview TEXT NULL,
      preview_image TEXT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS platform_formats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_key TEXT NOT NULL,
      platform_name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('creative', 'product', 'ratio', 'custom')),
      format_name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      safe_area_json TEXT NULL,
      max_size_kb INTEGER NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(platform_key, format_name, width, height)
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS task_formats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      platform_format_id INTEGER NULL,
      custom_width INTEGER NULL,
      custom_height INTEGER NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (platform_format_id) REFERENCES platform_formats(id) ON DELETE SET NULL
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS ai_cost_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      provider TEXT NULL,
      model TEXT NULL,
      input_tokens INTEGER NULL,
      output_tokens INTEGER NULL,
      image_count INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NULL,
      raw_response_json TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS user_brand_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      brand_name TEXT NULL,
      logo_path TEXT NULL,
      primary_color TEXT NULL,
      secondary_color TEXT NULL,
      watermark_path TEXT NULL,
      default_language TEXT NOT NULL DEFAULT 'zh-TW',
      default_logo_mode TEXT NOT NULL DEFAULT 'keep',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  if (hasTable('user_brand_settings')) {
    addColumnIfMissing('user_brand_settings', 'brand_voice', 'TEXT NULL');
    addColumnIfMissing('user_brand_settings', 'target_audience', 'TEXT NULL');
    addColumnIfMissing('user_brand_settings', 'brand_keywords', 'TEXT NULL');
    addColumnIfMissing('user_brand_settings', 'forbidden_terms', 'TEXT NULL');
    addColumnIfMissing('user_brand_settings', 'product_pillars', 'TEXT NULL');
    addColumnIfMissing('user_brand_settings', 'sample_posts', 'TEXT NULL');
  }

  run(`
    CREATE TABLE IF NOT EXISTS credit_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      credits INTEGER NOT NULL,
      price INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'TWD',
      bonus_credits INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      credit_package_id INTEGER NOT NULL,
      order_no TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'TWD',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'canceled', 'refunded')),
      paid_at TEXT NULL,
      provider TEXT NULL,
      provider_payload TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (credit_package_id) REFERENCES credit_packages(id) ON DELETE RESTRICT
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      tool_type TEXT NOT NULL,
      system_prompt TEXT NULL,
      user_prompt_template TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS quality_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      task_image_id INTEGER NULL,
      reviewer_user_id INTEGER NOT NULL,
      product_preserved TEXT NULL,
      no_garbled_text TEXT NULL,
      composition_ok TEXT NULL,
      size_ok TEXT NULL,
      commercial_quality INTEGER NULL,
      notes TEXT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      needs_regeneration INTEGER NOT NULL DEFAULT 0,
      regeneration_reason TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id, task_image_id),
      FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (task_image_id) REFERENCES task_images(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  if (hasTable('quality_reviews')) {
    addColumnIfMissing('quality_reviews', 'approved', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('quality_reviews', 'needs_regeneration', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('quality_reviews', 'regeneration_reason', 'TEXT NULL');
  }

  run(`
    CREATE TABLE IF NOT EXISTS task_regeneration_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      task_image_id INTEGER NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'reviewed', 'queued', 'canceled')),
      reason TEXT NULL,
      output_url TEXT NULL,
      metadata_json TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (task_image_id) REFERENCES task_images(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS ai_handoff_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_ref TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      project_id TEXT NULL,
      project_name TEXT NULL,
      project_status TEXT NULL,
      source_system TEXT NOT NULL,
      external_ref TEXT NULL,
      request_id TEXT NULL,
      idempotency_key TEXT NULL,
      actor_type TEXT NULL,
      actor_id TEXT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      risk TEXT NOT NULL,
      reason TEXT NOT NULL,
      next_step TEXT NOT NULL,
      rejection_reason TEXT NULL,
      execution_allowed INTEGER NOT NULL DEFAULT 0,
      api_payload TEXT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT NULL,
      FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS devpilot_external_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_system TEXT NOT NULL UNIQUE,
      label TEXT NULL,
      key_hash TEXT NOT NULL,
      key_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      created_by_user_id INTEGER NULL,
      last_used_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS asset_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_image_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      tags TEXT NULL,
      notes TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_image_id) REFERENCES task_images(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS asset_share_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_image_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      revoked_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_image_id) REFERENCES task_images(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS feedback_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NULL,
      task_id INTEGER NULL,
      asset_url TEXT NULL,
      type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('bug', 'quality', 'billing', 'account', 'other')),
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      browser_info_safe TEXT NULL,
      screenshot_url TEXT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'ignored')),
      admin_notes TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE SET NULL
    )
  `);

  if (hasTable('prompt_templates')) {
    addColumnIfMissing('prompt_templates', 'capability', 'TEXT NULL');
    addColumnIfMissing('prompt_templates', 'template_body', 'TEXT NULL');
    addColumnIfMissing('prompt_templates', 'variables_json', 'TEXT NULL');
    addColumnIfMissing('prompt_templates', 'created_by_user_id', 'INTEGER NULL');
  }

  run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type TEXT NOT NULL,
      actor_id TEXT NULL,
      action TEXT NOT NULL,
      target_type TEXT NULL,
      target_id TEXT NULL,
      metadata_safe TEXT NULL,
      ip_hash TEXT NULL,
      user_agent_safe TEXT NULL,
      created_at TEXT NOT NULL
    )
  `);

  run('CREATE INDEX IF NOT EXISTS idx_generation_tasks_user_status ON generation_tasks(user_id, status)');
  run('CREATE INDEX IF NOT EXISTS idx_task_images_task_type ON task_images(task_id, type)');
  run('CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_kind ON task_artifacts(task_id, kind)');
  run('CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created ON credit_transactions(user_id, created_at)');
  run('CREATE INDEX IF NOT EXISTS idx_quality_reviews_task ON quality_reviews(task_id)');
  run('CREATE INDEX IF NOT EXISTS idx_ai_handoff_logs_conversation_source ON ai_handoff_logs(conversation_ref, source_system)');
  run('CREATE INDEX IF NOT EXISTS idx_ai_handoff_logs_task ON ai_handoff_logs(task_id)');
  run('CREATE INDEX IF NOT EXISTS idx_ai_handoff_logs_status_risk ON ai_handoff_logs(status, risk)');
  run('CREATE INDEX IF NOT EXISTS idx_devpilot_external_api_keys_source_status ON devpilot_external_api_keys(source_system, status)');
  run('CREATE INDEX IF NOT EXISTS idx_asset_metadata_user_archived ON asset_metadata(user_id, archived)');
  run('CREATE INDEX IF NOT EXISTS idx_asset_share_tokens_token ON asset_share_tokens(token)');
  run('CREATE INDEX IF NOT EXISTS idx_feedback_reports_status_created ON feedback_reports(status, created_at)');
  run('CREATE INDEX IF NOT EXISTS idx_feedback_reports_task ON feedback_reports(task_id)');
  run('CREATE INDEX IF NOT EXISTS idx_task_regeneration_requests_task ON task_regeneration_requests(task_id)');
  run('CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON audit_logs(action, created_at)');
  run('CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id)');
}
