import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CircleDot,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  CloudOff,
  Command,
  Database,
  File as FileIcon,
  FilePlus2,
  Filter,
  FolderKanban,
  HardDrive,
  Home,
  Inbox,
  Info,
  ListChecks,
  Languages,
  LayoutDashboard,
  Menu,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
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
import { CoreClientError, createCoreClient } from './coreAdapter'
import type { ActivityItem, AssetSummary, CharacterRevision, CharacterRevisionKind, CharacterSummary, CoreClient, DashboardSnapshot, DecisionRequest, Locale, NoteSummary, ProductionItem, ProjectSummary, ProjectWorkspace, ShotLifecycleState, ShotSummary, TaskStatus, TaskSummary, Theme, WorkState } from './types'

type NavKey = 'home' | 'projects' | 'characters' | 'needs' | 'activity' | 'library' | 'settings'

export const copy = {
  vi: {
    home: 'Trang chủ',
    projects: 'Dự án',
    characters: 'Nhân vật',
    needs: 'Cần bạn',
    activity: 'Hoạt động',
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
    refresh: 'Tải lại',
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
    decisionResolved: 'Đã lưu lựa chọn. Core đã ghi nhận quyết định.',
    decisionDismissed: 'Đã bỏ qua quyết định. Trạng thái đã được Core ghi lại.',
    resolveDecision: 'Chọn',
    dismissDecision: 'Bỏ qua',
    recommended: 'Khuyến nghị',
    decisionScope: 'Phạm vi chặn',
    decisionDeadline: 'Hạn phản hồi',
    decisionDefault: 'Nếu không chọn',
    decisionAuthority: 'Quyền quyết định',
    decisionEvidence: 'Bằng chứng',
    staleDecision: 'Quyết định đã thay đổi. Tải lại để xem bản mới nhất trước khi chọn.',
    decisionActionUnavailable: 'Core chưa cung cấp thao tác quyết định này. Không có thay đổi nào được ghi.',
    commandHint: 'Nhấn Ctrl K để tìm nhanh',
  },
  en: {
    home: 'Home',
    projects: 'Projects',
    characters: 'Characters',
    needs: 'Needs You',
    activity: 'Activity',
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
    refresh: 'Refresh',
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
    decisionResolved: 'Choice saved. Core recorded the decision.',
    decisionDismissed: 'Decision dismissed. Core recorded the outcome.',
    resolveDecision: 'Choose',
    dismissDecision: 'Dismiss',
    recommended: 'Recommended',
    decisionScope: 'Blocking scope',
    decisionDeadline: 'Response deadline',
    decisionDefault: 'If you do nothing',
    decisionAuthority: 'Decision authority',
    decisionEvidence: 'Evidence',
    staleDecision: 'This decision changed. Refresh before choosing so you see the latest state.',
    decisionActionUnavailable: 'Core does not expose this decision action yet. Nothing was changed.',
    commandHint: 'Press Ctrl K to search quickly',
  },
} as const

type Copy = (typeof copy)[Locale]

const navItems: Array<{ key: NavKey; icon: typeof Home; label: keyof typeof copy.vi }> = [
  { key: 'home', icon: Home, label: 'home' },
  { key: 'projects', icon: FolderKanban, label: 'projects' },
  { key: 'characters', icon: UserRound, label: 'characters' },
  { key: 'needs', icon: Inbox, label: 'needs' },
  { key: 'activity', icon: Activity, label: 'activity' },
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
  const [decisionPendingId, setDecisionPendingId] = useState<string | null>(null)
  const [decisionError, setDecisionError] = useState<{ id: string; message: string } | null>(null)
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
    setDecisionError(null)
    setToast(locale === 'vi' ? `Đang xem ${decision.title}` : `Reviewing ${decision.title}`)
  }

  const resolveDecision = async (decision: DecisionRequest, choiceId: string) => {
    if (!client.resolveDecision) {
      setDecisionError({ id: decision.id, message: t.decisionActionUnavailable })
      return
    }
    setDecisionPendingId(decision.id)
    setDecisionError(null)
    try {
      await client.resolveDecision(decision.id, choiceId, decision.decisionVersion, `decision-resolve:${decision.id}:${decision.decisionVersion}:${choiceId}`)
      setSnapshot((current) => current ? { ...current, decisions: current.decisions.filter((candidate) => candidate.id !== decision.id), generatedAt: new Date().toISOString() } : current)
      setToast(t.decisionResolved)
    } catch (error) {
      const code = error instanceof CoreClientError ? error.code : ''
      setDecisionError({ id: decision.id, message: code === 'STALE_DECISION' || code === 'STALE_REVISION' ? t.staleDecision : error instanceof Error ? error.message : t.loadError })
    } finally {
      setDecisionPendingId(null)
    }
  }

  const dismissDecision = async (decision: DecisionRequest) => {
    if (!client.dismissDecision) {
      setDecisionError({ id: decision.id, message: t.decisionActionUnavailable })
      return
    }
    setDecisionPendingId(decision.id)
    setDecisionError(null)
    try {
      await client.dismissDecision(decision.id, decision.decisionVersion, `decision-dismiss:${decision.id}:${decision.decisionVersion}`)
      setSnapshot((current) => current ? { ...current, decisions: current.decisions.filter((candidate) => candidate.id !== decision.id), generatedAt: new Date().toISOString() } : current)
      setToast(t.decisionDismissed)
    } catch (error) {
      const code = error instanceof CoreClientError ? error.code : ''
      setDecisionError({ id: decision.id, message: code === 'STALE_DECISION' || code === 'STALE_REVISION' ? t.staleDecision : error instanceof Error ? error.message : t.loadError })
    } finally {
      setDecisionPendingId(null)
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
      return item
    } catch (error) {
      setToast(error instanceof Error ? error.message : t.loadError)
      throw error
    }
  }

  const syncProjectWorkspace = useCallback((workspace: ProjectWorkspace) => {
    setSnapshot((current) => current ? {
      ...current,
      projects: current.projects.map((project) => {
        if (project.id !== workspace.projectId) return project
        const blocked = workspace.tasks.some((task) => task.status === 'BLOCKED')
        return {
          ...project,
          productionItems: workspace.productionItems,
          completion: {
            done: workspace.productionItems.filter((item) => item.state === 'done').length,
            total: workspace.productionItems.length,
          },
          health: project.health === 'blocked' ? 'blocked' : blocked ? 'attention' : project.health,
          updatedAt: locale === 'vi' ? 'Vừa cập nhật' : 'Just updated',
        }
      }),
      generatedAt: workspace.generatedAt ?? new Date().toISOString(),
    } : current)
  }, [locale])

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
        selectedProjectId ? <ProjectPlanningView snapshot={snapshot} projectId={selectedProjectId} locale={locale} client={client} onBack={() => setSelectedProjectId(null)} onWorkspaceChanged={syncProjectWorkspace} /> : <ProjectsView snapshot={snapshot} t={t} locale={locale} onNewProject={() => setNewProjectOpen(true)} onOpenProject={openProject} />
      )}
      {activeNav === 'characters' && <CharactersView snapshot={snapshot} locale={locale} client={client} onToast={setToast} />}
      {activeNav === 'needs' && (
        <NeedsView snapshot={snapshot} t={t} locale={locale} onOpenDecision={openDecision} onResolve={resolveDecision} onDismiss={dismissDecision} pendingId={decisionPendingId} decisionError={decisionError} onRefresh={() => void loadDashboard()} />
      )}
      {activeNav === 'activity' && <ActivityView snapshot={snapshot} locale={locale} onOpenProject={openProject} />}
      {activeNav === 'library' && <LibraryView snapshot={snapshot} locale={locale} client={client} onOpenProject={openProject} />}
      {activeNav === 'settings' && <SettingsView snapshot={snapshot} locale={locale} theme={theme} onThemeChange={setTheme} onLocaleChange={setLocale} onRefresh={() => void loadDashboard()} refreshLabel={t.refresh} />}
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
            <div className="breadcrumbs"><span>{activeNav === 'home' ? t.home : activeNav === 'projects' ? t.projects : activeNav === 'characters' ? t.characters : activeNav === 'needs' ? t.needs : activeNav === 'activity' ? t.activity : activeNav === 'library' ? t.library : t.settings}</span>{activeNav === 'home' && <><span className="breadcrumb-separator">/</span><span className="muted">{locale === 'vi' ? 'Tổng quan' : 'Overview'}</span></>}</div>
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
  if (!leadProject) return <div className="page empty-home-page"><div className="page-heading"><div><p className="eyebrow">{locale === 'vi' ? 'KHỞI ĐỘNG' : 'GET STARTED'}</p><h1>{locale === 'vi' ? 'Bắt đầu workspace đầu tiên' : 'Start your first workspace'}</h1><p className="page-subtitle">{locale === 'vi' ? 'CineForge chỉ ghi nhận dữ liệu sau khi Core xác nhận. Tạo project để bắt đầu.' : 'CineForge records data only after Core confirms it. Create a project to begin.'}</p></div><button className="primary-button" onClick={onNewProject}><Plus size={17} />{t.newProject}</button></div><EmptyState icon={FolderKanban} title={locale === 'vi' ? 'Chưa có dự án' : 'No projects yet'} detail={locale === 'vi' ? 'Một project mới sẽ xuất hiện ở đây sau khi được Core lưu.' : 'A new project will appear here after Core saves it.'} /></div>
  return <div className="page home-page">
    <div className="page-heading"><div><p className="eyebrow">{formatDateGreeting(locale)}</p><h1>{t.greeting}</h1><p className="page-subtitle">{t.greetingHint}</p></div><button className="primary-button" onClick={onNewProject}><Plus size={17} />{t.newProject}</button></div>
    <section className="continue-section"><div className="section-heading"><div><h2>{t.continue}</h2><p>{locale === 'vi' ? 'Nơi bạn dừng lại lần trước.' : 'Where you left off last time.'}</p></div><button className="text-button" onClick={() => onOpenProject(leadProject)}>{t.view}<ArrowRight size={15} /></button></div><div className="hero-project-card" style={{ '--project-accent': leadProject.accent } as CSSProperties} onClick={() => onOpenProject(leadProject)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenProject(leadProject) } }}><div className="hero-cover" style={{ background: leadProject.cover }}><div className="cover-noise" /><div className="cover-type">{leadProject.kind}</div><div className="cover-play"><LayoutDashboard size={19} /></div></div><div className="hero-project-body"><div className="project-title-row"><div><span className="project-kicker">{leadProject.name}</span><h3>{leadProject.nextAction}</h3></div><span className={`health-pill ${leadProject.health}`}><span />{leadProject.health === 'healthy' ? t.healthy : leadProject.health === 'blocked' ? (locale === 'vi' ? 'Đang chặn' : 'Blocked') : (locale === 'vi' ? 'Cần chú ý' : 'Needs attention')}</span></div><p className="hero-detail">{leadProject.stage} <span>·</span> {leadProject.stageDetail}</p><div className="hero-progress-row"><span>{leadProject.completion.done}/{leadProject.completion.total} {locale === 'vi' ? 'việc đã xong' : 'tasks complete'}</span><span className="hero-progress-percent">{percentage(leadProject.completion.done, leadProject.completion.total)}%</span></div><div className="progress-track large"><span style={{ width: `${percentage(leadProject.completion.done, leadProject.completion.total)}%` }} /></div><div className="hero-footer"><span><Clock3 size={14} />{leadProject.updatedAt}</span><span><HardDrive size={14} />{leadProject.storage}</span><span className="hero-action">{leadProject.nextActionLabel}<ArrowRight size={15} /></span></div></div></div></section>
    <div className="home-grid"><section className="dashboard-card needs-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon amber"><Inbox size={16} /></span><div><h2>{t.needsYou}</h2><p>{t.needsHint}</p></div></div><button className="text-button" onClick={() => onNavigate('needs')}>{t.seeAll}<ArrowRight size={14} /></button></div>{snapshot.decisions.length === 0 ? <EmptyInline icon={CheckCircle2} text={t.noDecisions} /> : <div className="decision-list">{snapshot.decisions.slice(0, 3).map((decision) => <DecisionRow key={decision.id} decision={decision} locale={locale} onOpen={() => onOpenDecision(decision)} />)}</div>}</section><section className="dashboard-card activity-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><Activity size={16} /></span><div><h2>{t.background}</h2><p>{t.backgroundHint}</p></div></div><button className="text-button" onClick={() => onNavigate('activity')}>{t.seeAll}<ArrowRight size={14} /></button></div>{snapshot.activity.length === 0 ? <EmptyInline icon={CheckCircle2} text={t.noActivity} /> : <div className="activity-list">{snapshot.activity.slice(0, 4).map((item) => <ActivityRow key={item.id} item={item} locale={locale} />)}</div>}</section></div>
    <section className="projects-section"><div className="section-heading"><div><h2>{t.recentProjects}</h2><p>{locale === 'vi' ? 'Các không gian bạn vừa làm việc.' : 'The spaces you worked in recently.'}</p></div><button className="text-button" onClick={() => onNavigate('projects')}>{t.allProjects}<ArrowRight size={15} /></button></div><div className="project-grid">{snapshot.projects.slice(0, 3).map((project) => <ProjectCard key={project.id} project={project} locale={locale} onOpen={() => onOpenProject(project)} />)}</div></section>
  </div>
}

