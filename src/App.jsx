import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Copy,
  CreditCard,
  Download,
  Heart,
  Image as ImageIcon,
  FileText,
  Layers,
  LayoutDashboard,
  Loader2,
  LogOut,
  RefreshCcw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  User,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import { api, loadSession } from './lib/api.js';
import { friendlyTaskError, imageLoadErrorMessage, parseTaskCostMeta } from './lib/taskMeta.js';

const roleLabels = {
  cover: '封面圖',
  white_bg: '白底圖',
  feature: '功能圖',
  scenario: '情境圖',
  detail: '細節圖',
  comparison: '對比圖',
  multi_use: '多用途',
  info: '資訊圖',
};

const toolLabels = {
  banner: '產品圖文設計',
  translation: '圖片翻譯',
  cutout: '智慧去背',
  removal: '智慧去字',
  post_generator: '貼文生成器',
  image_mix: '圖片混合',
  image_to_video: '圖生影片',
  voice_clone: '聲音克隆',
  lip_sync: '對嘴影片',
  face_swap: '換臉',
  avatar: 'Avatar',
  avatar_video: 'Avatar 影片',
};

const sensitiveToolTypes = ['voice_clone', 'lip_sync', 'face_swap', 'avatar', 'avatar_video'];

const toolCapabilityMap = {
  banner: 'image_generation',
  translation: 'image_editing',
  cutout: 'image_editing',
  removal: 'image_editing',
  post_generator: 'post_generation',
  image_mix: 'image_mix',
  image_to_video: 'image_to_video',
  voice_clone: 'sensitive_media',
  lip_sync: 'sensitive_media',
  face_swap: 'sensitive_media',
  avatar: 'sensitive_media',
  avatar_video: 'sensitive_media',
};

const capabilityDisplayLabels = {
  generate: '自動生成',
  image_generation: '圖片生成',
  image_editing: '圖片編修',
  post_generation: '貼文生成',
  image_mix: '圖片混合',
  image_to_video: '圖生影片',
  sensitive_media: '需同意的私密媒體',
};

function capabilityForTool(toolType) {
  return toolCapabilityMap[toolType] || 'generate';
}

const statusLabels = {
  pending: '等待中',
  processing: '生成中',
  success: '成功',
  failed: '失敗',
  canceled: '已取消',
};

const creditTypeLabels = {
  grant: '贈送',
  purchase: '購買',
  consume: '消耗',
  refund: '退點',
  admin_adjust: '管理調整',
};

const platformOrder = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['shopee', '蝦皮購物'],
  ['line', 'LINE'],
  ['google_display', 'Google 多媒體廣告'],
  ['youtube', 'YouTube'],
  ['tiktok', 'TikTok'],
  ['yahoo', 'Yahoo'],
  ['dcard', 'Dcard'],
  ['pchome', 'PChome'],
  ['momo', 'momo'],
  ['ruten', '露天拍賣'],
  ['ratio', '固定比例'],
];

