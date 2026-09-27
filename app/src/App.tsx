import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  CloudOff,
  Command,
  FolderKanban,
  HardDrive,
  Home,
  Inbox,
  Languages,
  LayoutDashboard,
  Menu,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  UploadCloud,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { createCoreClient } from './coreAdapter'
import type { ActivityItem, DashboardSnapshot, DecisionRequest, Locale, ProjectSummary, Theme, WorkState } from './types'

type NavKey = 'home' | 'projects' | 'needs' | 'library' | 'settings'

const copy = {
  vi: {
    home: 'Trang chủ',
    projects: 'Dự án',
    needs: 'Cần bạn',
    library: 'Thư viện',
    settings: 'Cài đặt',
    searchPlaceholder: 'Tìm dự án, cảnh, shot, tài sản…',
    greeting: 'Chào buổi tối, Tuyên',
    greetingHint: 'Mọi thứ quan trọng của bạn, ở đúng một chỗ.',
    continue: 'Tiếp tục',
    needsYou: 'Cần bạn',
    needsHint: 'Quyết định sáng tạo và quyền đang chờ bạn.',
    background: 'Đang tự xử lý',
    backgroundHint: 'Các tác vụ có thể chạy mà không chiếm sự chú ý.',
    recentProjects: 'Dự án gần đây',
    allProjects: 'Xem tất cả dự án',
    newProject: 'Tạo dự án',
    view: 'Mở',
    seeAll: 'Xem tất cả',
    noDecisions: 'Không có quyết định nào đang chờ.',
    noActivity: 'Chưa có hoạt động mới.',
    storage: 'Dung lượng',
    healthy: 'Ổn định',
    connected: 'Core đang kết nối',
    offline: 'Đang offline',
    loading: 'Đang tải không gian làm việc…',
    retry: 'Thử lại',
    loadError: 'Không thể đọc trạng thái từ Core.',
    createProjectTitle: 'Tạo dự án mới',
    createProjectHint: 'Bắt đầu bằng một cái tên. Bạn có thể thêm kịch bản sau.',
    projectName: 'Tên dự án',
    projectNamePlaceholder: 'Ví dụ: Mùa hè ở tầng thượng',
    cancel: 'Để sau',
    create: 'Tạo dự án',
    acknowledged: 'Đã ghi nhận. Quyết định vẫn được giữ trong lịch sử.',
    commandHint: 'Nhấn Ctrl K để tìm nhanh',
  },
  en: {
    home: 'Home',
    projects: 'Projects',
    needs: 'Needs You',
    library: 'Library',
    settings: 'Settings',
    searchPlaceholder: 'Search projects, scenes, shots, assets…',
    greeting: 'Good evening, Tuyên',
    greetingHint: 'Everything that matters, in one calm place.',
    continue: 'Continue',
    needsYou: 'Needs You',
    needsHint: 'Creative and rights decisions waiting for you.',
    background: 'Running quietly',
    backgroundHint: 'Work that can continue without taking your attention.',
    recentProjects: 'Recent projects',
    allProjects: 'View all projects',
    newProject: 'New project',
    view: 'Open',
    seeAll: 'See all',
    noDecisions: 'There are no decisions waiting.',
    noActivity: 'No recent activity.',
    storage: 'Storage',
    healthy: 'Healthy',
    connected: 'Core connected',
    offline: 'Offline',
    loading: 'Loading your workspace…',
    retry: 'Retry',
    loadError: 'Could not read the latest state from Core.',
    createProjectTitle: 'Create a new project',
    createProjectHint: 'Start with a name. You can add a script later.',
    projectName: 'Project name',
    projectNamePlaceholder: 'For example: Summer on the rooftop',
    cancel: 'Maybe later',
    create: 'Create project',
    acknowledged: 'Acknowledged. The decision remains in history.',
    commandHint: 'Press Ctrl K to search quickly',
  },
} as const

type Copy = (typeof copy)[Locale]

const navItems: Array<{ key: NavKey; icon: typeof Home; label: keyof typeof copy.vi }> = [
  { key: 'home', icon: Home, label: 'home' },
  { key: 'projects', icon: FolderKanban, label: 'projects' },
  { key: 'needs', icon: Inbox, label: 'needs' },
  { key: 'library', icon: BookOpen, label: 'library' },
]