function ProjectsView({ snapshot, t, locale, onNewProject, onOpenProject }: { snapshot: DashboardSnapshot; t: Copy; locale: Locale; onNewProject: () => void; onOpenProject: (project: ProjectSummary) => void }) {
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">{t.projects}</p><h1>{locale === 'vi' ? 'Không gian của bạn' : 'Your workspaces'}</h1><p className="page-subtitle">{locale === 'vi' ? `${snapshot.projects.length} dự án · dữ liệu nằm trên máy của bạn.` : `${snapshot.projects.length} projects · your data stays on this machine.`}</p></div><button className="primary-button" onClick={onNewProject}><Plus size={17} />{t.newProject}</button></div><div className="project-grid full">{snapshot.projects.map((project) => <ProjectCard key={project.id} project={project} locale={locale} onOpen={() => onOpenProject(project)} />)}<button className="new-project-card" onClick={onNewProject}><span><Plus size={21} /></span><strong>{t.newProject}</strong><small>{locale === 'vi' ? 'Bắt đầu từ một không gian trống' : 'Start with an empty workspace'}</small></button></div></div>
}

function ProjectDetailView({ snapshot, projectId, locale, client, onBack, onAddItem }: { snapshot: DashboardSnapshot; projectId: string; locale: Locale; client: CoreClient; onBack: () => void; onAddItem: (projectId: string, title: string) => Promise<ProductionItem> }) {
  const project = snapshot.projects.find((candidate) => candidate.id === projectId)
  const [newItem, setNewItem] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [activeTab, setActiveTab] = useState<'production' | 'activity' | 'context'>('production')
  const [workspaceItems, setWorkspaceItems] = useState<ProductionItem[] | null>(null)
  const [workspaceCounts, setWorkspaceCounts] = useState({ shots: 0, notes: 0 })
  const [workspaceActivity, setWorkspaceActivity] = useState<ActivityItem[]>([])
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  useEffect(() => {
    if (!project || !client.getProjectWorkspace) return
    const controller = new AbortController()
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    void Promise.all([
      client.getProjectWorkspace(project.id, controller.signal),
      client.getProjectActivity?.(project.id, controller.signal) ?? Promise.resolve([]),
    ]).then(([workspace, activity]) => {
      if (controller.signal.aborted) return
      setWorkspaceItems(workspace.productionItems)
      setWorkspaceCounts({ shots: workspace.shotsCount, notes: workspace.notesCount })
      setWorkspaceActivity(activity.map((item) => item.projectId === project.id || item.projectName === project.id ? { ...item, projectId: project.id, projectName: project.name } : item))
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setWorkspaceError(error instanceof Error ? error.message : 'Workspace request failed')
    }).finally(() => {
      if (!controller.signal.aborted) setWorkspaceLoading(false)
    })
    return () => controller.abort()
  }, [client, project?.id])

  if (!project) return <div className="page"><ErrorState message={locale === 'vi' ? 'Không tìm thấy dự án.' : 'Project could not be found.'} retryLabel={locale === 'vi' ? 'Quay lại dự án' : 'Back to projects'} onRetry={onBack} /></div>
  const items = workspaceItems ?? project.productionItems ?? []
  const activity = workspaceActivity.length > 0 ? workspaceActivity : snapshot.activity.filter((item) => item.projectId === project.id || item.projectName === project.name)
  const addItem = async (event: FormEvent) => {
    event.preventDefault()
    const title = newItem.trim()
    if (!title || isAdding) return
    setIsAdding(true)
    try {
      const item = await onAddItem(project.id, title)
      setWorkspaceItems((current) => current ? [...current, item] : current)
      setNewItem('')
    } finally {
      setIsAdding(false)
    }
  }
  return <div className="page project-detail-page"><button className="back-link" onClick={onBack}><ArrowRight size={15} className="back-arrow" />{locale === 'vi' ? 'Tất cả dự án' : 'All projects'}</button><div className="project-detail-heading"><div><p className="eyebrow">{project.kind}</p><h1>{project.name}</h1><p className="page-subtitle">{project.stage} · {project.stageDetail}</p></div><span className={`health-pill ${project.health}`}><span />{project.health === 'healthy' ? (locale === 'vi' ? 'Ổn định' : 'Healthy') : project.health === 'blocked' ? (locale === 'vi' ? 'Đang chặn' : 'Blocked') : (locale === 'vi' ? 'Cần chú ý' : 'Needs attention')}</span></div><div className="project-detail-grid"><section className="detail-summary-card"><div className="detail-cover" style={{ background: project.cover }}><div className="cover-noise" /><span className="cover-type">{project.kind}</span></div><div className="detail-summary-body"><div className="detail-stat"><span>{locale === 'vi' ? 'Production items' : 'Production items'}</span><strong>{items.length}</strong></div><div className="detail-stat"><span>{locale === 'vi' ? 'Việc đã xong' : 'Tasks complete'}</span><strong>{project.completion.done}/{project.completion.total || '—'}</strong></div><div className="detail-stat"><span>{locale === 'vi' ? 'Dung lượng' : 'Storage'}</span><strong>{project.storage}</strong></div><div className="detail-stat"><span>{locale === 'vi' ? 'Ghi chú' : 'Notes'}</span><strong>{workspaceCounts.notes || '—'}</strong></div></div></section><section className="production-card"><div className="production-card-heading"><div><h2>{locale === 'vi' ? 'Không gian dự án' : 'Project workspace'}</h2><p>{locale === 'vi' ? 'Dữ liệu đọc từ Core. Mọi thay đổi ghi nhận qua command.' : 'Read from Core. Mutations are recorded through commands.'}</p></div><span className="state-label"><ShieldCheck size={13} />{locale === 'vi' ? 'Do Core quản lý' : 'Core-owned'}</span></div><div className="project-tabs" role="tablist" aria-label={locale === 'vi' ? 'Các phần của dự án' : 'Project sections'}><button className={activeTab === 'production' ? 'active' : ''} onClick={() => setActiveTab('production')} role="tab" aria-selected={activeTab === 'production'}><ListChecks size={14} />{locale === 'vi' ? 'Sản xuất' : 'Production'}</button><button className={activeTab === 'activity' ? 'active' : ''} onClick={() => setActiveTab('activity')} role="tab" aria-selected={activeTab === 'activity'}><Activity size={14} />{locale === 'vi' ? 'Hoạt động' : 'Activity'}</button><button className={activeTab === 'context' ? 'active' : ''} onClick={() => setActiveTab('context')} role="tab" aria-selected={activeTab === 'context'}><Info size={14} />{locale === 'vi' ? 'Thông tin' : 'Context'}</button></div>{workspaceLoading && <div className="inline-state"><RefreshCw size={14} className="spin" />{locale === 'vi' ? 'Đang đọc workspace từ Core…' : 'Reading workspace from Core…'}</div>}{workspaceError && <div className="inline-state warning"><AlertCircle size={14} />{locale === 'vi' ? 'Không đọc được workspace mới nhất; đang hiển thị snapshot dashboard.' : 'Could not read the latest workspace; showing the dashboard snapshot.'}</div>}{activeTab === 'production' && <><form className="add-item-form" onSubmit={addItem}><input value={newItem} onChange={(event) => setNewItem(event.target.value)} placeholder={locale === 'vi' ? 'Thêm production item…' : 'Add a production item…'} aria-label={locale === 'vi' ? 'Tên production item' : 'Production item name'} /><button className="primary-button small" disabled={!newItem.trim() || isAdding}>{isAdding ? '…' : <><Plus size={15} />{locale === 'vi' ? 'Thêm' : 'Add'}</>}</button></form><div className="production-list">{items.length === 0 ? <div className="production-empty"><Sparkles size={19} /><p>{locale === 'vi' ? 'Bắt đầu bằng một cảnh, shot hoặc mốc âm thanh.' : 'Start with a scene, shot, or audio milestone.'}</p></div> : items.map((item) => <div className="production-item" key={item.id}><span className={`production-check ${item.state}`}>{productionItemIcon(item.state)}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><span className={`item-state ${item.state}`}>{productionItemLabel(item.state, locale)}</span></div>)}</div></>}{activeTab === 'activity' && <div className="workspace-activity-list">{activity.length === 0 ? <div className="production-empty"><CircleDot size={19} /><p>{locale === 'vi' ? 'Chưa có activity nào cho project này.' : 'No activity has been recorded for this project.'}</p></div> : activity.map((item) => <ActivityRow key={item.id} item={item} locale={locale} />)}</div>}{activeTab === 'context' && <div className="workspace-context"><div><span>{locale === 'vi' ? 'Project ID' : 'Project ID'}</span><code>{project.id}</code></div><div><span>{locale === 'vi' ? 'Giai đoạn' : 'Stage'}</span><strong>{project.stage}</strong></div><div><span>{locale === 'vi' ? 'Shots trong workspace' : 'Workspace shots'}</span><strong>{workspaceCounts.shots}</strong></div><div><span>{locale === 'vi' ? 'Cập nhật gần nhất' : 'Last updated'}</span><strong>{project.updatedAt}</strong></div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Các trường này chỉ đọc. Dùng command tương ứng để thay đổi dữ liệu canonical.' : 'These fields are read-only. Use the corresponding command to change canonical data.'}</p></div>}</section></div></div>
}

const taskStatusLabels: Record<TaskStatus, { vi: string; en: string }> = {
  PLANNED: { vi: 'Đã lên kế hoạch', en: 'Planned' },
  IN_PROGRESS: { vi: 'Đang làm', en: 'In progress' },
  BLOCKED: { vi: 'Đang bị chặn', en: 'Blocked' },
  DONE: { vi: 'Đã hoàn tất', en: 'Done' },
  CANCELLED: { vi: 'Đã huỷ', en: 'Cancelled' },
}

const shotLifecycleLabels: Record<ShotLifecycleState, { vi: string; en: string }> = {
  ACTIVE: { vi: 'Đang hoạt động', en: 'Active' },
  PAUSED: { vi: 'Tạm dừng', en: 'Paused' },
  ARCHIVED: { vi: 'Đã lưu trữ', en: 'Archived' },
  TRASHED: { vi: 'Đã đưa vào thùng rác', en: 'Trashed' },
}

const taskTransitions: Record<TaskStatus, TaskStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'DONE', 'CANCELLED'],
  BLOCKED: ['PLANNED', 'IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
}