export function App() {
  const [route, setRoute] = useState(window.location.pathname);
  const [session, setSession] = useState({ user: null });
  const [bootstrap, setBootstrap] = useState(null);
  const [authModal, setAuthModal] = useState(null);

  const navigate = (path) => {
    window.history.pushState({}, '', path);
    setRoute(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const refreshSession = async () => {
    const data = await loadSession();
    setSession(data);
    return data.user;
  };

  useEffect(() => {
    refreshSession();
    api('/api/bootstrap').then(setBootstrap);
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const commonProps = {
    route,
    navigate,
    user: session.user,
    bootstrap,
    refreshSession,
    openAuth: (tab = 'login') => setAuthModal(tab),
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-paper">
      <Navbar {...commonProps} />
      <TrialBanner bootstrap={bootstrap} />
      {!bootstrap ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <Router {...commonProps} />
      )}
      {authModal && (
        <AuthModal
          initialTab={authModal}
          bootstrap={bootstrap}
          onClose={() => setAuthModal(null)}
          onAuthed={async () => {
            await refreshSession();
            setAuthModal(null);
          }}
        />
      )}
    </div>
  );
}

function Router(props) {
  const { route, user, openAuth } = props;
  if (route === '/') return <HomePage {...props} />;
  if (route.startsWith('/share/') && route.split('/')[2]) return <SharePage token={route.split('/')[2]} />;
  if (route === '/feedback') return <FeedbackPage {...props} />;
  if (route.startsWith('/admin')) return <AdminRouter {...props} />;
  if (route === '/pricing') return <PricingPage {...props} />;
  if (route.startsWith('/tasks/') && route.split('/')[2]) return <TaskDetailPage {...props} taskId={route.split('/')[2]} />;
  if (!user && ['/dashboard', '/tasks', '/assets', '/credits', '/brand'].includes(route)) {
    return <LoginRequired openAuth={openAuth} />;
  }
  if (route === '/dashboard') return <DashboardPage {...props} />;
  if (route === '/tasks') return <TaskListPage {...props} />;
  if (route === '/assets') return <AssetsManagerPage {...props} />;
  if (route === '/credits') return <CreditsPage {...props} />;
  if (route === '/brand') return <BrandPage {...props} />;
  return <HomePage {...props} />;
}

function Navbar({ user, navigate, openAuth, refreshSession }) {
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    await refreshSession();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <button onClick={() => navigate('/')} className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-yellow-400 font-black">AI</span>
          <span className="truncate text-sm font-black sm:text-lg">AD Studio AI</span>
        </button>
        <nav className="no-scrollbar hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto px-4 text-sm font-semibold text-neutral-600 lg:flex">
          {['一鍵出圖', '產品組圖', '平台抓圖', '文章圖片', '高手特調'].map((item) => (
            <button key={item} onClick={() => navigate('/')} className="shrink-0 rounded-lg px-3 py-2 hover:bg-white">
              {item}
            </button>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <select className="hidden rounded-lg border border-neutral-200 bg-white px-2 py-2 text-xs sm:block" defaultValue="zh-TW">
            <option value="zh-TW">繁中</option>
            <option value="en">EN</option>
          </select>
          {!user ? (
            <>
              <button onClick={() => openAuth('login')} className="btn btn-ghost px-3">
                登入
              </button>
              <button onClick={() => openAuth('register')} className="btn btn-yellow px-3">
                註冊
              </button>
            </>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <button onClick={() => navigate('/dashboard')} className="hidden min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs sm:block">
                <span className="block truncate">{user.email}</span>
              </button>
              <button onClick={() => navigate('/credits')} className="btn btn-yellow gap-1 px-3">
                <Coins className="h-4 w-4" />
                {user.credits_balance}
              </button>
              <button onClick={() => navigate('/dashboard')} className="btn btn-ghost hidden gap-1 px-3 md:inline-flex">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </button>
              <button onClick={logout} className="btn btn-ghost px-3" title="登出">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function TrialBanner({ bootstrap }) {
  if (!bootstrap?.trialMode?.enabled) return null;
  return (
    <div className="border-b border-yellow-300 bg-yellow-100 px-4 py-2 text-center text-sm font-black text-neutral-950">
      測試模式：{bootstrap.trialMode.message || '目前為測試站，資料與圖片可能會被清理。'}
    </div>
  );
}

function AuthModal({ initialTab, bootstrap, onClose, onAuthed }) {
  const [tab, setTab] = useState(initialTab);
  const [form, setForm] = useState({ name: '', email: '', password: '', invite_code: '', terms: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        await api('/api/auth/login', { method: 'POST', body: { email: form.email, password: form.password } });
      } else {
        await api('/api/auth/register', { method: 'POST', body: form });
      }
      await onAuthed();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex rounded-lg bg-neutral-100 p-1">
            {['login', 'register'].map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={`rounded-md px-4 py-2 text-sm font-bold ${tab === item ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
              >
                {item === 'login' ? '登入' : '註冊'}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-neutral-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <button disabled className="mb-3 w-full rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-400">
          Google 登入（預留）
        </button>
        <form onSubmit={submit} className="space-y-3">
          {tab === 'register' && (
            <div>
              <label className="label">名稱</label>
              <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          )}
          <div>
            <label className="label">{tab === 'login' ? 'Email / 帳號' : 'Email'}</label>
            <input className="field" type={tab === 'login' ? 'text' : 'email'} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">密碼</label>
            <input className="field" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          {tab === 'register' && bootstrap?.registration?.invite_code_enabled && (
            <div>
              <label className="label">{bootstrap.registration.invite_code_label || 'Trial invite code'}</label>
              <input className="field" value={form.invite_code} onChange={(e) => setForm({ ...form, invite_code: e.target.value })} />
            </div>
          )}
          {tab === 'register' && (
            <label className="flex items-start gap-2 text-sm text-neutral-600">
              <input type="checkbox" className="mt-1" checked={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.checked })} />
              <span>我同意 AI 工具使用條款，並了解生成內容需自行確認授權與刊登規範。</span>
            </label>
          )}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <button disabled={loading} className="btn btn-primary w-full gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {tab === 'login' ? '登入' : '建立帳號並領 15 點'}
          </button>
        </form>
      </div>
    </div>
  );
}

function HomePage({ bootstrap, user, navigate, openAuth, refreshSession }) {
  const savedDraft = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('ad-studio-draft') || '{}');
    } catch {
      return {};
    }
  }, []);
  const [toolType, setToolType] = useState(savedDraft.toolType || 'banner');
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({
    product_name: savedDraft.product_name || '',
    main_title: savedDraft.main_title || '',
    subtitle: savedDraft.subtitle || '',
    custom_prompt: savedDraft.custom_prompt || '',
  });
  const [styleKey, setStyleKey] = useState(savedDraft.styleKey || 'minimal');
  const [textMode, setTextMode] = useState(savedDraft.textMode || 'merged');
  const [titleStyle, setTitleStyle] = useState(savedDraft.titleStyle || 'title_minimal_thin');
  const [subtitleStyle, setSubtitleStyle] = useState(savedDraft.subtitleStyle || 'sub_clean_sans');
  const [language, setLanguage] = useState(savedDraft.language || 'zh-TW');
  const [logoMode, setLogoMode] = useState(savedDraft.logoMode || 'keep');
  const [imageSize, setImageSize] = useState(savedDraft.imageSize || '2K');
  const [quantity, setQuantity] = useState(Number(savedDraft.quantity || 1));
  const [selectedFormatIds, setSelectedFormatIds] = useState(savedDraft.selectedFormatIds || []);
  const [platform, setPlatform] = useState('facebook');
  const [category, setCategory] = useState('all');
  const [customFormats, setCustomFormats] = useState(savedDraft.customFormats || []);
  const [customSize, setCustomSize] = useState({ width: 1200, height: 628 });
  const [styleModal, setStyleModal] = useState(false);
  const [favorites, setFavorites] = useState(() => JSON.parse(localStorage.getItem('ad-studio-style-favorites') || '[]'));
  const [loadingAnalyze, setLoadingAnalyze] = useState(false);
  const [fileError, setFileError] = useState('');
  const [analysisMeta, setAnalysisMeta] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [watermarkOpacity, setWatermarkOpacity] = useState(40);
  const [toolConfig, setToolConfig] = useState(savedDraft.toolConfig || {
    channel: 'instagram',
    tone: 'conversion',
    duration_seconds: 5,
    motion: 'slow product orbit',
    consent_granted: false,
    consent_statement: '',
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advanced, setAdvanced] = useState({
    provider: savedDraft.advanced?.provider || '',
    model: savedDraft.advanced?.model || '',
    strict_provider: Boolean(savedDraft.advanced?.strict_provider),
    quality_review_required: Boolean(savedDraft.advanced?.quality_review_required),
  });

  const stylePresets = bootstrap.stylePresets || [];
  const textStyles = bootstrap.textStylePresets || [];
  const platformFormats = bootstrap.platformFormats || [];
  const currentStyle = stylePresets.find((style) => style.key === styleKey);

  useEffect(() => {
    localStorage.setItem(
      'ad-studio-draft',
      JSON.stringify({
        toolType,
        ...form,
        styleKey,
        textMode,
        titleStyle,
        subtitleStyle,
        language,
        logoMode,
        imageSize,
        quantity,
        selectedFormatIds,
        customFormats,
        toolConfig,
        advanced,
      }),
    );
  }, [toolType, form, styleKey, textMode, titleStyle, subtitleStyle, language, logoMode, imageSize, quantity, selectedFormatIds, customFormats, toolConfig, advanced]);

  useEffect(() => {
    if (currentStyle) {
      setTitleStyle(currentStyle.default_title_style || titleStyle);
      setSubtitleStyle(currentStyle.default_subtitle_style || subtitleStyle);
    }
  }, [styleKey]);

  useEffect(() => {
    if (pendingSubmit && user) {
      setPendingSubmit(false);
      submitTask();
    }
  }, [pendingSubmit, user]);

  const selectedFormatCount = selectedFormatIds.length + customFormats.length;
  const creditCost =
    toolType === 'banner'
      ? files.length * selectedFormatCount * quantity * (imageSize === '4K' ? 30 : 15)
      : toolType === 'post_generator'
        ? 2
        : toolType === 'image_to_video'
          ? Math.max(files.length, 1) * 40
          : sensitiveToolTypes.includes(toolType)
            ? Math.max(files.length, 1) * 50
            : Math.max(files.length, 1) * 12;

  const addFiles = (incoming) => {
    const next = [...files];
    let rejected = '';
    Array.from(incoming).forEach((file) => {
      if (next.length >= 10) return;
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/bmp'].includes(file.type)) {
        rejected = 'Only png, jpg, jpeg, webp, and bmp images are supported.';
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        rejected = 'File is too large. Maximum size is 10MB.';
        return;
      }
      next.push({ file, preview: URL.createObjectURL(file), role: next.length === 0 ? 'cover' : 'multi_use' });
    });
    setFileError(rejected);
    setFiles(next);
  };

  const analyze = async () => {
    if (!files.length) {
      setNotice('');
      setMessage('請先上傳至少 1 張圖片。');
      return;
    }
    setLoadingAnalyze(true);
    setMessage('');
    setNotice('分析中...');
    try {
      const data = new FormData();
      files.forEach((item) => data.append('images', item.file));
      data.append('language', language);
      const result = await api('/studio/analyze', { method: 'POST', body: data });
      setForm({
        product_name: result.productName,
        main_title: result.title,
        subtitle: result.subtitle,
        custom_prompt: result.customPrompt,
      });
      setFiles((items) => items.map((item, index) => ({ ...item, role: result.imageRoles[index] || item.role })));
      setAnalysisMeta(result._meta || null);
      setNotice(`AI 分析完成${result._meta?.provider ? ` (${result._meta.provider})` : ''}`);
    } catch (err) {
      setMessage(err.message);
      setNotice('');
      setAnalysisMeta(null);
    } finally {
      setLoadingAnalyze(false);
    }
  };

  const submitTask = async () => {
    if (!user) {
      setPendingSubmit(true);
      openAuth('register');
      return;
    }
    setSubmitting(true);
    setMessage('');
    setNotice('');
    try {
      const data = new FormData();
      files.forEach((item) => data.append('images', item.file));
      data.append('tool_type', toolType);
      data.append('product_name', form.product_name);
      data.append('main_title', form.main_title);
      data.append('subtitle', form.subtitle);
      data.append('custom_prompt', toolType === 'translation' ? `${form.custom_prompt}\nTarget language: ${targetLanguage}` : form.custom_prompt);
      data.append('style_key', styleKey);
      data.append('text_mode', textMode);
      data.append('title_style_key', titleStyle);
      data.append('subtitle_style_key', subtitleStyle);
      data.append('language', language);
      data.append('image_size', imageSize);
      data.append('logo_mode', logoMode);
      data.append('quantity', String(quantity));
      data.append('provider', advanced.provider || '');
      data.append('model', advanced.model || '');
      data.append('capability', capabilityForTool(toolType));
      data.append('strict_provider', advanced.strict_provider ? 'true' : 'false');
      data.append('quality_review_required', advanced.quality_review_required ? 'true' : 'false');
      data.append('metadata_json', JSON.stringify(toolConfig));
      data.append('privacy_mode', sensitiveToolTypes.includes(toolType) ? 'private' : 'private');
      data.append('consent_granted', toolConfig.consent_granted ? 'true' : 'false');
      data.append('consent_statement', toolConfig.consent_statement || '');
      data.append('input_roles', JSON.stringify(files.map((item) => item.role)));
      data.append('platform_format_ids', JSON.stringify(selectedFormatIds));
      data.append('custom_formats', JSON.stringify(customFormats.map((item) => ({ width: item.width, height: item.height }))));
      const result = await api('/studio/tasks', { method: 'POST', body: data });
      await refreshSession();
      navigate(result.redirect_url);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const clearAll = () => {
    setFiles([]);
    setForm({ product_name: '', main_title: '', subtitle: '', custom_prompt: '' });
    setNotice('');
    setMessage('');
    setFileError('');
    setAnalysisMeta(null);
    setSelectedFormatIds([]);
    setCustomFormats([]);
    localStorage.removeItem('ad-studio-draft');
  };

  const toggleFavorite = (key) => {
    const next = favorites.includes(key) ? favorites.filter((item) => item !== key) : [...favorites, key];
    setFavorites(next);
    localStorage.setItem('ad-studio-style-favorites', JSON.stringify(next));
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="min-w-0">
          <p className="text-xs font-black tracking-[0.28em] text-yellow-600">AI 內容設計工具</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black leading-tight text-neutral-950 sm:text-5xl">
            AI 商務廣告與商品內容生成平台
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-neutral-600">
            上傳商品圖片、分析文案、建立多平台素材，並在同一套任務與素材庫流程中管理生成結果。
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ['商品分析', 'AI 輔助產生商品文案與圖片角色建議。'],
              ['多尺寸廣告圖', '支援 1:1、4:5、9:16、16:9 與 1200x628 等素材。'],
              ['作品素材庫', '搜尋、下載、標籤、收藏並匯出生成素材。'],
              ['DevPilot 交接', '安全使用來源限定外部金鑰與整合工具資源。'],
            ].map(([title, text]) => (
              <div key={title} className="rounded-lg border border-neutral-200 bg-white p-3">
                <div className="font-black text-neutral-950">{title}</div>
                <div className="mt-1 text-sm leading-6 text-neutral-500">{text}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="btn btn-yellow" onClick={() => (user ? navigate('/dashboard') : openAuth('login'))}>{user ? '開啟儀表板' : '登入開始使用'}</button>
            <button className="btn btn-ghost" onClick={() => navigate('/assets')}>開啟素材庫</button>
          </div>
        </div>
        <div className="panel">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(bootstrap.tools || []).map((tool) => (
              <button
                key={tool.key}
                onClick={() => setToolType(tool.key)}
                className={`rounded-xl border p-3 text-left transition ${
                  toolType === tool.key ? 'border-yellow-400 bg-yellow-50' : 'border-neutral-200 bg-white hover:border-neutral-300'
                }`}
              >
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-950 text-white">
                  {tool.key === 'post_generator' ? <FileText className="h-4 w-4" /> : tool.key === 'image_mix' ? <Layers className="h-4 w-4" /> : tool.key === 'image_to_video' ? <Video className="h-4 w-4" /> : tool.key === 'banner' ? <Sparkles className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                </div>
                <div className="text-sm font-black">{tool.name}</div>
                <div className="mt-1 line-clamp-2 text-xs text-neutral-500">{tool.description}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <UploadPanel files={files} setFiles={setFiles} addFiles={addFiles} banner={toolType === 'banner'} fileError={fileError} />

          {toolType === 'banner' ? (
            <>
              <CopyForm form={form} setForm={setForm} analyze={analyze} loadingAnalyze={loadingAnalyze} clearAll={clearAll} analysisMeta={analysisMeta} />
              <StylePicker
                styles={stylePresets}
                styleKey={styleKey}
                setStyleKey={setStyleKey}
                favorites={favorites}
                toggleFavorite={toggleFavorite}
                openAll={() => setStyleModal(true)}
              />
              <TextControls
                textMode={textMode}
                setTextMode={setTextMode}
                titleStyle={titleStyle}
                setTitleStyle={setTitleStyle}
                subtitleStyle={subtitleStyle}
                setSubtitleStyle={setSubtitleStyle}
                textStyles={textStyles}
              />
              <SpecControls
                language={language}
                setLanguage={setLanguage}
                logoMode={logoMode}
                setLogoMode={setLogoMode}
                imageSize={imageSize}
                setImageSize={setImageSize}
                quantity={quantity}
                setQuantity={setQuantity}
                watermarkOpacity={watermarkOpacity}
                setWatermarkOpacity={setWatermarkOpacity}
              />
              <FormatPicker
                formats={platformFormats}
                category={category}
                setCategory={setCategory}
                platform={platform}
                setPlatform={setPlatform}
                selectedFormatIds={selectedFormatIds}
                setSelectedFormatIds={setSelectedFormatIds}
                customSize={customSize}
                setCustomSize={setCustomSize}
                customFormats={customFormats}
                setCustomFormats={setCustomFormats}
              />
            </>
          ) : (
            <SimpleToolPanel
              toolType={toolType}
              form={form}
              setForm={setForm}
              targetLanguage={targetLanguage}
              setTargetLanguage={setTargetLanguage}
              toolConfig={toolConfig}
              setToolConfig={setToolConfig}
            />
          )}
        </div>

        <aside className="h-fit rounded-xl border border-neutral-200 bg-white p-4 shadow-soft lg:sticky lg:top-24">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-black">點數試算</div>
              <div className="text-xs text-neutral-500">後端會重新計算，以後端為準。</div>
            </div>
            <Coins className="h-5 w-5 text-yellow-500" />
          </div>
          <div className="mt-4 rounded-xl bg-neutral-950 p-4 text-white">
            <div className="text-xs text-neutral-300">本次預估</div>
            <div className="mt-1 text-4xl font-black">{creditCost}</div>
            <div className="text-xs text-neutral-300">點</div>
          </div>
          <div className="mt-4 space-y-2 text-sm text-neutral-600">
            <Row label="工具" value={toolLabels[toolType]} />
            <Row label="AI 工作" value={capabilityDisplayLabels[capabilityForTool(toolType)] || '自動配對'} />
            <Row label="圖片" value={`${files.length} 張`} />
            {toolType === 'banner' && <Row label="尺寸" value={`${selectedFormatCount} 個`} />}
            {toolType === 'banner' && <Row label="解析度" value={imageSize} />}
            {toolType === 'banner' && <Row label="每張產出" value={`${quantity} 張`} />}
            {toolType === 'post_generator' && <Row label="發佈渠道" value={toolConfig.channel} />}
            {toolType === 'image_to_video' && <Row label="影片長度" value={`${toolConfig.duration_seconds || 5}s`} />}
            {sensitiveToolTypes.includes(toolType) && <Row label="隱私" value="私密 + 稽核" />}
          </div>
          <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <button type="button" className="flex w-full items-center justify-between text-sm font-black" onClick={() => setAdvancedOpen(!advancedOpen)}>
              <span>進階設定</span>
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            {advancedOpen && (
              <div className="mt-3 space-y-3 text-sm">
                <label className="block">
                  <span className="label">AI 供應商</span>
                  <select className="field" value={advanced.provider} onChange={(e) => {
                    const provider = (bootstrap.providers || []).find((item) => item.name === e.target.value);
                    setAdvanced({ ...advanced, provider: e.target.value, model: provider?.models?.[0] || '' });
                  }}>
                    <option value="">使用伺服器預設</option>
                    {(bootstrap.providers || []).map((provider) => (
                      <option key={provider.name} value={provider.name}>{provider.label || provider.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label">模型</span>
                  <input className="field" value={advanced.model} onChange={(e) => setAdvanced({ ...advanced, model: e.target.value })} placeholder="可選填指定模型" />
                </label>
                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="label">AI 工作自動配對</div>
                  <div className="mt-1 font-black text-neutral-950">{capabilityDisplayLabels[capabilityForTool(toolType)] || '自動配對'}</div>
                  <div className="mt-1 text-xs leading-5 text-neutral-500">依目前工具自動送出，使用者不需要選 technical capability。</div>
                </div>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-600">
                  <input type="checkbox" checked={advanced.strict_provider} onChange={(e) => setAdvanced({ ...advanced, strict_provider: e.target.checked })} />
                  嚴格使用指定供應商，不使用 fake fallback
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-600">
                  <input type="checkbox" checked={advanced.quality_review_required} onChange={(e) => setAdvanced({ ...advanced, quality_review_required: e.target.checked })} />
                  需要品質審核
                </label>
              </div>
            )}
          </div>
          {notice && <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm font-bold text-green-700">{notice}</div>}
          {message && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>}
          <button disabled={submitting} onClick={submitTask} className="btn btn-yellow mt-4 w-full gap-2 py-3">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            建立生成任務
          </button>
          {!user && <div className="mt-3 text-center text-xs text-neutral-500">送出後會先開啟註冊，成功即自動建立任務。</div>}
        </aside>
      </section>

      {styleModal && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-black/40 p-4">
          <div className="mx-auto mt-10 max-w-5xl rounded-xl bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-black">全部圖片風格</h2>
              <button onClick={() => setStyleModal(false)} className="rounded-lg p-2 hover:bg-neutral-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
              {stylePresets.map((style) => (
                <StyleCard
                  key={style.key}
                  style={style}
                  active={styleKey === style.key}
                  favorite={favorites.includes(style.key)}
                  onFavorite={() => toggleFavorite(style.key)}
                  onClick={() => {
                    setStyleKey(style.key);
                    setStyleModal(false);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function UploadPanel({ files, setFiles, addFiles, banner, fileError = '' }) {
  return (
    <section className="panel">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black">圖片上傳</h2>
          <p className="text-sm text-neutral-500">JPG / JPEG / PNG / WEBP / BMP，最多 10 張，單張最大 10MB。</p>
        </div>
        <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold">{files.length}/10</span>
      </div>
      <label
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }}
        className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-6 text-center hover:border-yellow-400"
      >
        <UploadCloud className="h-8 w-8 text-neutral-500" />
        <span className="mt-2 text-sm font-bold">點擊上傳或拖曳上傳</span>
        <input className="hidden" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.bmp" onChange={(e) => addFiles(e.target.files)} />
      </label>
      <div className="mt-2 text-xs text-neutral-500">Accepted: png, jpg, webp. Maximum: 10MB. Suggested: square product image, 1024px or larger.</div>
      {fileError && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{fileError}</div>}
      {!!files.length && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {files.map((item, index) => (
            <div key={item.preview} className="min-w-0 rounded-xl border border-neutral-200 bg-white p-2">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-neutral-100">
                <img src={item.preview} className="h-full w-full object-cover" alt="" />
                <button
                  onClick={() => setFiles(files.filter((_, fileIndex) => fileIndex !== index))}
                  className="absolute right-2 top-2 rounded-full bg-white p-1 shadow"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {banner && (
                <select
                  className="field mt-2 py-1 text-xs"
                  value={item.role}
                  onChange={(e) => setFiles(files.map((file, fileIndex) => (fileIndex === index ? { ...file, role: e.target.value } : file)))}
                >
                  {Object.entries(roleLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CopyForm({ form, setForm, analyze, loadingAnalyze, clearAll, analysisMeta = null }) {
  return (
    <section className="panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black">商品資料</h2>
        <div className="flex gap-2">
          <button onClick={analyze} className="btn btn-yellow gap-2">
            {loadingAnalyze ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            AI 自動填寫
          </button>
          <button onClick={clearAll} className="btn btn-ghost">
            清除全部
          </button>
        </div>
      </div>
      {analysisMeta && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-neutral-950 px-3 py-1 font-black text-white">provider: {analysisMeta.provider || '-'}</span>
          <span className="rounded-full bg-neutral-100 px-3 py-1 font-bold text-neutral-700">model: {analysisMeta.model || '-'}</span>
          <span className="rounded-full bg-yellow-100 px-3 py-1 font-bold text-yellow-800">fallback: {analysisMeta.fallback_used ? 'yes' : 'no'}</span>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="產品名稱，不顯示在圖上" value={form.product_name} onChange={(value) => setForm({ ...form, product_name: value })} />
        <Field label="主標語，顯示在圖上" value={form.main_title} onChange={(value) => setForm({ ...form, main_title: value })} />
        <Field label="副標語，顯示在圖上" value={form.subtitle} onChange={(value) => setForm({ ...form, subtitle: value })} />
        <div>
          <label className="label">圖片描述，不顯示在圖上</label>
          <textarea className="field min-h-24" value={form.custom_prompt} onChange={(e) => setForm({ ...form, custom_prompt: e.target.value })} />
        </div>
      </div>
      <div className="mt-2 text-xs text-neutral-500">草稿會自動暫存在 localStorage。</div>
    </section>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div className="min-w-0">
      <label className="label">{label}</label>
      <input className="field" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function StylePicker({ styles, styleKey, setStyleKey, favorites, toggleFavorite, openAll }) {
  const shown = [...styles.filter((style) => favorites.includes(style.key)), ...styles.filter((style) => !favorites.includes(style.key))].slice(0, 10);
  return (
    <section className="panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black">圖片風格</h2>
        <button onClick={openAll} className="btn btn-ghost gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          查看全部
        </button>
      </div>
      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
        {shown.map((style) => (
          <div key={style.key} className="w-40 shrink-0">
            <StyleCard
              style={style}
              active={styleKey === style.key}
              favorite={favorites.includes(style.key)}
              onFavorite={() => toggleFavorite(style.key)}
              onClick={() => setStyleKey(style.key)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function StyleCard({ style, active, favorite, onFavorite, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-left transition ${active ? 'border-yellow-400 bg-yellow-50' : 'border-neutral-200 bg-white'}`}
    >
      <div className="h-20 rounded-lg bg-[linear-gradient(135deg,#f8fafc,#fde68a,#d9f99d)]" />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-black">{style.name}</span>
        <span
          onClick={(event) => {
            event.stopPropagation();
            onFavorite();
          }}
          className={`rounded-full p-1 ${favorite ? 'text-yellow-500' : 'text-neutral-300'}`}
        >
          <Heart className="h-4 w-4" fill={favorite ? 'currentColor' : 'none'} />
        </span>
      </div>
    </button>
  );
}

function TextControls({ textMode, setTextMode, titleStyle, setTitleStyle, subtitleStyle, setSubtitleStyle, textStyles }) {
  const titleStyles = textStyles.filter((style) => style.type === 'title');
  const subtitleStyles = textStyles.filter((style) => style.type === 'subtitle');
  return (
    <section className="panel">
      <h2 className="text-lg font-black">文字生成</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {[
          ['merged', '圖文合併'],
          ['scene_only', '純底圖'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTextMode(key)}
            className={`rounded-xl border p-3 text-sm font-black ${textMode === key ? 'border-yellow-400 bg-yellow-50' : 'border-neutral-200 bg-white'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {textMode !== 'scene_only' && (
        <div className="mt-4 space-y-4">
          <TextStyleRow label="主標風格" styles={titleStyles} active={titleStyle} setActive={setTitleStyle} />
          <TextStyleRow label="副標風格" styles={subtitleStyles} active={subtitleStyle} setActive={setSubtitleStyle} />
        </div>
      )}
    </section>
  );
}

function TextStyleRow({ label, styles, active, setActive }) {
  return (
    <div>
      <div className="mb-2 text-sm font-bold">{label}</div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {styles.map((style) => (
          <button
            key={style.key}
            onClick={() => setActive(style.key)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold ${
              active === style.key ? 'border-yellow-400 bg-yellow-50' : 'border-neutral-200 bg-white'
            }`}
          >
            {style.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function SpecControls({ language, setLanguage, logoMode, setLogoMode, imageSize, setImageSize, quantity, setQuantity, watermarkOpacity, setWatermarkOpacity }) {
  return (
    <section className="panel">
      <h2 className="text-lg font-black">產圖規格</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">語言</label>
          <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="zh-TW">繁體中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>
        </div>
        <div>
          <label className="label">Logo 模式</label>
          <select className="field" value={logoMode} onChange={(e) => setLogoMode(e.target.value)}>
            <option value="keep">Logo 完整展示</option>
            <option value="remove">Logo 遮蔽去除</option>
          </select>
        </div>
        <div>
          <label className="label">解析度</label>
          <div className="grid grid-cols-2 gap-2">
            {['2K', '4K'].map((key) => (
              <button key={key} onClick={() => setImageSize(key)} className={`rounded-lg border px-3 py-2 text-sm font-bold ${imageSize === key ? 'border-yellow-400 bg-yellow-50' : 'border-neutral-200'}`}>
                {key}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">每張產出</label>
          <select className="field" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
            {[1, 2, 3, 4].map((number) => (
              <option key={number} value={number}>
                {number} 張
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">套框 PNG</label>
          <input className="field" type="file" accept=".png" />
        </div>
        <div>
          <label className="label">浮水印 PNG</label>
          <input className="field" type="file" accept=".png" />
        </div>
        <div>
          <label className="label">水印位置</label>
          <select className="field">
            <option>右下</option>
            <option>左下</option>
            <option>右上</option>
            <option>置中</option>
          </select>
        </div>
        <div>
          <label className="label">水印透明度 {watermarkOpacity}%</label>
          <input className="w-full accent-yellow-400" type="range" min="0" max="100" value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(Number(e.target.value))} />
        </div>
      </div>
    </section>
  );
}

function FormatPicker({ formats, category, setCategory, platform, setPlatform, selectedFormatIds, setSelectedFormatIds, customSize, setCustomSize, customFormats, setCustomFormats }) {
  const filteredPlatforms = platformOrder.filter(([key]) => key !== 'ratio');
  const visibleFormats = formats.filter((format) => {
    if (platform === 'ratio') return format.category === 'ratio';
    return format.platform_key === platform && (category === 'all' || format.category === category);
  });
  const selected = formats.filter((format) => selectedFormatIds.includes(format.id));

  const toggle = (id) => {
    setSelectedFormatIds(selectedFormatIds.includes(id) ? selectedFormatIds.filter((item) => item !== id) : [...selectedFormatIds, id]);
  };

  return (
    <section className="panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black">平台圖片尺寸</h2>
        <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-black text-yellow-700">已選 {selected.length + customFormats.length}</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {[
          ['all', '全部'],
          ['creative', '行銷廣告'],
          ['product', '電商產品'],
          ['ratio', '固定比例'],
          ['custom', '自訂尺寸'],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setCategory(key)} className={`rounded-full px-3 py-2 text-sm font-bold ${category === key ? 'bg-neutral-950 text-white' : 'bg-neutral-100'}`}>
            {label}
          </button>
        ))}
      </div>
      {category !== 'custom' && (
        <>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-2">
            {(category === 'ratio' ? [['ratio', '固定比例']] : filteredPlatforms).map(([key, label]) => (
              <button key={key} onClick={() => setPlatform(key)} className={`shrink-0 rounded-full px-3 py-2 text-sm font-bold ${platform === key ? 'bg-yellow-400' : 'bg-white border border-neutral-200'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {visibleFormats.map((format) => (
              <label key={format.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                <input type="checkbox" checked={selectedFormatIds.includes(format.id)} onChange={() => toggle(format.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{format.format_name}</span>
                  <span className="text-xs text-neutral-500">
                    {format.width}x{format.height}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {category === 'custom' && (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="寬度" type="number" value={customSize.width} onChange={(value) => setCustomSize({ ...customSize, width: Number(value) })} />
          <Field label="高度" type="number" value={customSize.height} onChange={(value) => setCustomSize({ ...customSize, height: Number(value) })} />
          <button
            className="btn btn-yellow self-end"
            onClick={() => {
              if (customSize.width >= 100 && customSize.width <= 4096 && customSize.height >= 100 && customSize.height <= 4096) {
                setCustomFormats([...customFormats, { ...customSize, id: Date.now() }]);
              }
            }}
          >
            加入
          </button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {selected.map((format) => (
          <button key={format.id} onClick={() => toggle(format.id)} className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold">
            {format.platform_name} {format.format_name} ×
          </button>
        ))}
        {customFormats.map((format) => (
          <button key={format.id} onClick={() => setCustomFormats(customFormats.filter((item) => item.id !== format.id))} className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold">
            自訂 {format.width}x{format.height} ×
          </button>
        ))}
      </div>
    </section>
  );
}

function SimpleToolPanel({ toolType, form, setForm, targetLanguage, setTargetLanguage, toolConfig, setToolConfig }) {
  const sensitive = sensitiveToolTypes.includes(toolType);
  return (
    <section className="panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black">{toolLabels[toolType]}</h2>
        {(toolType === 'post_generator' || sensitive) && <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-black">任務 + 點數帳本</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="商品 / 主體" value={form.product_name} onChange={(value) => setForm({ ...form, product_name: value })} />
        <Field label="活動主標" value={form.main_title} onChange={(value) => setForm({ ...form, main_title: value })} />
        <Field label="CTA / 副標" value={form.subtitle} onChange={(value) => setForm({ ...form, subtitle: value })} />
        <div>
          <label className="label">提示詞備註</label>
          <textarea className="field min-h-24" value={form.custom_prompt} onChange={(e) => setForm({ ...form, custom_prompt: e.target.value })} />
        </div>
      </div>
      {toolType === 'translation' && (
        <div className="mt-3">
          <label className="label">目標語言</label>
          <select className="field" value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
            <option value="en">英文</option>
            <option value="zh-TW">繁體中文</option>
            <option value="ja">日文</option>
            <option value="ko">韓文</option>
          </select>
        </div>
      )}
      {toolType === 'post_generator' && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">發佈渠道</label>
            <select className="field" value={toolConfig.channel} onChange={(e) => setToolConfig({ ...toolConfig, channel: e.target.value })}>
              {['instagram', 'facebook', 'line', 'threads', 'tiktok', 'blog'].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label className="label">語氣</label>
            <select className="field" value={toolConfig.tone} onChange={(e) => setToolConfig({ ...toolConfig, tone: e.target.value })}>
              {[
                ['conversion', '轉換導向'],
                ['friendly', '親切'],
                ['premium', '高級感'],
                ['educational', '教育說明'],
                ['playful', '活潑'],
              ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
      )}
      {toolType === 'image_to_video' && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">影片秒數</label>
            <input className="field" type="number" min="3" max="15" value={toolConfig.duration_seconds} onChange={(e) => setToolConfig({ ...toolConfig, duration_seconds: Number(e.target.value) })} />
          </div>
          <Field label="動態描述" value={toolConfig.motion} onChange={(value) => setToolConfig({ ...toolConfig, motion: value })} />
        </div>
      )}
      {sensitive && (
        <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
          <label className="flex items-start gap-2 text-sm font-bold text-neutral-800">
            <input type="checkbox" className="mt-1" checked={toolConfig.consent_granted} onChange={(e) => setToolConfig({ ...toolConfig, consent_granted: e.target.checked })} />
            <span>我已取得主體本人或權利人的明確同意。結果會預設私密保存，並記錄稽核事件。</span>
          </label>
          <textarea
            className="field mt-3 min-h-20"
            placeholder="同意紀錄、肖像/聲音授權、或內部核准編號"
            value={toolConfig.consent_statement}
            onChange={(e) => setToolConfig({ ...toolConfig, consent_statement: e.target.value })}
          />
        </div>
      )}
      <p className="mt-3 text-sm text-neutral-500">所有生成請求都會建立佇列任務，並透過點數帳本扣點。測試模式下 fake provider 會回傳可預期的本機結果。</p>
    </section>
  );
}

function DashboardShell({ route, navigate, children }) {
  const links = [
    ['/dashboard', '儀表板', LayoutDashboard],
    ['/', '一鍵出圖', Sparkles],
    ['/tasks', '任務紀錄', Search],
    ['/assets', '素材庫', ImageIcon],
    ['/credits', '點數明細', Coins],
    ['/pricing', '帳務方案', CreditCard],
    ['/brand', '品牌設定', Settings],
  ];
  return (
    <main className="mx-auto grid max-w-7xl gap-5 px-4 py-6 md:grid-cols-[220px_1fr]">
      <aside className="h-fit rounded-xl border border-neutral-200 bg-white p-3 shadow-soft">
        <div className="mb-2 px-2 text-xs font-black text-neutral-400">會員後台</div>
        <div className="grid gap-1">
          {links.map(([path, label, Icon]) => (
            <button key={path} onClick={() => navigate(path)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold ${route === path ? 'bg-yellow-100' : 'hover:bg-neutral-100'}`}>
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </aside>
      <section className="min-w-0">{children}</section>
    </main>
  );
}

function DashboardPage(props) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api('/api/dashboard').then(setData);
  }, []);
  return (
    <DashboardShell {...props}>
      <PageTitle title="儀表板" subtitle="點數、任務狀態與最近生成紀錄。" />
      {!data ? <LoadingPanel /> : <StatsAndRecent data={data} navigate={props.navigate} />}
    </DashboardShell>
  );
}

function StatsAndRecent({ data, navigate }) {
  const stats = [
    ['點數餘額', data.stats.creditsBalance],
    ['本月生成數', data.stats.monthlyTasks ?? data.stats.todayTasks ?? 0],
    ['成功任務數', data.stats.successTasks ?? data.stats.completedTasks ?? 0],
    ['失敗任務數', data.stats.failedTasks ?? 0],
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="panel">
            <div className="text-sm text-neutral-500">{label}</div>
            <div className="mt-2 text-3xl font-black">{value}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black">最近生成紀錄</h2>
          <button className="btn btn-ghost" onClick={() => navigate('/tasks')}>全部任務</button>
        </div>
        <TaskRows tasks={data.recentTasks} navigate={navigate} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.tools.map((tool) => (
          <button key={tool.key} onClick={() => navigate('/')} className="rounded-xl border border-neutral-200 bg-white p-4 text-left font-black hover:border-yellow-400">
            {tool.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskListPage(props) {
  const [filters, setFilters] = useState({ q: '', tool_type: '', status: '' });
  const [tasks, setTasks] = useState([]);
  const load = () => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    api(`/api/my/tasks?${query}`).then((data) => setTasks(data.tasks));
  };
  useEffect(load, []);
  return (
    <DashboardShell {...props}>
      <PageTitle title="任務紀錄" subtitle="可依工具、狀態與關鍵字篩選。" />
      <div className="panel mb-4 grid gap-2 md:grid-cols-[1fr_160px_160px_auto]">
        <input className="field" placeholder="搜尋產品、主標或任務 ID" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select className="field" value={filters.tool_type} onChange={(e) => setFilters({ ...filters, tool_type: e.target.value })}>
          <option value="">全部工具</option>
          {Object.entries(toolLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select className="field" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">全部狀態</option>
          {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button className="btn btn-primary gap-2" onClick={load}><Search className="h-4 w-4" />搜尋</button>
      </div>
      <div className="panel">
        <TaskRows tasks={tasks} navigate={props.navigate} />
      </div>
    </DashboardShell>
  );
}

function TaskRows({ tasks, navigate }) {
  if (!tasks?.length) return <div className="py-8 text-center text-sm text-neutral-500">目前沒有紀錄。</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="text-xs text-neutral-500">
          <tr>
            <th className="py-2">ID</th>
            <th>工具</th>
            <th>產品 / 主標</th>
            <th>點數</th>
            <th>狀態</th>
            <th>建立時間</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-t border-neutral-100">
              <td className="py-3 font-bold">#{task.id}</td>
              <td>{toolLabels[task.tool_type] || task.tool_type}</td>
              <td className="max-w-xs truncate">{task.product_name || task.main_title || '-'}</td>
              <td>{task.credits_cost}</td>
              <td><StatusBadge status={task.status} /></td>
              <td>{new Date(task.created_at).toLocaleString()}</td>
              <td><button className="btn btn-ghost px-3 py-1" onClick={() => navigate(`/tasks/${task.id}`)}>查看</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskDetailPage({ taskId, navigate, user, openAuth }) {
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const data = await api(`/api/tasks/${taskId}`);
      setTask(data.task);
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => {
    if (!user) {
      openAuth('login');
      return;
    }
    load();
  }, [taskId, user?.id]);
  useEffect(() => {
    if (!task || !['pending', 'processing'].includes(task.status)) return undefined;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [task?.status, taskId]);

  if (error) return <main className="mx-auto max-w-3xl px-4 py-10"><div className="panel text-red-700">{error}</div></main>;
  if (!task) return <main className="mx-auto max-w-3xl px-4 py-10"><LoadingPanel /></main>;

  const latestCostLog = task.ai_cost_logs?.[0] || null;
  const latestCostMeta = parseTaskCostMeta(latestCostLog);
  const taskAction = async (path, body = {}) => {
    const result = await api(path, { method: 'POST', body });
    await load();
    return result;
  };
  const retryTask = () => taskAction(`/api/tasks/${task.id}/retry`);
  const duplicateTask = async () => {
    const result = await taskAction(`/api/tasks/${task.id}/duplicate`);
    if (result.redirect_url) navigate(result.redirect_url);
  };
  const requestQuality = () => taskAction(`/api/tasks/${task.id}/quality-review-request`, { reason: 'Requested from task detail.' });
  const requestHandoff = () => taskAction(`/api/tasks/${task.id}/devpilot-handoff`, { reason: 'Task detail handoff requested.' });
  const regenerateOutput = (image) => taskAction(`/api/tasks/${task.id}/regenerations`, { task_image_id: image.id, reason: 'Selected output needs another version.' });
  const updateAsset = async (image, patch) => {
    await api(`/api/assets/${image.id}/metadata`, { method: 'POST', body: patch });
    await load();
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <button onClick={() => navigate('/tasks')} className="btn btn-ghost mb-4">返回任務紀錄</button>
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <aside className="panel h-fit">
          <div className="mb-3 flex items-center justify-between">
            <h1 className="text-xl font-black">任務 #{task.id}</h1>
            <StatusBadge status={task.status} />
          </div>
          <div className="space-y-2 text-sm">
            <Row label="工具" value={toolLabels[task.tool_type]} />
            <Row label="產品名稱" value={task.product_name || '-'} />
            <Row label="主標" value={task.main_title || '-'} />
            <Row label="副標" value={task.subtitle || '-'} />
            <Row label="點數" value={`${task.credits_cost} 點`} />
            <Row label="建立時間" value={new Date(task.created_at).toLocaleString()} />
          </div>
          {latestCostLog && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-neutral-600">AI 供應商</span>
                <span className="font-black text-neutral-900">
                  {latestCostMeta.provider || '-'} / {latestCostMeta.model || '-'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-500">
                <span>Images: {latestCostMeta.imageCount || 0}</span>
                <span>Cost: {latestCostMeta.cost ?? '-'}</span>
                {latestCostMeta.latencyMs !== null && <span>Latency: {latestCostMeta.latencyMs}ms</span>}
                {latestCostMeta.imageMode && <span>Mode: {latestCostMeta.imageMode}</span>}
                {latestCostMeta.storageDisk && <span>Storage: {latestCostMeta.storageDisk}</span>}
                <span>參考圖: {latestCostMeta.usedReferenceImage ? '是' : '否'}</span>
                {(latestCostMeta.requestedProvider || task.requested_provider) && <span>指定: {latestCostMeta.requestedProvider || task.requested_provider}</span>}
                {(latestCostMeta.resolvedProvider || task.resolved_provider) && <span>實際: {latestCostMeta.resolvedProvider || task.resolved_provider}</span>}
                {(latestCostMeta.requestedCapability || task.requested_capability) && <span>能力: {latestCostMeta.requestedCapability || task.requested_capability}</span>}
              </div>
              {latestCostMeta.fallbackUsed && (
                <div className="mt-2 rounded-full bg-yellow-100 px-3 py-1 text-xs font-black text-yellow-700">
                  已 fallback 到 fake provider{latestCostMeta.fallbackReason ? `: ${latestCostMeta.fallbackReason}` : ''}
                </div>
              )}
              {(latestCostMeta.qualityReviewRequired || task.quality_review_required) && (
                <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                  Quality review required
                </div>
              )}
              {task.quality_reviews?.length > 0 && (
                <div className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
                  Review: {task.quality_reviews[0].approved ? 'approved' : task.quality_reviews[0].needs_regeneration ? 'needs regeneration' : 'pending'}
                  {task.quality_reviews[0].notes ? ` - ${task.quality_reviews[0].notes}` : ''}
                </div>
              )}
              {latestCostMeta.errorMessage && task.status === 'failed' && (
                <div className="mt-2 text-xs font-bold text-red-600">
                  {latestCostMeta.errorCode && <span>[{latestCostMeta.errorCode}] </span>}
                  {friendlyTaskError(latestCostMeta)}
                </div>
              )}
            </div>
          )}
          {['pending', 'processing'].includes(task.status) && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-yellow-50 p-3 text-sm font-bold text-yellow-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>AI 生成中，請勿關閉頁面。系統每 3 秒自動更新。</span>
              任務處理中，系統每 3 秒更新。
            </div>
          )}
          {task.status === 'failed' && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <div className="font-bold">錯誤原因</div>
              <div>{friendlyTaskError(latestCostMeta, task.error_message || '未知錯誤')}</div>
              <button onClick={retryTask} className="btn btn-ghost mt-3 gap-2"><RefreshCcw className="h-4 w-4" />Retry failed task</button>
            </div>
          )}
        </aside>
        {task.status === 'failed' && (
        <div className="mt-3 rounded-lg bg-red-100 p-3 text-xs font-bold text-red-700">
          {latestCostMeta.errorCode && <div>error_code: {latestCostMeta.errorCode}</div>}
          <div>{friendlyTaskError(latestCostMeta, task.error_message || '')}</div>
          <div className="mt-1 font-semibold">請使用 smoke/storage check 與 Admin 任務紀錄排查 provider、worker 或 storage 設定。</div>
        </div>
        )}
        <section className="min-w-0">
          {task.status === 'success' && (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                <button className="btn btn-ghost gap-2" onClick={duplicateTask}><Copy className="h-4 w-4" />複製任務</button>
                <button className="btn btn-ghost gap-2" onClick={requestQuality}><CheckCircle2 className="h-4 w-4" />申請品質審核</button>
                <button className="btn btn-ghost gap-2" onClick={requestHandoff}><Shield className="h-4 w-4" />申請 DevPilot 交接</button>
                <button className="btn btn-ghost gap-2" onClick={() => navigate(`/feedback?task_id=${task.id}`)}><AlertTriangle className="h-4 w-4" />回報問題</button>
              </div>
              {task.artifacts?.length > 0 && <ArtifactPanel artifacts={task.artifacts} />}
              <ImageGrid
                images={task.output_images}
                onRegenerate={regenerateOutput}
                onFavorite={(image) => updateAsset(image, { favorite: true })}
                onArchive={(image) => updateAsset(image, { archived: true })}
              />
            </>
          )}
          {task.status !== 'success' && (
            <>
              {task.artifacts?.length > 0 && <ArtifactPanel artifacts={task.artifacts} />}
              <ImageGrid images={task.input_images} title="上傳原圖" />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function ArtifactPanel({ artifacts }) {
  return (
    <div className="panel mb-4">
      <h2 className="mb-3 text-lg font-black">生成作品</h2>
      <div className="grid gap-3">
        {artifacts.map((artifact) => (
          <div key={artifact.id} className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="font-black">{artifact.title || artifact.kind}</div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold">{artifact.kind} / {artifact.visibility || 'private'}</span>
            </div>
            {artifact.content_text && <pre className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm leading-6 text-neutral-700">{artifact.content_text}</pre>}
            {artifact.storage_path && <div className="mt-2 break-all text-xs text-neutral-500">{artifact.storage_path}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ImageGrid({ images, title = '生成圖片', onRegenerate = null, onFavorite = null, onArchive = null }) {
  return (
    <div className="panel">
      <h2 className="mb-3 text-lg font-black">{title}</h2>
      {!images?.length ? (
        <div className="py-10 text-center text-sm text-neutral-500">尚無圖片。</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {images.map((image) => (
            <div key={image.id} className="rounded-xl border border-neutral-200 p-2">
              <div className="aspect-square overflow-hidden rounded-lg bg-neutral-100">
                <img
                  src={image.url}
                  className="h-full w-full object-cover"
                  alt=""
                  onError={(event) => {
                    event.currentTarget.replaceWith(document.createTextNode(imageLoadErrorMessage()));
                  }}
                />
              </div>
              <a href={image.url} download className="btn btn-ghost mt-2 w-full gap-2">
                <Download className="h-4 w-4" />
                下載
              </a>
              {(onRegenerate || onFavorite || onArchive) && (
                <div className="mt-2 grid gap-2 text-xs">
                  {onRegenerate && <button className="btn btn-ghost px-2 py-1" onClick={() => onRegenerate(image)}>Regenerate request</button>}
                  {onFavorite && <button className="btn btn-ghost px-2 py-1" onClick={() => onFavorite(image)}>Mark favorite</button>}
                  {onArchive && <button className="btn btn-ghost px-2 py-1" onClick={() => onArchive(image)}>Archive output</button>}
                  <button className="btn btn-ghost px-2 py-1" onClick={() => navigator.clipboard?.writeText(image.url)}>Copy output URL</button>
                  <button className="btn btn-ghost px-2 py-1" onClick={() => { window.location.href = `/feedback?asset_url=${encodeURIComponent(image.url)}`; }}>Report image issue</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetsPage(props) {
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState('all');
  const [format, setFormat] = useState('all');
  const [assets, setAssets] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [drafts, setDrafts] = useState({});
  const buildQuery = () => {
    const query = new URLSearchParams();
    query.set('type', type);
    if (q) query.set('q', q);
    if (provider !== 'all') query.set('provider', provider);
    if (format !== 'all') query.set('format', format);
    return query.toString();
  };
  const load = () => api(`/api/assets?${buildQuery()}`).then((data) => {
    setAssets(data.assets || []);
    setArtifacts(data.artifacts || []);
    setTotal(data.total || 0);
  });
  useEffect(() => {
    load();
  }, [type, provider, format]);
  const saveMetadata = async (asset, patch) => {
    const body = { ...(drafts[asset.id] || {}), ...patch };
    await api(`/api/assets/${asset.id}/metadata`, { method: 'POST', body });
    setMessage('素材資訊已儲存。');
    load();
  };
  const exportManifest = async () => {
    const ids = selectedIds.length ? selectedIds : assets.map((asset) => asset.id);
    const result = await api(`/api/assets/export-manifest?ids=${ids.join(',')}`);
    setMessage(`素材清單已產生：${result.items?.length || 0} 筆。`);
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'asset-manifest.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () => {
    const ids = selectedIds.length ? selectedIds : assets.map((asset) => asset.id);
    window.location.href = `/api/assets.csv?ids=${ids.join(',')}`;
  };
  const batchAction = async (action) => {
    const ids = selectedIds.length ? selectedIds : assets.map((asset) => asset.id);
    await api('/api/assets/batch', { method: 'POST', body: { ids, action, tags: action === 'tag' ? 'trial-selected' : undefined } });
    setMessage(`已批次更新 ${ids.length} 個素材。`);
    load();
  };
  const createShare = async (asset) => {
    const result = await api(`/api/assets/${asset.id}/share`, { method: 'POST', body: {} });
    await navigator.clipboard?.writeText(result.share.share_url);
    setMessage(`分享連結已建立：${result.share.share_url}`);
    load();
  };
  return (
    <DashboardShell {...props}>
      <PageTitle title="素材庫" subtitle="集中查看上傳原圖與生成結果。" />
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ['all', '全部'],
          ['input', '上傳原圖'],
          ['output', '生成結果'],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setType(key)} className={`rounded-full px-3 py-2 text-sm font-bold ${type === key ? 'bg-neutral-950 text-white' : 'bg-white border border-neutral-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <ImageGrid images={assets} title="素材" />
    </DashboardShell>
  );
}

function AssetsManagerPage(props) {
  const [type, setType] = useState('output');
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState('all');
  const [format, setFormat] = useState('all');
  const [assets, setAssets] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [drafts, setDrafts] = useState({});
  const buildQuery = () => {
    const query = new URLSearchParams();
    query.set('type', type);
    if (q) query.set('q', q);
    if (provider !== 'all') query.set('provider', provider);
    if (format !== 'all') query.set('format', format);
    return query.toString();
  };
  const load = () => api(`/api/assets?${buildQuery()}`).then((data) => {
    setAssets(data.assets || []);
    setArtifacts(data.artifacts || []);
    setTotal(data.total || 0);
  });
  useEffect(() => {
    load();
  }, [type, provider, format]);
  const saveMetadata = async (asset, patch) => {
    const body = { ...(drafts[asset.id] || {}), ...patch };
    await api(`/api/assets/${asset.id}/metadata`, { method: 'POST', body });
    setMessage('素材資訊已儲存。');
    load();
  };
  const exportManifest = async () => {
    const ids = selectedIds.length ? selectedIds : assets.map((asset) => asset.id);
    const result = await api(`/api/assets/export-manifest?ids=${ids.join(',')}`);
    setMessage(`素材清單已產生：${result.items?.length || 0} 筆。`);
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'asset-manifest.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () => {
    const ids = selectedIds.length ? selectedIds : assets.map((asset) => asset.id);
    window.location.href = `/api/assets.csv?ids=${ids.join(',')}`;
  };
  const batchAction = async (action) => {
    const ids = selectedIds.length ? selectedIds : assets.map((asset) => asset.id);
    await api('/api/assets/batch', { method: 'POST', body: { ids, action, tags: action === 'tag' ? 'trial-selected' : undefined } });
    setMessage(`已批次更新 ${ids.length} 個素材。`);
    load();
  };
  const createShare = async (asset) => {
    const result = await api(`/api/assets/${asset.id}/share`, { method: 'POST', body: {} });
    await navigator.clipboard?.writeText(result.share.share_url);
    setMessage(`分享連結已建立：${result.share.share_url}`);
    load();
  };
  return (
    <DashboardShell {...props}>
      <PageTitle title="素材庫" subtitle="管理生成作品、素材資訊、下載連結與匯出清單。" />
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ['all', '全部'],
          ['input', '上傳原圖'],
          ['output', '生成結果'],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setType(key)} className={`rounded-full px-3 py-2 text-sm font-bold ${type === key ? 'bg-neutral-950 text-white' : 'border border-neutral-200 bg-white'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="panel mb-4 grid gap-2 md:grid-cols-[1fr_150px_150px_auto_auto_auto]">
        <input className="field" placeholder="搜尋商品或任務 ID" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <select className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="all">全部供應商</option>
          <option value="fake">fake</option>
          <option value="openai">openai</option>
          <option value="gemini">gemini</option>
          <option value="claude">claude</option>
        </select>
        <input className="field" placeholder="格式" value={format === 'all' ? '' : format} onChange={(e) => setFormat(e.target.value || 'all')} />
        <button className="btn btn-primary gap-2" onClick={load}><Search className="h-4 w-4" />搜尋</button>
        <button className="btn btn-ghost gap-2" onClick={exportManifest}><Download className="h-4 w-4" />清單</button>
        <button className="btn btn-ghost gap-2" onClick={exportCsv}><Download className="h-4 w-4" />CSV</button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => batchAction('favorite')}>批次收藏</button>
        <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => batchAction('archive')}>批次封存</button>
        <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => batchAction('tag')}>批次標籤</button>
      </div>
      {message && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm font-bold text-green-700">{message}</div>}
      <div className="panel">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-black">素材 ({total})</h2>
          <span className="text-xs text-neutral-500">已選 {selectedIds.length} 個</span>
        </div>
        {!assets.length ? (
          <div className="py-10 text-center text-sm text-neutral-500">目前沒有素材。建立本機測試任務後會出現在這裡。</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => {
              const draft = drafts[asset.id] || { tags: (asset.tags || []).join(', '), notes: asset.notes || '' };
              return (
                <div key={asset.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <label className="mb-2 flex items-center gap-2 text-xs font-bold text-neutral-500">
                    <input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={(e) => setSelectedIds(e.target.checked ? [...selectedIds, asset.id] : selectedIds.filter((id) => id !== asset.id))} />
                    #{asset.id} / 任務 #{asset.task_id}
                  </label>
                  <div className="aspect-square overflow-hidden rounded-lg bg-neutral-100">
                    <img src={asset.url} className="h-full w-full object-cover" alt="" onError={(event) => { event.currentTarget.replaceWith(document.createTextNode(imageLoadErrorMessage())); }} />
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-neutral-600">
                    <div className="font-black text-neutral-900">{asset.product_name || asset.main_title || '未命名'}</div>
                    <div>{asset.format || '未指定格式'} / {asset.provider || '-'}</div>
                    <div>{asset.model || '-'} / cost {asset.cost ?? '-'}</div>
                    <div>{asset.created_at ? new Date(asset.created_at).toLocaleString() : '-'}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={asset.url} download className="btn btn-ghost gap-1 px-2 py-1 text-xs"><Download className="h-3 w-3" />下載</a>
                    <button className="btn btn-ghost gap-1 px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(asset.url)}><Copy className="h-3 w-3" />複製網址</button>
                    <button className="btn btn-ghost gap-1 px-2 py-1 text-xs" onClick={() => saveMetadata(asset, { favorite: !asset.favorite })}><Heart className="h-3 w-3" />{asset.favorite ? '取消收藏' : '收藏'}</button>
                    <button className="btn btn-ghost gap-1 px-2 py-1 text-xs" onClick={() => saveMetadata(asset, { archived: true })}>封存</button>
                    <button className="btn btn-ghost gap-1 px-2 py-1 text-xs" onClick={() => createShare(asset)}>建立分享連結</button>
                    {asset.share_url && <button className="btn btn-ghost gap-1 px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(asset.share_url)}>複製分享</button>}
                  </div>
                  <div className="mt-3 space-y-2">
                    <input className="field text-xs" placeholder="標籤，以逗號分隔" value={draft.tags} onChange={(e) => setDrafts({ ...drafts, [asset.id]: { ...draft, tags: e.target.value } })} />
                    <textarea className="field min-h-[70px] text-xs" placeholder="備註" value={draft.notes} onChange={(e) => setDrafts({ ...drafts, [asset.id]: { ...draft, notes: e.target.value } })} />
                    <button className="btn btn-primary w-full px-2 py-1 text-xs" onClick={() => saveMetadata(asset, draft)}>儲存標籤/備註</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!!artifacts.length && (
        <div className="panel mt-4">
          <h2 className="mb-3 text-lg font-black">文字 / 影片作品</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {artifacts.map((artifact) => (
              <div key={artifact.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate font-black">{artifact.title || artifact.kind}</div>
                  <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold">{artifact.kind}</span>
                </div>
                <div className="mb-2 text-xs text-neutral-500">任務 #{artifact.task_id} / {toolLabels[artifact.tool_type] || artifact.tool_type} / {artifact.visibility === 'private' ? '私密' : '分享'}</div>
                {artifact.content_text && <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-xs leading-5">{artifact.content_text}</pre>}
                {artifact.url && <a className="btn btn-ghost mt-2 px-2 py-1 text-xs" href={artifact.url}>開啟檔案</a>}
              </div>
            ))}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

function CreditsPage(props) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api('/api/credits').then(setData);
  }, []);
  return (
    <DashboardShell {...props}>
      <PageTitle title="點數明細" subtitle="消耗、購買、退點與管理調整紀錄。" />
      {!data ? <LoadingPanel /> : (
        <div className="space-y-4">
          <div className="panel flex items-center justify-between">
            <div><div className="text-sm text-neutral-500">目前餘額</div><div className="text-3xl font-black">{data.balance} 點</div></div>
            <button className="btn btn-yellow" onClick={() => props.navigate('/pricing')}>購買點數</button>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="panel"><div className="text-xs text-neutral-500">Total spent</div><div className="mt-2 text-2xl font-black">{data.totalSpent || 0}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Today spent</div><div className="mt-2 text-2xl font-black">{data.todaySpent || 0}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Fake provider</div><div className="mt-2 text-2xl font-black">demo / {data.fakeProviderCost || 0}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Recharge</div><div className="mt-2 text-sm font-bold">Demo placeholder</div></div>
          </div>
          <div className="panel overflow-x-auto">
            <h2 className="mb-3 font-black">Recent task costs</h2>
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-xs text-neutral-500"><tr><th className="py-2">Task</th><th>Product</th><th>Status</th><th>Task cost</th><th>Provider</th><th>Provider cost</th><th>Refund</th></tr></thead>
              <tbody>{(data.taskCosts || []).map((task) => (
                <tr key={task.task_id} className="border-t border-neutral-100"><td className="py-3">#{task.task_id}</td><td>{task.product_name || '-'}</td><td>{task.status}</td><td>{task.credits_cost}</td><td>{task.provider || task.metadata?.provider || '-'}</td><td>{task.cost_usd ?? task.metadata?.cost ?? '-'}</td><td>{task.status === 'failed' ? 'policy checked' : '-'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="text-xs text-neutral-500"><tr><th className="py-2">時間</th><th>類型</th><th>點數</th><th>餘額</th><th>備註</th></tr></thead>
              <tbody>{data.transactions.map((tx) => (
                <tr key={tx.id} className="border-t border-neutral-100"><td className="py-3">{new Date(tx.created_at).toLocaleString()}</td><td>{creditTypeLabels[tx.type]}</td><td className={tx.amount > 0 ? 'text-green-700' : 'text-red-700'}>{tx.amount}</td><td>{tx.balance_after}</td><td>{tx.note}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

function BrandPage(props) {
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    api('/api/brand').then((data) => setSettings(data.settings));
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await api('/api/brand', { method: 'POST', body: data });
    setSettings(result.settings);
    setMessage('品牌設定已儲存');
  };
  return (
    <DashboardShell {...props}>
      <PageTitle title="品牌設定" subtitle="保存 Logo、品牌色與預設輸出偏好。" />
      {!settings ? <LoadingPanel /> : (
        <form onSubmit={submit} className="panel grid gap-3 md:grid-cols-2">
          <Field label="品牌名稱" value={settings.brand_name || ''} onChange={(value) => setSettings({ ...settings, brand_name: value })} />
          <div><label className="label">Logo 上傳</label><input className="field" type="file" name="logo" accept=".jpg,.jpeg,.png,.webp,.bmp" /></div>
          <div><label className="label">主色</label><input className="field h-11" type="color" name="primary_color" value={settings.primary_color || '#facc15'} onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })} /></div>
          <div><label className="label">輔色</label><input className="field h-11" type="color" name="secondary_color" value={settings.secondary_color || '#111827'} onChange={(e) => setSettings({ ...settings, secondary_color: e.target.value })} /></div>
          <div><label className="label">預設浮水印</label><input className="field" type="file" name="watermark" accept=".jpg,.jpeg,.png,.webp,.bmp" /></div>
          <div><label className="label">預設語言</label><select className="field" name="default_language" value={settings.default_language} onChange={(e) => setSettings({ ...settings, default_language: e.target.value })}><option value="zh-TW">繁中</option><option value="en">英文</option></select></div>
          <div><label className="label">預設 Logo 模式</label><select className="field" name="default_logo_mode" value={settings.default_logo_mode} onChange={(e) => setSettings({ ...settings, default_logo_mode: e.target.value })}><option value="keep">完整展示</option><option value="remove">遮蔽去除</option></select></div>
          <div><label className="label">Brand voice</label><input className="field" name="brand_voice" value={settings.brand_voice || ''} onChange={(e) => setSettings({ ...settings, brand_voice: e.target.value })} /></div>
          <div><label className="label">Target audience</label><input className="field" name="target_audience" value={settings.target_audience || ''} onChange={(e) => setSettings({ ...settings, target_audience: e.target.value })} /></div>
          <div><label className="label">Keywords</label><textarea className="field min-h-24" name="brand_keywords" value={settings.brand_keywords || ''} onChange={(e) => setSettings({ ...settings, brand_keywords: e.target.value })} /></div>
          <div><label className="label">Forbidden terms</label><textarea className="field min-h-24" name="forbidden_terms" value={settings.forbidden_terms || ''} onChange={(e) => setSettings({ ...settings, forbidden_terms: e.target.value })} /></div>
          <div><label className="label">Product pillars</label><textarea className="field min-h-24" name="product_pillars" value={settings.product_pillars || ''} onChange={(e) => setSettings({ ...settings, product_pillars: e.target.value })} /></div>
          <div><label className="label">Sample posts</label><textarea className="field min-h-24" name="sample_posts" value={settings.sample_posts || ''} onChange={(e) => setSettings({ ...settings, sample_posts: e.target.value })} /></div>
          <input type="hidden" name="brand_name" value={settings.brand_name || ''} />
          <input type="hidden" name="primary_color" value={settings.primary_color || ''} />
          <input type="hidden" name="secondary_color" value={settings.secondary_color || ''} />
          <div className="md:col-span-2"><button className="btn btn-yellow">儲存</button>{message && <span className="ml-3 text-sm text-green-700">{message}</span>}</div>
        </form>
      )}
    </DashboardShell>
  );
}

function PricingPage({ user, openAuth, refreshSession }) {
  const [packages, setPackages] = useState([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    api('/api/pricing').then((data) => setPackages(data.packages));
  }, []);
  const buy = async (pkg) => {
    if (!user) {
      openAuth('login');
      return;
    }
    const order = await api('/api/orders', { method: 'POST', body: { credit_package_id: pkg.id } });
    await api(order.dev_pay_url, { method: 'POST' });
    await refreshSession();
    setMessage(`${pkg.name} 模擬付款成功，點數已入帳。`);
  };
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <PageTitle title="帳務方案" subtitle="第一版先提供 dev/admin 模擬付款，不串真金流。" />
      {message && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>}
      <div className="grid gap-4 md:grid-cols-3">
        {packages.map((pkg) => (
          <div key={pkg.id} className="panel">
            <h2 className="text-xl font-black">{pkg.name}</h2>
            <div className="mt-3 text-4xl font-black">{pkg.credits + pkg.bonus_credits}<span className="text-base"> 點</span></div>
            <div className="mt-1 text-neutral-500">NT${pkg.price}</div>
            <button onClick={() => buy(pkg)} className="btn btn-yellow mt-5 w-full">購買</button>
          </div>
        ))}
      </div>
    </main>
  );
}

function AdminRouter(props) {
  if (!props.user) return <LoginRequired openAuth={props.openAuth} />;
  if (props.user.role !== 'admin') return <main className="mx-auto max-w-3xl px-4 py-10"><div className="panel text-red-700">需要管理員權限。</div></main>;
  const path = props.route;
  if (path.startsWith('/admin/tasks/')) return <AdminTaskDetailPage {...props} taskId={path.split('/')[3]} />;
  if (path === '/admin/users') return <AdminUsersPage {...props} />;
  if (path === '/admin/credits') return <AdminCreditsPage {...props} />;
  if (path === '/admin/tasks') return <AdminTasksPage {...props} />;
  if (path === '/admin/storage') return <AdminStoragePage {...props} />;
  if (path === '/admin/quality') return <AdminQualityPage {...props} />;
  if (path === '/admin/system') return <AdminSystemPage {...props} />;
  if (path === '/admin/trial') return <AdminTrialPage {...props} />;
  if (path === '/admin/feedback') return <AdminFeedbackPage {...props} />;
  if (path === '/admin/providers') return <AdminProvidersPage {...props} />;
  if (path === '/admin/provider-playground') return <AdminProviderPlaygroundPage {...props} />;
  if (path === '/admin/devpilot') return <AdminDevPilotPage {...props} />;
  if (path === '/admin/devpilot/handoffs') return <AdminDevPilotHandoffsPage {...props} />;
  if (path === '/admin/devpilot-keys') return <AdminDevPilotKeysPage {...props} />;
  if (path === '/admin/integration-toolbox') return <AdminIntegrationToolboxPage {...props} />;
  if (path === '/admin/assets') return <AdminAssetsPage {...props} />;
  if (path === '/admin/audit') return <AdminAuditPage {...props} />;
  if (path === '/admin/usage') return <AdminUsagePage {...props} />;
  if (path === '/admin/styles') return <AdminCrudPage {...props} title="風格管理" endpoint="/api/admin/styles" fields={['key','name','prompt','default_title_style','default_subtitle_style','sort_order','is_active']} />;
  if (path === '/admin/platform-formats') return <AdminCrudPage {...props} title="平台尺寸管理" endpoint="/api/admin/platform-formats" fields={['platform_key','platform_name','category','format_name','width','height','sort_order','is_active']} />;
  if (path === '/admin/prompts') return <AdminCrudPage {...props} title="Prompt 管理" endpoint="/api/admin/prompts" fields={['key','name','tool_type','system_prompt','user_prompt_template','version','is_active','notes']} />;
  if (path === '/admin/reports/costs') return <AdminReportsPage {...props} />;
  return <AdminDashboardPage {...props} />;
}

function AdminShell({ route, navigate, children }) {
  const links = [
    ['/admin', '總覽'],
    ['/admin/users', '使用者管理'],
    ['/admin/credits', 'Credits'],
    ['/admin/tasks', '任務管理'],
    ['/admin/storage', 'Storage'],
    ['/admin/quality', 'Quality Review'],
    ['/admin/system', 'System'],
    ['/admin/trial', 'Trial Ops'],
    ['/admin/feedback', 'Feedback'],
    ['/admin/providers', 'AI Providers'],
    ['/admin/provider-playground', 'Provider Playground'],
    ['/admin/devpilot', 'DevPilot'],
    ['/admin/devpilot/handoffs', 'Handoffs'],
    ['/admin/devpilot-keys', 'DevPilot Keys'],
    ['/admin/integration-toolbox', 'Integration Toolbox'],
    ['/admin/assets', 'Assets'],
    ['/admin/audit', 'Audit'],
    ['/admin/usage', 'Usage'],
    ['/admin/styles', '風格管理'],
    ['/admin/platform-formats', '平台尺寸管理'],
    ['/admin/prompts', 'Prompt 管理'],
    ['/admin/reports/costs', '成本報表'],
  ];
  return (
    <main className="mx-auto grid max-w-7xl gap-5 px-4 py-6 md:grid-cols-[220px_1fr]">
      <aside className="h-fit rounded-xl border border-neutral-200 bg-neutral-950 p-3 text-white shadow-soft">
        <div className="mb-2 flex items-center gap-2 px-2 text-xs font-black text-yellow-300"><Shield className="h-4 w-4" />Admin</div>
        {links.map(([path, label]) => (
          <button key={path} onClick={() => navigate(path)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-bold ${route === path ? 'bg-yellow-400 text-neutral-950' : 'hover:bg-white/10'}`}>
            {label}
          </button>
        ))}
      </aside>
      <section className="min-w-0">{children}</section>
    </main>
  );
}

function AdminDashboardPage(props) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/summary').then(setData); }, []);
  return (
    <AdminShell {...props}>
      <PageTitle title="Admin 總覽" subtitle="今日註冊、任務、消耗點數與 AI 成本。" />
      {!data ? <LoadingPanel /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(data.stats).map(([key, value]) => <div key={key} className="panel"><div className="text-xs text-neutral-500">{key}</div><div className="mt-2 text-3xl font-black">{value}</div></div>)}
          </div>
          <div className="panel"><h2 className="mb-3 font-black">最近失敗任務</h2><TaskRows tasks={data.recentFailedTasks} navigate={props.navigate} /></div>
        </div>
      )}
    </AdminShell>
  );
}

function AdminUsersPage(props) {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('管理調整');
  const load = () => api(`/api/admin/users?q=${encodeURIComponent(q)}`).then((data) => setUsers(data.users));
  useEffect(load, []);
  const adjust = async (id, amount) => { await api(`/api/admin/users/${id}/adjust-credits`, { method: 'POST', body: { amount, note } }); load(); };
  const update = async (id, route, body) => { await api(`/api/admin/users/${id}/${route}`, { method: 'POST', body }); load(); };
  return (
    <AdminShell {...props}>
      <PageTitle title="使用者管理" subtitle="搜尋、補點、扣點、停權與角色切換。" />
      <div className="panel mb-4 grid gap-2 md:grid-cols-[1fr_180px_auto]">
        <input className="field" placeholder="搜尋 email/name/id" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="field" placeholder="調整備註" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-primary" onClick={load}>搜尋</button>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="text-xs text-neutral-500"><tr><th className="py-2">ID</th><th>Email</th><th>Role</th><th>Status</th><th>Credits</th><th>Actions</th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id} className="border-t border-neutral-100">
              <td className="py-3">#{u.id}</td><td>{u.email}</td><td>{u.role}</td><td>{u.status}</td><td>{u.credits_balance}</td>
              <td className="flex flex-wrap gap-2 py-2">
                <button className="btn btn-ghost px-2 py-1" onClick={() => adjust(u.id, 100)}>補 100</button>
                <button className="btn btn-ghost px-2 py-1" onClick={() => adjust(u.id, -100)}>扣 100</button>
                <button className="btn btn-ghost px-2 py-1" onClick={() => update(u.id, 'status', { status: u.status === 'active' ? 'suspended' : 'active' })}>{u.status === 'active' ? '停權' : '恢復'}</button>
                <button className="btn btn-ghost px-2 py-1" onClick={() => update(u.id, 'role', { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? '設 user' : '設 admin'}</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </AdminShell>
  );
}

function AdminCreditsPage(props) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ user_id: '', amount: 100, note: '' });
  const [message, setMessage] = useState('');
  const load = () => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    api(`/api/admin/credits?${query}`).then(setData);
  };
  useEffect(load, []);
  const adjust = async () => {
    await api(`/api/admin/users/${form.user_id}/adjust-credits`, { method: 'POST', body: { amount: Number(form.amount), note: form.note } });
    setMessage('Credit adjustment saved.');
    load();
  };
  return (
    <AdminShell {...props}>
      <PageTitle title="Admin Credits" subtitle="Demo credit ledger, manual adjustment, and redacted CSV export." />
      <div className="space-y-4">
        {message && <div className="rounded-lg bg-green-50 p-3 text-sm font-bold text-green-700">{message}</div>}
        <div className="panel grid gap-2 md:grid-cols-[1fr_auto]">
          <input className="field" placeholder="Search user email/name/id" value={q} onChange={(event) => setQ(event.target.value)} />
          <button className="btn btn-primary" onClick={load}>Search</button>
        </div>
        <div className="panel grid gap-2 md:grid-cols-[120px_120px_1fr_auto]">
          <input className="field" placeholder="User ID" value={form.user_id} onChange={(event) => setForm({ ...form, user_id: event.target.value })} />
          <input className="field" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          <input className="field" placeholder="Reason required" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          <button className="btn btn-yellow" onClick={adjust}>Adjust</button>
        </div>
        {!data ? <LoadingPanel /> : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="panel"><div className="text-xs text-neutral-500">Total balance</div><div className="mt-2 text-2xl font-black">{data.totalBalance}</div></div>
              <div className="panel"><div className="text-xs text-neutral-500">Total spent</div><div className="mt-2 text-2xl font-black">{data.totalSpent}</div></div>
              <a className="panel text-sm font-black" href="/api/admin/credits.csv">Export ledger CSV</a>
            </div>
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="text-xs text-neutral-500"><tr><th className="py-2">ID</th><th>User</th><th>Type</th><th>Amount</th><th>Balance</th><th>Task</th><th>Reason</th><th>Created</th></tr></thead>
                <tbody>{data.ledger?.map((tx) => (
                  <tr key={tx.id} className="border-t border-neutral-100"><td className="py-3">#{tx.id}</td><td>{tx.email} #{tx.user_id}</td><td>{tx.type}</td><td>{tx.amount}</td><td>{tx.balance_after}</td><td>{tx.related_task_id || '-'}</td><td>{tx.note || '-'}</td><td>{new Date(tx.created_at).toLocaleString()}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function AdminTrialPage(props) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/trial').then(setData); }, []);
  const stats = data ? [
    ['Today logins', data.today_login_count],
    ['New users', data.today_new_users],
    ['Tasks', data.today_tasks],
    ['Success tasks', data.today_success_tasks],
    ['Failed tasks', data.today_failed_tasks],
    ['Generated images', data.today_generated_images],
    ['Open feedback', data.feedback_open_count],
    ['Avg latency', `${data.average_task_latency_ms || 0}ms`],
  ] : [];
  return (
    <AdminShell {...props}>
      <PageTitle title="Trial Ops" subtitle="Trial usage, feedback, failed tasks, and generated asset summary." />
      {!data ? <LoadingPanel /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map(([label, value]) => <div key={label} className="panel"><div className="text-xs text-neutral-500">{label}</div><div className="mt-2 text-2xl font-black">{value}</div></div>)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <MiniList title="Provider split" rows={data.provider_split} labelKey="provider" />
            <MiniList title="Most used formats" rows={data.most_used_formats} labelKey="format" />
            <MiniList title="Failed reasons" rows={data.failed_reason_top_list} labelKey="reason" />
            <MiniList title="Recent feedback" rows={data.recent_feedback} labelKey="title" onClick={(row) => props.navigate('/admin/feedback')} />
            <MiniList title="Recent failed tasks" rows={data.recent_failed_tasks} labelKey="product_name" />
            <MiniList title="Recent assets" rows={data.recent_assets} labelKey="product_name" />
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function AdminFeedbackPage(props) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState('');
  const load = () => api(`/api/admin/feedback${status ? `?status=${status}` : ''}`).then(setData);
  useEffect(load, [status]);
  const update = async (report, nextStatus) => {
    const result = await api(`/api/admin/feedback/${report.id}`, { method: 'POST', body: { status: nextStatus, admin_notes: notes || report.admin_notes || '' } });
    setSelected(result.report);
    load();
  };
  return (
    <AdminShell {...props}>
      <PageTitle title="Feedback" subtitle="Trial bug reports, image quality issues, and account questions." />
      <div className="space-y-4">
        <div className="panel flex flex-wrap gap-2">
          {['', 'open', 'reviewing', 'resolved', 'ignored'].map((item) => <button key={item || 'all'} className={`btn ${status === item ? 'btn-yellow' : 'btn-ghost'}`} onClick={() => setStatus(item)}>{item || 'all'}</button>)}
        </div>
        {!data ? <LoadingPanel /> : (
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs text-neutral-500"><tr><th>ID</th><th>Status</th><th>Type</th><th>Severity</th><th>Title</th><th>Task</th><th>Created</th></tr></thead>
                <tbody>{data.reports.map((report) => (
                  <tr key={report.id} className="cursor-pointer border-t border-neutral-100" onClick={() => { setSelected(report); setNotes(report.admin_notes || ''); }}>
                    <td className="py-3">#{report.id}</td><td>{report.status}</td><td>{report.type}</td><td>{report.severity}</td><td>{report.title}</td><td>{report.task_id || '-'}</td><td>{new Date(report.created_at).toLocaleString()}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="panel">
              {!selected ? <div className="text-sm text-neutral-500">Select a feedback report.</div> : (
                <div className="space-y-3 text-sm">
                  <div className="text-lg font-black">#{selected.id} {selected.title}</div>
                  <Row label="Status" value={selected.status} />
                  <Row label="Type" value={selected.type} />
                  <Row label="Task" value={selected.task_id || '-'} />
                  <div className="rounded-lg bg-neutral-50 p-3">{selected.description}</div>
                  <textarea className="field min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Admin notes" />
                  <div className="flex flex-wrap gap-2">
                    {['reviewing','resolved','ignored'].map((item) => <button key={item} className="btn btn-ghost" onClick={() => update(selected, item)}>{item}</button>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function MiniList({ title, rows = [], labelKey, onClick = null }) {
  return (
    <div className="panel">
      <div className="mb-2 font-black">{title}</div>
      {!rows?.length ? <div className="text-sm text-neutral-500">No data yet.</div> : (
        <div className="space-y-2 text-sm">
          {rows.map((row, index) => (
            <button key={`${title}-${index}`} onClick={() => onClick?.(row)} className="flex w-full items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2 text-left">
              <span className="truncate">{row[labelKey] || row.title || row.id || 'unknown'}</span>
              <span className="font-black">{row.count ?? row.status ?? ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminTasksPage(props) {
  const [tasks, setTasks] = useState([]);
  useEffect(() => { api('/api/admin/tasks').then((data) => setTasks(data.tasks)); }, []);
  return (
    <AdminShell {...props}>
      <PageTitle title="任務管理" subtitle="所有任務、狀態、使用者與錯誤資訊。" />
      <div className="panel"><AdminTaskTable tasks={tasks} navigate={props.navigate} /></div>
    </AdminShell>
  );
}

function AdminTaskTable({ tasks, navigate }) {
  if (!tasks?.length) return <div className="py-8 text-center text-sm text-neutral-500">No admin tasks found.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] text-left text-xs">
        <thead className="text-neutral-500">
          <tr>
            {['ID','User','Status','Provider','Model','Mode','Ref','Storage','Images','Cost','Latency','Fallback','Created','Updated',''].map((head) => <th key={head} className="py-2 pr-3">{head}</th>)}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-t border-neutral-100 align-top">
              <td className="py-3 font-bold">#{task.id}</td>
              <td>{task.user_email}<div className="text-neutral-400">#{task.user_id}</div></td>
              <td><StatusBadge status={task.status} /></td>
              <td>{task.provider || '-'}</td>
              <td>{task.model || '-'}</td>
              <td>{task.image_mode || '-'}</td>
              <td>{task.used_reference_image ? 'yes' : 'no'}</td>
              <td>{task.storage_disk || '-'}</td>
              <td>{task.image_count ?? 0}</td>
              <td>{task.cost ?? '-'}</td>
              <td>{task.latency_ms ?? '-'}</td>
              <td>{task.fallback_used ? <span className="rounded-full bg-yellow-100 px-2 py-1 font-black text-yellow-700">fallback</span> : '-'}</td>
              <td>{task.created_at ? new Date(task.created_at).toLocaleString() : '-'}</td>
              <td>{task.updated_at ? new Date(task.updated_at).toLocaleString() : '-'}</td>
              <td><button className="btn btn-ghost px-2 py-1" onClick={() => navigate(`/admin/tasks/${task.id}`)}>Detail</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminTaskDetailPage(props) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/api/admin/tasks/${props.taskId}`).then(setDetail).catch((err) => setError(err.message));
  }, [props.taskId]);
  if (error) return <AdminShell {...props}><div className="panel text-red-700">{error}</div></AdminShell>;
  if (!detail) return <AdminShell {...props}><LoadingPanel /></AdminShell>;
  const meta = detail.task?.metadata || {};
  return (
    <AdminShell {...props}>
      <PageTitle title={`Admin Task #${detail.task.id}`} subtitle="Provider metadata, storage URLs, and safe raw response summary." />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <div className="panel">
            <ImageGrid images={detail.output_images} title="Output preview" />
            <div className="mt-3 space-y-1 text-xs">
              {detail.output_images?.map((image) => <div key={image.id} className="break-all">{image.url}</div>)}
              {!detail.output_images?.length && <div className="text-neutral-500">No output images yet.</div>}
            </div>
          </div>
          <div className="panel">
            <h2 className="mb-3 font-black">Raw response safe summary</h2>
            <pre className="max-h-96 overflow-auto rounded-lg bg-neutral-950 p-3 text-xs text-neutral-100">{JSON.stringify(detail.ai_cost_logs?.[0]?.raw_response_json_safe || {}, null, 2)}</pre>
          </div>
        </section>
        <aside className="panel h-fit space-y-3 text-sm">
          <Row label="User" value={`${detail.user.email} (#${detail.user.id})`} />
          <Row label="Status" value={detail.task.status} />
          <Row label="Provider" value={meta.provider || '-'} />
          <Row label="Model" value={meta.model || '-'} />
          <Row label="Requested provider" value={meta.requested_provider || detail.task.request_payload_summary?.requested_provider || '-'} />
          <Row label="Resolved provider" value={meta.resolved_provider || detail.task.request_payload_summary?.resolved_provider || '-'} />
          <Row label="Capability" value={meta.requested_capability || detail.task.request_payload_summary?.requested_capability || '-'} />
          <Row label="Selection reason" value={meta.provider_selection_reason || '-'} />
          <Row label="Image mode" value={meta.image_mode || '-'} />
          <Row label="Reference image" value={meta.used_reference_image ? 'yes' : 'no'} />
          <Row label="Storage disk" value={meta.storage_disk || '-'} />
          <Row label="Images" value={meta.image_count ?? 0} />
          <Row label="Cost" value={meta.cost ?? '-'} />
          <Row label="Latency" value={meta.latency_ms !== null ? `${meta.latency_ms}ms` : '-'} />
          {meta.fallback_used && <div className="rounded-lg bg-yellow-100 p-2 text-xs font-black text-yellow-800">Fallback: {meta.fallback_reason || 'no reason recorded'}</div>}
          {detail.task.status === 'failed' && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">[{meta.error_code || detail.task.last_error_code || 'error'}] {meta.error_message || detail.task.error_message || 'Task failed.'}<div className="mt-1 font-bold">Run smoke:staging and storage:check to diagnose provider, worker, or storage settings.</div></div>}
        </aside>
      </div>
    </AdminShell>
  );
}

function AdminStoragePage(props) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/storage').then(setData); }, []);
  return (
    <AdminShell {...props}>
      <PageTitle title="Storage" subtitle="Current disk, masked public URL, and storage diagnostic hints." />
      {!data ? <LoadingPanel /> : (
        <div className="space-y-4">
          {data.warnings?.length > 0 && (
            <div className="rounded-lg bg-yellow-50 p-3 text-sm font-bold text-yellow-800">{data.warnings.join(' ')}</div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="panel"><div className="text-xs text-neutral-500">Disk</div><div className="mt-2 text-2xl font-black">{data.disk}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Public URL</div><div className="mt-2 break-all text-sm font-bold">{data.storagePublicUrlMasked || 'not configured'}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Diagnostic</div><div className="mt-2 text-sm font-bold">Run npm run storage:check</div></div>
          </div>
          <div className="panel">
            <h2 className="mb-3 font-black">Redacted config summary</h2>
            <pre className="max-h-96 overflow-auto rounded-lg bg-neutral-950 p-3 text-xs text-neutral-100">{JSON.stringify(data, null, 2)}</pre>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function AdminQualityPage(props) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const load = () => api('/api/admin/quality').then(setData);
  useEffect(load, []);
  const saveReview = async (taskId) => {
    await api('/api/admin/quality', {
      method: 'POST',
      body: {
        task_id: taskId,
        product_preserved: 'pass',
        no_garbled_text: 'pass',
        composition_ok: 'pass',
        size_ok: 'pass',
        commercial_quality: 4,
        approved: true,
        needs_regeneration: false,
        notes: 'Demo review saved from admin.',
      },
    });
    setMessage(`Saved review for task #${taskId}`);
    load();
  };
  return (
    <AdminShell {...props}>
      <PageTitle title="Quality Review" subtitle="Manual review checklist for staging AI outputs." />
      {!data ? <LoadingPanel /> : (
        <div className="space-y-4">
          {message && <div className="rounded-lg bg-green-50 p-3 text-sm font-bold text-green-700">{message}</div>}
          <div className="panel">
            <h2 className="mb-3 font-black">Recent tasks</h2>
            <div className="space-y-2">
              {data.recentTasks?.map((task) => (
                <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-100 p-3 text-sm">
                  <span>#{task.id} {task.product_name || task.main_title || 'Untitled'} <StatusBadge status={task.status} /></span>
                  <button className="btn btn-ghost px-3 py-1" onClick={() => saveReview(task.id)}>Save demo review</button>
                </div>
              ))}
              {!data.recentTasks?.length && <div className="text-sm text-neutral-500">No tasks to review.</div>}
            </div>
          </div>
          <div className="panel">
            <h2 className="mb-3 font-black">Saved reviews</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs text-neutral-500"><tr><th className="py-2">Task</th><th>Product</th><th>Status</th><th>Preserved</th><th>No garbled text</th><th>Quality</th><th>Notes</th></tr></thead>
                <tbody>{data.reviews?.map((review) => (
                  <tr key={review.id} className="border-t border-neutral-100"><td className="py-3">#{review.task_id}</td><td>{review.product_name || review.main_title || '-'}</td><td>{review.approved ? 'approved' : review.needs_regeneration ? 'needs regeneration' : 'pending'}</td><td>{review.product_preserved || '-'}</td><td>{review.no_garbled_text || '-'}</td><td>{review.commercial_quality || '-'}</td><td>{review.notes || '-'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function AdminSystemPage(props) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/system').then(setData); }, []);
  return (
    <AdminShell {...props}>
      <PageTitle title="System" subtitle="Version, runtime mode, and safe release configuration summary." />
      {!data ? <LoadingPanel /> : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="panel"><div className="text-xs text-neutral-500">Version</div><div className="mt-2 text-2xl font-black">{data.version}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Provider</div><div className="mt-2 text-2xl font-black">{data.provider}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Storage</div><div className="mt-2 text-2xl font-black">{data.filesystemDisk}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Queue</div><div className="mt-2 text-2xl font-black">{data.queueDriver}</div></div>
          </div>
          {data.securityWarnings?.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <div className="font-black">Production warnings</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {data.securityWarnings.map((warning) => (
                  <li key={warning.code}>
                    {warning.blocking ? 'BLOCKING: ' : ''}
                    {warning.testing_only ? 'Testing only: ' : ''}
                    {warning.message}
                    {warning.production_release_status && <span> Production release: {warning.production_release_status}.</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.trialMode?.enabled && (
            <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
              <div className="font-black">Trial Mode</div>
              <div>{data.trialMode.message}</div>
              <div className="mt-1 font-bold">Default admin password is active only for testing. Change before external/public release.</div>
            </div>
          )}
          <div className="panel grid gap-2 text-sm md:grid-cols-2">
            <Row label="Invite gate" value={data.inviteGate?.enabled ? 'enabled' : 'disabled'} />
            <Row label="Invite code configured" value={data.inviteGate?.codeConfigured ? 'yes' : 'no'} />
            <Row label="Trial cleanup" value={data.trialCleanup?.command || 'npm run trial:cleanup'} />
            <Row label="Cleanup dry run" value={data.trialCleanup?.dryRun ? 'true' : 'false'} />
          </div>
          <DomainFixPanel domainFix={data.domainFix} />
          <ChangePasswordPanel />
          <div className="panel">
            <pre className="max-h-96 overflow-auto rounded-lg bg-neutral-950 p-3 text-xs text-neutral-100">{JSON.stringify(data, null, 2)}</pre>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function DomainFixPanel({ domainFix }) {
  if (!domainFix) return null;
  const failed = domainFix.last_status === 'failed';
  const passed = domainFix.last_status === 'passed';
  const Icon = passed ? CheckCircle2 : AlertTriangle;
  const tone = passed ? 'text-green-600' : failed ? 'text-red-600' : 'text-yellow-600';
  return (
    <section className="panel space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-black">Domain / HTTPS Troubleshooting</div>
          <div className="mt-1 text-sm text-neutral-500">{domainFix.quick_summary}</div>
        </div>
        <Icon className={`h-5 w-5 shrink-0 ${tone}`} />
      </div>
      <div className="grid gap-x-6 text-sm md:grid-cols-2">
        <Row label="APP_URL" value={domainFix.app_url || '-'} />
        <Row label="PUBLIC_URL" value={domainFix.public_url || '-'} />
        <Row label="Last domain check" value={domainFix.last_status || 'unknown'} />
        <Row label="Failed step" value={domainFix.failed_step || '-'} />
        <Row label="Error code" value={domainFix.error_code || '-'} />
        <Row label="Guide" value={domainFix.guide?.path || 'NAS_DOMAIN_FIX.md'} />
      </div>
      {failed && (
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <div className="text-xs font-black uppercase text-neutral-500">Likely root cause</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-neutral-700">
              {(domainFix.likely_root_cause || []).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div>
            <div className="text-xs font-black uppercase text-neutral-500">Next manual steps</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-neutral-700">
              {(domainFix.next_manual_steps || []).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      )}
      <div className="border-t border-neutral-100 pt-3 text-sm text-neutral-600">
        {(domainFix.guide?.summary || []).join(' / ')}
      </div>
    </section>
  );
}

function ChangePasswordPanel() {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await api('/api/auth/change-password', { method: 'POST', body: form });
      setForm({ current_password: '', new_password: '', confirm_password: '' });
      setMessage('Password updated.');
    } catch (err) {
      setError(err.message || 'Password update failed.');
    }
  };
  return (
    <form onSubmit={submit} className="panel space-y-3">
      <div>
        <div className="font-black">Change admin password</div>
        <div className="text-sm text-neutral-500">Use this before public trials if the default admin password is still active.</div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <input className="input" type="password" placeholder="Current password" value={form.current_password} onChange={(event) => setForm({ ...form, current_password: event.target.value })} />
        <input className="input" type="password" placeholder="New password" value={form.new_password} onChange={(event) => setForm({ ...form, new_password: event.target.value })} />
        <input className="input" type="password" placeholder="Confirm password" value={form.confirm_password} onChange={(event) => setForm({ ...form, confirm_password: event.target.value })} />
      </div>
      <div className="text-xs text-neutral-500">Minimum strength: at least 8 characters.</div>
      {message && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>}
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <button className="btn btn-yellow" type="submit">Update password</button>
    </form>
  );
}

function AdminDevPilotKeysPage(props) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ source_system: 'ad-studio-ai', label: 'AD Studio AI', api_key: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = () => api('/api/admin/devpilot-keys').then(setData);
  useEffect(load, []);
  const save = async () => {
    setError('');
    setMessage('');
    try {
      const result = await api('/api/admin/devpilot-keys', { method: 'POST', body: form });
      setForm({ ...form, api_key: '' });
      setMessage(`Saved ${result.key.source_system}. Fingerprint: ${result.key.key_fingerprint}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const revoke = async (id) => {
    setError('');
    setMessage('');
    try {
      await api(`/api/admin/devpilot-keys/${id}/revoke`, { method: 'POST', body: {} });
      setMessage('Key revoked.');
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <AdminShell {...props}>
      <PageTitle title="DevPilot Keys" subtitle="Store source-scoped external API keys as one-way hashes. Raw keys are never shown again." />
      <div className="space-y-4">
        {message && <div className="rounded-lg bg-green-50 p-3 text-sm font-bold text-green-700">{message}</div>}
        {error && <div className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        <div className="panel">
          <h2 className="mb-3 font-black">Add or replace key</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="label">Source system</span>
              <input className="field" value={form.source_system} onChange={(e) => setForm({ ...form, source_system: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Label</span>
              <input className="field" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">API key</span>
              <input className="field" type="password" autoComplete="new-password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={save}>Save hashed key</button>
            <span className="text-xs text-neutral-500">After saving, the raw key is cleared and cannot be viewed by anyone.</span>
          </div>
        </div>
        <div className="panel">
          <h2 className="mb-3 font-black">Configured sources</h2>
          {!data ? <LoadingPanel /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs text-neutral-500">
                  <tr><th className="py-2">Source</th><th>Label</th><th>Fingerprint</th><th>Status</th><th>Updated</th><th></th></tr>
                </thead>
                <tbody>
                  {data.keys?.map((key) => (
                    <tr key={key.id} className="border-t border-neutral-100">
                      <td className="py-3 font-bold">{key.source_system}</td>
                      <td>{key.label || '-'}</td>
                      <td className="font-mono text-xs">{key.key_fingerprint}</td>
                      <td>{key.status}</td>
                      <td>{key.updated_at ? new Date(key.updated_at).toLocaleString() : '-'}</td>
                      <td>{key.status === 'active' && <button className="btn btn-ghost px-3 py-1" onClick={() => revoke(key.id)}>Revoke</button>}</td>
                    </tr>
                  ))}
                  {!data.keys?.length && <tr><td colSpan="6" className="py-8 text-center text-neutral-500">No DevPilot keys configured yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function AdminIntegrationToolboxPage(props) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/api/admin/integration-toolbox').then(setData).catch((err) => setError(err.message));
  }, []);
  return (
    <AdminShell {...props}>
      <PageTitle title="Integration Toolbox" subtitle="Download safe admin-facing integration resources. Secrets are never embedded in these files." />
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
      {!data && !error ? <LoadingPanel /> : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-neutral-500">
              <tr><th className="py-2">Resource</th><th>Filename</th><th>Resource ID</th><th></th></tr>
            </thead>
            <tbody>
              {data?.resources?.map((resource) => (
                <tr key={resource.resource_id} className="border-t border-neutral-100">
                  <td className="py-3 font-bold">{resource.display_name}</td>
                  <td className="font-mono text-xs">{resource.download_filename}</td>
                  <td className="font-mono text-xs">{resource.resource_id}</td>
                  <td className="text-right">
                    <a
                      className="btn btn-ghost px-3 py-1"
                      href={`/admin/integration-toolbox/download/${encodeURIComponent(resource.resource_id)}`}
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
              {!data?.resources?.length && <tr><td colSpan="4" className="py-8 text-center text-neutral-500">No toolbox resources available.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function AdminProvidersPage(props) {
  const [data, setData] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [ping, setPing] = useState({});
  useEffect(() => {
    Promise.all([api('/api/admin/providers'), api('/api/admin/provider-capability-matrix')]).then(([providersData, matrixData]) => {
      setData(providersData);
      setMatrix(matrixData);
    });
  }, []);
  const runPing = async (provider) => {
    const result = await api(`/api/admin/providers/${provider}/ping`, { method: 'POST', body: { live: false } });
    setPing((current) => ({ ...current, [provider]: result }));
  };
  return (
    <AdminShell {...props}>
      <PageTitle title="AI Providers" subtitle="Registry metadata for fake, OpenAI, Gemini, Claude, external, and DevPilot Gateway providers." />
      {!data ? <LoadingPanel /> : (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            {data.providers?.map((provider) => (
              <div key={provider.name} className="panel space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xl font-black">{provider.label}</div>
                    <div className="text-xs text-neutral-500">{provider.name}</div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${provider.configured ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-600'}`}>
                    {provider.configured ? 'configured' : 'not configured'}
                  </span>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <Row label="Source" value={provider.source || '-'} />
                  <Row label="Key" value={provider.keyConfigured ? 'configured' : 'missing'} />
                  <Row label="Text" value={provider.supportsTextGeneration ? 'yes' : 'no'} />
                  <Row label="Image generation" value={provider.supportsImageGeneration ? 'yes' : 'fallback/scaffold'} />
                </div>
                <div className="text-xs text-neutral-500">Models: {(provider.models || []).join(', ') || '-'}</div>
                <div className="flex flex-wrap gap-1">
                  {(provider.capabilities || []).map((capability) => <span key={capability} className="rounded-full bg-neutral-100 px-2 py-1 text-xs">{capability}</span>)}
                </div>
                <button className="btn btn-ghost px-3 py-1" onClick={() => runPing(provider.name)}>Config ping</button>
                {ping[provider.name] && <pre className="max-h-48 overflow-auto rounded-lg bg-neutral-950 p-3 text-xs text-neutral-100">{JSON.stringify(ping[provider.name], null, 2)}</pre>}
                {data.lastPing?.provider === provider.name && (
                  <div className={`rounded-lg p-3 text-xs ${data.lastPing.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                    <div className="font-black">Last live ping: {data.lastPing.ok ? 'ok' : 'failed'}</div>
                    <div>Diagnosis: {data.lastPing.diagnosis?.code || '-'}</div>
                    <div>Latency: {data.lastPing.latency_ms ?? '-'}ms</div>
                    <div>Usage: {JSON.stringify(data.lastPing.usage || {})}</div>
                    {data.lastPing.output && <div className="mt-1 line-clamp-3">Output: {data.lastPing.output}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
          {matrix && <ProviderCapabilityMatrix matrix={matrix} />}
        </div>
      )}
    </AdminShell>
  );
}

function ProviderCapabilityMatrix({ matrix }) {
  return (
    <div className="panel overflow-x-auto">
      <div className="mb-4">
        <h2 className="text-xl font-black">工具與供應商支援狀態</h2>
        <p className="mt-1 text-sm text-neutral-500">依 provider registry 產生；fake 只代表開發測試 placeholder。</p>
      </div>
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="text-xs text-neutral-500">
          <tr>
            <th className="py-2">工具</th>
            <th>必要能力</th>
            <th>可用供應商</th>
            <th>限制 / 備註</th>
          </tr>
        </thead>
        <tbody>
          {(matrix.tools || []).map((tool) => {
            const supported = (tool.providers || []).filter((provider) => provider.supported);
            const notes = [
              tool.notes,
              tool.consent_required ? '需 consent' : '',
              tool.private_by_default ? 'private-by-default' : '',
            ].filter(Boolean);
            return (
              <tr key={tool.tool_type} className="border-t border-neutral-100 align-top">
                <td className="py-3">
                  <div className="font-black text-neutral-950">{tool.label}</div>
                  <div className="font-mono text-xs text-neutral-500">{tool.tool_type}</div>
                </td>
                <td className="py-3 font-mono text-xs">{tool.required_capability}</td>
                <td className="py-3">
                  <div className="flex max-w-xl flex-wrap gap-1">
                    {supported.map((provider) => (
                      <span
                        key={provider.name}
                        className={`rounded-full px-2 py-1 text-xs font-black ${
                          provider.fake_only
                            ? 'bg-yellow-100 text-yellow-800'
                            : provider.live
                              ? 'bg-green-100 text-green-700'
                              : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {provider.label}{provider.fake_only ? ' (dev only)' : provider.live ? '' : ' (needs config)'}
                      </span>
                    ))}
                    {!supported.length && <span className="text-xs text-red-600">尚無 provider</span>}
                  </div>
                </td>
                <td className="py-3 text-xs leading-5 text-neutral-600">
                  <div>{notes.join(' / ') || '-'}</div>
                  <div className="mt-1 text-neutral-400">
                    不支援：{(tool.providers || []).filter((provider) => !provider.supported).map((provider) => provider.label).join(', ') || '-'}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AdminProviderPlaygroundPage(props) {
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({ provider: 'fake', capability: 'chat', model: '', prompt: 'Return AI_PING_OK.', labels: 'approved,needs_review,reject', instruction: '', schema: '{"summary":"string"}' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    api('/api/admin/providers').then((data) => setProviders(data.providers || [])).catch(() => setProviders([]));
  }, []);
  const run = async (event) => {
    event.preventDefault();
    setError('');
    setResult(null);
    try {
      const data = await api('/api/admin/provider-playground', { method: 'POST', body: form });
      setResult(data);
    } catch (err) {
      setError(err.message || 'Provider playground request failed.');
    }
  };
  const saveTemplate = async () => {
    const key = `playground_${form.capability}_${Date.now()}`;
    await api('/api/admin/prompts', {
      method: 'POST',
      body: {
        key,
        name: `Playground ${form.capability}`,
        tool_type: form.capability,
        capability: form.capability,
        user_prompt_template: form.prompt,
        template_body: form.prompt,
        variables_json: JSON.stringify({ labels: form.labels, instruction: form.instruction, schema: form.schema }),
        is_active: 0,
        version: 1,
        notes: 'Saved from provider playground.',
      },
    });
    setMessage(`Saved prompt template ${key}.`);
  };
  return (
    <AdminShell {...props}>
      <PageTitle title="Provider Playground" subtitle="Run safe text capabilities for configured providers. Secrets are never returned." />
      <form onSubmit={run} className="panel space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <select className="input" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
            {providers.map((provider) => <option key={provider.name} value={provider.name}>{provider.label || provider.name}</option>)}
          </select>
          <select className="input" value={form.capability} onChange={(event) => setForm({ ...form, capability: event.target.value })}>
            {['chat', 'generate', 'summary', 'classification', 'rewrite', 'extraction', 'planning', 'prompt_rewrite'].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input className="input" placeholder="Model override" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
          <button className="btn btn-yellow" type="submit">Run</button>
        </div>
        <textarea className="input min-h-[160px]" value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} />
        <div className="grid gap-3 md:grid-cols-3">
          {form.capability === 'classification' && <input className="input" placeholder="labels" value={form.labels} onChange={(event) => setForm({ ...form, labels: event.target.value })} />}
          {['rewrite', 'prompt_rewrite'].includes(form.capability) && <input className="input" placeholder="instruction / goal" value={form.instruction} onChange={(event) => setForm({ ...form, instruction: event.target.value })} />}
          {form.capability === 'extraction' && <textarea className="input min-h-[90px]" placeholder="schema JSON" value={form.schema} onChange={(event) => setForm({ ...form, schema: event.target.value })} />}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" onClick={saveTemplate}>Save as prompt template</button>
          {result?.output && <button type="button" className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(result.output)}>Copy output</button>}
        </div>
        {message && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>}
        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {result && <pre className="max-h-96 overflow-auto rounded-lg bg-neutral-950 p-3 text-xs text-neutral-100">{JSON.stringify(result, null, 2)}</pre>}
      </form>
    </AdminShell>
  );
}

function AdminDevPilotPage(props) {
  const [data, setData] = useState(null);
  const [source, setSource] = useState('');
  const [message, setMessage] = useState('');
  const load = () => {
    const query = new URLSearchParams();
    if (source) query.set('source_system', source);
    api(`/api/admin/devpilot?${query.toString()}`).then(setData);
  };
  useEffect(() => { load(); }, []);
  const markReviewed = async (id) => {
    await api(`/api/admin/handoffs/${id}/reviewed`, { method: 'POST' });
    setMessage(`Handoff #${id} marked reviewed.`);
    load();
  };
  const runTestSuite = async () => {
    const result = await api('/api/admin/devpilot/test-suite', { method: 'POST', body: {} });
    setMessage(`DevPilot UI test suite ${result.ok ? 'passed' : 'failed'}. Raw key returned: ${result.raw_key_returned ? 'yes' : 'no'}`);
    load();
  };
  return (
    <AdminShell {...props}>
      <PageTitle title="DevPilot" subtitle="External handoff activity, source usage, and integration toolbox access." />
      {!data ? <LoadingPanel /> : (
        <div className="space-y-4">
          {message && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="panel"><div className="text-xs text-neutral-500">Active DB keys</div><div className="mt-2 text-2xl font-black">{data.activeKeyCount}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Env keys</div><div className="mt-2 text-2xl font-black">{data.configuredEnvKeys ? 'yes' : 'no'}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Rate limit</div><div className="mt-2 text-2xl font-black">{data.rateLimit?.enabled ? 'on' : 'off'}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Toolbox resources</div><div className="mt-2 text-2xl font-black">{data.toolboxResources?.length || 0}</div></div>
          </div>
          <div className="panel flex flex-wrap gap-3">
            <input className="input max-w-xs" placeholder="Filter source" value={source} onChange={(event) => setSource(event.target.value)} />
            <button className="btn btn-ghost" onClick={load}>Apply</button>
            <button className="btn btn-ghost" onClick={() => props.navigate('/admin/integration-toolbox')}>Open toolbox</button>
            <button className="btn btn-ghost" onClick={() => props.navigate('/admin/devpilot/handoffs')}>Open handoffs</button>
            <button className="btn btn-yellow" onClick={runTestSuite}>Run UI test suite</button>
          </div>
          <div className="panel overflow-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="text-xs text-neutral-500"><th className="py-2">ID</th><th>Source</th><th>Status</th><th>Risk</th><th>External ref</th><th>From</th><th>To</th><th></th></tr></thead>
              <tbody>
                {data.recentHandoffs?.map((handoff) => (
                  <tr key={handoff.handoff_id} className="border-t border-neutral-100">
                    <td className="py-2 font-mono">#{handoff.handoff_id}</td>
                    <td>{handoff.source_system}</td>
                    <td>{handoff.status}</td>
                    <td>{handoff.risk}</td>
                    <td>{handoff.external_ref || '-'}</td>
                    <td>{handoff.from_agent}</td>
                    <td>{handoff.to_agent}</td>
                    <td className="text-right"><button className="btn btn-ghost px-3 py-1" onClick={() => markReviewed(handoff.handoff_id)}>Mark reviewed</button></td>
                  </tr>
                ))}
                {!data.recentHandoffs?.length && <tr><td colSpan="8" className="py-8 text-center text-neutral-500">No handoffs found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function AdminDevPilotHandoffsPage(props) {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ source_system: '', status: '', risk: '', external_ref: '', task_id: '' });
  const [message, setMessage] = useState('');
  const load = () => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    api(`/api/admin/devpilot/handoffs?${query}`).then(setData);
  };
  useEffect(load, []);
  const markReviewed = async (id) => {
    await api(`/api/admin/handoffs/${id}/reviewed`, { method: 'POST' });
    setMessage(`Handoff #${id} marked reviewed.`);
    load();
  };
  return (
    <AdminShell {...props}>
      <PageTitle title="DevPilot Handoffs" subtitle="Filter handoffs, inspect redacted payload summaries, and copy placeholder snippets." />
      <div className="space-y-4">
        {message && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>}
        <div className="panel grid gap-2 md:grid-cols-6">
          {Object.keys(filters).map((key) => (
            <input key={key} className="field" placeholder={key} value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} />
          ))}
          <button className="btn btn-primary" onClick={load}>Filter</button>
        </div>
        {!data ? <LoadingPanel /> : (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-xs">
              <thead className="text-neutral-500"><tr><th className="py-2">ID</th><th>Task</th><th>Source</th><th>Status</th><th>Risk</th><th>External ref</th><th>Idempotency</th><th>Payload</th><th></th></tr></thead>
              <tbody>{data.handoffs?.map((handoff) => (
                <tr key={handoff.handoff_id} className="border-t border-neutral-100 align-top">
                  <td className="py-3">#{handoff.handoff_id}</td>
                  <td>#{handoff.task_id}</td>
                  <td>{handoff.source_system}</td>
                  <td>{handoff.status}</td>
                  <td>{handoff.risk}</td>
                  <td>{handoff.external_ref || '-'}</td>
                  <td className="font-mono">{handoff.idempotency_key_masked || '-'}</td>
                  <td><pre className="max-h-32 overflow-auto rounded bg-neutral-100 p-2">{JSON.stringify(handoff.safe_payload_summary || {}, null, 2)}</pre></td>
                  <td><button className="btn btn-ghost px-2 py-1" onClick={() => markReviewed(handoff.handoff_id)}>Reviewed</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function AdminAssetsPage(props) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState('all');
  const load = () => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (provider !== 'all') query.set('provider', provider);
    api(`/api/admin/assets?${query}`).then(setData);
  };
  useEffect(load, []);
  return (
    <AdminShell {...props}>
      <PageTitle title="Admin Assets" subtitle="All generated output assets with safe URLs and provider metadata." />
      <div className="panel mb-4 grid gap-2 md:grid-cols-[1fr_160px_auto]">
        <input className="field" placeholder="Search task/product" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="all">All</option>
          <option value="fake">fake</option>
          <option value="openai">openai</option>
          <option value="gemini">gemini</option>
          <option value="claude">claude</option>
        </select>
        <button className="btn btn-primary" onClick={load}>Search</button>
      </div>
      {!data ? <LoadingPanel /> : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="text-neutral-500"><tr><th className="py-2">Asset</th><th>Task</th><th>Product</th><th>Provider</th><th>Format</th><th>URL</th></tr></thead>
            <tbody>
              {data.assets?.map((asset) => (
                <tr key={asset.id} className="border-t border-neutral-100 align-top">
                  <td className="py-3">#{asset.id}</td>
                  <td>#{asset.task_id}</td>
                  <td>{asset.product_name || asset.main_title || '-'}</td>
                  <td>{asset.provider || '-'}</td>
                  <td>{asset.format || '-'}</td>
                  <td className="max-w-md break-all">{asset.url}</td>
                </tr>
              ))}
              {!data.assets?.length && <tr><td colSpan="6" className="py-8 text-center text-neutral-500">No assets found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function AdminAuditPage(props) {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ action: '', target_type: '', actor_id: '' });
  const load = () => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    api(`/api/admin/audit?${query}`).then(setData);
  };
  useEffect(load, []);
  return (
    <AdminShell {...props}>
      <PageTitle title="Audit Logs" subtitle="Safe operational audit events. Secrets, hashes, and base64 are redacted." />
      <div className="panel mb-4 grid gap-2 md:grid-cols-[1fr_150px_150px_auto]">
        <input className="field" placeholder="action" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        <input className="field" placeholder="target_type" value={filters.target_type} onChange={(e) => setFilters({ ...filters, target_type: e.target.value })} />
        <input className="field" placeholder="actor_id" value={filters.actor_id} onChange={(e) => setFilters({ ...filters, actor_id: e.target.value })} />
        <button className="btn btn-primary" onClick={load}>Filter</button>
      </div>
      {!data ? <LoadingPanel /> : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="text-neutral-500"><tr><th className="py-2">Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Metadata</th></tr></thead>
            <tbody>
              {data.logs?.map((log) => (
                <tr key={log.id} className="border-t border-neutral-100 align-top">
                  <td className="py-3">{new Date(log.created_at).toLocaleString()}</td>
                  <td>{log.actor_type}:{log.actor_id || '-'}</td>
                  <td>{log.action}</td>
                  <td>{log.target_type || '-'} #{log.target_id || '-'}</td>
                  <td><pre className="max-h-40 overflow-auto rounded bg-neutral-100 p-2">{JSON.stringify(log.metadata_safe || {}, null, 2)}</pre></td>
                </tr>
              ))}
              {!data.logs?.length && <tr><td colSpan="5" className="py-8 text-center text-neutral-500">No audit logs found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function AdminUsagePage(props) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/usage').then(setData); }, []);
  return (
    <AdminShell {...props}>
      <PageTitle title="Usage" subtitle="Provider usage, cost, latency, fallback, and external handoff summary." />
      {!data ? <LoadingPanel /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="panel"><div className="text-xs text-neutral-500">Average latency</div><div className="mt-2 text-2xl font-black">{data.averageLatency || 0}ms</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Fallback count</div><div className="mt-2 text-2xl font-black">{data.fallbackCount || 0}</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">Fallback rate</div><div className="mt-2 text-2xl font-black">{Math.round((data.fallbackRate || 0) * 100)}%</div></div>
            <div className="panel"><div className="text-xs text-neutral-500">External handoffs</div><div className="mt-2 text-2xl font-black">{data.externalHandoffCount || 0}</div></div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <pre className="panel max-h-96 overflow-auto text-xs">{JSON.stringify(data.tasksByProvider || {}, null, 2)}</pre>
            <pre className="panel max-h-96 overflow-auto text-xs">{JSON.stringify(data.devpilotSourceUsage || [], null, 2)}</pre>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function AdminCrudPage(props) {
  const { title, endpoint, fields } = props;
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(Object.fromEntries(fields.map((field) => [field, field === 'is_active' ? 1 : ''])));
  const load = () => api(endpoint).then((data) => setRows(data.rows));
  useEffect(load, [endpoint]);
  const submit = async () => {
    await api(endpoint, { method: 'POST', body: form });
    setForm(Object.fromEntries(fields.map((field) => [field, field === 'is_active' ? 1 : ''])));
    load();
  };
  return (
    <AdminShell {...props}>
      <PageTitle title={title} subtitle="新增 / 編輯 / 啟用 / 停用 / 排序的 MVP 管理入口。" />
      <div className="panel mb-4 grid gap-2 md:grid-cols-3">
        {fields.map((field) => (
          <input key={field} className="field" placeholder={field} value={form[field] ?? ''} onChange={(e) => setForm({ ...form, [field]: e.target.value })} />
        ))}
        <button className="btn btn-yellow" onClick={submit}>新增</button>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-xs">
          <thead><tr>{fields.slice(0, 6).map((field) => <th key={field} className="py-2">{field}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-neutral-100">{fields.slice(0, 6).map((field) => <td key={field} className="max-w-[180px] truncate py-2">{String(row[field] ?? '')}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </AdminShell>
  );
}

function AdminReportsPage(props) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/reports/costs').then(setData); }, []);
  return (
    <AdminShell {...props}>
      <PageTitle title="成本報表" subtitle="從 ai_cost_logs 彙總成本、任務數與成功率。" />
      {!data ? <LoadingPanel /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['今日成本', data.todayCost],
            ['本月成本', data.monthCost],
            ['任務數', data.taskCount],
            ['成功率', `${Math.round(data.successRate * 100)}%`],
            ['失敗率', `${Math.round(data.failureRate * 100)}%`],
          ].map(([label, value]) => <div key={label} className="panel"><div className="text-xs text-neutral-500">{label}</div><div className="mt-2 text-2xl font-black">{value}</div></div>)}
        </div>
      )}
    </AdminShell>
  );
}

function LoginRequired({ openAuth }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div className="panel text-center">
        <User className="mx-auto h-10 w-10 text-neutral-400" />
        <h1 className="mt-3 text-xl font-black">請先登入</h1>
        <p className="mt-2 text-sm text-neutral-500">登入後即可查看會員後台、任務紀錄與素材庫。</p>
        <button onClick={() => openAuth('login')} className="btn btn-yellow mt-5">登入 / 註冊</button>
      </div>
    </main>
  );
}

function FeedbackPage({ user, navigate }) {
  const params = new URLSearchParams(window.location.search);
  const [form, setForm] = useState({
    type: 'bug',
    severity: 'medium',
    title: '',
    description: '',
    task_id: params.get('task_id') || '',
    asset_url: params.get('asset_url') || '',
    browser_info: navigator.userAgent || '',
  });
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const result = await api('/api/feedback', { method: 'POST', body: form });
      setTicket(result.report);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageTitle title="Feedback" subtitle="Report a bug, image quality issue, or trial account problem." />
      <form onSubmit={submit} className="panel space-y-3">
        {ticket && <div className="rounded-lg bg-green-50 p-3 text-sm font-black text-green-700">Ticket #{ticket.id} submitted.</div>}
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label">Type</label><select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{['bug','quality','billing','account','other'].map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          <div><label className="label">Severity</label><select className="field" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>{['low','medium','high'].map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
        </div>
        <div><label className="label">Title</label><input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div><label className="label">Description</label><textarea className="field min-h-32" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label">Task ID</label><input className="field" value={form.task_id} onChange={(e) => setForm({ ...form, task_id: e.target.value })} /></div>
          <div><label className="label">Asset URL</label><input className="field" value={form.asset_url} onChange={(e) => setForm({ ...form, asset_url: e.target.value })} /></div>
        </div>
        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="flex gap-2">
          <button className="btn btn-primary">Submit feedback</button>
          {user && <button type="button" className="btn btn-ghost" onClick={() => navigate('/tasks')}>Back to tasks</button>}
        </div>
      </form>
    </main>
  );
}

function SharePage({ token }) {
  const [asset, setAsset] = useState(null);
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    api(`/api/share/${encodeURIComponent(token)}`).then((data) => setAsset(data.asset)).catch((err) => setError(err.message));
  }, [token]);
  if (error) return <main className="mx-auto max-w-xl px-4 py-16"><div className="panel"><h1 className="text-xl font-black">找不到分享連結</h1><p className="mt-2 text-sm text-neutral-600">這個分享連結不存在、已撤銷，或圖片已被清理。</p></div></main>;
  if (!asset) return <main className="mx-auto max-w-xl px-4 py-16"><LoadingPanel /></main>;
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <PageTitle title={asset.product_name || 'Shared asset'} subtitle="Public share view" />
      <div className="panel">
        <img src={asset.image_url} className="max-h-[70vh] w-full rounded-lg bg-white object-contain" alt="" onError={() => setImageError(true)} />
        {imageError && <div className="mt-3 rounded-lg bg-yellow-50 p-3 text-sm font-bold text-yellow-700">圖片載入失敗，請稍後重試或回報問題。</div>}
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={asset.image_url} download className="btn btn-yellow gap-2"><Download className="h-4 w-4" />下載</a>
          <button className="btn btn-ghost" onClick={() => { window.location.href = `/feedback?asset_url=${encodeURIComponent(asset.image_url)}`; }}>Report image issue</button>
        </div>
        <div className="mt-3 text-sm font-bold text-neutral-500">由 imageai.tw 生成</div>
        <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
          <Row label="Task" value={`#${asset.task_id}`} />
          <Row label="Format" value={asset.format || '-'} />
          <Row label="Tool" value={asset.tool_type || '-'} />
          <Row label="Created" value={asset.created_at ? new Date(asset.created_at).toLocaleString() : '-'} />
        </div>
      </div>
    </main>
  );
}

function PageTitle({ title, subtitle }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-black text-neutral-950">{title}</h1>
      <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="panel flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      載入中
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-neutral-100 py-2 last:border-b-0">
      <span className="shrink-0 text-neutral-500">{label}</span>
      <span className="min-w-0 break-words text-right font-bold">{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const color = {
    success: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    processing: 'bg-yellow-100 text-yellow-700',
    pending: 'bg-neutral-100 text-neutral-700',
    canceled: 'bg-neutral-100 text-neutral-700',
  }[status] || 'bg-neutral-100';
  const Icon = status === 'success' ? CheckCircle2 : status === 'failed' ? AlertTriangle : Loader2;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-black ${color}`}>
      <Icon className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      {statusLabels[status] || status}
    </span>
  );
}
