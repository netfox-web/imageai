import bcrypt from 'bcryptjs';
import { get, insert, now, run } from './database.js';

function upsert(table, uniqueColumns, values) {
  const timestamp = now();
  const row = { ...values, created_at: values.created_at || timestamp, updated_at: timestamp };
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  const conflict = Array.isArray(uniqueColumns) ? uniqueColumns.join(', ') : uniqueColumns;
  const updates = columns
    .filter((column) => !['id', 'created_at'].includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');

  run(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(${conflict}) DO UPDATE SET ${updates}`,
    columns.map((column) => row[column]),
  );
}

export async function seed() {
  seedTools();
  seedStylePresets();
  seedTextStyles();
  seedPlatformFormats();
  seedCreditPackages();
  seedPromptTemplates();
  await seedDemoAdmin();
}

function seedTools() {
  [
    ['banner', '產品圖文設計', '上傳商品圖，自動產生多平台廣告素材。'],
    ['translation', '圖片翻譯', '保留版面並翻譯圖片文案。'],
    ['cutout', '智慧去背', '快速去除商品背景。'],
    ['removal', '智慧去字', '移除圖片上的既有文字。'],
  ].forEach(([key, name, description], index) => {
    upsert('tools', 'key', {
      key,
      name,
      description,
      is_active: 1,
      sort_order: index + 1,
    });
  });
}

function seedStylePresets() {
  const styles = [
    ['minimal', '簡約清新', 'clean ecommerce layout, soft daylight, airy spacing', 'title_minimal_thin', 'sub_clean_sans'],
    ['luxury', '奢華高端', 'premium lighting, refined shadows, elegant product stage', 'title_gold_3d', 'sub_elegant_italic'],
    ['tech', '科技未來', 'futuristic surface, subtle neon lines, high contrast', 'title_neon_glow', 'sub_mono_tech'],
    ['organic', '自然有機', 'natural texture, greenery, warm sunlight', 'title_elegant_serif', 'sub_clean_sans'],
    ['cute', '可愛童趣', 'playful pastel scene, rounded props, delightful mood', 'title_handwritten', 'sub_handwritten_note'],
    ['japanese', '日式和風', 'washi texture, calm composition, Japanese minimal styling', 'title_elegant_serif', 'sub_light_outline'],
    ['retro', '復古懷舊', 'vintage poster palette, film grain, nostalgic props', 'title_retro_vintage', 'sub_ribbon_banner'],
    ['sport', '運動活力', 'dynamic angles, energetic lighting, action vibe', 'title_bold_impact', 'sub_underline_accent'],
    ['fashion', '時尚穿搭', 'editorial fashion set, confident contrast, modern styling', 'title_gradient_modern', 'sub_clean_sans'],
    ['beauty', '美妝保養', 'soft reflection, skincare glow, premium clean background', 'title_elegant_serif', 'sub_frosted_glass'],
    ['pet', '寵物萌寵', 'friendly cozy scene, bright playful props', 'title_handwritten', 'sub_capsule_tag'],
    ['illustration', '插畫手繪', 'hand drawn background, illustrated accents, warm detail', 'title_brush_stroke', 'sub_handwritten_note'],
    ['food', '美食料理', 'fresh ingredients, appetizing light, table styling', 'title_bold_impact', 'sub_capsule_tag'],
    ['baby', '母嬰親子', 'soft safe nursery mood, pastel fabric, gentle light', 'title_handwritten', 'sub_light_outline'],
    ['korean', '韓系質感', 'Korean lifestyle styling, muted colors, refined space', 'title_minimal_thin', 'sub_clean_sans'],
    ['outdoor', '戶外露營', 'camping scene, natural daylight, durable product mood', 'title_stamp_badge', 'sub_ribbon_banner'],
    ['home', '居家生活', 'cozy interior, warm light, practical lifestyle setting', 'title_elegant_serif', 'sub_clean_sans'],
    ['festival', '節慶促銷', 'seasonal promotion energy, celebratory props, bright sale mood', 'title_3d_emboss', 'sub_ribbon_banner'],
    ['jewelry', '飾品精品', 'jewelry showcase, velvet texture, sparkle highlights', 'title_gold_3d', 'sub_elegant_italic'],
    ['health', '保健養生', 'wellness clean scene, balanced light, trusted healthy mood', 'title_elegant_serif', 'sub_capsule_tag'],
  ];

  styles.forEach(([key, name, prompt, default_title_style, default_subtitle_style], index) => {
    upsert('style_presets', 'key', {
      key,
      name,
      prompt,
      negative_prompt: 'low quality, blurry, distorted product, broken text',
      preview_image: null,
      default_title_style,
      default_subtitle_style,
      is_active: 1,
      sort_order: index + 1,
    });
  });
}

function seedTextStyles() {
  const titleStyles = [
    ['title_bold_impact', '粗體衝擊', 'bold high-impact advertising headline', 'font-weight:900;text-transform:uppercase;'],
    ['title_elegant_serif', '優雅襯線', 'elegant serif premium headline', 'font-family:serif;font-weight:700;'],
    ['title_handwritten', '手寫質感', 'friendly handwritten headline', 'font-style:italic;'],
    ['title_neon_glow', '霓虹發光', 'neon glow headline with luminous edge', 'text-shadow:0 0 12px #38bdf8;'],
    ['title_minimal_thin', '極簡纖細', 'minimal thin headline', 'font-weight:300;'],
    ['title_retro_vintage', '復古懷舊', 'retro vintage headline', 'font-weight:800;'],
    ['title_3d_emboss', '3D立體', 'embossed 3D headline', 'text-shadow:2px 3px 0 #d97706;'],
    ['title_gradient_modern', '漸層時尚', 'modern gradient headline', 'background:linear-gradient(90deg,#111827,#f59e0b);'],
    ['title_stamp_badge', '標章徽記', 'badge stamp headline', 'border:2px solid currentColor;'],
    ['title_brush_stroke', '筆刷揮灑', 'expressive brush headline', 'font-weight:800;'],
    ['title_gold_3d', '金色文字', 'gold metallic headline', 'color:#b7791f;text-shadow:1px 2px 0 #fde68a;'],
  ];

  const subtitleStyles = [
    ['sub_clean_sans', '乾淨無襯線', 'clean sans subtitle', 'font-family:sans-serif;'],
    ['sub_elegant_italic', '優雅斜體', 'elegant italic subtitle', 'font-style:italic;'],
    ['sub_capsule_tag', '膠囊標籤', 'capsule tag subtitle', 'border-radius:999px;padding:4px 12px;'],
    ['sub_underline_accent', '底線強調', 'accent underline subtitle', 'text-decoration:underline;'],
    ['sub_light_outline', '輕描邊框', 'light outline subtitle', 'border:1px solid currentColor;'],
    ['sub_mono_tech', '等寬科技', 'mono tech subtitle', 'font-family:monospace;'],
    ['sub_handwritten_note', '手寫註記', 'handwritten note subtitle', 'font-style:italic;'],
    ['sub_ribbon_banner', '緞帶橫幅', 'ribbon banner subtitle', 'background:#111827;color:white;'],
    ['sub_frosted_glass', '毛玻璃背景', 'frosted glass subtitle', 'backdrop-filter:blur(8px);'],
    ['sub_small_caps', '小型大寫', 'small caps subtitle', 'font-variant:small-caps;'],
  ];

  [...titleStyles.map((item) => ['title', ...item]), ...subtitleStyles.map((item) => ['subtitle', ...item])].forEach(
    ([type, key, name, prompt, css_preview], index) => {
      upsert('text_style_presets', 'key', {
        key,
        type,
        name,
        prompt,
        css_preview,
        preview_image: null,
        is_active: 1,
        sort_order: index + 1,
      });
    },
  );
}

function seedPlatformFormats() {
  const rows = [
    ['facebook', 'Facebook', 'creative', '動態貼文 橫', 1200, 628],
    ['facebook', 'Facebook', 'creative', '動態貼文 方', 1080, 1080],
    ['facebook', 'Facebook', 'creative', '限時動態', 1080, 1920],
    ['instagram', 'Instagram', 'creative', '貼文 方', 1080, 1080],
    ['instagram', 'Instagram', 'creative', '貼文 直', 1080, 1350],
    ['instagram', 'Instagram', 'creative', '限時動態', 1080, 1920],
    ['shopee', '蝦皮購物', 'product', '商品主圖', 800, 800],
    ['shopee', '蝦皮購物', 'product', '商品主圖 大', 1024, 1024],
    ['shopee', '蝦皮購物', 'creative', '活動 Banner', 1200, 300],
    ['line', 'LINE', 'creative', '橫向', 1200, 628],
    ['line', 'LINE', 'creative', '正方形', 1080, 1080],
    ['google_display', 'Google 多媒體廣告', 'creative', '中矩形', 300, 250],
    ['google_display', 'Google 多媒體廣告', 'creative', '大矩形', 336, 280],
    ['google_display', 'Google 多媒體廣告', 'creative', '排行榜', 728, 90],
    ['google_display', 'Google 多媒體廣告', 'creative', '橫幅廣告', 970, 250],
    ['google_display', 'Google 多媒體廣告', 'creative', '半頁', 300, 600],
    ['youtube', 'YouTube', 'creative', '影片縮圖', 1280, 720],
    ['youtube', 'YouTube', 'creative', '影片廣告 橫', 1920, 1080],
    ['tiktok', 'TikTok', 'creative', '直式影片封面', 1080, 1920],
    ['yahoo', 'Yahoo', 'creative', '原生廣告 橫', 1200, 627],
    ['yahoo', 'Yahoo', 'creative', '原生廣告 方', 627, 627],
    ['dcard', 'Dcard', 'creative', '橫幅', 796, 448],
    ['dcard', 'Dcard', 'creative', '方形', 216, 216],
    ['pchome', 'PChome', 'product', '商品圖', 600, 600],
    ['pchome', 'PChome', 'creative', '活動 Banner', 960, 290],
    ['momo', 'momo', 'product', '商品圖', 700, 700],
    ['momo', 'momo', 'product', '商品圖 大', 1000, 1000],
    ['ruten', '露天拍賣', 'product', '商品圖', 800, 800],
    ['ruten', '露天拍賣', 'creative', '賣場 Banner', 1200, 300],
    ['ratio', '固定比例', 'ratio', '1:1', 1080, 1080],
    ['ratio', '固定比例', 'ratio', '3:4', 900, 1200],
    ['ratio', '固定比例', 'ratio', '4:3', 1200, 900],
    ['ratio', '固定比例', 'ratio', '9:16', 1080, 1920],
    ['ratio', '固定比例', 'ratio', '16:9', 1920, 1080],
    ['ratio', '固定比例', 'ratio', '4:5', 1080, 1350],
    ['ratio', '固定比例', 'ratio', '2:3', 1000, 1500],
  ];

  rows.forEach(([platform_key, platform_name, category, format_name, width, height], index) => {
    upsert('platform_formats', ['platform_key', 'format_name', 'width', 'height'], {
      platform_key,
      platform_name,
      category,
      format_name,
      width,
      height,
      safe_area_json: null,
      max_size_kb: null,
      is_active: 1,
      sort_order: index + 1,
    });
  });
}

function seedCreditPackages() {
  [
    ['體驗包', 100, 100, 'TWD', 0],
    ['標準包', 500, 450, 'TWD', 0],
    ['專業包', 1200, 990, 'TWD', 0],
  ].forEach(([name, credits, price, currency, bonus_credits], index) => {
    upsert('credit_packages', 'name', {
      name,
      credits,
      price,
      currency,
      bonus_credits,
      is_active: 1,
      sort_order: index + 1,
    });
  });
}

function seedPromptTemplates() {
  [
    {
      key: 'banner_generation',
      name: '產品圖文設計',
      tool_type: 'banner',
      system_prompt: 'You are an ecommerce advertising designer.',
      user_prompt_template:
        'Create ecommerce ad creatives for {{product_name}} with title {{main_title}}, subtitle {{subtitle}}, style {{style_key}}, format {{format}}.',
      notes: 'FakeAIProvider reads task metadata but keeps this prompt ready for real providers.',
    },
    {
      key: 'analyze_product_images',
      name: '商品圖片分析',
      tool_type: 'banner',
      system_prompt: 'You analyze product photos and produce Taiwanese ecommerce copy.',
      user_prompt_template: 'Analyze uploaded product images and infer product name, title, subtitle, prompt, and image roles.',
      notes: 'Used by /studio/analyze.',
    },
  ].forEach((template) => {
    upsert('prompt_templates', 'key', {
      ...template,
      version: 1,
      is_active: 1,
    });
  });
}

async function seedDemoAdmin() {
  ensureAdmin('admin', await bcrypt.hash('1234', 10), 'Admin');
}

export function ensureAdmin(email, passwordHash, name = 'Admin') {
  const existing = get('SELECT id FROM users WHERE email = ?', [email]);
  const timestamp = now();
  if (existing) {
    run('UPDATE users SET role = ?, status = ?, password = ?, updated_at = ? WHERE id = ?', [
      'admin',
      'active',
      passwordHash,
      timestamp,
      existing.id,
    ]);
    return existing.id;
  }

  return insert(
    `INSERT INTO users (name, email, password, role, credits_balance, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, email, passwordHash, 'admin', 9999, 'active', timestamp, timestamp],
  );
}