const shotLifecycleTransitions: Record<ShotLifecycleState, ShotLifecycleState[]> = {
  ACTIVE: ['PAUSED', 'ARCHIVED', 'TRASHED'],
  PAUSED: ['ACTIVE', 'ARCHIVED', 'TRASHED'],
  ARCHIVED: ['TRASHED'],
  TRASHED: ['ACTIVE'],
}

function productionItemLabel(state: ProductionItem['state'], locale: Locale) {
  if (state === 'done') return locale === 'vi' ? 'Đã xong' : 'Done'
  if (state === 'in_progress') return locale === 'vi' ? 'Đang xử lý' : 'In progress'
  if (state === 'blocked') return locale === 'vi' ? 'Đang bị chặn' : 'Blocked'
  if (state === 'cancelled') return locale === 'vi' ? 'Đã huỷ' : 'Cancelled'
  return locale === 'vi' ? 'Chưa bắt đầu' : 'Not started'
}

function productionItemIcon(state: ProductionItem['state']) {
  if (state === 'done') return <Check size={13} />
  if (state === 'in_progress') return <Clock3 size={13} />
  if (state === 'blocked') return <AlertCircle size={13} />
  if (state === 'cancelled') return <X size={13} />
  return <span />
}

function workspaceErrorMessage(cause: unknown, locale: Locale) {
  if (!(cause instanceof CoreClientError)) return cause instanceof Error ? cause.message : (locale === 'vi' ? 'Không thể ghi thay đổi.' : 'The change could not be saved.')
  const messages: Record<string, { vi: string; en: string }> = {
    DUPLICATE_SHOT_CODE: { vi: 'Mã shot đã tồn tại trong dự án này.', en: 'That shot code already exists in this project.' },
    DUPLICATE_CHARACTER_CODE: { vi: 'Mã nhân vật đã tồn tại trong dự án này.', en: 'That character code already exists in this project.' },
    INVALID_STATE_TRANSITION: { vi: 'Trạng thái này không thể chuyển từ trạng thái hiện tại.', en: 'That state change is not allowed from the current state.' },
    ENTITY_SCOPE_MISMATCH: { vi: 'Bản ghi không thuộc dự án này.', en: 'That record does not belong to this project.' },
    PROJECT_NOT_WRITABLE: { vi: 'Dự án hiện không cho phép thay đổi.', en: 'This project is not writable in its current lifecycle.' },
    RIGHTS_BLOCKED: { vi: 'Quyền hoặc consent chưa đủ để tiếp tục.', en: 'The required rights or consent are not available yet.' },
    ASSET_NOT_READY: { vi: 'Asset tham chiếu chưa sẵn sàng để dùng cho revision.', en: 'A referenced asset is not ready for this revision.' },
    CHARACTER_NOT_FOUND: { vi: 'Nhân vật không còn tồn tại trong Core.', en: 'The character no longer exists in Core.' },
    CHARACTER_REVISION_NOT_FOUND: { vi: 'Revision nhân vật không còn tồn tại trong Core.', en: 'The character revision no longer exists in Core.' },
    CHARACTER_PACKAGE_NOT_FOUND: { vi: 'Package nhân vật chưa sẵn sàng trong Core.', en: 'The character package is not available in Core.' },
    CORE_OFFLINE: { vi: 'Core đang offline. Hãy kết nối lại rồi thử lại.', en: 'Core is offline. Reconnect and try again.' },
    EXTERNAL_UNAVAILABLE: { vi: 'Core hiện chưa phản hồi. Hãy thử lại.', en: 'Core is not responding yet. Try again.' },
    EXPECTED_VERSION_REQUIRED: { vi: 'Dữ liệu đã thay đổi; hãy tải lại workspace trước khi tiếp tục.', en: 'The data changed; reload the workspace before continuing.' },
    STALE_REVISION: { vi: 'Revision đã thay đổi; hãy tải lại workspace trước khi tiếp tục.', en: 'The revision changed; reload the workspace before continuing.' },
    IDEMPOTENCY_KEY_REUSE_CONFLICT: { vi: 'Mã yêu cầu đã được dùng cho dữ liệu khác. Hãy thử lại với thao tác mới.', en: 'That request key was already used for different data. Retry as a new action.' },
    NOT_FOUND: { vi: 'Bản ghi không còn tồn tại.', en: 'That record no longer exists.' },
    INVALID_ARGUMENT: { vi: 'Thông tin nhập chưa hợp lệ.', en: 'Some entered values are invalid.' },
  }
  return messages[cause.code]?.[locale] ?? (locale === 'vi' ? 'Core không thể ghi thay đổi này.' : 'Core could not save this change.')
}