function App() {
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem('cineforge-locale') as Locale) || 'vi')
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('cineforge-theme') as Theme) || 'dark')
  const [activeNav, setActiveNav] = useState<NavKey>('home')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const t = copy[locale]
  const client = useMemo(() => createCoreClient(), [])

  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const next = await client.getDashboard(signal)
      setSnapshot(next)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setLoadError(error instanceof Error ? error.message : t.loadError)
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [client, t.loadError])

  useEffect(() => {
    const controller = new AbortController()
    void loadDashboard(controller.signal)
    return () => controller.abort()
  }, [loadDashboard])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('cineforge-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('cineforge-locale', locale)
    document.documentElement.lang = locale === 'vi' ? 'vi' : 'en'
  }, [locale])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setNewProjectOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openDecision = (decision: DecisionRequest) => {
    setActiveNav('needs')
    setToast(locale === 'vi' ? `Đang mở ${decision.title}` : `Opening ${decision.title}`)
  }

  const acknowledgeDecision = async (decision: DecisionRequest) => {
    try {
      await client.acknowledgeDecision(decision.id)
      setSnapshot((current) => current ? { ...current, decisions: current.decisions.filter((candidate) => candidate.id !== decision.id), generatedAt: new Date().toISOString() } : current)
      setToast(t.acknowledged)
    } catch (error) {
      setToast(error instanceof Error ? error.message : t.loadError)
    }
  }

  const openProject = (project: ProjectSummary) => {
    setSelectedProjectId(project.id)
    setActiveNav('projects')
  }

  const handleCreateProject = async (name: string) => {
    try {
      const project = await client.createProject(name)
      setSnapshot((current) => current ? { ...current, projects: [project, ...current.projects], generatedAt: new Date().toISOString() } : current)
      setNewProjectOpen(false)
      setSelectedProjectId(project.id)
      setActiveNav('projects')
      setToast(locale === 'vi' ? `Đã tạo “${name}”. Thêm production item đầu tiên để bắt đầu.` : `“${name}” created. Add the first production item to begin.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : t.loadError)
    }
  }

  const addProductionItem = async (projectId: string, title: string) => {
    try {
      const item = await client.addProductionItem(projectId, title)
      setSnapshot((current) => current ? {
        ...current,
        projects: current.projects.map((project) => project.id === projectId ? { ...project, productionItems: [...(project.productionItems ?? []), item], completion: { ...project.completion, total: Math.max(project.completion.total, (project.productionItems?.length ?? 0) + 1) }, updatedAt: locale === 'vi' ? 'Vừa cập nhật' : 'Just updated' } : project),
        generatedAt: new Date().toISOString(),
      } : current)
      setToast(locale === 'vi' ? 'Đã thêm production item.' : 'Production item added.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : t.loadError)
    }
  }

  const content = snapshot ? (
    <>
      {activeNav === 'home' && (
        <HomeView
          snapshot={snapshot}
          t={t}
          locale={locale}
          onOpenDecision={openDecision}
          onOpenProject={openProject}
          onNewProject={() => setNewProjectOpen(true)}
          onToast={setToast}
          onNavigate={setActiveNav}
        />
      )}
      {activeNav === 'projects' && (
        selectedProjectId ? <ProjectDetailView snapshot={snapshot} projectId={selectedProjectId} locale={locale} onBack={() => setSelectedProjectId(null)} onAddItem={addProductionItem} /> : <ProjectsView snapshot={snapshot} t={t} locale={locale} onNewProject={() => setNewProjectOpen(true)} onOpenProject={openProject} />
      )}
      {activeNav === 'needs' && (
        <NeedsView snapshot={snapshot} t={t} locale={locale} onOpenDecision={openDecision} onAcknowledge={acknowledgeDecision} />
      )}
      {activeNav === 'library' && <PlaceholderView icon={BookOpen} title={t.library} detail={locale === 'vi' ? 'Thư viện asset sẽ xuất hiện ở đây khi bạn thêm nguồn đầu tiên.' : 'Your asset library will appear here once you add the first source.'} primary={locale === 'vi' ? 'Nhập asset' : 'Import assets'} onPrimary={() => setToast(locale === 'vi' ? 'Import tray sẽ sẵn sàng trong vertical slice tiếp theo.' : 'The import tray is planned for the next vertical slice.')} />}
      {activeNav === 'settings' && <PlaceholderView icon={Settings2} title={t.settings} detail={locale === 'vi' ? 'Cài đặt kết nối, quyền riêng tư và lưu trữ nằm trong khu vực hệ thống.' : 'Connection, privacy and storage settings live in the system area.'} primary={locale === 'vi' ? 'Mở chẩn đoán' : 'Open diagnostics'} onPrimary={() => setToast(locale === 'vi' ? 'Chẩn đoán chưa cần thiết lúc này.' : 'Diagnostics are not needed right now.')} />}
    </>
  ) : null

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><Sparkles size={18} strokeWidth={2.4} /></div>
          {!sidebarCollapsed && <div className="brand-copy"><strong>CineForge</strong><span>OS</span></div>}
          <button className="icon-button sidebar-close" aria-label={locale === 'vi' ? 'Đóng menu' : 'Close menu'} onClick={() => setMobileNavOpen(false)}><X size={17} /></button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">T</div>
          {!sidebarCollapsed && <div className="workspace-meta"><strong>{locale === 'vi' ? 'Không gian của Tuyên' : "Tuyên's workspace"}</strong><span>{locale === 'vi' ? 'Cá nhân · Local-first' : 'Personal · Local-first'}</span></div>}
          {!sidebarCollapsed && <ChevronDown size={15} className="muted" />}
        </div>

        <nav className="main-nav" aria-label={locale === 'vi' ? 'Điều hướng chính' : 'Primary navigation'}>
          <div className="nav-label">{locale === 'vi' ? 'Không gian làm việc' : 'Workspace'}</div>
          {navItems.map(({ key, icon: Icon, label }) => (
            <button key={key} className={`nav-item ${activeNav === key ? 'active' : ''}`} onClick={() => { setActiveNav(key); if (key === 'projects') setSelectedProjectId(null); setMobileNavOpen(false) }} aria-current={activeNav === key ? 'page' : undefined}>
              <Icon size={18} />
              {!sidebarCollapsed && <span>{t[label]}</span>}
              {key === 'needs' && snapshot && snapshot.decisions.length > 0 && <span className="nav-badge">{snapshot.decisions.length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="storage-mini">
          <div className="storage-mini-top"><HardDrive size={15} /><span>{t.storage}</span><span className="storage-percent">{snapshot ? storagePercent(snapshot) : '—'}</span></div>
          <div className="storage-track"><span style={{ width: snapshot ? `${storagePercentNumber(snapshot)}%` : '0%' }} /></div>
          {!sidebarCollapsed && <div className="storage-meta">{snapshot?.system.storageUsed ?? '—'} / {snapshot?.system.storageTotal ?? '—'}</div>}
        </div>
        <button className={`nav-item ${activeNav === 'settings' ? 'active' : ''}`} onClick={() => setActiveNav('settings')}><Settings2 size={18} />{!sidebarCollapsed && <span>{t.settings}</span>}</button>
        <div className="sidebar-footer"><span className="version-dot" />{!sidebarCollapsed && <span>CineForge OS · v0.1</span>}</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label={locale === 'vi' ? 'Mở menu' : 'Open menu'} onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button>
            <button className="icon-button collapse-button" aria-label={sidebarCollapsed ? (locale === 'vi' ? 'Mở rộng menu' : 'Expand menu') : (locale === 'vi' ? 'Thu gọn menu' : 'Collapse menu')} onClick={() => setSidebarCollapsed((value) => !value)}><PanelLeftClose size={18} /></button>
            <div className="breadcrumbs"><span>{activeNav === 'home' ? t.home : activeNav === 'projects' ? t.projects : activeNav === 'needs' ? t.needs : activeNav === 'library' ? t.library : t.settings}</span>{activeNav === 'home' && <><span className="breadcrumb-separator">/</span><span className="muted">{locale === 'vi' ? 'Tổng quan' : 'Overview'}</span></>}</div>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={16} /><span>{t.searchPlaceholder}</span><kbd><Command size={11} /> K</kbd></button>
            {snapshot && <span className={`connection-pill ${snapshot.system.offline || !snapshot.system.connected ? 'offline' : ''}`}><span />{snapshot.system.offline || !snapshot.system.connected ? t.offline : t.connected}</span>}
            <div className="topbar-divider" />
            <button className="icon-button" aria-label={locale === 'vi' ? 'Đổi giao diện' : 'Toggle theme'} onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
            <button className="locale-button" onClick={() => setLocale((value) => value === 'vi' ? 'en' : 'vi')}><Languages size={15} /><span>{locale === 'vi' ? 'VI' : 'EN'}</span></button>
            <button className="icon-button notification-button" aria-label={locale === 'vi' ? 'Thông báo' : 'Notifications'}><Bell size={17} /><span className="notification-dot" /></button>
            <div className="user-avatar">T</div>
          </div>
        </header>

        <div className="content-scroll">
          {isLoading && !snapshot ? <LoadingState label={t.loading} /> : loadError && !snapshot ? <ErrorState message={t.loadError} onRetry={() => void loadDashboard()} retryLabel={t.retry} /> : content}
        </div>
      </main>

      {searchOpen && <SearchOverlay snapshot={snapshot} t={t} onClose={() => setSearchOpen(false)} onSelectProject={(project) => { setSearchOpen(false); openProject(project) }} />}
      {newProjectOpen && <NewProjectModal t={t} onClose={() => setNewProjectOpen(false)} onCreated={handleCreateProject} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={16} /><span>{toast}</span><button onClick={() => setToast(null)} aria-label="Close"><X size={14} /></button></div>}
    </div>
  )
}

function HomeView({ snapshot, t, locale, onOpenDecision, onOpenProject, onNewProject, onNavigate, onToast }: { snapshot: DashboardSnapshot; t: Copy; locale: Locale; onOpenDecision: (decision: DecisionRequest) => void; onOpenProject: (project: ProjectSummary) => void; onNewProject: () => void; onNavigate: (nav: NavKey) => void; onToast: (message: string) => void }) {
  const leadProject = snapshot.projects[0]
  return <div className="page home-page">
    <div className="page-heading"><div><p className="eyebrow">{formatDateGreeting(locale)}</p><h1>{t.greeting}</h1><p className="page-subtitle">{t.greetingHint}</p></div><button className="primary-button" onClick={onNewProject}><Plus size={17} />{t.newProject}</button></div>
    <section className="continue-section"><div className="section-heading"><div><h2>{t.continue}</h2><p>{locale === 'vi' ? 'Nơi bạn dừng lại lần trước.' : 'Where you left off last time.'}</p></div><button className="text-button" onClick={() => onOpenProject(leadProject)}>{t.view}<ArrowRight size={15} /></button></div><div className="hero-project-card" style={{ '--project-accent': leadProject.accent } as CSSProperties} onClick={() => onOpenProject(leadProject)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onOpenProject(leadProject) }}><div className="hero-cover" style={{ background: leadProject.cover }}><div className="cover-noise" /><div className="cover-type">{leadProject.kind}</div><div className="cover-play"><LayoutDashboard size={19} /></div></div><div className="hero-project-body"><div className="project-title-row"><div><span className="project-kicker">{leadProject.name}</span><h3>{leadProject.nextAction}</h3></div><span className={`health-pill ${leadProject.health}`}><span />{leadProject.health === 'healthy' ? t.healthy : leadProject.health === 'blocked' ? (locale === 'vi' ? 'Đang chặn' : 'Blocked') : (locale === 'vi' ? 'Cần chú ý' : 'Needs attention')}</span></div><p className="hero-detail">{leadProject.stage} <span>·</span> {leadProject.stageDetail}</p><div className="hero-progress-row"><span>{leadProject.completion.done}/{leadProject.completion.total} {locale === 'vi' ? 'shot đã xong' : 'shots complete'}</span><span className="hero-progress-percent">{percentage(leadProject.completion.done, leadProject.completion.total)}%</span></div><div className="progress-track large"><span style={{ width: `${percentage(leadProject.completion.done, leadProject.completion.total)}%` }} /></div><div className="hero-footer"><span><Clock3 size={14} />{leadProject.updatedAt}</span><span><HardDrive size={14} />{leadProject.storage}</span><span className="hero-action">{leadProject.nextActionLabel}<ArrowRight size={15} /></span></div></div></div></section>
    <div className="home-grid"><section className="dashboard-card needs-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon amber"><Inbox size={16} /></span><div><h2>{t.needsYou}</h2><p>{t.needsHint}</p></div></div><button className="text-button" onClick={() => onNavigate('needs')}>{t.seeAll}<ArrowRight size={14} /></button></div>{snapshot.decisions.length === 0 ? <EmptyInline icon={CheckCircle2} text={t.noDecisions} /> : <div className="decision-list">{snapshot.decisions.slice(0, 3).map((decision) => <DecisionRow key={decision.id} decision={decision} locale={locale} onOpen={() => onOpenDecision(decision)} />)}</div>}</section><section className="dashboard-card activity-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><Activity size={16} /></span><div><h2>{t.background}</h2><p>{t.backgroundHint}</p></div></div><button className="text-button" onClick={() => onToast(locale === 'vi' ? 'Activity Center sẽ mở trong cửa sổ riêng.' : 'Activity Center will open in its own view.')}>{t.seeAll}<ArrowRight size={14} /></button></div><div className="activity-list">{snapshot.activity.slice(0, 4).map((item) => <ActivityRow key={item.id} item={item} locale={locale} />)}</div></section></div>
    <section className="projects-section"><div className="section-heading"><div><h2>{t.recentProjects}</h2><p>{locale === 'vi' ? 'Các không gian bạn vừa làm việc.' : 'The spaces you worked in recently.'}</p></div><button className="text-button" onClick={() => onNavigate('projects')}>{t.allProjects}<ArrowRight size={15} /></button></div><div className="project-grid">{snapshot.projects.slice(0, 3).map((project) => <ProjectCard key={project.id} project={project} locale={locale} onOpen={() => onOpenProject(project)} />)}</div></section>
  </div>
}

function ProjectsView({ snapshot, t, locale, onNewProject, onOpenProject }: { snapshot: DashboardSnapshot; t: Copy; locale: Locale; onNewProject: () => void; onOpenProject: (project: ProjectSummary) => void }) {
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">{t.projects}</p><h1>{locale === 'vi' ? 'Không gian của bạn' : 'Your workspaces'}</h1><p className="page-subtitle">{locale === 'vi' ? `${snapshot.projects.length} dự án · dữ liệu nằm trên máy của bạn.` : `${snapshot.projects.length} projects · your data stays on this machine.`}</p></div><button className="primary-button" onClick={onNewProject}><Plus size={17} />{t.newProject}</button></div><div className="project-grid full">{snapshot.projects.map((project) => <ProjectCard key={project.id} project={project} locale={locale} onOpen={() => onOpenProject(project)} />)}<button className="new-project-card" onClick={onNewProject}><span><Plus size={21} /></span><strong>{t.newProject}</strong><small>{locale === 'vi' ? 'Bắt đầu từ một không gian trống' : 'Start with an empty workspace'}</small></button></div></div>
}

function ProjectDetailView({ snapshot, projectId, locale, onBack, onAddItem }: { snapshot: DashboardSnapshot; projectId: string; locale: Locale; onBack: () => void; onAddItem: (projectId: string, title: string) => Promise<void> }) {
  const project = snapshot.projects.find((candidate) => candidate.id === projectId)
  const [newItem, setNewItem] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  if (!project) return <div className="page"><ErrorState message={locale === 'vi' ? 'Không tìm thấy dự án.' : 'Project could not be found.'} retryLabel={locale === 'vi' ? 'Quay lại dự án' : 'Back to projects'} onRetry={onBack} /></div>
  const items = project.productionItems ?? []
  const addItem = async (event: FormEvent) => {
    event.preventDefault()
    const title = newItem.trim()
    if (!title || isAdding) return
    setIsAdding(true)
    try {
      await onAddItem(project.id, title)
      setNewItem('')
    } finally {
      setIsAdding(false)
    }
  }
  return <div className="page project-detail-page"><button className="back-link" onClick={onBack}><ArrowRight size={15} className="back-arrow" />{locale === 'vi' ? 'Tất cả dự án' : 'All projects'}</button><div className="project-detail-heading"><div><p className="eyebrow">{project.kind}</p><h1>{project.name}</h1><p className="page-subtitle">{project.stage} · {project.stageDetail}</p></div><span className={`health-pill ${project.health}`}><span />{project.health === 'healthy' ? (locale === 'vi' ? 'Ổn định' : 'Healthy') : project.health === 'blocked' ? (locale === 'vi' ? 'Đang chặn' : 'Blocked') : (locale === 'vi' ? 'Cần chú ý' : 'Needs attention')}</span></div><div className="project-detail-grid"><section className="detail-summary-card"><div className="detail-cover" style={{ background: project.cover }}><div className="cover-noise" /><span className="cover-type">{project.kind}</span></div><div className="detail-summary-body"><div className="detail-stat"><span>{locale === 'vi' ? 'Production items' : 'Production items'}</span><strong>{items.length}</strong></div><div className="detail-stat"><span>{locale === 'vi' ? 'Shot đã xong' : 'Shots complete'}</span><strong>{project.completion.done}/{project.completion.total || '—'}</strong></div><div className="detail-stat"><span>{locale === 'vi' ? 'Dung lượng' : 'Storage'}</span><strong>{project.storage}</strong></div></div></section><section className="production-card"><div className="production-card-heading"><div><h2>{locale === 'vi' ? 'Bảng sản xuất' : 'Production board'}</h2><p>{locale === 'vi' ? 'Mỗi việc là một mốc có thể truy lại. Không có tiến độ giả.' : 'Each item is a traceable milestone. No invented progress.'}</p></div><span className="state-label"><ShieldCheck size={13} />{locale === 'vi' ? 'Do Core quản lý' : 'Core-owned'}</span></div><form className="add-item-form" onSubmit={addItem}><input value={newItem} onChange={(event) => setNewItem(event.target.value)} placeholder={locale === 'vi' ? 'Thêm production item…' : 'Add a production item…'} aria-label={locale === 'vi' ? 'Tên production item' : 'Production item name'} /><button className="primary-button small" disabled={!newItem.trim() || isAdding}>{isAdding ? '…' : <><Plus size={15} />{locale === 'vi' ? 'Thêm' : 'Add'}</>}</button></form><div className="production-list">{items.length === 0 ? <div className="production-empty"><Sparkles size={19} /><p>{locale === 'vi' ? 'Bắt đầu bằng một cảnh, shot hoặc mốc âm thanh.' : 'Start with a scene, shot, or audio milestone.'}</p></div> : items.map((item) => <div className="production-item" key={item.id}><span className={`production-check ${item.state}`}>{item.state === 'done' ? <Check size={13} /> : item.state === 'in_progress' ? <Clock3 size={13} /> : <span />}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><span className={`item-state ${item.state}`}>{item.state === 'done' ? (locale === 'vi' ? 'Đã xong' : 'Done') : item.state === 'in_progress' ? (locale === 'vi' ? 'Đang xử lý' : 'In progress') : (locale === 'vi' ? 'Chưa bắt đầu' : 'Not started')}</span></div>)}</div></section></div></div>
}

function NeedsView({ snapshot, t, locale, onOpenDecision, onAcknowledge }: { snapshot: DashboardSnapshot; t: Copy; locale: Locale; onOpenDecision: (decision: DecisionRequest) => void; onAcknowledge: (decision: DecisionRequest) => void }) {
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">{t.needs}</p><h1>{t.needsYou}</h1><p className="page-subtitle">{t.needsHint}</p></div><span className="count-chip"><Inbox size={15} />{snapshot.decisions.length}</span></div><section className="needs-page-list">{snapshot.decisions.length === 0 ? <EmptyState icon={CheckCircle2} title={t.noDecisions} detail="" /> : snapshot.decisions.map((decision) => <DecisionCard key={decision.id} decision={decision} locale={locale} onOpen={() => onOpenDecision(decision)} onAcknowledge={() => onAcknowledge(decision)} />)}</section></div>
}

function ProjectCard({ project, locale, onOpen }: { project: ProjectSummary; locale: Locale; onOpen: () => void }) {
  return <article className="project-card" onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }} role="button" tabIndex={0}><div className="project-card-cover" style={{ background: project.cover }}><div className="cover-noise" /><span className="cover-type">{project.kind}</span><span className={`cover-health ${project.health}`}><span /></span></div><div className="project-card-body"><div className="project-card-top"><div><h3>{project.name}</h3><p>{project.stage} <span>·</span> {project.stageDetail}</p></div><button className="icon-button ghost" onClick={(event) => { event.stopPropagation(); onOpen() }} aria-label={locale === 'vi' ? `Mở ${project.name}` : `Open ${project.name}`}><MoreHorizontal size={17} /></button></div><div className="mini-progress-row"><span>{project.completion.done}/{project.completion.total} {locale === 'vi' ? 'shot' : 'shots'}</span><span>{percentage(project.completion.done, project.completion.total)}%</span></div><div className="progress-track"><span style={{ width: `${percentage(project.completion.done, project.completion.total)}%` }} /></div><div className="project-card-footer"><span>{project.updatedAt}</span><span>{project.storage}</span></div></div></article>
}

function DecisionRow({ decision, locale, onOpen }: { decision: DecisionRequest; locale: Locale; onOpen: () => void }) {
  return <button className="decision-row" onClick={onOpen}><span className={`decision-marker ${decision.priority}`}><Inbox size={14} /></span><span className="decision-row-content"><strong>{decision.title}</strong><small>{decision.projectName} <span>·</span> {decision.age}</small></span><ArrowRight size={15} className="row-arrow" /><span className="sr-only">{locale === 'vi' ? 'Mở quyết định' : 'Open decision'}</span></button>
}

function DecisionCard({ decision, locale, onOpen, onAcknowledge }: { decision: DecisionRequest; locale: Locale; onOpen: () => void; onAcknowledge: () => void }) {
  return <article className={`decision-card ${decision.priority}`}><div className="decision-card-icon"><Inbox size={19} /></div><div className="decision-card-main"><div className="decision-card-top"><div><span className="decision-project">{decision.projectName}</span><h2>{decision.title}</h2></div><span className={`priority-label ${decision.priority}`}>{decision.priority === 'high' ? (locale === 'vi' ? 'Ưu tiên' : 'Priority') : (locale === 'vi' ? 'Đang chờ' : 'Waiting')}</span></div><p className="decision-detail">{decision.detail}</p><p className="decision-reason"><CircleHelp size={14} />{decision.reason}</p><div className="decision-card-actions"><button className="primary-button small" onClick={onOpen}>{decision.actionLabel}<ArrowRight size={15} /></button><button className="subtle-button" onClick={onAcknowledge}><Check size={15} />{locale === 'vi' ? 'Đã xem' : 'Acknowledge'}</button><span className="decision-age"><Clock3 size={13} />{decision.age}</span></div></div></article>
}

function ActivityRow({ item, locale }: { item: ActivityItem; locale: Locale }) {
  const icon = item.state === 'complete' ? <CheckCircle2 size={15} /> : item.state === 'blocked' ? <AlertCircle size={15} /> : item.state === 'needs_user' ? <UserRound size={15} /> : <Zap size={15} />
  return <div className="activity-row"><span className={`activity-state ${item.state}`}>{icon}</span><div className="activity-row-main"><div className="activity-row-title"><strong>{item.label}</strong><span>{item.updatedAt}</span></div><p>{item.projectName} <span>·</span> {item.detail}</p><div className="activity-milestone"><span className={`milestone-dot ${item.state}`} />{item.milestone ?? (locale === 'vi' ? 'Đang xử lý' : 'Working')}</div></div>{item.actionable && <button className="subtle-button tiny">{locale === 'vi' ? 'Xem' : 'View'}</button>}</div>
}

function PlaceholderView({ icon: Icon, title, detail, primary, onPrimary }: { icon: typeof BookOpen; title: string; detail: string; primary: string; onPrimary: () => void }) {
  return <div className="page placeholder-page"><div className="placeholder-icon"><Icon size={27} /></div><h1>{title}</h1><p>{detail}</p><button className="primary-button" onClick={onPrimary}><UploadCloud size={16} />{primary}</button></div>
}

function LoadingState({ label }: { label: string }) {
  return <div className="loading-state"><div className="loading-orb"><Sparkles size={20} /></div><p>{label}</p><div className="loading-skeleton wide" /><div className="loading-skeleton" /><div className="loading-skeleton" /></div>
}

function ErrorState({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return <div className="error-state"><div className="error-icon"><CloudOff size={24} /></div><h2>{message}</h2><p>CineForge không giả vờ đã lưu thay đổi. Kiểm tra Core rồi thử lại.</p><button className="primary-button" onClick={onRetry}>{retryLabel}</button></div>
}

function EmptyInline({ icon: Icon, text }: { icon: typeof CheckCircle2; text: string }) {
  return <div className="empty-inline"><Icon size={18} /><span>{text}</span></div>
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof CheckCircle2; title: string; detail: string }) {
  return <div className="empty-state"><Icon size={28} /><h2>{title}</h2>{detail && <p>{detail}</p>}</div>
}

function SearchOverlay({ snapshot, t, onClose, onSelectProject }: { snapshot: DashboardSnapshot | null; t: Copy; onClose: () => void; onSelectProject: (project: ProjectSummary) => void }) {
  const [query, setQuery] = useState('')
  const filtered = snapshot?.projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase())) ?? []
  return <div className="overlay-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="search-dialog" role="dialog" aria-modal="true" aria-label={t.searchPlaceholder}><div className="search-dialog-input"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} /><kbd>ESC</kbd></div><div className="search-dialog-body">{filtered.length ? <>{filtered.map((project) => <button className="search-result" key={project.id} onClick={() => onSelectProject(project)}><span className="result-thumb" style={{ background: project.cover }} /><span><strong>{project.name}</strong><small>{project.kind} · {project.stage}</small></span><ArrowRight size={15} /></button>)}</> : <div className="search-empty"><Search size={20} /><p>{query ? 'Không tìm thấy kết quả phù hợp.' : 'Gõ để tìm dự án hoặc tài sản.'}</p></div>}</div><div className="search-dialog-footer"><span>{t.commandHint}</span><span><kbd>↵</kbd> {t.view}</span></div></div></div>
}

function NewProjectModal({ t, onClose, onCreated }: { t: Copy; onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState('')
  return <div className="overlay-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal-card" onSubmit={(event) => { event.preventDefault(); const clean = name.trim(); if (clean) onCreated(clean) }}><button type="button" className="modal-close icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button><div className="modal-icon"><FolderKanban size={20} /></div><h2>{t.createProjectTitle}</h2><p>{t.createProjectHint}</p><label htmlFor="project-name">{t.projectName}</label><input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t.projectNamePlaceholder} autoFocus /><div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>{t.cancel}</button><button type="submit" className="primary-button" disabled={!name.trim()}>{t.create}<ArrowRight size={15} /></button></div></form></div>
}

function percentage(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

function storagePercentNumber(snapshot: DashboardSnapshot) {
  const used = Number.parseFloat(snapshot.system.storageUsed)
  const total = Number.parseFloat(snapshot.system.storageTotal)
  return Number.isFinite(used) && Number.isFinite(total) && total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0
}

function storagePercent(snapshot: DashboardSnapshot) {
  return `${storagePercentNumber(snapshot)}%`
}

function formatDateGreeting(locale: Locale) {
  const hour = new Date().getHours()
  if (locale === 'en') return hour < 12 ? 'MORNING CHECK-IN' : hour < 18 ? 'AFTERNOON CHECK-IN' : 'EVENING CHECK-IN'
  return hour < 12 ? 'BUỔI SÁNG' : hour < 18 ? 'BUỔI CHIỀU' : 'BUỔI TỐI'
}

export default App