export function ProjectPlanningView({ snapshot, projectId, locale, client, onBack, onWorkspaceChanged }: { snapshot: DashboardSnapshot; projectId: string; locale: Locale; client: CoreClient; onBack: () => void; onWorkspaceChanged?: (workspace: ProjectWorkspace) => void }) {
  const project = snapshot.projects.find((candidate) => candidate.id === projectId)
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null)
  const [activeTab, setActiveTab] = useState<'tasks' | 'shots' | 'notes' | 'activity' | 'context'>('tasks')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [staleMessage, setStaleMessage] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [shotCode, setShotCode] = useState('')
  const [shotTitle, setShotTitle] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [noteTarget, setNoteTarget] = useState(`PROJECT:${projectId}`)
  const [mutating, setMutating] = useState<string | null>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const mutationKeys = useRef(new Map<string, string>())

  useEffect(() => {
    if (!project || !client.getProjectWorkspace) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setStaleMessage(null)
    void client.getProjectWorkspace(project.id, controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setWorkspace(next)
        onWorkspaceChanged?.(next)
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(workspaceErrorMessage(cause, locale))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [client, project?.id, refreshToken, locale, onWorkspaceChanged])

  useEffect(() => {
    if (project) setNoteTarget(`PROJECT:${project.id}`)
  }, [project?.id])

  if (!project) return <div className="page"><ErrorState message={locale === 'vi' ? 'Không tìm thấy dự án.' : 'Project could not be found.'} retryLabel={locale === 'vi' ? 'Quay lại dự án' : 'Back to projects'} onRetry={onBack} /></div>

  const tasks = workspace?.tasks ?? []
  const shots = workspace?.shots ?? []
  const notes = workspace?.notes ?? []
  const workspaceHealth: ProjectSummary['health'] = workspace ? (tasks.some((task) => task.status === 'BLOCKED') ? 'attention' : project.health === 'blocked' ? 'blocked' : 'healthy') : project.health
  const tabs: Array<{ key: typeof activeTab; label: string; icon: typeof ListChecks }> = [
    { key: 'tasks', label: locale === 'vi' ? 'Công việc' : 'Tasks', icon: ListChecks },
    { key: 'shots', label: locale === 'vi' ? 'Shot kế hoạch' : 'Planning shots', icon: CircleDot },
    { key: 'notes', label: locale === 'vi' ? 'Ghi chú' : 'Notes', icon: BookOpen },
    { key: 'activity', label: locale === 'vi' ? 'Hoạt động' : 'Activity', icon: Activity },
    { key: 'context', label: locale === 'vi' ? 'Thông tin' : 'Context', icon: Info },
  ]

  const refresh = () => setRefreshToken((value) => value + 1)
  const runMutation = async (key: string, action: (idempotencyKey: string) => Promise<void>) => {
    if (mutating) return
    const idempotencyKey = mutationKeys.current.get(key) ?? crypto.randomUUID()
    mutationKeys.current.set(key, idempotencyKey)
    setMutating(key)
    setError(null)
    try {
      await action(idempotencyKey)
      mutationKeys.current.delete(key)
      setRefreshToken((value) => value + 1)
    } catch (cause: unknown) {
      if (cause instanceof CoreClientError && cause.code === 'STALE_REVISION') {
        setStaleMessage(locale === 'vi' ? 'Workspace đã thay đổi ở nơi khác. Bản nháp của bạn được giữ nguyên; hãy tải lại rồi thử lại.' : 'This workspace changed elsewhere. Your draft is preserved; refresh and retry.')
      } else {
        setError(workspaceErrorMessage(cause, locale))
      }
    } finally {
      setMutating(null)
    }
  }

  const createTask = (event: FormEvent) => {
    event.preventDefault()
    const title = taskTitle.trim()
    if (!title || !client.createTask) return
    void runMutation(`create-task:${title}:${taskDescription.trim()}`, async (idempotencyKey) => {
      await client.createTask!(project.id, title, { description: taskDescription.trim(), idempotencyKey })
      setTaskTitle('')
      setTaskDescription('')
    })
  }

  const createShot = (event: FormEvent) => {
    event.preventDefault()
    const code = shotCode.trim().toUpperCase()
    const title = shotTitle.trim()
    if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(code) || !title || !client.createShot) return
    void runMutation(`create-shot:${code}:${title}`, async (idempotencyKey) => {
      await client.createShot!(project.id, code, title, idempotencyKey)
      setShotCode('')
      setShotTitle('')
    })
  }

  const addNote = (event: FormEvent) => {
    event.preventDefault()
    const body = noteBody.trim()
    const separator = noteTarget.indexOf(':')
    const entityType = noteTarget.slice(0, separator) as 'PROJECT' | 'TASK' | 'SHOT'
    const entityId = noteTarget.slice(separator + 1)
    if (!body || !entityId || !client.addNote) return
    void runMutation(`add-note:${noteTarget}:${body}`, async (idempotencyKey) => {
      await client.addNote!(project.id, { entityType, entityId }, body, idempotencyKey)
      setNoteBody('')
    })
  }

  const updateTask = (task: TaskSummary, nextStatus: TaskStatus) => {
    if (!client.updateTask || nextStatus === task.status) return
    if (nextStatus === 'CANCELLED') {
      const confirmed = window.confirm(locale === 'vi' ? `Xác nhận huỷ công việc “${task.title}”? Trạng thái này không thể khôi phục.` : `Cancel “${task.title}”? This task state cannot be restored.`)
      if (!confirmed) return
    }
    void runMutation(`task-${task.id}:${nextStatus}:${task.rowVersion}`, async (idempotencyKey) => {
      await client.updateTask!(task.id, { status: nextStatus }, task.rowVersion, idempotencyKey)
    })
  }

  const updateShot = (shot: ShotSummary, nextState: ShotLifecycleState) => {
    if (!client.updateShot || nextState === shot.lifecycleState) return
    if (nextState === 'ARCHIVED' || nextState === 'TRASHED') {
      const confirmed = window.confirm(locale === 'vi' ? `Xác nhận chuyển ${shot.code} sang “${shotLifecycleLabels[nextState].vi}”? Thao tác này ảnh hưởng đến lifecycle của shot.` : `Move ${shot.code} to “${shotLifecycleLabels[nextState].en}”? This changes the shot lifecycle.`)
      if (!confirmed) return
    }
    void runMutation(`shot-${shot.id}:${nextState}:${shot.rowVersion}`, async (idempotencyKey) => {
      await client.updateShot!(shot.id, { lifecycleState: nextState }, shot.rowVersion, idempotencyKey)
    })
  }

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (event.key === 'Home') { event.preventDefault(); tabRefs.current[0]?.focus(); setActiveTab(tabs[0].key); return }
    if (event.key === 'End') { event.preventDefault(); tabRefs.current[tabs.length - 1]?.focus(); setActiveTab(tabs[tabs.length - 1].key); return }
    if (direction === 0) return
    event.preventDefault()
    const nextIndex = (index + direction + tabs.length) % tabs.length
    tabRefs.current[nextIndex]?.focus()
    setActiveTab(tabs[nextIndex].key)
  }

  const tabPanel = activeTab === 'tasks' ? <>
    <form className="workspace-form" onSubmit={createTask}>
      <div className="form-grid two"><label htmlFor="workspace-task-title">{locale === 'vi' ? 'Tên công việc' : 'Task title'}<input id="workspace-task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} maxLength={500} placeholder={locale === 'vi' ? 'Ví dụ: Chốt shot list' : 'For example: Lock the shot list'} /></label><label htmlFor="workspace-task-description">{locale === 'vi' ? 'Mô tả (tuỳ chọn)' : 'Description (optional)'}<input id="workspace-task-description" value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} maxLength={10000} placeholder={locale === 'vi' ? 'Điều cần nhớ…' : 'What should be remembered…'} /></label></div>
      <button className="primary-button small" disabled={!taskTitle.trim() || !client.createTask || Boolean(mutating) || loading || !workspace}>{mutating?.startsWith('create-task:') ? '…' : <><Plus size={14} />{locale === 'vi' ? 'Thêm công việc' : 'Add task'}</>}</button>
    </form>
    {tasks.length === 0 ? <EmptyInline icon={ListChecks} text={locale === 'vi' ? 'Chưa có công việc. Thêm một việc để bắt đầu lập kế hoạch.' : 'No tasks yet. Add one to start planning.'} /> : <div className="workspace-record-list">{tasks.map((task) => <div className="workspace-record" key={task.id}><div className="workspace-record-main"><strong>{task.title}</strong><small>{task.description || (locale === 'vi' ? 'Không có mô tả' : 'No description')} · v{task.rowVersion}</small></div><select aria-label={`${locale === 'vi' ? 'Trạng thái' : 'Status'}: ${task.title}`} value={task.status} disabled={!client.updateTask || Boolean(mutating) || loading} onChange={(event) => updateTask(task, event.target.value as TaskStatus)}>{[task.status, ...taskTransitions[task.status]].map((status) => <option key={status} value={status}>{locale === 'vi' ? taskStatusLabels[status].vi : taskStatusLabels[status].en}</option>)}</select></div>)}</div>}
  </> : activeTab === 'shots' ? <>
    <form className="workspace-form" onSubmit={createShot}><div className="form-grid two"><label htmlFor="workspace-shot-code">{locale === 'vi' ? 'Mã shot' : 'Shot code'}<input id="workspace-shot-code" value={shotCode} onChange={(event) => setShotCode(event.target.value.toUpperCase())} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" placeholder="SH010" required /></label><label htmlFor="workspace-shot-title">{locale === 'vi' ? 'Tên shot kế hoạch' : 'Planning shot title'}<input id="workspace-shot-title" value={shotTitle} onChange={(event) => setShotTitle(event.target.value)} maxLength={500} placeholder={locale === 'vi' ? 'Cửa mở' : 'Door opens'} required /></label></div><button className="primary-button small" disabled={!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(shotCode.trim()) || !shotTitle.trim() || !client.createShot || Boolean(mutating) || loading || !workspace}>{mutating?.startsWith('create-shot:') ? '…' : <><Plus size={14} />{locale === 'vi' ? 'Thêm shot kế hoạch' : 'Add planning shot'}</>}</button></form>
    <p className="workspace-boundary" role="note"><Info size={14} />{locale === 'vi' ? 'Đây là bản ghi lập kế hoạch và lifecycle. Nó chưa đại diện cho media đã render, review hoặc approval.' : 'This is a planning record and lifecycle only. It does not represent rendered, reviewed, or approved media.'}</p>
    {shots.length === 0 ? <EmptyInline icon={CircleDot} text={locale === 'vi' ? 'Chưa có shot kế hoạch.' : 'No planning shots yet.'} /> : <div className="workspace-record-list">{shots.map((shot) => <div className="workspace-record" key={shot.id}><div className="workspace-record-main"><strong><span className="record-code">{shot.code}</span>{shot.title}</strong><small>{locale === 'vi' ? 'Lifecycle' : 'Lifecycle'} · v{shot.rowVersion}</small></div><select aria-label={`${locale === 'vi' ? 'Lifecycle của' : 'Lifecycle for'} ${shot.code}`} value={shot.lifecycleState} disabled={!client.updateShot || Boolean(mutating) || loading} onChange={(event) => updateShot(shot, event.target.value as ShotLifecycleState)}>{[shot.lifecycleState, ...shotLifecycleTransitions[shot.lifecycleState]].map((state) => <option key={state} value={state}>{locale === 'vi' ? shotLifecycleLabels[state].vi : shotLifecycleLabels[state].en}</option>)}</select></div>)}</div>}
  </> : activeTab === 'notes' ? <>
    <form className="workspace-form" onSubmit={addNote}><label htmlFor="workspace-note-target">{locale === 'vi' ? 'Gắn ghi chú vào' : 'Attach note to'}<select id="workspace-note-target" value={noteTarget} onChange={(event) => setNoteTarget(event.target.value)}><option value={`PROJECT:${project.id}`}>{locale === 'vi' ? 'Dự án' : 'Project'} · {project.name}</option>{tasks.map((task) => <option key={`TASK:${task.id}`} value={`TASK:${task.id}`}>{locale === 'vi' ? 'Công việc' : 'Task'} · {task.title}</option>)}{shots.map((shot) => <option key={`SHOT:${shot.id}`} value={`SHOT:${shot.id}`}>{locale === 'vi' ? 'Shot' : 'Shot'} · {shot.code}</option>)}</select></label><label htmlFor="workspace-note-body">{locale === 'vi' ? 'Ghi chú' : 'Note'}<textarea id="workspace-note-body" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} maxLength={50000} rows={4} placeholder={locale === 'vi' ? 'Ghi lại điều cần nhớ…' : 'Capture what should be remembered…'} /></label><button className="primary-button small" disabled={!noteBody.trim() || !client.addNote || Boolean(mutating) || loading || !workspace}>{mutating?.startsWith('add-note:') ? '…' : <><Plus size={14} />{locale === 'vi' ? 'Thêm ghi chú' : 'Add note'}</>}</button></form>
    {notes.length === 0 ? <EmptyInline icon={BookOpen} text={locale === 'vi' ? 'Chưa có ghi chú. Ghi chú được giữ nguyên và không thể sửa xoá trong slice này.' : 'No notes yet. Notes are append-only in this slice.'} /> : <div className="workspace-note-list">{notes.map((note) => <NoteRecord key={note.id} note={note} tasks={tasks} shots={shots} locale={locale} />)}</div>}
  </> : activeTab === 'activity' ? <div className="workspace-activity-list"><ActivityView snapshot={{ ...snapshot, activity: snapshot.activity.filter((item) => item.projectId === project.id || item.projectName === project.name) }} locale={locale} onOpenProject={() => undefined} /></div> : <div className="workspace-context"><div><span>Project ID</span><code>{project.id}</code></div><div><span>{locale === 'vi' ? 'Công việc' : 'Tasks'}</span><strong>{tasks.length}</strong></div><div><span>{locale === 'vi' ? 'Shot kế hoạch' : 'Planning shots'}</span><strong>{shots.length}</strong></div><div><span>{locale === 'vi' ? 'Ghi chú' : 'Notes'}</span><strong>{notes.length}</strong></div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Workspace đọc từ Core. Mọi thay đổi đi qua command và giữ row version để phát hiện xung đột.' : 'Workspace is read from Core. Mutations go through commands and carry row versions for conflict detection.'}</p></div>

  return <div className="page project-detail-page"><button className="back-link" onClick={onBack}><ArrowRight size={15} className="back-arrow" />{locale === 'vi' ? 'Tất cả dự án' : 'All projects'}</button><div className="project-detail-heading"><div><p className="eyebrow">{project.kind}</p><h1>{project.name}</h1><p className="page-subtitle">{project.stage} · {project.stageDetail}</p></div><span className={`health-pill ${workspaceHealth}`}><span />{workspaceHealth === 'healthy' ? (locale === 'vi' ? 'Ổn định' : 'Healthy') : workspaceHealth === 'blocked' ? (locale === 'vi' ? 'Đang chặn' : 'Blocked') : (locale === 'vi' ? 'Cần chú ý' : 'Needs attention')}</span></div><div className="project-detail-grid"><section className="detail-summary-card"><div className="detail-cover" style={{ background: project.cover }}><div className="cover-noise" /><span className="cover-type">{project.kind}</span></div><div className="detail-summary-body"><div className="detail-stat"><span>{locale === 'vi' ? 'Công việc' : 'Tasks'}</span><strong>{tasks.length}</strong></div><div className="detail-stat"><span>{locale === 'vi' ? 'Shot kế hoạch' : 'Planning shots'}</span><strong>{shots.length}</strong></div><div className="detail-stat"><span>{locale === 'vi' ? 'Ghi chú' : 'Notes'}</span><strong>{notes.length}</strong></div><div className="detail-stat"><span>{locale === 'vi' ? 'Dung lượng' : 'Storage'}</span><strong>{project.storage}</strong></div></div></section><section className="production-card"><div className="production-card-heading"><div><h2>{locale === 'vi' ? 'Workspace sản xuất' : 'Production workspace'}</h2><p>{locale === 'vi' ? 'Task, shot kế hoạch và ghi chú là các bản ghi riêng biệt.' : 'Tasks, planning shots, and notes are separate records.'}</p></div><span className="state-label"><ShieldCheck size={13} />{locale === 'vi' ? 'Do Core quản lý' : 'Core-owned'}</span></div><div className="project-tabs" role="tablist" aria-label={locale === 'vi' ? 'Các phần của workspace' : 'Workspace sections'}>{tabs.map(({ key, label, icon: Icon }, index) => <button key={key} ref={(element) => { tabRefs.current[index] = element }} id={`workspace-tab-${key}`} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)} onKeyDown={(event) => onTabKeyDown(event, index)} role="tab" aria-selected={activeTab === key} aria-controls={activeTab === key ? `workspace-panel-${key}` : undefined} tabIndex={activeTab === key ? 0 : -1}><Icon size={14} />{label}</button>)}</div>{loading && <div className="inline-state" aria-live="polite"><RefreshCw size={14} className="spin" />{locale === 'vi' ? 'Đang đọc workspace từ Core…' : 'Reading workspace from Core…'}</div>}{staleMessage && <div className="inline-state warning stale-panel" role="alert" tabIndex={-1}><AlertCircle size={14} /><span>{staleMessage}</span><button className="subtle-button tiny" onClick={refresh}>{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button></div>}{error && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{error}</span><button className="subtle-button tiny" onClick={refresh}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}<div id={`workspace-panel-${activeTab}`} role="tabpanel" aria-labelledby={`workspace-tab-${activeTab}`} aria-busy={loading} className="workspace-panel">{loading && !workspace ? <div className="inline-state" aria-live="polite">{locale === 'vi' ? 'Đang chuẩn bị workspace…' : 'Preparing workspace…'}</div> : tabPanel}</div></section></div></div>
}

function NoteRecord({ note, tasks, shots, locale }: { note: NoteSummary; tasks: TaskSummary[]; shots: ShotSummary[]; locale: Locale }) {
  const target = note.entityType === 'PROJECT' ? (locale === 'vi' ? 'Dự án' : 'Project') : note.entityType === 'TASK' ? tasks.find((task) => task.id === note.entityId)?.title ?? (locale === 'vi' ? 'Công việc' : 'Task') : shots.find((shot) => shot.id === note.entityId)?.code ?? 'Shot'
  const parsedDate = note.createdAt ? new Date(note.createdAt) : null
  const renderedDate = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US') : '—'
  return <article className="workspace-note"><div className="workspace-note-meta"><span>{target}</span><time dateTime={note.createdAt}>{renderedDate}</time></div><p>{note.body}</p></article>
}

export function NeedsView({ snapshot, t, locale, onOpenDecision, onResolve, onDismiss, pendingId, decisionError, onRefresh }: { snapshot: DashboardSnapshot; t: Copy; locale: Locale; onOpenDecision: (decision: DecisionRequest) => void; onResolve: (decision: DecisionRequest, choiceId: string) => void; onDismiss: (decision: DecisionRequest) => void; pendingId: string | null; decisionError: { id: string; message: string } | null; onRefresh: () => void }) {
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">{t.needs}</p><h1>{t.needsYou}</h1><p className="page-subtitle">{t.needsHint}</p></div><div className="page-heading-actions"><button type="button" className="subtle-button tiny" onClick={onRefresh}><RefreshCw size={13} />{t.refresh}</button><span className="count-chip"><Inbox size={15} />{snapshot.decisions.length}</span></div></div><section className="needs-page-list">{snapshot.decisions.length === 0 ? <EmptyState icon={CheckCircle2} title={t.noDecisions} detail="" /> : snapshot.decisions.map((decision) => <DecisionCard key={decision.id} decision={decision} locale={locale} copy={t} onOpen={() => onOpenDecision(decision)} onResolve={(choiceId) => onResolve(decision, choiceId)} onDismiss={() => onDismiss(decision)} pending={pendingId === decision.id} error={decisionError?.id === decision.id ? decisionError.message : undefined} onRefresh={onRefresh} />)}</section></div>
}

function ActivityView({ snapshot, locale, onOpenProject }: { snapshot: DashboardSnapshot; locale: Locale; onOpenProject: (project: ProjectSummary) => void }) {
  const [filter, setFilter] = useState<'all' | WorkState>('all')
  const filters: Array<{ key: 'all' | WorkState; vi: string; en: string }> = [
    { key: 'all', vi: 'Tất cả', en: 'All' },
    { key: 'running', vi: 'Đang chạy', en: 'Running' },
    { key: 'needs_user', vi: 'Cần bạn', en: 'Needs you' },
    { key: 'complete', vi: 'Đã xong', en: 'Complete' },
    { key: 'blocked', vi: 'Đang chặn', en: 'Blocked' },
  ]
  const visible = filter === 'all' ? snapshot.activity : snapshot.activity.filter((item) => item.state === filter)
  return <div className="page activity-page"><div className="page-heading"><div><p className="eyebrow">{locale === 'vi' ? 'THEO DÕI' : 'MONITORING'}</p><h1>{locale === 'vi' ? 'Hoạt động' : 'Activity'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Trạng thái đọc từ Core, theo từng project. Không có tiến độ được dựng trong giao diện.' : 'State read from Core, grouped by project. The interface never invents progress.'}</p></div><span className="count-chip"><Activity size={15} />{snapshot.activity.length}</span></div><div className="activity-filter-row" role="tablist" aria-label={locale === 'vi' ? 'Lọc hoạt động' : 'Activity filters'}>{filters.map((item) => <button key={item.key} className={`filter-chip ${filter === item.key ? 'active' : ''}`} onClick={() => setFilter(item.key)} role="tab" aria-selected={filter === item.key}><Filter size={13} />{locale === 'vi' ? item.vi : item.en}</button>)}</div><section className="activity-page-list">{visible.length === 0 ? <EmptyState icon={CheckCircle2} title={locale === 'vi' ? 'Không có activity phù hợp' : 'No matching activity'} detail={locale === 'vi' ? 'Core chưa ghi nhận trạng thái trong bộ lọc này.' : 'Core has not recorded a state in this filter yet.'} /> : visible.map((item) => { const project = snapshot.projects.find((candidate) => candidate.id === item.projectId || candidate.name === item.projectName); return <ActivityRow key={item.id} item={item} locale={locale} onOpen={project ? () => onOpenProject(project) : undefined} /> })}</section></div>
}

type IntakeFile = {
  id: string
  name: string
  size: number
  type: string
  modifiedAt: number
  handle?: string
  importIdempotencyKey?: string
  stageState: 'preview' | 'staging' | 'ready' | 'error'
  stageError?: string
}

function LibraryView({ snapshot, locale, client, onOpenProject }: { snapshot: DashboardSnapshot; locale: Locale; client: CoreClient; onOpenProject: (project: ProjectSummary) => void }) {
  const [stagedFiles, setStagedFiles] = useState<IntakeFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetsError, setAssetsError] = useState<string | null>(null)
  const [sourcePath, setSourcePath] = useState('')
  const [projectId, setProjectId] = useState(() => snapshot.projects[0]?.id ?? '')
  const [isImporting, setIsImporting] = useState(false)
  const [importingFileId, setImportingFileId] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const records = snapshot.projects.flatMap((project) => (project.productionItems ?? []).map((item) => ({ project, item })))

  useEffect(() => {
    if (!projectId && snapshot.projects[0]) setProjectId(snapshot.projects[0].id)
  }, [projectId, snapshot.projects])

  const loadAssets = useCallback(async (signal?: AbortSignal) => {
    if (!client.getAssets) return
    setAssetsLoading(true)
    setAssetsError(null)
    try {
      setAssets(await client.getAssets(undefined, signal))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setAssetsError(error instanceof Error ? error.message : (locale === 'vi' ? 'Không đọc được asset.' : 'Could not read assets.'))
    } finally {
      if (!signal?.aborted) setAssetsLoading(false)
    }
  }, [client, locale])

  useEffect(() => {
    const controller = new AbortController()
    void loadAssets(controller.signal)
    return () => controller.abort()
  }, [loadAssets])

  const connected = snapshot.system.connected && !snapshot.system.offline && (client.isLive?.() ?? true) && Boolean(client.importAsset)

  const stageFiles = async (fileList: FileList | null) => {
    if (!fileList) return
    const files = Array.from(fileList)
    const next = files.map((file) => ({
      // A browser intentionally does not expose a stable local path. A UUID
      // keeps two same-sized files with the same name independently actionable
      // in the intake queue and avoids accidental client-side deduplication.
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      modifiedAt: file.lastModified,
      importIdempotencyKey: crypto.randomUUID(),
      stageState: connected && client.stageAsset ? 'staging' as const : 'preview' as const,
    }))
    setStagedFiles((current) => dedupeIntakeFiles([...current, ...next]))
    if (!connected || !client.stageAsset) return
    for (const [index, file] of files.entries()) {
      const id = next[index].id
      try {
        const staged = await client.stageAsset(file)
        setStagedFiles((current) => current.map((item) => item.id === id ? { ...item, handle: staged.handle, name: staged.name, size: staged.byteSize, type: staged.mimeType || item.type, stageState: 'ready', stageError: undefined } : item))
      } catch (error) {
        const message = error instanceof Error ? error.message : (locale === 'vi' ? 'Không stage được file.' : 'Could not stage file.')
        setStagedFiles((current) => current.map((item) => item.id === id ? { ...item, stageState: 'error', stageError: message } : item))
      }
    }
  }

  const importStagedFile = async (file: IntakeFile) => {
    if (!file.handle || !client.importAsset || !connected || isImporting) return
    setImportingFileId(file.id)
    setImportError(null)
    try {
      const imported = await client.importAsset({ sourceHandle: file.handle, projectId: projectId || undefined, originalName: file.name, mimeType: file.type, storageMode: 'COPY', idempotencyKey: file.importIdempotencyKey })
      setAssets((current) => [imported, ...current.filter((asset) => asset.id !== imported.id)])
      setStagedFiles((current) => current.filter((item) => item.id !== file.id))
    } catch (error) {
      setImportError(error instanceof Error ? error.message : (locale === 'vi' ? 'Import asset thất bại.' : 'Asset import failed.'))
    } finally {
      setImportingFileId(null)
    }
  }

  const submitImport = async (event: FormEvent) => {
    event.preventDefault()
    const cleanPath = sourcePath.trim()
    if (!cleanPath || !client.importAsset || !snapshot.system.connected || snapshot.system.offline || isImporting) return
    setIsImporting(true)
    setImportError(null)
    try {
      const imported = await client.importAsset({ sourcePath: cleanPath, projectId: projectId || undefined })
      setAssets((current) => [imported, ...current.filter((asset) => asset.id !== imported.id)])
      setSourcePath('')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : (locale === 'vi' ? 'Import asset thất bại.' : 'Asset import failed.'))
    } finally {
      setIsImporting(false)
    }
  }

  return <div className="page library-page">
    <div className="page-heading"><div><p className="eyebrow">{locale === 'vi' ? 'NGUỒN & TÀI SẢN' : 'SOURCES & ASSETS'}</p><h1>{locale === 'vi' ? 'Thư viện & intake' : 'Library & intake'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Hash, provenance và trạng thái asset do Core xác nhận trước khi ghi vào workspace.' : 'Core verifies hash, provenance, and asset state before writing to the workspace.'}</p></div><label className="primary-button file-picker"><FilePlus2 size={16} />{locale === 'vi' ? 'Chọn file' : 'Choose files'}<input type="file" multiple onChange={(event) => { void stageFiles(event.target.files); event.currentTarget.value = '' }} /></label></div>
    <div className="library-grid">
      <section className="library-intake-card">
        <div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><UploadCloud size={16} /></span><div><h2>{locale === 'vi' ? 'Intake cục bộ' : 'Local intake'}</h2><p>{locale === 'vi' ? 'Chọn file, stage qua bootstrap local rồi xác nhận import vào Core.' : 'Choose files, stage them through the local bootstrap, then confirm the Core import.'}</p></div></div><span className="state-label"><ShieldCheck size={13} />{connected ? (locale === 'vi' ? 'Core sẵn sàng' : 'Core ready') : (locale === 'vi' ? 'Chỉ xem' : 'Read only')}</span></div>
        <div className={`intake-dropzone ${isDragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); void stageFiles(event.dataTransfer.files) }}><FilePlus2 size={21} /><strong>{locale === 'vi' ? 'Kéo file vào đây hoặc dùng “Chọn file”' : 'Drop files here or use “Choose files”'}</strong><span>{locale === 'vi' ? 'File được stage an toàn qua bootstrap local; browser chỉ nhận handle tạm thời, không nhận đường dẫn thật.' : 'Files are staged through the local bootstrap; the browser receives only a temporary handle, never the raw path.'}</span></div>
        {stagedFiles.length === 0 ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Chưa có file nào được chọn.' : 'No files staged yet.'} /> : <div className="intake-list">{stagedFiles.map((file) => <div className="intake-row" key={file.id}><span className="intake-file-icon"><FileIcon size={15} /></span><div><strong>{file.name}</strong><small>{formatBytes(file.size)} · {file.type}{file.stageError ? ` · ${file.stageError}` : ''}</small></div><span className={`intake-status ${file.stageState}`}>{file.stageState === 'staging' ? (locale === 'vi' ? 'Đang stage…' : 'Staging…') : file.stageState === 'ready' ? (locale === 'vi' ? 'Sẵn sàng import' : 'Ready to import') : file.stageState === 'error' ? (locale === 'vi' ? 'Lỗi stage' : 'Staging failed') : (locale === 'vi' ? 'Chỉ xem trước' : 'Preview only')}</span>{file.stageState === 'ready' && <button type="button" className="subtle-button tiny" disabled={importingFileId === file.id || isImporting} onClick={() => void importStagedFile(file)}>{importingFileId === file.id ? (locale === 'vi' ? 'Đang import…' : 'Importing…') : (locale === 'vi' ? 'Import' : 'Import')}</button>}<button type="button" className="icon-button ghost" onClick={() => setStagedFiles((current) => current.filter((candidate) => candidate.id !== file.id))} aria-label={locale === 'vi' ? `Bỏ ${file.name}` : `Remove ${file.name}`}><X size={14} /></button></div>)}</div>}
        <form className="asset-import-form" onSubmit={submitImport}><label>{locale === 'vi' ? 'Đường dẫn file local (nâng cao)' : 'Local file path (advanced)'}<input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder={String.raw`C:\Projects\film\shot-010.png`} disabled={!connected} /></label><label>{locale === 'vi' ? 'Gắn vào project' : 'Attach to project'}<select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={!connected || snapshot.projects.length === 0}><option value="">{locale === 'vi' ? 'Studio-wide asset' : 'Studio-wide asset'}</option>{snapshot.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><button className="primary-button small" type="submit" disabled={!sourcePath.trim() || !connected || isImporting}><UploadCloud size={15} />{isImporting ? (locale === 'vi' ? 'Đang hash…' : 'Hashing…') : (locale === 'vi' ? 'Import đường dẫn' : 'Import path')}</button></form>
        {importError && <div className="inline-state warning"><AlertCircle size={14} />{importError}</div>}
        <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Import thành công chỉ được hiển thị sau khi Core trả về hash, object location và provenance. File không được tự chạy.' : 'An import is shown only after Core returns a hash, object location, and provenance. Files are never executed automatically.'}</p>
      </section>
      <section className="library-records-card">
        <div className="card-heading"><div className="card-title-with-icon"><span className="card-icon amber"><Database size={16} /></span><div><h2>{locale === 'vi' ? 'Asset đã nhập' : 'Imported assets'}</h2><p>{locale === 'vi' ? 'Bản ghi canonical từ Core, không đọc trực tiếp SQLite.' : 'Canonical Core records; the UI never reads SQLite directly.'}</p></div></div><div className="card-heading-actions"><button type="button" className="subtle-button tiny" onClick={() => void loadAssets()}><RefreshCw size={13} />{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button><span className="count-chip">{assets.length}</span></div></div>
        {assetsLoading ? <div className="inline-state"><RefreshCw size={14} className="spin" />{locale === 'vi' ? 'Đang đọc asset…' : 'Loading assets…'}</div> : assetsError ? <div className="inline-state warning"><AlertCircle size={14} />{assetsError}</div> : assets.length === 0 ? <EmptyState icon={Database} title={locale === 'vi' ? 'Chưa có asset' : 'No imported assets'} detail={locale === 'vi' ? 'Dán đường dẫn local và gửi command ImportAsset để bắt đầu.' : 'Paste a local path and send ImportAsset command to begin.'} /> : <div className="library-record-list">{assets.map((asset) => { const project = snapshot.projects.find((candidate) => candidate.id === asset.projectId); const readinessLabel = asset.readinessState === 'READY' ? (locale === 'vi' ? 'Đã kiểm tra' : 'Verified') : asset.readinessState === 'REVIEW_REQUIRED' ? (locale === 'vi' ? 'Cần review' : 'Review required') : (locale === 'vi' ? 'Chờ kiểm tra' : 'Readiness unknown'); const rightsStatus = asset.rights?.status ?? 'UNKNOWN'; const rightsLabel = rightsStatus === 'ALLOWED' ? (locale === 'vi' ? 'Quyền đã cho phép' : 'Rights allowed') : rightsStatus === 'RESTRICTED' ? (locale === 'vi' ? 'Quyền bị giới hạn' : 'Rights restricted') : rightsStatus === 'REVOKED' ? (locale === 'vi' ? 'Quyền đã thu hồi' : 'Rights revoked') : rightsStatus === 'EXPIRED' ? (locale === 'vi' ? 'Quyền hết hạn' : 'Rights expired') : (locale === 'vi' ? 'Quyền chưa xác minh' : 'Rights unknown'); return <div className="library-record asset-record" key={asset.id}><span className="record-state done"><FileIcon size={14} /></span><span className="library-record-main"><strong>{asset.name}</strong><small>{project?.name ?? (locale === 'vi' ? 'Studio-wide' : 'Studio-wide')} · {asset.assetType} · {formatBytes(asset.byteSize)} · {asset.contentHash?.slice(0, 12) ?? 'hash—'}</small></span><span className={`item-state ${asset.readinessState === 'READY' ? 'ready' : 'attention'}`} title={asset.availability === 'AVAILABLE' ? (locale === 'vi' ? 'Object đã lưu; readiness vẫn cần bằng chứng verifier.' : 'Object is stored; readiness still requires verifier evidence.') : asset.availability}>{readinessLabel}</span><span className={`item-state ${rightsStatus === 'ALLOWED' ? 'ready' : 'attention'}`} title={asset.rights?.blockers?.map((blocker) => String(blocker.code ?? '')).filter(Boolean).join(', ') || rightsLabel}>{rightsLabel}</span></div> })}</div>}
      </section>
      <section className="library-records-card library-production-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><ListChecks size={16} /></span><div><h2>{locale === 'vi' ? 'Mốc production' : 'Production records'}</h2><p>{locale === 'vi' ? 'Các mốc công việc đã được Core lưu trong project.' : 'Production milestones already saved by Core.'}</p></div></div><span className="count-chip">{records.length}</span></div>{records.length === 0 ? <EmptyState icon={ListChecks} title={locale === 'vi' ? 'Chưa có mốc' : 'No records yet'} detail={locale === 'vi' ? 'Tạo project rồi thêm production item để thấy dữ liệu ở đây.' : 'Create a project and add a production item to see data here.'} /> : <div className="library-record-list">{records.map(({ project, item }) => <button className="library-record" key={`${project.id}-${item.id}`} onClick={() => onOpenProject(project)}><span className={`record-state ${item.state}`}><CircleDot size={14} /></span><span className="library-record-main"><strong>{item.title}</strong><small>{project.name} · {item.detail}</small></span><span className={`item-state ${item.state}`}>{productionItemLabel(item.state, locale)}</span><ArrowRight size={14} /></button>)}</div>}</section>
    </div>
  </div>
}

function characterRevisionMeta(revision: CharacterRevision, locale: Locale) {
  const parts = [revision.state]
  if (revision.canonicalLanguage) parts.push(revision.canonicalLanguage)
  if (revision.rightsStatus) parts.push(`${locale === 'vi' ? 'quyền' : 'rights'} ${revision.rightsStatus}`)
  if (revision.readinessState) parts.push(revision.readinessState)
  return parts.join(' · ')
}

export function CharactersView({ snapshot, locale, client, onToast }: { snapshot: DashboardSnapshot; locale: Locale; client: CoreClient; onToast: (message: string) => void }) {
  const [projectId, setProjectId] = useState(() => snapshot.projects[0]?.id ?? '')
  const [characters, setCharacters] = useState<CharacterSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<CharacterSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createNeedsUser, setCreateNeedsUser] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [stableCode, setStableCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [revisionKind, setRevisionKind] = useState<CharacterRevisionKind>('visual')
  const [revisionDescription, setRevisionDescription] = useState('')
  const [revisionLanguage, setRevisionLanguage] = useState('vi-VN')
  const [revisionPending, setRevisionPending] = useState(false)
  const createIntentRef = useRef<{ fingerprint: string; key: string } | null>(null)
  const revisionIntentRef = useRef<{ fingerprint: string; key: string } | null>(null)
  const characterLoadGenerationRef = useRef(0)
  const workspaceLoadGenerationRef = useRef(0)

  useEffect(() => {
    if (!projectId && snapshot.projects[0]) setProjectId(snapshot.projects[0].id)
  }, [projectId, snapshot.projects])

  const loadCharacters = useCallback(async (signal?: AbortSignal) => {
    const generation = ++characterLoadGenerationRef.current
    if (!client.getCharacters) {
      setCharacters([])
      setError(locale === 'vi' ? 'Core chưa cung cấp không gian nhân vật.' : 'Core does not expose the character workspace yet.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await client.getCharacters(projectId || undefined, signal)
      if (signal?.aborted || generation !== characterLoadGenerationRef.current) return
      setCharacters(next)
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null)
    } catch (cause) {
      if ((cause instanceof DOMException && cause.name === 'AbortError') || generation !== characterLoadGenerationRef.current) return
      setError(workspaceErrorMessage(cause, locale))
      setCharacters([])
      setSelectedId(null)
    } finally {
      if (!signal?.aborted && generation === characterLoadGenerationRef.current) setLoading(false)
    }
  }, [client, locale, projectId])

  useEffect(() => {
    const controller = new AbortController()
    void loadCharacters(controller.signal)
    return () => controller.abort()
  }, [loadCharacters])

  const loadWorkspace = useCallback(async (characterId: string, signal?: AbortSignal) => {
    const generation = ++workspaceLoadGenerationRef.current
    setSelectedId(characterId)
    if (!client.getCharacterWorkspace) {
      setWorkspace(characters.find((item) => item.id === characterId) ?? null)
      setWorkspaceError(locale === 'vi' ? 'Core chưa cung cấp chi tiết nhân vật.' : 'Core does not expose character details yet.')
      return
    }
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      const next = await client.getCharacterWorkspace(characterId, signal)
      if (signal?.aborted || generation !== workspaceLoadGenerationRef.current) return
      setWorkspace(next.character)
    } catch (cause) {
      if ((cause instanceof DOMException && cause.name === 'AbortError') || generation !== workspaceLoadGenerationRef.current) return
      setWorkspaceError(workspaceErrorMessage(cause, locale))
      setWorkspace(characters.find((item) => item.id === characterId) ?? null)
    } finally {
      if (!signal?.aborted && generation === workspaceLoadGenerationRef.current) setWorkspaceLoading(false)
    }
  }, [characters, client, locale])

  useEffect(() => {
    if (!selectedId) {
      setWorkspace(null)
      return
    }
    const controller = new AbortController()
    void loadWorkspace(selectedId, controller.signal)
    return () => controller.abort()
  }, [loadWorkspace, selectedId])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName || !projectId || !client.createCharacter || creating) return
    setCreating(true)
    setCreateError(null)
    setCreateNeedsUser(false)
    const createFingerprint = `${projectId}\u001f${cleanName}\u001f${stableCode.trim()}`
    if (!createIntentRef.current || createIntentRef.current.fingerprint !== createFingerprint) {
      createIntentRef.current = { fingerprint: createFingerprint, key: `character-create:${crypto.randomUUID()}` }
    }
    try {
      const created = await client.createCharacter(projectId, cleanName, stableCode.trim() || undefined, createIntentRef.current.key)
      setCharacters((current) => [created, ...current.filter((item) => item.id !== created.id)])
      setSelectedId(created.id)
      setName('')
      setStableCode('')
      createIntentRef.current = null
      onToast(locale === 'vi' ? `Đã tạo nhân vật “${created.displayName}”.` : `Character “${created.displayName}” created.`)
    } catch (cause) {
      setCreateNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setCreateError(workspaceErrorMessage(cause, locale))
    } finally {
      setCreating(false)
    }
  }

  const createRevision = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedId || !revisionDescription.trim() || revisionPending) return
    const action = revisionKind === 'visual' ? client.createVisualIdentityRevision : revisionKind === 'voice' ? client.createVoiceIdentityRevision : client.createPerformanceBibleRevision
    if (!action) {
      setWorkspaceError(locale === 'vi' ? 'Core chưa cung cấp command revision này.' : 'Core does not expose this revision command yet.')
      return
    }
    setRevisionPending(true)
    setWorkspaceError(null)
    try {
      const input = revisionKind === 'voice'
        ? { semanticDescription: revisionDescription.trim(), canonicalLanguage: revisionLanguage.trim() || 'vi-VN' }
        : { semanticDescription: revisionDescription.trim() }
      const revisionFingerprint = `${selectedId}\u001f${revisionKind}\u001f${revisionDescription.trim()}\u001f${revisionLanguage.trim() || 'vi-VN'}`
      if (!revisionIntentRef.current || revisionIntentRef.current.fingerprint !== revisionFingerprint) {
        revisionIntentRef.current = { fingerprint: revisionFingerprint, key: `character-${revisionKind}-revision:${crypto.randomUUID()}` }
      }
      await action(selectedId, input, revisionIntentRef.current.key)
      setRevisionDescription('')
      revisionIntentRef.current = null
      await loadWorkspace(selectedId)
      onToast(locale === 'vi' ? 'Đã lưu revision. Revision mới vẫn cần bước phê duyệt riêng.' : 'Revision saved. Approval remains a separate step.')
    } catch (cause) {
      const needsUser = cause instanceof CoreClientError && cause.needsUser
      setWorkspaceError(needsUser ? (locale === 'vi' ? 'Core cần bạn bổ sung quyền hoặc xử lý xung đột trước khi lưu.' : 'Core needs your rights or conflict decision before it can save this revision.') : cause instanceof Error ? cause.message : (locale === 'vi' ? 'Không lưu được revision.' : 'Revision could not be saved.'))
    } finally {
      setRevisionPending(false)
    }
  }

  const selected = workspace ?? characters.find((item) => item.id === selectedId) ?? null
  const packageRows: Array<{ key: CharacterRevisionKind; label: string; package: CharacterSummary['visualIdentityPackage'] }> = [
    { key: 'visual', label: locale === 'vi' ? 'Visual identity' : 'Visual identity', package: selected?.visualIdentityPackage ?? null },
    { key: 'voice', label: locale === 'vi' ? 'Voice identity' : 'Voice identity', package: selected?.voiceIdentityPackage ?? null },
    { key: 'performance', label: locale === 'vi' ? 'Performance bible' : 'Performance bible', package: selected?.performanceBible ?? null },
  ]
  const connected = snapshot.system.connected && !snapshot.system.offline && (client.isLive?.() ?? true)

  return <div className="page characters-page">
    <div className="page-heading"><div><p className="eyebrow">{locale === 'vi' ? 'CANON' : 'CANON'}</p><h1>{locale === 'vi' ? 'Nhân vật' : 'Characters'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Identity, visual, voice và performance được giữ thành các revision tách biệt do Core quản lý.' : 'Identity, visual, voice and performance remain separate Core-owned revisions.'}</p></div><div className="page-heading-actions"><button className="subtle-button tiny" onClick={() => void loadCharacters()}><RefreshCw size={13} />{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button><span className="count-chip"><UserRound size={15} />{characters.length}</span></div></div>
    {!connected && <div className="inline-state warning"><CloudOff size={14} /><span>{locale === 'vi' ? 'Core đang offline. Bạn có thể xem snapshot cục bộ; thay đổi canonical cần kết nối Core.' : 'Core is offline. You can view the local snapshot; canonical changes require Core.'}</span></div>}
     <div className="characters-grid">
      <section className="workspace-panel characters-list-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><UserRound size={16} /></span><div><h2>{locale === 'vi' ? 'Danh sách nhân vật' : 'Character list'}</h2><p>{locale === 'vi' ? 'Chọn project để xem canon.' : 'Choose a project to view canon.'}</p></div></div><select className="character-project-select" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSelectedId(null); setWorkspace(null); setWorkspaceError(null); setCreateError(null); setCreateNeedsUser(false) }} aria-label={locale === 'vi' ? 'Project nhân vật' : 'Character project'}><option value="">{locale === 'vi' ? 'Toàn workspace' : 'All projects'}</option>{snapshot.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></div>{loading ? <LoadingState label={locale === 'vi' ? 'Đang đọc nhân vật từ Core…' : 'Reading characters from Core…'} /> : error ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{error}</span><button className="subtle-button tiny" onClick={() => void loadCharacters()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div> : characters.length === 0 ? <EmptyState icon={UserRound} title={locale === 'vi' ? 'Chưa có nhân vật' : 'No characters yet'} detail={locale === 'vi' ? 'Tạo CharacterIdentity đầu tiên. Các package sẽ được thêm bằng revision riêng.' : 'Create the first CharacterIdentity. Packages are added as separate revisions.'} /> : <div className="workspace-record-list">{characters.map((character) => <button type="button" className={`character-row ${selectedId === character.id ? 'active' : ''}`} key={character.id} onClick={() => setSelectedId(character.id)}><span className="character-avatar"><UserRound size={15} /></span><span className="workspace-record-main"><strong>{character.displayName}</strong><small>{character.stableCode ?? character.id} · {character.lifecycleState}</small></span><span className="record-code">v{character.rowVersion}</span><ArrowRight size={14} /></button>)}</div>}
         <form className="workspace-form character-create-form" onSubmit={create}><div className="form-grid two"><label>{locale === 'vi' ? 'Tên nhân vật' : 'Character name'}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={locale === 'vi' ? 'Ví dụ: Mai' : 'For example: Mai'} disabled={!connected || creating} /></label><label>{locale === 'vi' ? 'Mã ổn định (tuỳ chọn)' : 'Stable code (optional)'}<input value={stableCode} onChange={(event) => setStableCode(event.target.value)} placeholder="MAYA" disabled={!connected || creating} /></label></div><button className="primary-button small" type="submit" disabled={!connected || !projectId || !name.trim() || creating || !client.createCharacter}>{creating ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}{locale === 'vi' ? 'Tạo CharacterIdentity' : 'Create CharacterIdentity'}</button>{createError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{createError}</span>{createNeedsUser && <small>{locale === 'vi' ? 'Danh sách hiện tại vẫn được giữ nguyên; xử lý mục cần bạn rồi thử lại.' : 'The current list stays intact; resolve the requested action and retry.'}</small>}</div>}</form>
      </section>
      <section className="workspace-panel character-detail-card">{!selected ? <EmptyState icon={Info} title={locale === 'vi' ? 'Chọn một nhân vật' : 'Select a character'} detail={locale === 'vi' ? 'Workspace chi tiết sẽ xuất hiện sau khi Core xác nhận identity.' : 'The detailed workspace appears after Core confirms the identity.'} /> : <><div className="production-card-heading"><div><p className="eyebrow">{selected.stableCode ?? 'CHARACTER'}</p><h2>{selected.displayName}</h2><p>{selected.lifecycleState} · v{selected.rowVersion}</p></div><span className="state-label"><ShieldCheck size={13} />{locale === 'vi' ? 'Core-owned' : 'Core-owned'}</span></div>{workspaceLoading && <div className="inline-state"><RefreshCw size={14} className="spin" />{locale === 'vi' ? 'Đang đọc workspace…' : 'Reading workspace…'}</div>}{workspaceError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{workspaceError}</span><button className="subtle-button tiny" onClick={() => void loadWorkspace(selected.id)}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}{selected.needsYou.length > 0 && <div className="inline-state warning"><UserRound size={14} /><span>{locale === 'vi' ? `Core cần bạn xử lý ${selected.needsYou.length} mục trước khi tiếp tục.` : `Core needs you to resolve ${selected.needsYou.length} item${selected.needsYou.length === 1 ? '' : 's'} before continuing.`}</span></div>}<div className="character-package-grid">{packageRows.map(({ key, label, package: packageValue }) => <div className="character-package" key={key}><div className="character-package-heading"><strong>{label}</strong><span>{packageValue?.candidateRevisions.length ?? 0} {locale === 'vi' ? 'candidate' : 'candidates'}</span></div>{packageValue?.approvedRevision && <div className="revision-row approved"><CheckCircle2 size={13} /><span><strong>{locale === 'vi' ? 'Đã duyệt' : 'Approved'}</strong><small>{packageValue.approvedRevision.id} · {characterRevisionMeta(packageValue.approvedRevision, locale)}</small></span></div>}{packageValue?.candidateRevisions.map((revision) => <div className="revision-row" key={revision.id}><CircleDot size={13} /><span><strong>{revision.id}</strong><small>{characterRevisionMeta(revision, locale)}</small></span></div>)}{!packageValue?.approvedRevision && !packageValue?.candidateRevisions.length && <span className="character-package-empty">{locale === 'vi' ? 'Chưa có revision' : 'No revision yet'}</span>}</div>)}</div><form className="workspace-form character-revision-form" onSubmit={createRevision}><div className="form-grid two"><label>{locale === 'vi' ? 'Loại revision' : 'Revision type'}<select value={revisionKind} onChange={(event) => setRevisionKind(event.target.value as CharacterRevisionKind)} disabled={!connected || revisionPending}><option value="visual">Visual identity</option><option value="voice">Voice identity</option><option value="performance">Performance bible</option></select></label>{revisionKind === 'voice' && <label>{locale === 'vi' ? 'Ngôn ngữ chuẩn' : 'Canonical language'}<input value={revisionLanguage} onChange={(event) => setRevisionLanguage(event.target.value)} disabled={!connected || revisionPending} /></label>}</div><label>{locale === 'vi' ? 'Mô tả semantic' : 'Semantic description'}<textarea value={revisionDescription} onChange={(event) => setRevisionDescription(event.target.value)} rows={3} placeholder={locale === 'vi' ? 'Mô tả có thể kiểm tra; không chèn provider id.' : 'Bounded, reviewable description; do not enter provider ids.'} disabled={!connected || revisionPending} /></label><button className="primary-button small" type="submit" disabled={!connected || !revisionDescription.trim() || revisionPending}>{revisionPending ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}{locale === 'vi' ? 'Lưu revision nháp' : 'Save draft revision'}</button></form><p className="workspace-boundary"><Info size={14} />{locale === 'vi' ? 'Revision nháp không tự động được approve, bind voice, generate hay pin vào shot.' : 'Draft revisions are not auto-approved, voice-bound, generated, or pinned to a shot.'}</p></>}</section>
    </div>
  </div>
}

function SettingsView({ snapshot, locale, theme, onThemeChange, onLocaleChange, onRefresh, refreshLabel }: { snapshot: DashboardSnapshot; locale: Locale; theme: Theme; onThemeChange: (theme: Theme) => void; onLocaleChange: (locale: Locale) => void; onRefresh: () => void; refreshLabel: string }) {
  const connected = snapshot.system.connected && !snapshot.system.offline
  const backupStateLabel = formatBackupState(snapshot.system.backupState, locale)
  const backupAtLabel = snapshot.system.backupAt ? formatRelativeSnapshot(snapshot.system.backupAt, locale) : null
  return <div className="page settings-page"><div className="page-heading"><div><p className="eyebrow">{locale === 'vi' ? 'HỆ THỐNG' : 'SYSTEM'}</p><h1>{locale === 'vi' ? 'Cài đặt' : 'Settings'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Các tuỳ chọn hiển thị ở đây; dữ liệu canonical vẫn thuộc quyền của Core.' : 'Display preferences live here; canonical data remains owned by Core.'}</p></div><button className="subtle-button" onClick={onRefresh}><RefreshCw size={15} />{refreshLabel}</button></div><div className="settings-grid"><section className="settings-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><Settings2 size={16} /></span><div><h2>{locale === 'vi' ? 'Giao diện' : 'Appearance'}</h2><p>{locale === 'vi' ? 'Lưu cục bộ trên máy này.' : 'Saved locally on this machine.'}</p></div></div></div><div className="setting-row"><div><strong>{locale === 'vi' ? 'Giao diện màu' : 'Theme'}</strong><small>{theme === 'dark' ? (locale === 'vi' ? 'Tối' : 'Dark') : (locale === 'vi' ? 'Sáng' : 'Light')}</small></div><button className="toggle-button" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')} aria-label={locale === 'vi' ? 'Đổi giao diện' : 'Toggle theme'}><span className={theme === 'dark' ? 'on' : ''} /></button></div><div className="setting-row"><div><strong>{locale === 'vi' ? 'Ngôn ngữ' : 'Language'}</strong><small>{locale === 'vi' ? 'Tiếng Việt' : 'English'}</small></div><button className="locale-button bordered" onClick={() => onLocaleChange(locale === 'vi' ? 'en' : 'vi')}><Languages size={14} />{locale === 'vi' ? 'VI' : 'EN'}</button></div></section><section className="settings-card"><div className="card-heading"><div className="card-title-with-icon"><span className={`card-icon ${connected ? 'green' : 'amber'}`}><Database size={16} /></span><div><h2>{locale === 'vi' ? 'Core & dữ liệu' : 'Core & data'}</h2><p>{locale === 'vi' ? 'Thông tin kết nối đọc từ dashboard gần nhất.' : 'Connection details from the latest dashboard.'}</p></div></div><span className={`health-pill ${connected ? 'healthy' : 'attention'}`}><span />{connected ? (locale === 'vi' ? 'Đã kết nối' : 'Connected') : (locale === 'vi' ? 'Cần kiểm tra' : 'Check connection')}</span></div><div className="system-facts"><div><span>{locale === 'vi' ? 'Kết nối' : 'Connection'}</span><strong>{connected ? (locale === 'vi' ? 'Loopback local' : 'Local loopback') : (locale === 'vi' ? 'Offline' : 'Offline')}</strong></div><div><span>{locale === 'vi' ? 'Dung lượng đã dùng' : 'Storage used'}</span><strong>{snapshot.system.storageUsed}</strong></div><div><span>{locale === 'vi' ? 'Tổng dung lượng' : 'Storage total'}</span><strong>{snapshot.system.storageTotal}</strong></div><div><span>{locale === 'vi' ? 'Backup gần nhất' : 'Latest backup'}</span><strong>{backupStateLabel}{backupAtLabel ? ` · ${backupAtLabel}` : ''}</strong></div><div><span>{locale === 'vi' ? 'Snapshot gần nhất' : 'Latest snapshot'}</span><strong>{formatRelativeSnapshot(snapshot.generatedAt, locale)}</strong></div>{snapshot.system.storagePressure && <div><span>{locale === 'vi' ? 'Dung lượng dự phòng' : 'Storage reserve'}</span><strong>{locale === 'vi' ? 'Cần xử lý' : 'Needs attention'}</strong></div>}</div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Cài đặt này không thay đổi quyền, RLS hoặc dữ liệu. Mọi command quan trọng vẫn cần Core xác nhận.' : 'These settings do not change permissions, RLS, or data. Important commands still require Core confirmation.'}</p></section></div></div>
}

function ProjectCard({ project, locale, onOpen }: { project: ProjectSummary; locale: Locale; onOpen: () => void }) {
  return <article className="project-card" onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() } }} role="button" tabIndex={0}><div className="project-card-cover" style={{ background: project.cover }}><div className="cover-noise" /><span className="cover-type">{project.kind}</span><span className={`cover-health ${project.health}`}><span /></span></div><div className="project-card-body"><div className="project-card-top"><div><h3>{project.name}</h3><p>{project.stage} <span>·</span> {project.stageDetail}</p></div><span className="icon-button ghost" aria-hidden="true"><MoreHorizontal size={17} /></span></div><div className="mini-progress-row"><span>{project.completion.done}/{project.completion.total} {locale === 'vi' ? 'việc' : 'tasks'}</span><span>{percentage(project.completion.done, project.completion.total)}%</span></div><div className="progress-track"><span style={{ width: `${percentage(project.completion.done, project.completion.total)}%` }} /></div><div className="project-card-footer"><span>{project.updatedAt}</span><span>{project.storage}</span></div></div></article>
}

function DecisionRow({ decision, locale, onOpen }: { decision: DecisionRequest; locale: Locale; onOpen: () => void }) {
  return <button className="decision-row" onClick={onOpen}><span className={`decision-marker ${decision.priority}`}><Inbox size={14} /></span><span className="decision-row-content"><strong>{decision.title}</strong><small>{decision.projectName} <span>·</span> {decision.age}</small></span><ArrowRight size={15} className="row-arrow" /><span className="sr-only">{locale === 'vi' ? 'Mở quyết định' : 'Open decision'}</span></button>
}

function DecisionCard({ decision, locale, copy: t, onOpen, onResolve, onDismiss, pending, error, onRefresh }: { decision: DecisionRequest; locale: Locale; copy: Copy; onOpen: () => void; onResolve: (choiceId: string) => void; onDismiss: () => void; pending: boolean; error?: string; onRefresh: () => void }) {
  const evidence = (decision.evidence ?? []).map((item) => typeof item === 'string' ? item : JSON.stringify(item)).filter(Boolean)
  const scope = decision.blockingScopeId ? `${decision.blockingScopeType} · ${decision.blockingScopeId}` : decision.blockingScopeType
  return <article className={`decision-card ${decision.priority}`}><div className="decision-card-icon"><Inbox size={19} /></div><div className="decision-card-main"><div className="decision-card-top"><div><span className="decision-project">{decision.projectName}</span><h2>{decision.title}</h2></div><span className={`priority-label ${decision.priority}`}>{decision.priority === 'high' ? (locale === 'vi' ? 'Ưu tiên' : 'Priority') : (locale === 'vi' ? 'Đang chờ' : 'Waiting')}</span></div><p className="decision-detail">{decision.detail}</p><p className="decision-reason"><CircleHelp size={14} />{decision.reason}</p><div className="decision-meta-grid"><span><strong>{t.decisionScope}</strong>{scope}</span>{decision.deadlineAt && <span><strong>{t.decisionDeadline}</strong>{new Date(decision.deadlineAt).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}</span>}{decision.defaultBehavior && <span><strong>{t.decisionDefault}</strong>{decision.defaultBehavior}</span>}{decision.requiredAuthority && <span><strong>{t.decisionAuthority}</strong>{decision.requiredAuthority}</span>}</div>{evidence.length > 0 && <div className="decision-evidence"><strong>{t.decisionEvidence}</strong>{evidence.map((item, index) => <span key={`${decision.id}-evidence-${index}`}>{item}</span>)}</div>}<div className="decision-choices" aria-label={locale === 'vi' ? 'Các lựa chọn quyết định' : 'Decision choices'}>{decision.choices.length === 0 ? <span className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Core chưa cung cấp lựa chọn. Không thể ghi quyết định.' : 'Core has not provided a choice. The decision cannot be recorded.'}</span> : decision.choices.map((choice) => <button type="button" className={`decision-choice ${choice.id === decision.recommendedChoiceId || choice.recommended ? 'recommended' : ''}`} key={choice.id} disabled={pending} onClick={() => onResolve(choice.id)}><span>{choice.label}</span>{(choice.id === decision.recommendedChoiceId || choice.recommended) && <small>{t.recommended}</small>}</button>)}</div>{error && <div className="inline-state warning decision-inline-error" role="alert"><AlertCircle size={14} /><span>{error}</span><button type="button" className="subtle-button tiny" onClick={onRefresh}>{t.refresh}</button></div>}<div className="decision-card-actions"><button type="button" className="subtle-button" onClick={onOpen} disabled={pending}><Info size={15} />{decision.actionLabel}</button><button type="button" className="subtle-button" onClick={onDismiss} disabled={pending}>{pending ? <RefreshCw size={15} className="spin" /> : <X size={15} />}{t.dismissDecision}</button><span className="decision-age"><Clock3 size={13} />{decision.age} · v{decision.decisionVersion}</span></div></div></article>
}

function ActivityRow({ item, locale, onOpen }: { item: ActivityItem; locale: Locale; onOpen?: () => void }) {
  const icon = item.state === 'complete' ? <CheckCircle2 size={15} /> : item.state === 'blocked' ? <AlertCircle size={15} /> : item.state === 'needs_user' ? <UserRound size={15} /> : <Zap size={15} />
  return <div className="activity-row"><span className={`activity-state ${item.state}`}>{icon}</span><div className="activity-row-main"><div className="activity-row-title"><strong>{item.label}</strong><span>{item.updatedAt}</span></div><p>{item.projectName} <span>·</span> {item.detail}</p><div className="activity-milestone"><span className={`milestone-dot ${item.state}`} />{item.milestone ?? (locale === 'vi' ? 'Đang xử lý' : 'Working')}</div></div>{item.actionable && onOpen && <button className="subtle-button tiny" onClick={onOpen}>{locale === 'vi' ? 'Xem' : 'View'}</button>}</div>
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

function dedupeIntakeFiles(files: IntakeFile[]) {
  const unique = new Map<string, IntakeFile>()
  for (const file of files) unique.set(file.id, file)
  return [...unique.values()]
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 0; value >= 1024 && index < units.length - 1; index += 1) {
    value /= 1024
    unit = units[index + 1]
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

function formatRelativeSnapshot(value: string, locale: Locale) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return locale === 'vi' ? 'Vừa xong' : 'Just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return locale === 'vi' ? `${minutes} phút trước` : `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return locale === 'vi' ? `${hours} giờ trước` : `${hours}h ago`
}

function formatBackupState(value: string | undefined, locale: Locale) {
  const state = String(value ?? 'MISSING').toUpperCase()
  if (state === 'VERIFIED') return locale === 'vi' ? 'Đã xác minh' : 'Verified'
  if (state === 'CREATED') return locale === 'vi' ? 'Đang kiểm tra' : 'Created'
  if (state === 'FAILED') return locale === 'vi' ? 'Kiểm tra thất bại' : 'Verification failed'
  if (state === 'QUARANTINED') return locale === 'vi' ? 'Đã cách ly' : 'Quarantined'
  if (state === 'MISSING') return locale === 'vi' ? 'Chưa có backup' : 'No backup yet'
  return locale === 'vi' ? `Trạng thái: ${state}` : state
}

function percentage(done: number, total: number) {
  const safeDone = Number.isFinite(done) && done >= 0 ? done : 0
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0
  return safeTotal > 0 ? Math.min(100, Math.max(0, Math.round((safeDone / safeTotal) * 100))) : 0
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
