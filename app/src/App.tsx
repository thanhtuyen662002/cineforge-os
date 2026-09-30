import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, FormEvent } from 'react'
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
  Download,
  File as FileIcon,
  FilePlus2,
  Film,
  Filter,
  FolderKanban,
  HardDrive,
  Home,
  Inbox,
  Info,
  ListChecks,
  Languages,
  Layers3,
  LayoutDashboard,
  Menu,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  UploadCloud,
  Undo2,
  Redo2,
  Save,
  XCircle,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { CoreClientError, createCoreClient } from './coreAdapter'
import type { ActivityItem, AssetSummary, AudioCueTiming, BackupRestoreWorkspace, BackupSummary, BackupWorkspace, CharacterRevision, CharacterRevisionKind, CharacterSummary, CoreClient, DashboardSnapshot, DecisionRequest, ExternalEdit, ExternalEditLineageConfidence, HandoffListItem, HandoffWorkspace, Locale, ManagedAssetIntegrityJob, MediaProfileInput, MediaProfileRevision, MediaProfileWorkspace, NoteSummary, ProductionItem, ProjectSummary, ProjectWorkspace, RecoveryStatus, ReleaseCandidate, ReleaseGate, ReleaseGateState, ReleaseReadiness, ReviewSession, ReviewWorkspace, ShotLifecycleState, ShotSummary, StagingEvidence, StagingWorkspace, StorageAdmission, StorageScrubHealth, SubtitleTiming, TaskStatus, TaskSummary, Theme, TimelineRevision, TimelineSnapshotInput, TimelineSummary, TimelineTimingImpact, TimelineTimingLifecycleState, TimelineWorkspace, TimelineWorkingHistory, TimelineWorkingWorkspace, WorkState } from './types'

type NavKey = 'home' | 'projects' | 'timeline' | 'review' | 'handoff' | 'release' | 'characters' | 'needs' | 'activity' | 'library' | 'settings'

export const copy = {
  vi: {
    home: 'Trang chủ',
    projects: 'Dự án',
    timeline: 'Timeline',
    review: 'Duyệt',
    handoff: 'Bàn giao',
    release: 'Phát hành',
    characters: 'Nhân vật',
    needs: 'Cần bạn',
    activity: 'Hoạt động',
    library: 'Thư viện',
    settings: 'Cài đặt',
    searchPlaceholder: 'Tìm dự án…',
    searchNoResults: 'Không tìm thấy dự án phù hợp.',
    searchHint: 'Gõ để tìm dự án.',
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
    loadError: 'Không thể kết nối CineForge Core.',
    loadErrorDetail: 'Ứng dụng production cần Core local đang chạy. Không có dữ liệu demo nào được dùng khi Core chưa sẵn sàng.',
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
    timeline: 'Timeline',
    review: 'Review',
    handoff: 'Handoff',
    release: 'Release',
    characters: 'Characters',
    needs: 'Needs You',
    activity: 'Activity',
    library: 'Library',
    settings: 'Settings',
    searchPlaceholder: 'Search projects…',
    searchNoResults: 'No matching projects found.',
    searchHint: 'Type to find a project.',
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
    loadError: 'CineForge Core is unavailable.',
    loadErrorDetail: 'The production app requires the local Core to be ready. No demo data is used while Core is unavailable.',
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
  { key: 'timeline', icon: Film, label: 'timeline' },
  { key: 'review', icon: CheckCircle2, label: 'review' },
  { key: 'handoff', icon: PackageOpen, label: 'handoff' },
  { key: 'release', icon: ShieldCheck, label: 'release' },
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
      {activeNav === 'timeline' && <TimelineView snapshot={snapshot} locale={locale} client={client} onToast={setToast} />}
      {activeNav === 'review' && <ReviewView snapshot={snapshot} locale={locale} client={client} onToast={setToast} />}
      {activeNav === 'handoff' && <HandoffView snapshot={snapshot} locale={locale} client={client} onToast={setToast} />}
      {activeNav === 'release' && <ReleaseView snapshot={snapshot} locale={locale} client={client} />}
      {activeNav === 'characters' && <CharactersView snapshot={snapshot} locale={locale} client={client} onToast={setToast} />}
      {activeNav === 'needs' && (
        <NeedsView snapshot={snapshot} t={t} locale={locale} onOpenDecision={openDecision} onResolve={resolveDecision} onDismiss={dismissDecision} pendingId={decisionPendingId} decisionError={decisionError} onRefresh={() => void loadDashboard()} />
      )}
      {activeNav === 'activity' && <ActivityView snapshot={snapshot} locale={locale} client={client} onOpenProject={openProject} />}
      {activeNav === 'library' && <LibraryView snapshot={snapshot} locale={locale} client={client} onOpenProject={openProject} />}
      {activeNav === 'settings' && <SettingsView snapshot={snapshot} locale={locale} client={client} theme={theme} onThemeChange={setTheme} onLocaleChange={setLocale} onRefresh={() => void loadDashboard()} refreshLabel={t.refresh} onToast={setToast} />}
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
            <button key={key} className={`nav-item ${activeNav === key ? 'active' : ''}`} onClick={() => { setActiveNav(key); if (key === 'projects' || key === 'timeline' || key === 'review' || key === 'handoff' || key === 'release') setSelectedProjectId(null); setMobileNavOpen(false) }} aria-current={activeNav === key ? 'page' : undefined}>
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
            <div className="breadcrumbs"><span>{activeNav === 'home' ? t.home : activeNav === 'projects' ? t.projects : activeNav === 'timeline' ? t.timeline : activeNav === 'review' ? t.review : activeNav === 'handoff' ? t.handoff : activeNav === 'release' ? t.release : activeNav === 'characters' ? t.characters : activeNav === 'needs' ? t.needs : activeNav === 'activity' ? t.activity : activeNav === 'library' ? t.library : t.settings}</span>{activeNav === 'home' && <><span className="breadcrumb-separator">/</span><span className="muted">{locale === 'vi' ? 'Tổng quan' : 'Overview'}</span></>}</div>
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
          {isLoading && !snapshot ? <LoadingState label={t.loading} /> : loadError && !snapshot ? <ErrorState message={t.loadError} detail={loadError === t.loadError ? t.loadErrorDetail : `${t.loadErrorDetail} (${loadError})`} onRetry={() => void loadDashboard()} retryLabel={t.retry} /> : content}
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
    MEDIA_PROFILE_NOT_APPROVED: { vi: 'Media Profile revision phải được approve trước khi pin vào timeline.', en: 'The Media Profile revision must be approved before it can be pinned to a timeline.' },
    MEDIA_PROFILE_REVISION_NOT_FOUND: { vi: 'Media Profile revision không còn tồn tại trong Core.', en: 'The Media Profile revision no longer exists in Core.' },
    TIMELINE_NOT_FOUND: { vi: 'Timeline không còn tồn tại trong Core.', en: 'The timeline no longer exists in Core.' },
    TIMELINE_REVISION_NOT_FOUND: { vi: 'Timeline revision không còn tồn tại trong Core.', en: 'The timeline revision no longer exists in Core.' },
    INVALID_MEDIA_PROFILE_TRANSITION: { vi: 'Media Profile không thể chuyển sang trạng thái này.', en: 'That Media Profile transition is not allowed.' },
    INVALID_TIMELINE_REVISION_TRANSITION: { vi: 'Timeline revision không thể chuyển sang trạng thái này.', en: 'That timeline revision transition is not allowed.' },
    TIMELINE_PROFILE_REQUIRED: { vi: 'Timeline cần pin một Media Profile revision.', en: 'The timeline must pin a Media Profile revision.' },
    TIMELINE_PROFILE_NOT_APPROVED: { vi: 'Media Profile đang pin chưa được approve.', en: 'The pinned Media Profile is not approved.' },
    TIMELINE_ASSET_NOT_READY: { vi: 'Asset trong timeline chưa đủ bằng chứng readiness.', en: 'A timeline asset does not have sufficient readiness evidence.' },
    TIMELINE_RIGHTS_BLOCKED: { vi: 'Rights/consent của asset trong timeline đang chặn thao tác.', en: 'Rights or consent for a timeline asset is blocking the action.' },
    TIMELINE_REVISION_IMMUTABLE: { vi: 'Revision đã được chốt và không thể sửa trực tiếp.', en: 'This revision is immutable and cannot be edited directly.' },
    REVIEW_SESSION_NOT_FOUND: { vi: 'Review không còn tồn tại trong Core.', en: 'The review session no longer exists in Core.' },
    REVIEW_REQUIRED_FOR_APPROVAL: { vi: 'Timeline phải có review APPROVE còn hiệu lực trước khi chốt.', en: 'The timeline needs a current APPROVE review before it can be approved.' },
    REVIEW_SNAPSHOT_REQUIRED: { vi: 'Cần gửi đúng dependency snapshot hash của review trước khi chốt timeline.', en: 'The exact dependency snapshot hash is required before approving the timeline.' },
    REVIEW_ALREADY_OPEN: { vi: 'Revision này đã có một review đang mở.', en: 'This revision already has an open review.' },
    REVIEW_NOT_READY: { vi: 'Checkpoint chưa đủ readiness để reviewer approve.', en: 'The checkpoint is not ready for an approval review.' },
    REVIEW_APPROVAL_REQUIRED: { vi: 'Chỉ quyết định APPROVE mới được chốt timeline.', en: 'Only an APPROVE decision can approve the timeline.' },
    REVIEW_NOT_SUBMITTED: { vi: 'Review chưa được gửi; hãy hoàn tất quyết định trước.', en: 'The review has not been submitted yet.' },
    REVIEW_DECISION_IMMUTABLE: { vi: 'Review đã gửi và không thể sửa quyết định.', en: 'A submitted review decision cannot be edited.' },
    STALE_REVIEW: { vi: 'Review đã cũ vì checkpoint hoặc dependency thay đổi. Hãy mở review mới.', en: 'This review is stale because the checkpoint or dependency changed. Open a new review.' },
    HANDOFF_NOT_FOUND: { vi: 'Manifest bàn giao không còn tồn tại trong Core.', en: 'The handoff manifest no longer exists in Core.' },
    HANDOFF_REVISION_NOT_APPROVED: { vi: 'Chỉ timeline revision đã approve mới được bàn giao.', en: 'Only an approved timeline revision can be handed off.' },
    HANDOFF_SNAPSHOT_REQUIRED: { vi: 'Cần đúng dependency snapshot hash của review đã approve.', en: 'The exact dependency snapshot hash from the approved review is required.' },
    RELEASE_READINESS_BLOCKED: { vi: 'Readiness chưa READY; xử lý mọi gate FAIL/UNKNOWN rồi tải lại trước khi tạo candidate.', en: 'Readiness is not READY; resolve every FAIL/UNKNOWN gate and refresh before creating a candidate.' },
    RELEASE_CANDIDATE_ALREADY_EXISTS: { vi: 'Candidate đã tồn tại cho exact source và readiness digest này; hãy dùng bản đang có.', en: 'A candidate already exists for this exact source and readiness digest; use the existing draft.' },
    RELEASE_CANDIDATE_NOT_FOUND: { vi: 'Release candidate không còn tồn tại trong Core.', en: 'The release candidate no longer exists in Core.' },
    RELEASE_CANDIDATE_NOT_CANCELLABLE: { vi: 'Candidate đã ở trạng thái terminal và không thể huỷ thêm.', en: 'This candidate is terminal and cannot be cancelled again.' },
    HANDOFF_MEDIA_PROFILE_NOT_APPROVED: { vi: 'Media Profile của timeline chưa được approve.', en: 'The timeline media profile is not approved.' },
    STORAGE_PRESSURE: { vi: 'Dung lượng trống không đủ cho backup này; hãy giải phóng dung lượng rồi thử lại.', en: 'There is not enough free storage for this backup; free space and try again.' },
    STORAGE_CAPACITY_UNKNOWN: { vi: 'Core chưa xác minh được dung lượng trống. Không thể tạo backup an toàn.', en: 'Core could not verify free storage. A safe backup cannot be created.' },
    DURABILITY_PROFILE_UNAVAILABLE: { vi: 'Chính sách lưu backup này chưa khả dụng trên máy hiện tại.', en: 'This backup durability policy is not available on this machine.' },
    BACKUP_OBJECT_MISSING: { vi: 'Một managed object của backup không còn sẵn sàng.', en: 'A managed object required by the backup is not available.' },
    BACKUP_OBJECT_TAMPERED: { vi: 'Core phát hiện managed object thay đổi; backup đã bị chặn.', en: 'Core detected a changed managed object; the backup was blocked.' },
    BACKUP_DATABASE_TAMPERED: { vi: 'Core phát hiện snapshot database bị thay đổi.', en: 'Core detected a changed database snapshot.' },
    BACKUP_MANIFEST_TAMPERED: { vi: 'Core phát hiện manifest backup bị thay đổi.', en: 'Core detected a changed backup manifest.' },
    BACKUP_NOT_FOUND: { vi: 'Backup không còn tồn tại trong Core.', en: 'The backup no longer exists in Core.' },
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

/**
 * Merge one page of the read-only working-session history endpoint into the
 * pages already shown by the Timeline view. The Core cursor is monotonic by
 * operation sequence, but de-duplication keeps a retry or stale response from
 * rendering the same operation twice.
 */
export function mergeTimelineWorkingHistory(current: TimelineWorkingHistory | null, next: TimelineWorkingHistory): TimelineWorkingHistory {
  if (!current) return {
    ...next,
    operations: [...next.operations].sort((left, right) => left.opSeq - right.opSeq),
    historyActions: [...next.historyActions].sort((left, right) => left.actionSeq - right.actionSeq),
  }
  const operations = new Map<string, TimelineWorkingHistory['operations'][number]>()
  for (const operation of [...current.operations, ...next.operations]) {
    const key = Number.isSafeInteger(operation.opSeq) && operation.opSeq >= 0 ? `seq:${operation.opSeq}` : `id:${operation.id ?? 'unknown'}`
    operations.set(key, operation)
  }
  const historyActions = new Map<string, TimelineWorkingHistory['historyActions'][number]>()
  for (const action of [...current.historyActions, ...next.historyActions]) {
    const key = Number.isSafeInteger(action.actionSeq) && action.actionSeq >= 0 ? `seq:${action.actionSeq}` : `id:${action.id ?? 'unknown'}`
    historyActions.set(key, action)
  }
  return {
    ...next,
    operations: [...operations.values()].sort((left, right) => left.opSeq - right.opSeq),
    historyActions: [...historyActions.values()].sort((left, right) => left.actionSeq - right.actionSeq),
  }
}

export function timelineHistoryOperationLabel(opType: string, locale: Locale) {
  const labels: Record<string, { vi: string; en: string }> = {
    ADD_MARKER: { vi: 'Thêm marker', en: 'Add marker' },
    INSERT_CLIP: { vi: 'Chèn clip', en: 'Insert clip' },
    MOVE_CLIP: { vi: 'Di chuyển clip', en: 'Move clip' },
    TRIM_CLIP: { vi: 'Trim clip', en: 'Trim clip' },
    DELETE_CLIP: { vi: 'Xoá clip', en: 'Delete clip' },
  }
  const normalized = String(opType ?? 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN'
  return labels[normalized]?.[locale] ?? (locale === 'vi' ? 'Thao tác khác' : 'Other operation')
}

export function timelineHistoryStateLabel(state: string, locale: Locale) {
  const labels: Record<string, { vi: string; en: string }> = {
    ACTIVE: { vi: 'Đang áp dụng', en: 'Active' },
    UNDONE: { vi: 'Đã undo', en: 'Undone' },
    DISCARDED: { vi: 'Đã loại khỏi nhánh', en: 'Discarded' },
  }
  const normalized = String(state ?? 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN'
  return labels[normalized]?.[locale] ?? 'UNKNOWN'
}

export function timelineHistoryActionLabel(actionType: string, locale: Locale) {
  const labels: Record<string, { vi: string; en: string }> = {
    UNDO: { vi: 'Undo', en: 'Undo' },
    REDO: { vi: 'Redo', en: 'Redo' },
    DISCARD_REDO_BRANCH: { vi: 'Loại nhánh redo', en: 'Discard redo branch' },
  }
  const normalized = String(actionType ?? 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN'
  return labels[normalized]?.[locale] ?? (locale === 'vi' ? 'Lịch sử khác' : 'Other history action')
}

export function timelineHistoryHashPreview(hash?: string) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash) ? hash.slice(0, 12) : '—'
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
  </> : activeTab === 'activity' ? <div className="workspace-activity-list"><ActivityView snapshot={{ ...snapshot, activity: snapshot.activity.filter((item) => item.projectId === project.id || item.projectName === project.name) }} locale={locale} client={client} onOpenProject={() => undefined} /></div> : <div className="workspace-context"><div><span>Project ID</span><code>{project.id}</code></div><div><span>{locale === 'vi' ? 'Công việc' : 'Tasks'}</span><strong>{tasks.length}</strong></div><div><span>{locale === 'vi' ? 'Shot kế hoạch' : 'Planning shots'}</span><strong>{shots.length}</strong></div><div><span>{locale === 'vi' ? 'Ghi chú' : 'Notes'}</span><strong>{notes.length}</strong></div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Workspace đọc từ Core. Mọi thay đổi đi qua command và giữ row version để phát hiện xung đột.' : 'Workspace is read from Core. Mutations go through commands and carry row versions for conflict detection.'}</p></div>

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

function JobQueuePanel({ locale, client }: { locale: Locale; client: CoreClient }) {
  const [jobs, setJobs] = useState<ManagedAssetIntegrityJob[]>([])
  const [retryAllowed, setRetryAllowed] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<ManagedAssetIntegrityJob | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client.getJobs) return
    setLoading(true)
    setError(null)
    try {
      const result = await client.getJobs(undefined, undefined, 100)
      setJobs(result.jobs)
      setRetryAllowed({})
      if (client.getJobRetryPlan) {
        const retryPlans = await Promise.all(result.jobs.filter((job) => job.retryable).map(async (job) => {
          try {
            const plan = await client.getJobRetryPlan!(job.id, job.projectId ?? undefined)
            return [job.id, plan.allowed] as const
          } catch {
            return [job.id, false] as const
          }
        }))
        setRetryAllowed(Object.fromEntries(retryPlans))
      } else {
        setRetryAllowed({})
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (locale === 'vi' ? 'Không đọc được hàng đợi Core.' : 'Could not read the Core queue.'))
    } finally {
      setLoading(false)
    }
  }, [client, locale])

  useEffect(() => { void load() }, [load])

  const inspectJob = async (job: ManagedAssetIntegrityJob) => {
    setSelectedJobId(job.id)
    setSelectedJob(job)
    if (!client.getJob) return
    setDetailLoading(true)
    setDetailError(null)
    try {
      const detail = await client.getJob(job.id, job.projectId ?? undefined)
      setSelectedJob(detail)
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : (locale === 'vi' ? 'Không đọc được chi tiết job.' : 'Could not read the job details.'))
    } finally {
      setDetailLoading(false)
    }
  }

  const action = async (job: ManagedAssetIntegrityJob, operation: 'cancel' | 'retry') => {
    const handler = operation === 'cancel' ? client.cancelManagedAssetIntegrityProbe : client.retryManagedAssetIntegrityProbe
    if (!handler || !job.latestAttempt) return
    setMutating(job.id)
    setError(null)
    try {
      const next = await handler(job.id, job.rowVersion)
      setJobs((current) => current.map((item) => item.id === next.id ? next : item))
      if (operation === 'retry') setRetryAllowed((current) => ({ ...current, [job.id]: false }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (locale === 'vi' ? 'Thao tác job thất bại.' : 'The job action failed.'))
    } finally {
      setMutating(null)
    }
  }

  const stateLabel = (state: string) => {
    const labels: Record<string, [string, string]> = {
      QUEUED: ['Đang chờ', 'Queued'], CLAIMED: ['Đã nhận', 'Claimed'], RUNNING: ['Đang kiểm tra', 'Running'],
      CANCELLATION_REQUESTED: ['Đang huỷ', 'Cancelling'], CANCELLED_CONFIRMED: ['Đã huỷ', 'Cancelled'],
      COMPLETED: ['Đã xong', 'Complete'], COMPLETED_AFTER_CANCEL: ['Xong sau yêu cầu huỷ', 'Completed after cancel'],
      FAILED_RETRYABLE: ['Có thể thử lại', 'Retryable failure'], FAILED_FINAL: ['Không đạt', 'Failed'], CANNOT_CANCEL: ['Không thể huỷ', 'Cannot cancel'],
    }
    return labels[state]?.[locale === 'vi' ? 0 : 1] ?? state
  }

  return <section className="dashboard-card job-queue-card" aria-labelledby="job-queue-title">
    <div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><HardDrive size={16} /></span><div><h2 id="job-queue-title">{locale === 'vi' ? 'Hàng đợi kiểm tra dữ liệu' : 'Integrity job queue'}</h2><p>{locale === 'vi' ? 'Chỉ đọc managed asset local; trạng thái do Core ghi nhận.' : 'Reads local managed assets only; state comes from Core.'}</p></div></div><button className="subtle-button tiny" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} />{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button></div>
    {error && <div className="inline-state warning" role="alert"><AlertCircle size={14} />{error}</div>}
    {!client.getJobs ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Bridge hiện tại chưa cung cấp hàng đợi job.' : 'This bridge does not expose the job queue yet.'} /> : jobs.length === 0 && !loading ? <EmptyInline icon={CheckCircle2} text={locale === 'vi' ? 'Chưa có job integrity nào.' : 'No integrity jobs have been queued.'} /> : <div className="job-queue-list">{jobs.map((job) => <article className="job-queue-row" key={job.id}><div className="job-queue-main"><div className={`job-state-dot ${job.state.toLowerCase()}`} aria-hidden="true" /><div><strong>{locale === 'vi' ? 'Kiểm tra managed asset' : 'Managed asset integrity probe'}</strong><small>{job.subjectAssetRevisionId} · {stateLabel(job.state)}</small><small>{job.nextStep ?? (locale === 'vi' ? 'Core đang xác định bước tiếp theo.' : 'Core is determining the next step.')}</small></div></div><div className="job-queue-actions">{job.evidence && <span className={`health-pill ${job.evidence.state === 'PASS' ? 'healthy' : job.evidence.state === 'FAIL' ? 'blocked' : 'attention'}`}><span />{job.evidence.state}</span>}{client.getJob && <button type="button" className="subtle-button tiny" onClick={() => void inspectJob(job)} disabled={detailLoading && selectedJobId === job.id}>{locale === 'vi' ? 'Chi tiết' : 'Details'}</button>}{job.cancelable && client.cancelManagedAssetIntegrityProbe && <button type="button" className="subtle-button tiny" onClick={() => void action(job, 'cancel')} disabled={mutating === job.id}>{locale === 'vi' ? 'Huỷ' : 'Cancel'}</button>}{job.retryable && retryAllowed[job.id] === true && client.retryManagedAssetIntegrityProbe && <button type="button" className="subtle-button tiny" onClick={() => void action(job, 'retry')} disabled={mutating === job.id}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button>}</div></article>)}</div>}
    {client.getJob && selectedJobId && <section className="job-detail-card" aria-live="polite">{detailLoading ? <LoadingState label={locale === 'vi' ? 'Đang đọc chi tiết job…' : 'Reading job details…'} /> : detailError ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{detailError}</span><button type="button" className="subtle-button tiny" onClick={() => { const current = jobs.find((job) => job.id === selectedJobId); if (current) void inspectJob(current) }}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div> : selectedJob ? <><div className="card-heading"><div><strong>{locale === 'vi' ? 'Chi tiết integrity job' : 'Integrity job details'}</strong><small>{selectedJob.id} · row v{selectedJob.rowVersion}</small></div><span className={`health-pill ${selectedJob.state === 'COMPLETED' ? 'healthy' : selectedJob.state.startsWith('FAILED') ? 'blocked' : 'attention'}`}><span />{stateLabel(selectedJob.state)}</span></div><div className="system-facts"><div><span>{locale === 'vi' ? 'Asset revision' : 'Asset revision'}</span><strong>{selectedJob.subjectAssetRevisionId}</strong></div><div><span>{locale === 'vi' ? 'Capability' : 'Capability'}</span><strong>{selectedJob.semanticCapability}</strong></div><div><span>{locale === 'vi' ? 'Attempt' : 'Attempt'}</span><strong>{selectedJob.latestAttempt ? `#${selectedJob.latestAttempt.attemptNo} · ${selectedJob.latestAttempt.state}` : '—'}</strong></div><div><span>{locale === 'vi' ? 'Evidence' : 'Evidence'}</span><strong>{selectedJob.evidence?.state ?? 'UNKNOWN'}{selectedJob.evidence?.code ? ` · ${selectedJob.evidence.code}` : ''}</strong></div><div><span>{locale === 'vi' ? 'Bytes đã đọc' : 'Bytes read'}</span><strong>{selectedJob.evidence?.bytesRead ?? selectedJob.latestAttempt?.bytesRead ?? '—'}</strong></div></div><p className="readonly-note"><Info size={14} />{selectedJob.nextStep ?? (locale === 'vi' ? 'Core chưa cung cấp bước tiếp theo.' : 'Core has not supplied a next step.')}</p></> : null}</section>}
  </section>
}

function ActivityView({ snapshot, locale, client, onOpenProject }: { snapshot: DashboardSnapshot; locale: Locale; client: CoreClient; onOpenProject: (project: ProjectSummary) => void }) {
  const [filter, setFilter] = useState<'all' | WorkState>('all')
  const filters: Array<{ key: 'all' | WorkState; vi: string; en: string }> = [
    { key: 'all', vi: 'Tất cả', en: 'All' },
    { key: 'running', vi: 'Đang chạy', en: 'Running' },
    { key: 'needs_user', vi: 'Cần bạn', en: 'Needs you' },
    { key: 'complete', vi: 'Đã xong', en: 'Complete' },
    { key: 'blocked', vi: 'Đang chặn', en: 'Blocked' },
  ]
  const visible = filter === 'all' ? snapshot.activity : snapshot.activity.filter((item) => item.state === filter)
  return <div className="page activity-page"><div className="page-heading"><div><p className="eyebrow">{locale === 'vi' ? 'THEO DÕI' : 'MONITORING'}</p><h1>{locale === 'vi' ? 'Hoạt động' : 'Activity'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Trạng thái đọc từ Core, theo từng project. Không có tiến độ được dựng trong giao diện.' : 'State read from Core, grouped by project. The interface never invents progress.'}</p></div><span className="count-chip"><Activity size={15} />{snapshot.activity.length}</span></div><div className="activity-filter-row" role="tablist" aria-label={locale === 'vi' ? 'Lọc hoạt động' : 'Activity filters'}>{filters.map((item) => <button key={item.key} className={`filter-chip ${filter === item.key ? 'active' : ''}`} onClick={() => setFilter(item.key)} role="tab" aria-selected={filter === item.key}><Filter size={13} />{locale === 'vi' ? item.vi : item.en}</button>)}</div><section className="activity-page-list">{visible.length === 0 ? <EmptyState icon={CheckCircle2} title={locale === 'vi' ? 'Không có activity phù hợp' : 'No matching activity'} detail={locale === 'vi' ? 'Core chưa ghi nhận trạng thái trong bộ lọc này.' : 'Core has not recorded a state in this filter yet.'} /> : visible.map((item) => { const project = snapshot.projects.find((candidate) => candidate.id === item.projectId || candidate.name === item.projectName); return <ActivityRow key={item.id} item={item} locale={locale} onOpen={project ? () => onOpenProject(project) : undefined} /> })}</section><JobQueuePanel locale={locale} client={client} /></div>
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

function AssetPreview({ asset, locale, client, purpose = 'LIBRARY_PREVIEW' }: { asset: AssetSummary; locale: Locale; client: CoreClient; purpose?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const requestGeneration = useRef(0)
  const previewIdentity = `${asset.projectId ?? ''}:${asset.revisionId ?? ''}:${purpose}`
  const canResolve = Boolean(client.resolveMediaPreview && asset.projectId && asset.revisionId && asset.rights?.status === 'ALLOWED')
  useEffect(() => {
    requestGeneration.current += 1
    setUrl(null)
    setLoading(false)
    setError(null)
    setFailed(false)
  }, [previewIdentity])
  const resolve = async () => {
    if (!client.resolveMediaPreview || !asset.projectId || !asset.revisionId || loading) return
    const generation = requestGeneration.current
    setLoading(true)
    setError(null)
    setFailed(false)
    try {
      const resolved = await client.resolveMediaPreview(asset.projectId, asset.revisionId, purpose)
      if (generation !== requestGeneration.current) return
      setUrl(resolved.url)
    } catch (cause) {
      if (generation !== requestGeneration.current) return
      const code = cause instanceof CoreClientError ? cause.code : ''
      setError(code === 'PREVIEW_RIGHTS_BLOCKED' ? (locale === 'vi' ? 'Bị chặn bởi quyền/consent.' : 'Blocked by rights or consent.') : code === 'PREVIEW_NOT_READY' ? (locale === 'vi' ? 'Asset chưa sẵn sàng để xem.' : 'Asset is not ready for preview.') : (locale === 'vi' ? 'Không cấp được capability xem thử.' : 'Could not acquire a preview capability.'))
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }
  const mime = String(asset.latestRevision && typeof asset.latestRevision === 'object' ? (asset.latestRevision as Record<string, unknown>).provenance && typeof (asset.latestRevision as Record<string, unknown>).provenance === 'object' ? ((asset.latestRevision as Record<string, unknown>).provenance as Record<string, unknown>).source_metadata && typeof ((asset.latestRevision as Record<string, unknown>).provenance as Record<string, unknown>).source_metadata === 'object' ? (((asset.latestRevision as Record<string, unknown>).provenance as Record<string, unknown>).source_metadata as Record<string, unknown>).detected_mime : '' : '' : '').toLowerCase().split(';', 1)[0]
  const mediaKind = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'other'
  return <div className="asset-preview">
    {url && !failed ? <div className="asset-preview-surface">
      {mediaKind === 'image' ? <img src={url} alt={asset.name} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : mediaKind === 'audio' ? <audio controls preload="metadata" src={url} onError={() => setFailed(true)} /> : mediaKind === 'video' ? <video controls preload="metadata" src={url} onError={() => setFailed(true)} /> : <span>{locale === 'vi' ? 'Định dạng chỉ hỗ trợ metadata.' : 'Metadata-only format.'}</span>}
    </div> : <button type="button" className="subtle-button tiny asset-preview-button" disabled={!canResolve || loading} onClick={() => void resolve()}>{loading ? (locale === 'vi' ? 'Đang cấp quyền…' : 'Authorizing…') : (locale === 'vi' ? 'Xem thử' : 'Preview')}</button>}
    {!canResolve && <small className="asset-preview-hint">{locale === 'vi' ? 'Cần project, revision và quyền ALLOWED.' : 'Project, revision and ALLOWED rights are required.'}</small>}
    {error && <small className="asset-preview-hint warning-text">{error}</small>}
    {failed && <small className="asset-preview-hint warning-text">{locale === 'vi' ? 'Capability hết hạn hoặc bytes đã thay đổi; hãy cấp lại.' : 'Capability expired or bytes changed; acquire it again.'}</small>}
  </div>
}

function AssetRecord({ asset, projectName, locale, client }: { asset: AssetSummary; projectName: string; locale: Locale; client: CoreClient }) {
  const [probeLoading, setProbeLoading] = useState(false)
  const [probeMessage, setProbeMessage] = useState<string | null>(null)
  const readinessLabel = asset.readinessState === 'READY' ? (locale === 'vi' ? 'Đã kiểm tra' : 'Verified') : asset.readinessState === 'REVIEW_REQUIRED' ? (locale === 'vi' ? 'Cần review' : 'Review required') : (locale === 'vi' ? 'Chờ kiểm tra' : 'Readiness unknown')
  const rightsStatus = asset.rights?.status ?? 'UNKNOWN'
  const rightsLabel = rightsStatus === 'ALLOWED' ? (locale === 'vi' ? 'Quyền đã cho phép' : 'Rights allowed') : rightsStatus === 'RESTRICTED' ? (locale === 'vi' ? 'Quyền bị giới hạn' : 'Rights restricted') : rightsStatus === 'REVOKED' ? (locale === 'vi' ? 'Quyền đã thu hồi' : 'Rights revoked') : rightsStatus === 'EXPIRED' ? (locale === 'vi' ? 'Quyền hết hạn' : 'Rights expired') : (locale === 'vi' ? 'Quyền chưa xác minh' : 'Rights unknown')
  const canProbe = Boolean(client.runManagedAssetIntegrityProbe && asset.projectId && asset.revisionId && asset.contentHash && /^[a-f0-9]{64}$/i.test(asset.contentHash))
  const runProbe = async () => {
    if (!canProbe || !client.runManagedAssetIntegrityProbe || !asset.projectId || !asset.revisionId || !asset.contentHash || probeLoading) return
    setProbeLoading(true)
    setProbeMessage(null)
    try {
      await client.runManagedAssetIntegrityProbe(asset.projectId, asset.revisionId, asset.contentHash)
      setProbeMessage(locale === 'vi' ? 'Đã xếp hàng kiểm tra.' : 'Integrity check queued.')
    } catch (error) {
      setProbeMessage(error instanceof Error ? error.message : (locale === 'vi' ? 'Không xếp hàng được job.' : 'Could not queue the job.'))
    } finally {
      setProbeLoading(false)
    }
  }
  return <div className="library-record asset-record" key={asset.id}><span className="record-state done"><FileIcon size={14} /></span><span className="library-record-main"><strong>{asset.name}</strong><small>{projectName} · {asset.assetType} · {formatBytes(asset.byteSize)} · {asset.contentHash?.slice(0, 12) ?? 'hash—'}</small></span><span className={`item-state ${asset.readinessState === 'READY' ? 'ready' : 'attention'}`} title={asset.availability === 'AVAILABLE' ? (locale === 'vi' ? 'Object đã lưu; readiness vẫn cần bằng chứng verifier.' : 'Object is stored; readiness still requires verifier evidence.') : asset.availability}>{readinessLabel}</span><span className={`item-state ${rightsStatus === 'ALLOWED' ? 'ready' : 'attention'}`} title={asset.rights?.blockers?.map((blocker) => String(blocker.code ?? '')).filter(Boolean).join(', ') || rightsLabel}>{rightsLabel}</span><AssetPreview asset={asset} locale={locale} client={client} /><span className="asset-integrity-action"><button type="button" className="subtle-button tiny" disabled={!canProbe || probeLoading} title={!canProbe ? (locale === 'vi' ? 'Cần asset revision và SHA-256 exact.' : 'An exact asset revision and SHA-256 are required.') : undefined} onClick={() => void runProbe}><ShieldCheck size={13} />{probeLoading ? '…' : locale === 'vi' ? 'Kiểm tra dữ liệu' : 'Check data'}</button>{probeMessage && <small className="asset-preview-hint">{probeMessage}</small>}</span></div>
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
        {assetsLoading ? <div className="inline-state"><RefreshCw size={14} className="spin" />{locale === 'vi' ? 'Đang đọc asset…' : 'Loading assets…'}</div> : assetsError ? <div className="inline-state warning"><AlertCircle size={14} />{assetsError}</div> : assets.length === 0 ? <EmptyState icon={Database} title={locale === 'vi' ? 'Chưa có asset' : 'No imported assets'} detail={locale === 'vi' ? 'Dán đường dẫn local và gửi command ImportAsset để bắt đầu.' : 'Paste a local path and send ImportAsset command to begin.'} /> : <div className="library-record-list">{assets.map((asset) => <AssetRecord key={asset.id} asset={asset} projectName={snapshot.projects.find((candidate) => candidate.id === asset.projectId)?.name ?? (locale === 'vi' ? 'Studio-wide' : 'Studio-wide')} locale={locale} client={client} />)}</div>}
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
  const projectIdRef = useRef(projectId)
  const selectedIdRef = useRef<string | null>(selectedId)
  const characterLoadGenerationRef = useRef(0)
  const workspaceLoadGenerationRef = useRef(0)

  useEffect(() => {
    projectIdRef.current = projectId
  }, [projectId])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    if (!projectId && snapshot.projects[0]) {
      projectIdRef.current = snapshot.projects[0].id
      setProjectId(snapshot.projects[0].id)
    }
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
      setSelectedId((current) => {
        const nextId = current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null
        selectedIdRef.current = nextId
        return nextId
      })
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
    selectedIdRef.current = characterId
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
      selectedIdRef.current = null
      workspaceLoadGenerationRef.current += 1
      setWorkspace(null)
      setWorkspaceError(null)
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
    const requestedProjectId = projectId
    setCreating(true)
    setCreateError(null)
    setCreateNeedsUser(false)
    const createFingerprint = `${requestedProjectId}\u001f${cleanName}\u001f${stableCode.trim()}`
    if (!createIntentRef.current || createIntentRef.current.fingerprint !== createFingerprint) {
      createIntentRef.current = { fingerprint: createFingerprint, key: `character-create:${crypto.randomUUID()}` }
    }
    try {
      const created = await client.createCharacter(requestedProjectId, cleanName, stableCode.trim() || undefined, createIntentRef.current.key)
      // The user may switch projects while Core is processing the command.
      // Only merge the result into a still-compatible list; the next project
      // refresh owns the list for any other selection.
      if (projectIdRef.current === requestedProjectId || projectIdRef.current === '') {
        setCharacters((current) => [created, ...current.filter((item) => item.id !== created.id)])
        selectedIdRef.current = created.id
        setSelectedId(created.id)
      }
      setName('')
      setStableCode('')
      createIntentRef.current = null
      onToast(locale === 'vi' ? `Đã tạo nhân vật “${created.displayName}”.` : `Character “${created.displayName}” created.`)
    } catch (cause) {
      if (projectIdRef.current === requestedProjectId) {
        setCreateNeedsUser(cause instanceof CoreClientError && cause.needsUser)
        setCreateError(workspaceErrorMessage(cause, locale))
      }
    } finally {
      setCreating(false)
    }
  }

  const createRevision = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedId || !revisionDescription.trim() || revisionPending) return
    const requestedCharacterId = selectedId
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
      await action(requestedCharacterId, input, revisionIntentRef.current.key)
      // Keep a completion from an old selection from changing the current
      // character or clearing a draft the user has started elsewhere.
      if (selectedIdRef.current === requestedCharacterId) {
        setRevisionDescription('')
        revisionIntentRef.current = null
        await loadWorkspace(requestedCharacterId)
      }
      onToast(locale === 'vi' ? 'Đã lưu revision. Revision mới vẫn cần bước phê duyệt riêng.' : 'Revision saved. Approval remains a separate step.')
    } catch (cause) {
      if (selectedIdRef.current !== requestedCharacterId) return
      const needsUser = cause instanceof CoreClientError && cause.needsUser
      setWorkspaceError(needsUser
        ? (locale === 'vi' ? 'Core cần bạn bổ sung quyền hoặc xử lý xung đột trước khi lưu.' : 'Core needs your rights or conflict decision before it can save this revision.')
        : workspaceErrorMessage(cause, locale))
    } finally {
      setRevisionPending(false)
    }
  }

  // Keep the detail panel aligned with the selected row while a new workspace
  // request is in flight. A previous character's workspace may still be in
  // state until the response arrives, so it must never win for a different id.
  const selected = (workspace?.id === selectedId ? workspace : null) ?? characters.find((item) => item.id === selectedId) ?? null
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
      <section className="workspace-panel characters-list-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><UserRound size={16} /></span><div><h2>{locale === 'vi' ? 'Danh sách nhân vật' : 'Character list'}</h2><p>{locale === 'vi' ? 'Chọn project để xem canon.' : 'Choose a project to view canon.'}</p></div></div><select className="character-project-select" value={projectId} onChange={(event) => { projectIdRef.current = event.target.value; selectedIdRef.current = null; setProjectId(event.target.value); setSelectedId(null); setWorkspace(null); setWorkspaceError(null); setCreateError(null); setCreateNeedsUser(false) }} aria-label={locale === 'vi' ? 'Project nhân vật' : 'Character project'}><option value="">{locale === 'vi' ? 'Toàn workspace' : 'All projects'}</option>{snapshot.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></div>{loading ? <LoadingState label={locale === 'vi' ? 'Đang đọc nhân vật từ Core…' : 'Reading characters from Core…'} /> : error ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{error}</span><button className="subtle-button tiny" onClick={() => void loadCharacters()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div> : characters.length === 0 ? <EmptyState icon={UserRound} title={locale === 'vi' ? 'Chưa có nhân vật' : 'No characters yet'} detail={locale === 'vi' ? 'Tạo CharacterIdentity đầu tiên. Các package sẽ được thêm bằng revision riêng.' : 'Create the first CharacterIdentity. Packages are added as separate revisions.'} /> : <div className="workspace-record-list">{characters.map((character) => <button type="button" className={`character-row ${selectedId === character.id ? 'active' : ''}`} key={character.id} onClick={() => { selectedIdRef.current = character.id; setSelectedId(character.id) }}><span className="character-avatar"><UserRound size={15} /></span><span className="workspace-record-main"><strong>{character.displayName}</strong><small>{character.stableCode ?? character.id} · {character.lifecycleState}</small></span><span className="record-code">v{character.rowVersion}</span><ArrowRight size={14} /></button>)}</div>}
         <form className="workspace-form character-create-form" onSubmit={create}><div className="form-grid two"><label>{locale === 'vi' ? 'Tên nhân vật' : 'Character name'}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={locale === 'vi' ? 'Ví dụ: Mai' : 'For example: Mai'} disabled={!connected || creating} /></label><label>{locale === 'vi' ? 'Mã ổn định (tuỳ chọn)' : 'Stable code (optional)'}<input value={stableCode} onChange={(event) => setStableCode(event.target.value)} placeholder="MAYA" disabled={!connected || creating} /></label></div><button className="primary-button small" type="submit" disabled={!connected || !projectId || !name.trim() || creating || !client.createCharacter}>{creating ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}{locale === 'vi' ? 'Tạo CharacterIdentity' : 'Create CharacterIdentity'}</button>{createError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{createError}</span>{createNeedsUser && <small>{locale === 'vi' ? 'Danh sách hiện tại vẫn được giữ nguyên; xử lý mục cần bạn rồi thử lại.' : 'The current list stays intact; resolve the requested action and retry.'}</small>}</div>}</form>
      </section>
      <section className="workspace-panel character-detail-card">{!selected ? <EmptyState icon={Info} title={locale === 'vi' ? 'Chọn một nhân vật' : 'Select a character'} detail={locale === 'vi' ? 'Workspace chi tiết sẽ xuất hiện sau khi Core xác nhận identity.' : 'The detailed workspace appears after Core confirms the identity.'} /> : <><div className="production-card-heading"><div><p className="eyebrow">{selected.stableCode ?? 'CHARACTER'}</p><h2>{selected.displayName}</h2><p>{selected.lifecycleState} · v{selected.rowVersion}</p></div><span className="state-label"><ShieldCheck size={13} />{locale === 'vi' ? 'Core-owned' : 'Core-owned'}</span></div>{workspaceLoading && <div className="inline-state"><RefreshCw size={14} className="spin" />{locale === 'vi' ? 'Đang đọc workspace…' : 'Reading workspace…'}</div>}{workspaceError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{workspaceError}</span><button className="subtle-button tiny" onClick={() => void loadWorkspace(selected.id)}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}{selected.needsYou.length > 0 && <div className="inline-state warning"><UserRound size={14} /><span>{locale === 'vi' ? `Core cần bạn xử lý ${selected.needsYou.length} mục trước khi tiếp tục.` : `Core needs you to resolve ${selected.needsYou.length} item${selected.needsYou.length === 1 ? '' : 's'} before continuing.`}</span></div>}<div className="character-package-grid">{packageRows.map(({ key, label, package: packageValue }) => <div className="character-package" key={key}><div className="character-package-heading"><strong>{label}</strong><span>{packageValue?.candidateRevisions.length ?? 0} {locale === 'vi' ? 'candidate' : 'candidates'}</span></div>{packageValue?.approvedRevision && <div className="revision-row approved"><CheckCircle2 size={13} /><span><strong>{locale === 'vi' ? 'Đã duyệt' : 'Approved'}</strong><small>{packageValue.approvedRevision.id} · {characterRevisionMeta(packageValue.approvedRevision, locale)}</small></span></div>}{packageValue?.candidateRevisions.map((revision) => <div className="revision-row" key={revision.id}><CircleDot size={13} /><span><strong>{revision.id}</strong><small>{characterRevisionMeta(revision, locale)}</small></span></div>)}{!packageValue?.approvedRevision && !packageValue?.candidateRevisions.length && <span className="character-package-empty">{locale === 'vi' ? 'Chưa có revision' : 'No revision yet'}</span>}</div>)}</div><form className="workspace-form character-revision-form" onSubmit={createRevision}><div className="form-grid two"><label>{locale === 'vi' ? 'Loại revision' : 'Revision type'}<select value={revisionKind} onChange={(event) => setRevisionKind(event.target.value as CharacterRevisionKind)} disabled={!connected || revisionPending}><option value="visual">Visual identity</option><option value="voice">Voice identity</option><option value="performance">Performance bible</option></select></label>{revisionKind === 'voice' && <label>{locale === 'vi' ? 'Ngôn ngữ chuẩn' : 'Canonical language'}<input value={revisionLanguage} onChange={(event) => setRevisionLanguage(event.target.value)} disabled={!connected || revisionPending} /></label>}</div><label>{locale === 'vi' ? 'Mô tả semantic' : 'Semantic description'}<textarea value={revisionDescription} onChange={(event) => setRevisionDescription(event.target.value)} rows={3} placeholder={locale === 'vi' ? 'Mô tả có thể kiểm tra; không chèn provider id.' : 'Bounded, reviewable description; do not enter provider ids.'} disabled={!connected || revisionPending} /></label><button className="primary-button small" type="submit" disabled={!connected || !revisionDescription.trim() || revisionPending}>{revisionPending ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}{locale === 'vi' ? 'Lưu revision nháp' : 'Save draft revision'}</button></form><p className="workspace-boundary"><Info size={14} />{locale === 'vi' ? 'Revision nháp không tự động được approve, bind voice, generate hay pin vào shot.' : 'Draft revisions are not auto-approved, voice-bound, generated, or pinned to a shot.'}</p></>}</section>
    </div>
  </div>
}

type TimelineProfileDraft = {
  timelineRateNum: string
  timelineRateDen: string
  timeBaseNum: string
  timeBaseDen: string
  pixelAspectNum: string
  pixelAspectDen: string
  width: string
  height: string
  workingColorSpace: string
  transferFunction: string
  hdrPolicy: string
  audioSampleRate: string
  audioChannelLayout: string
}

function checkedRational(num: string, den: string, allowZero = true) {
  const cleanNum = num.trim()
  const cleanDen = den.trim()
  if (!/^[0-9]+$/.test(cleanNum) || !/^[0-9]+$/.test(cleanDen) || cleanDen === '0') return null
  const parsedNum = Number(cleanNum)
  const parsedDen = Number(cleanDen)
  if (!Number.isSafeInteger(parsedNum) || !Number.isSafeInteger(parsedDen) || (!allowZero && parsedNum === 0)) {
    // Keep large exact integers as strings, but still reject values that are
    // outside Core's practical V1 range when the browser can inspect them.
    if (cleanDen === '0' || (!allowZero && parsedNum === 0)) return null
  }
  return { num: Number.isSafeInteger(parsedNum) ? parsedNum : cleanNum, den: Number.isSafeInteger(parsedDen) ? parsedDen : cleanDen }
}

function timelineStateLabel(state: string, locale: Locale) {
  const labels: Record<string, { vi: string; en: string }> = {
    DRAFT: { vi: 'Bản nháp', en: 'Draft' },
    CANDIDATE: { vi: 'Chờ duyệt', en: 'Candidate' },
    APPROVED: { vi: 'Đã duyệt', en: 'Approved' },
    TIMED: { vi: 'Đã canh thời gian', en: 'Timed' },
    REVIEWED: { vi: 'Đã review', en: 'Reviewed' },
    SELECTED: { vi: 'Đã chọn', en: 'Selected' },
    SUPERSEDED: { vi: 'Đã thay thế', en: 'Superseded' },
    REJECTED: { vi: 'Từ chối', en: 'Rejected' },
    DRAFT_CHECKPOINT: { vi: 'Checkpoint nháp', en: 'Draft checkpoint' },
  }
  return labels[state]?.[locale] ?? state
}

function timelineRevisionTransition(state: string) {
  if (state === 'DRAFT_CHECKPOINT') return 'CANDIDATE'
  if (state === 'CANDIDATE') return 'APPROVED'
  return null
}

function mediaProfileTransition(state: string) {
  if (state === 'DRAFT') return 'CANDIDATE'
  if (state === 'CANDIDATE') return 'APPROVED'
  return null
}

function rationalLabel(value: { num: number | string; den: number | string } | undefined | null) {
  return value ? `${value.num}/${value.den}` : '—'
}

function timelineAssetIsSelectable(asset: AssetSummary, projectId: string) {
  return Boolean(
    asset.projectId && asset.projectId === projectId,
  )
    && String(asset.state).toUpperCase() === 'ACTIVE'
    && String(asset.availability).toUpperCase() === 'AVAILABLE'
    && String(asset.readinessState).toUpperCase() === 'READY'
    && Boolean(asset.revisionId)
    && asset.rights?.eligible === true
    && String(asset.rights.status ?? 'UNKNOWN').toUpperCase() === 'ALLOWED'
}

function timelineAssetBlocker(asset: AssetSummary, projectId: string, locale: Locale) {
  if (!asset.projectId) return locale === 'vi' ? 'Thiếu project scope' : 'Project scope unknown'
  if (asset.projectId !== projectId) return locale === 'vi' ? 'Khác project' : 'Different project'
  if (!asset.revisionId) return locale === 'vi' ? 'Thiếu revision cụ thể' : 'Missing exact revision'
  if (String(asset.state).toUpperCase() !== 'ACTIVE') return locale === 'vi' ? 'Asset không còn active' : 'Asset is not active'
  if (String(asset.availability).toUpperCase() !== 'AVAILABLE') return locale === 'vi' ? 'Chưa materialize/verify' : 'Not materialized/verified'
  if (String(asset.readinessState).toUpperCase() !== 'READY') return locale === 'vi' ? 'Readiness chưa READY' : 'Readiness is not READY'
  if (String(asset.rights?.status ?? 'UNKNOWN').toUpperCase() !== 'ALLOWED' || asset.rights?.eligible !== true) return locale === 'vi' ? 'Thiếu rights/consent ALLOWED' : 'Rights/consent are not ALLOWED'
  return locale === 'vi' ? 'Sẵn sàng' : 'Ready'
}

function timelineAssetOptionLabel(asset: AssetSummary, projectId: string, locale: Locale) {
  const name = asset.name || (locale === 'vi' ? 'Asset không tên' : 'Unnamed asset')
  const revision = asset.revisionId ? asset.revisionId.slice(0, 12) : '—'
  const state = timelineAssetBlocker(asset, projectId, locale)
  return `${name} · ${revision} · ${state}`
}

export function TimelineView({ snapshot, locale, client, onToast }: { snapshot: DashboardSnapshot; locale: Locale; client: CoreClient; onToast: (message: string) => void }) {
  const [projectId, setProjectId] = useState(() => snapshot.projects[0]?.id ?? '')
  const [mediaProfile, setMediaProfile] = useState<MediaProfileWorkspace | null>(null)
  const [timelines, setTimelines] = useState<TimelineSummary[]>([])
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetsError, setAssetsError] = useState<string | null>(null)
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<TimelineWorkspace | null>(null)
  const [workingWorkspace, setWorkingWorkspace] = useState<TimelineWorkingWorkspace | null>(null)
  const [workingHistory, setWorkingHistory] = useState<TimelineWorkingHistory | null>(null)
  const [workingHistoryLoading, setWorkingHistoryLoading] = useState(false)
  const [workingHistoryError, setWorkingHistoryError] = useState<string | null>(null)
  const [workingHistoryNeedsUser, setWorkingHistoryNeedsUser] = useState(false)
  const [workingLoading, setWorkingLoading] = useState(false)
  const [workingError, setWorkingError] = useState<string | null>(null)
  const [markerNum, setMarkerNum] = useState('0')
  const [markerDen, setMarkerDen] = useState('1')
  const [markerLabel, setMarkerLabel] = useState('Beat')
  const [clipTargetId, setClipTargetId] = useState('')
  const [clipMoveNum, setClipMoveNum] = useState('0')
  const [clipMoveDen, setClipMoveDen] = useState('1')
  const [clipTrimEdge, setClipTrimEdge] = useState<'IN' | 'OUT'>('OUT')
  const [clipTrimNum, setClipTrimNum] = useState('1')
  const [clipTrimDen, setClipTrimDen] = useState('1')
  const [insertTrackId, setInsertTrackId] = useState('')
  const [insertAssetRevisionId, setInsertAssetRevisionId] = useState('')
  const [insertClipId, setInsertClipId] = useState('')
  const [insertTimelineInNum, setInsertTimelineInNum] = useState('0')
  const [insertTimelineInDen, setInsertTimelineInDen] = useState('1')
  const [insertTimelineOutNum, setInsertTimelineOutNum] = useState('1')
  const [insertTimelineOutDen, setInsertTimelineOutDen] = useState('1')
  const [insertSourceInNum, setInsertSourceInNum] = useState('0')
  const [insertSourceInDen, setInsertSourceInDen] = useState('1')
  const [insertSourceOutNum, setInsertSourceOutNum] = useState('1')
  const [insertSourceOutDen, setInsertSourceOutDen] = useState('1')
  const [clientInstanceId] = useState(() => {
    try {
      const existing = localStorage.getItem('cineforge-timeline-client-instance')
      if (existing) return existing
      const next = crypto.randomUUID()
      localStorage.setItem('cineforge-timeline-client-instance', next)
      return next
    } catch {
      return `browser-${Math.random().toString(36).slice(2)}`
    }
  })
  const [loading, setLoading] = useState(false)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [needsUser, setNeedsUser] = useState(false)
  const [mutating, setMutating] = useState<string | null>(null)
  const [timelineTitle, setTimelineTitle] = useState('')
  const [timelineCode, setTimelineCode] = useState('MAIN')
  const [durationNum, setDurationNum] = useState('1')
  const [durationDen, setDurationDen] = useState('1')
  const [tracksJson, setTracksJson] = useState('[]')
  const [markersJson, setMarkersJson] = useState('[]')
  const [profileDraft, setProfileDraft] = useState<TimelineProfileDraft>({
    timelineRateNum: '24', timelineRateDen: '1', timeBaseNum: '1', timeBaseDen: '24',
    pixelAspectNum: '1', pixelAspectDen: '1', width: '1920', height: '1080',
    workingColorSpace: 'REC709', transferFunction: 'SDR', hdrPolicy: 'DISABLED',
    audioSampleRate: '48000', audioChannelLayout: 'STEREO',
  })
  const loadGenerationRef = useRef(0)
  const workspaceGenerationRef = useRef(0)
  const historyGenerationRef = useRef(0)
  const historyAbortRef = useRef<AbortController | null>(null)

  const connected = snapshot.system.connected && !snapshot.system.offline && (client.isLive?.() ?? true)
  const project = snapshot.projects.find((candidate) => candidate.id === projectId)
  const approvedProfile = mediaProfile?.approvedRevision ?? workspace?.mediaProfile?.approvedRevision ?? null
  const selectedTimeline = timelines.find((timeline) => timeline.id === selectedTimelineId) ?? null
  const workingSession = workingWorkspace?.session ?? null
  const workingTracks = workingSession?.draft.tracks ?? []
  const workingClips = workingTracks.flatMap((track) => track.clips.map((clip) => ({ track, clip })))
  const selectedWorkingClip = workingClips.find(({ clip }) => clip.id === clipTargetId)?.clip ?? null
  const previewAssetRevisionId = insertAssetRevisionId || selectedWorkingClip?.assetRevisionId || ''
  const previewAsset = assets.find((asset) => asset.revisionId === previewAssetRevisionId) ?? null
  const workingEditable = Boolean(workingSession && !['AUTOSAVING', 'CHECKPOINTING', 'CONFLICT', 'RECOVERY_REQUIRED', 'CLOSED', 'ABANDONED'].includes(workingSession.state))

  useEffect(() => {
    if (!projectId && snapshot.projects[0]) setProjectId(snapshot.projects[0].id)
    if (projectId && !snapshot.projects.some((candidate) => candidate.id === projectId)) setProjectId(snapshot.projects[0]?.id ?? '')
  }, [projectId, snapshot.projects])

  const loadProjectData = useCallback(async (signal?: AbortSignal) => {
    const generation = ++loadGenerationRef.current
    if (!projectId) {
      setMediaProfile(null)
      setTimelines([])
      setAssets([])
      setAssetsError(null)
      setAssetsLoading(false)
      setInsertAssetRevisionId('')
      setSelectedTimelineId(null)
      setWorkspace(null)
      setLoading(false)
      return
    }
    if (!client.getMediaProfile || !client.getTimelines) {
      setError(locale === 'vi' ? 'Core chưa cung cấp workspace Timeline.' : 'Core does not expose the Timeline workspace yet.')
      setAssetsLoading(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setAssetsLoading(Boolean(client.getAssets))
    setError(null)
    setAssetsError(null)
    setWorkspaceError(null)
    try {
      const assetResult = client.getAssets
        ? client.getAssets(projectId, signal).then((value) => ({ assets: value, error: null as unknown })).catch((cause) => ({ assets: [] as AssetSummary[], error: cause }))
        : Promise.resolve({ assets: [] as AssetSummary[], error: null as unknown })
      const [profileResult, timelineResult, loadedAssets] = await Promise.all([
        client.getMediaProfile(projectId, signal),
        client.getTimelines(projectId, signal),
        assetResult,
      ])
      if (signal?.aborted || generation !== loadGenerationRef.current) return
      setMediaProfile(profileResult)
      setTimelines(timelineResult)
      setAssets(loadedAssets.assets)
      setAssetsError(loadedAssets.error ? workspaceErrorMessage(loadedAssets.error, locale) : null)
      setInsertAssetRevisionId((current) => loadedAssets.assets.some((asset) => asset.revisionId === current && timelineAssetIsSelectable(asset, projectId)) ? current : '')
      setSelectedTimelineId((current) => current && timelineResult.some((item) => item.id === current) ? current : timelineResult[0]?.id ?? null)
      if (timelineResult.length === 0) setWorkspace(null)
    } catch (cause) {
      if ((cause instanceof DOMException && cause.name === 'AbortError') || generation !== loadGenerationRef.current) return
      setError(workspaceErrorMessage(cause, locale))
      setMediaProfile(null)
      setTimelines([])
      setAssets([])
      setAssetsError(null)
      setInsertAssetRevisionId('')
      setSelectedTimelineId(null)
      setWorkspace(null)
    } finally {
      if (!signal?.aborted && generation === loadGenerationRef.current) {
        setLoading(false)
        setAssetsLoading(false)
      }
    }
  }, [client, locale, projectId])

  useEffect(() => {
    const controller = new AbortController()
    // A project switch must never leave the previous project's records
    // visible if this bridge lacks the new query methods or the request fails.
    setMediaProfile(null)
    setTimelines([])
    setAssets([])
    setAssetsError(null)
    setAssetsLoading(false)
    setInsertAssetRevisionId('')
    setSelectedTimelineId(null)
    setWorkspace(null)
    setWorkingWorkspace(null)
    setWorkingError(null)
    setActionError(null)
    setNeedsUser(false)
    void loadProjectData(controller.signal)
    return () => controller.abort()
  }, [loadProjectData])

  const loadWorkspace = useCallback(async (timelineId: string, signal?: AbortSignal) => {
    const generation = ++workspaceGenerationRef.current
    if (!client.getTimelineWorkspace) {
      setWorkspaceError(locale === 'vi' ? 'Core chưa cung cấp chi tiết Timeline.' : 'Core does not expose Timeline details yet.')
      return
    }
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      const next = await client.getTimelineWorkspace(projectId, timelineId, signal)
      if (signal?.aborted || generation !== workspaceGenerationRef.current) return
      setWorkspace(next)
    } catch (cause) {
      if ((cause instanceof DOMException && cause.name === 'AbortError') || generation !== workspaceGenerationRef.current) return
      setWorkspaceError(workspaceErrorMessage(cause, locale))
      setWorkspace(null)
    } finally {
      if (!signal?.aborted && generation === workspaceGenerationRef.current) setWorkspaceLoading(false)
    }
  }, [client, locale, projectId])

  useEffect(() => {
    if (!selectedTimelineId || !projectId) {
      setWorkspace(null)
      setWorkspaceError(null)
      return
    }
    const controller = new AbortController()
    void loadWorkspace(selectedTimelineId, controller.signal)
    return () => controller.abort()
  }, [loadWorkspace, projectId, selectedTimelineId])

  const workingSessionStorageKey = projectId && selectedTimelineId ? `cineforge-working-session:${projectId}:${selectedTimelineId}` : null

  const loadWorkingSession = useCallback(async (timelineId: string, signal?: AbortSignal) => {
    if (!projectId || !client.getTimelineWorkingSession || !workingSessionStorageKey) {
      setWorkingWorkspace(null)
      setWorkingError(null)
      return
    }
    let sessionId: string | null = null
    try { sessionId = localStorage.getItem(workingSessionStorageKey) } catch { sessionId = null }
    if (!sessionId) {
      setWorkingWorkspace(null)
      setWorkingError(null)
      return
    }
    setWorkingLoading(true)
    setWorkingError(null)
    try {
      const next = await client.getTimelineWorkingSession(projectId, timelineId, sessionId, signal)
      if (!signal?.aborted) {
        if (['CLOSED', 'ABANDONED'].includes(next.session?.state ?? '')) {
          try { localStorage.removeItem(workingSessionStorageKey) } catch { /* optional recovery hint */ }
          setWorkingWorkspace(null)
        } else setWorkingWorkspace(next)
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      // A terminal session can remain in Core for audit, but a deleted or
      // unknown local pointer must not block starting a fresh session.
      if (cause instanceof CoreClientError && cause.code === 'TIMELINE_WORKING_SESSION_NOT_FOUND') {
        try { localStorage.removeItem(workingSessionStorageKey) } catch { /* storage may be unavailable */ }
        setWorkingWorkspace(null)
        setWorkingError(null)
      } else setWorkingError(workspaceErrorMessage(cause, locale))
    } finally {
      if (!signal?.aborted) setWorkingLoading(false)
    }
  }, [client, locale, projectId, workingSessionStorageKey])

  useEffect(() => {
    if (!selectedTimelineId || !projectId) {
      setWorkingWorkspace(null)
      setWorkingError(null)
      return
    }
    const controller = new AbortController()
    void loadWorkingSession(selectedTimelineId, controller.signal)
    return () => controller.abort()
  }, [loadWorkingSession, projectId, selectedTimelineId])

  useEffect(() => {
    historyAbortRef.current?.abort()
    historyAbortRef.current = null
    historyGenerationRef.current += 1
    setWorkingHistory(null)
    setWorkingHistoryError(null)
    setWorkingHistoryNeedsUser(false)
    setWorkingHistoryLoading(false)
  }, [projectId, selectedTimelineId, workingWorkspace?.session?.id])

  const loadWorkingHistory = useCallback(async (reset = false) => {
    const sessionId = workingWorkspace?.session?.id
    if (!client.getTimelineWorkingHistory || !projectId || !selectedTimelineId || !sessionId) {
      setWorkingHistoryError(client.getTimelineWorkingHistory ? null : (locale === 'vi' ? 'Bridge hiện tại chưa cung cấp history phiên chỉnh sửa.' : 'This bridge does not expose working-session history yet.'))
      setWorkingHistoryNeedsUser(false)
      return
    }
    historyAbortRef.current?.abort()
    const controller = new AbortController()
    historyAbortRef.current = controller
    const generation = ++historyGenerationRef.current
    const afterOpSeq = reset ? 0 : workingHistory?.cursor.afterOpSeq ?? 0
    setWorkingHistoryLoading(true)
    setWorkingHistoryError(null)
    setWorkingHistoryNeedsUser(false)
    try {
      const next = await client.getTimelineWorkingHistory(projectId, selectedTimelineId, sessionId, afterOpSeq, 100, controller.signal)
      if (controller.signal.aborted || generation !== historyGenerationRef.current) return
      setWorkingHistory((current) => reset ? mergeTimelineWorkingHistory(null, next) : mergeTimelineWorkingHistory(current, next))
    } catch (cause) {
      if (controller.signal.aborted || generation !== historyGenerationRef.current) return
      setWorkingHistoryError(workspaceErrorMessage(cause, locale))
      setWorkingHistoryNeedsUser(cause instanceof CoreClientError && cause.needsUser)
    } finally {
      if (!controller.signal.aborted && generation === historyGenerationRef.current) setWorkingHistoryLoading(false)
    }
  }, [client, locale, projectId, selectedTimelineId, workingHistory?.cursor.afterOpSeq, workingWorkspace?.session?.id])

  const updateProfileDraft = (key: keyof TimelineProfileDraft) => (event: ChangeEvent<HTMLInputElement>) => {
    setProfileDraft((current) => ({ ...current, [key]: event.target.value }))
  }

  const createProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!client.createMediaProfileRevision || !projectId || mutating) return
    const timelineRate = checkedRational(profileDraft.timelineRateNum, profileDraft.timelineRateDen, false)
    const timeBase = checkedRational(profileDraft.timeBaseNum, profileDraft.timeBaseDen, false)
    const pixelAspect = checkedRational(profileDraft.pixelAspectNum, profileDraft.pixelAspectDen, false)
    const width = Number(profileDraft.width)
    const height = Number(profileDraft.height)
    const audioSampleRate = Number(profileDraft.audioSampleRate)
    if (!timelineRate || !timeBase || !pixelAspect || !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(audioSampleRate) || audioSampleRate <= 0) {
      setActionError(locale === 'vi' ? 'Media Profile cần rational hợp lệ và kích thước dương.' : 'Media Profile needs valid rationals and positive dimensions.')
      setNeedsUser(true)
      return
    }
    setMutating('profile-create')
    setActionError(null)
    setNeedsUser(false)
    try {
      const next = await client.createMediaProfileRevision(projectId, {
        timelineRate, timeBase, pixelAspect, width, height,
        workingColorSpace: profileDraft.workingColorSpace.trim() || 'UNKNOWN',
        transferFunction: profileDraft.transferFunction.trim() || 'UNKNOWN',
        hdrPolicy: profileDraft.hdrPolicy.trim() || 'UNKNOWN',
        audioSampleRate,
        audioChannelLayout: profileDraft.audioChannelLayout.trim() || 'UNKNOWN',
      }, `media-profile-create:${projectId}:${JSON.stringify(profileDraft)}`)
      setMediaProfile(next)
      onToast(locale === 'vi' ? 'Đã lưu Media Profile candidate. Cần chuyển trạng thái riêng trước khi pin vào timeline.' : 'Media Profile candidate saved. Transition it separately before pinning it to a timeline.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      setMutating(null)
    }
  }

  const transitionProfile = async (revision: MediaProfileRevision, nextState: string) => {
    if (!client.transitionMediaProfileRevision || !projectId || !revision.id || mutating) return
    setMutating(`profile-transition:${revision.id}`)
    setActionError(null)
    setNeedsUser(false)
    try {
      const next = await client.transitionMediaProfileRevision(projectId, revision.id, nextState, revision.rowVersion, `media-profile-transition:${revision.id}:${revision.rowVersion}:${nextState}`)
      setMediaProfile(next)
      onToast(locale === 'vi' ? `Media Profile đã chuyển sang ${timelineStateLabel(nextState, locale)}.` : `Media Profile moved to ${timelineStateLabel(nextState, locale)}.`)
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      setMutating(null)
    }
  }

  const createTimeline = async (event: FormEvent) => {
    event.preventDefault()
    if (!client.createTimeline || !projectId || !approvedProfile?.id || !timelineTitle.trim() || !timelineCode.trim() || mutating) return
    setMutating('timeline-create')
    setActionError(null)
    setNeedsUser(false)
    try {
      const created = await client.createTimeline(projectId, {
        title: timelineTitle.trim(), code: timelineCode.trim().toUpperCase(), scopeType: 'PROJECT', mediaProfileRevisionId: approvedProfile.id,
      }, `timeline-create:${projectId}:${timelineCode.trim().toUpperCase()}`)
      const nextTimelines = [created, ...timelines.filter((item) => item.id !== created.id)]
      setTimelines(nextTimelines)
      setSelectedTimelineId(created.id ?? null)
      setTimelineTitle('')
      onToast(locale === 'vi' ? `Đã tạo timeline “${created.title}”.` : `Timeline “${created.title}” created.`)
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      setMutating(null)
    }
  }

  const createRevision = async (event: FormEvent) => {
    event.preventDefault()
    if (!client.createTimelineRevision || !projectId || !selectedTimelineId || !workspace || !approvedProfile?.id || mutating) return
    const duration = checkedRational(durationNum, durationDen, false)
    if (!duration) {
      setActionError(locale === 'vi' ? 'Duration phải là rational dương, ví dụ 24000/1001.' : 'Duration must be a positive rational, for example 24000/1001.')
      setNeedsUser(true)
      return
    }
    let parsedTracks: unknown
    let parsedMarkers: unknown
    try {
      parsedTracks = JSON.parse(tracksJson)
      parsedMarkers = JSON.parse(markersJson)
    } catch {
      setActionError(locale === 'vi' ? 'Tracks và markers phải là JSON hợp lệ.' : 'Tracks and markers must be valid JSON.')
      setNeedsUser(true)
      return
    }
    if (!Array.isArray(parsedTracks) || !Array.isArray(parsedMarkers)
      || parsedTracks.some((track) => !track || typeof track !== 'object' || Array.isArray(track)
        || ((track as Record<string, unknown>).trackType ?? (track as Record<string, unknown>).track_type ?? 'VIDEO') !== 'VIDEO'
        || !Array.isArray((track as Record<string, unknown>).clips ?? []))) {
      setActionError(locale === 'vi' ? 'Tracks phải là mảng VIDEO có clips; markers phải là mảng object.' : 'Tracks must be a VIDEO array with clips; markers must be an object array.')
      setNeedsUser(true)
      return
    }
    if (parsedMarkers.some((marker) => !marker || typeof marker !== 'object' || Array.isArray(marker))) {
      setActionError(locale === 'vi' ? 'Markers phải là mảng object hợp lệ.' : 'Markers must be an array of valid objects.')
      setNeedsUser(true)
      return
    }
    setMutating('timeline-revision-create')
    setActionError(null)
    setNeedsUser(false)
    try {
      const next = await client.createTimelineRevision(projectId, selectedTimelineId, {
        mediaProfileRevisionId: approvedProfile.id,
        duration,
        tracks: parsedTracks as TimelineSnapshotInput['tracks'],
        markers: parsedMarkers as TimelineSnapshotInput['markers'],
      }, workspace.timeline.rowVersion, `timeline-revision-create:${selectedTimelineId}:${workspace.timeline.rowVersion}:${duration.num}/${duration.den}:${tracksJson}:${markersJson}`)
      setWorkspace(next)
      setTimelines((current) => current.map((item) => item.id === next.timeline.id ? next.timeline : item))
      onToast(locale === 'vi' ? 'Đã lưu checkpoint timeline bất biến.' : 'Immutable timeline checkpoint saved.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      setMutating(null)
    }
  }

  const transitionRevision = async (revision: TimelineRevision, nextState: string) => {
    const transition = client.transitionTimelineRevision
    if ((!transition && !(nextState === 'APPROVED' && client.openReview)) || !projectId || !selectedTimelineId || !revision.id || mutating) return
    setMutating(`timeline-transition:${revision.id}`)
    setActionError(null)
    setNeedsUser(false)
    try {
      if (nextState === 'APPROVED') {
        if (!client.openReview) throw new CoreClientError('Review workspace is not available.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', needsUser: true })
        await client.openReview(projectId, revision.id, revision.rowVersion, `review-open:${revision.id}:${revision.rowVersion}`)
        onToast(locale === 'vi' ? 'Đã mở review cho checkpoint. Chuyển sang Duyệt để ghi quyết định.' : 'Review opened for this checkpoint. Go to Review to record the decision.')
        return
      }
      if (!transition) throw new CoreClientError('Timeline transitions are not available.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', needsUser: true })
      const next = await transition(projectId, selectedTimelineId, revision.id, nextState, revision.rowVersion, `timeline-transition:${revision.id}:${revision.rowVersion}:${nextState}`)
      setWorkspace(next)
      setTimelines((current) => current.map((item) => item.id === next.timeline.id ? next.timeline : item))
      onToast(locale === 'vi' ? `Revision timeline đã chuyển sang ${timelineStateLabel(nextState, locale)}.` : `Timeline revision moved to ${timelineStateLabel(nextState, locale)}.`)
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      setMutating(null)
    }
  }

  const rememberWorkingWorkspace = (next: TimelineWorkingWorkspace) => {
    if (['CLOSED', 'ABANDONED'].includes(next.session?.state ?? '')) {
      setWorkingWorkspace(null)
      if (workingSessionStorageKey) { try { localStorage.removeItem(workingSessionStorageKey) } catch { /* optional recovery hint */ } }
      return
    }
    setWorkingWorkspace(next)
    setWorkingHistory(null)
    setWorkingHistoryError(null)
    setWorkingHistoryNeedsUser(false)
    const nextId = next.session?.id
    if (workingSessionStorageKey && nextId) {
      try { localStorage.setItem(workingSessionStorageKey, nextId) } catch { /* local storage is an optional recovery hint */ }
    }
  }

  const beginWorkingSession = async () => {
    const begin = client.beginTimelineWorkingSession
    const base = currentRevision
    if (!begin || !projectId || !selectedTimelineId || !workspace || !base?.id || !base.editHash || mutating) return
    setMutating('timeline-working-begin')
    setWorkingError(null); setActionError(null); setNeedsUser(false)
    try {
      const next = await begin(projectId, selectedTimelineId, {
        baseRevisionId: base.id,
        baseRevisionRowVersion: base.rowVersion,
        baseContentHash: base.editHash,
        clientInstanceId,
        expectedTimelineVersion: workspace.timeline.rowVersion,
      }, `timeline-working-begin:${selectedTimelineId}:${base.id}:${workspace.timeline.rowVersion}:${clientInstanceId}`)
      rememberWorkingWorkspace(next)
      onToast(locale === 'vi' ? 'Đã mở phiên chỉnh sửa timeline trên revision cụ thể.' : 'Opened a timeline editing session on the exact revision.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setWorkingError(workspaceErrorMessage(cause, locale))
    } finally { setMutating(null) }
  }

  const applyWorkingOperation = async (operation: Record<string, unknown>, successVi: string, successEn: string) => {
    const apply = client.applyTimelineEditOps
    const session = workingWorkspace?.session
    if (!apply || !projectId || !selectedTimelineId || !session?.id || !workingEditable || mutating) return
    setMutating('timeline-working-apply'); setWorkingError(null); setActionError(null); setNeedsUser(false)
    try {
      const next = await apply(projectId, selectedTimelineId, session.id, [operation], session.rowVersion, `timeline-working-op:${session.id}:${session.rowVersion}:${JSON.stringify(operation)}`)
      rememberWorkingWorkspace(next)
      onToast(locale === 'vi' ? successVi : successEn)
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setWorkingError(workspaceErrorMessage(cause, locale))
    } finally { setMutating(null) }
  }

  const applyMarker = async (event: FormEvent) => {
    event.preventDefault()
    const session = workingWorkspace?.session
    if (!session?.id || !workingEditable) return
    const time = checkedRational(markerNum, markerDen, true)
    if (!time || !markerLabel.trim()) {
      setWorkingError(locale === 'vi' ? 'Marker cần thời gian rational hợp lệ và nhãn.' : 'A marker needs a valid rational time and label.')
      return
    }
    const operation = { op_type: 'ADD_MARKER', payload: { id: `marker-${session.nextOpSeq}`, time, marker_type: 'NOTE', label: markerLabel.trim(), payload: {} } }
    await applyWorkingOperation(operation, 'Đã thêm marker vào bản nháp.', 'Marker added to the working draft.')
  }

  const applyMoveClip = async (event: FormEvent) => {
    event.preventDefault()
    if (!clipTargetId.trim()) { setWorkingError(locale === 'vi' ? 'Chọn clip cần di chuyển.' : 'Choose a clip to move.'); return }
    const timelineIn = checkedRational(clipMoveNum, clipMoveDen, true)
    if (!timelineIn) { setWorkingError(locale === 'vi' ? 'Vị trí mới phải là rational hợp lệ.' : 'The new position must be a valid rational.'); return }
    await applyWorkingOperation({ op_type: 'MOVE_CLIP', payload: { clip_id: clipTargetId, timeline_in: timelineIn } }, 'Đã di chuyển clip trong bản nháp.', 'Clip moved in the working draft.')
  }

  const applyTrimClip = async (event: FormEvent) => {
    event.preventDefault()
    if (!clipTargetId.trim()) { setWorkingError(locale === 'vi' ? 'Chọn clip cần trim.' : 'Choose a clip to trim.'); return }
    const value = checkedRational(clipTrimNum, clipTrimDen, clipTrimEdge === 'IN')
    if (!value) { setWorkingError(locale === 'vi' ? 'Mốc trim phải là rational hợp lệ.' : 'The trim point must be a valid rational.'); return }
    const operation = clipTrimEdge === 'IN'
      ? { op_type: 'TRIM_CLIP', payload: { clip_id: clipTargetId, edge: 'IN', timeline_in: value } }
      : { op_type: 'TRIM_CLIP', payload: { clip_id: clipTargetId, edge: 'OUT', timeline_out: value } }
    await applyWorkingOperation(operation, 'Đã trim clip trong bản nháp.', 'Clip trimmed in the working draft.')
  }

  const applyDeleteClip = async () => {
    if (!clipTargetId.trim() || !workingEditable) { setWorkingError(locale === 'vi' ? 'Chọn clip cần xoá.' : 'Choose a clip to delete.'); return }
    if (!window.confirm(locale === 'vi' ? 'Xoá clip khỏi bản nháp? Thao tác này sẽ được ghi vào history.' : 'Delete this clip from the draft? The action will remain in history.')) return
    await applyWorkingOperation({ op_type: 'DELETE_CLIP', payload: { clip_id: clipTargetId } }, 'Đã xoá clip khỏi bản nháp.', 'Clip deleted from the working draft.')
  }

  const applyInsertClip = async (event: FormEvent) => {
    event.preventDefault()
    if (!insertTrackId.trim() || !insertAssetRevisionId.trim()) {
      setWorkingError(locale === 'vi' ? 'Insert clip cần track ID và asset revision ID cụ thể.' : 'Insert clip needs an exact track ID and asset revision ID.')
      return
    }
    const timelineIn = checkedRational(insertTimelineInNum, insertTimelineInDen, true)
    const timelineOut = checkedRational(insertTimelineOutNum, insertTimelineOutDen, false)
    const sourceIn = checkedRational(insertSourceInNum, insertSourceInDen, true)
    const sourceOut = checkedRational(insertSourceOutNum, insertSourceOutDen, false)
    if (!timelineIn || !timelineOut || !sourceIn || !sourceOut) {
      setWorkingError(locale === 'vi' ? 'Insert clip cần các khoảng thời gian rational hợp lệ.' : 'Insert clip needs valid rational timing intervals.')
      return
    }
    const generatedId = insertClipId.trim() || `clip-${workingSession?.nextOpSeq ?? Date.now()}`
    const operation = { op_type: 'INSERT_CLIP', payload: { track_id: insertTrackId.trim(), clip: { id: generatedId, asset_revision_id: insertAssetRevisionId.trim(), source_in: sourceIn, source_out: sourceOut, timeline_in: timelineIn, timeline_out: timelineOut, speed: { num: 1, den: 1 } } } }
    await applyWorkingOperation(operation, 'Đã chèn clip vào bản nháp.', 'Clip inserted into the working draft.')
  }

  const runWorkingCommand = async (kind: 'undo' | 'redo' | 'autosave' | 'checkpoint' | 'close', disposition?: 'SAVE' | 'ABANDON') => {
    const session = workingWorkspace?.session
    if (!projectId || !selectedTimelineId || !session?.id || mutating) return
    const action = kind === 'undo' ? client.undoTimelineEditOp : kind === 'redo' ? client.redoTimelineEditOp : kind === 'autosave' ? client.autosaveTimelineWorkingSession : kind === 'checkpoint' ? client.checkpointTimelineWorkingSession : client.closeTimelineWorkingSession
    if (!action) return
    setMutating(`timeline-working-${kind}`); setWorkingError(null); setActionError(null); setNeedsUser(false)
    try {
      let next: TimelineWorkingWorkspace
      if (kind === 'checkpoint') {
        next = await client.checkpointTimelineWorkingSession!(projectId, selectedTimelineId, session.id, session.rowVersion, workspace?.timeline.rowVersion ?? 0, `timeline-working-checkpoint:${session.id}:${session.rowVersion}:${workspace?.timeline.rowVersion ?? 0}`)
        if (next.timeline) setTimelines((current) => current.map((item) => item.id === next.timeline?.id ? next.timeline! : item))
        if (selectedTimelineId) await loadWorkspace(selectedTimelineId)
      } else if (kind === 'close') {
        next = await client.closeTimelineWorkingSession!(projectId, selectedTimelineId, session.id, disposition ?? 'ABANDON', session.rowVersion, `timeline-working-close:${session.id}:${session.rowVersion}:${disposition ?? 'ABANDON'}`)
      } else if (kind === 'undo') next = await client.undoTimelineEditOp!(projectId, selectedTimelineId, session.id, session.rowVersion, `timeline-working-undo:${session.id}:${session.rowVersion}`)
      else if (kind === 'redo') next = await client.redoTimelineEditOp!(projectId, selectedTimelineId, session.id, session.rowVersion, `timeline-working-redo:${session.id}:${session.rowVersion}`)
      else next = await client.autosaveTimelineWorkingSession!(projectId, selectedTimelineId, session.id, session.rowVersion, `timeline-working-autosave:${session.id}:${session.rowVersion}`)
      rememberWorkingWorkspace(next)
      onToast(locale === 'vi' ? (kind === 'autosave' ? 'Đã autosave bản nháp bền vững.' : kind === 'checkpoint' ? 'Đã tạo checkpoint immutable từ phiên chỉnh sửa.' : kind === 'close' ? 'Đã đóng phiên chỉnh sửa.' : `Đã ${kind === 'undo' ? 'undo' : 'redo'} thao tác.`) : (kind === 'autosave' ? 'Draft autosaved durably.' : kind === 'checkpoint' ? 'Immutable checkpoint created from the working session.' : kind === 'close' ? 'Editing session closed.' : `${kind === 'undo' ? 'Undo' : 'Redo'} completed.`))
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setWorkingError(workspaceErrorMessage(cause, locale))
    } finally { setMutating(null) }
  }

  const currentRevision = workspace?.currentRevision
  const revisions = workspace?.revisions ?? []
  const profileRevisions = mediaProfile?.revisions ?? []
  const historyOperations = workingHistory?.operations ?? []
  const historyActions = workingHistory?.historyActions ?? []

  return <div className="page timeline-page">
    <div className="page-heading"><div><p className="eyebrow">CANONICAL TIMELINE</p><h1>{locale === 'vi' ? 'Timeline' : 'Timeline'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Media Profile và checkpoint bất biến được Core quản lý; playback, render và export sẽ triển khai ở phase sau.' : 'Core-owned Media Profiles and immutable checkpoints; playback, render and export are deferred to a later phase.'}</p></div><div className="page-heading-actions"><button className="subtle-button tiny" onClick={() => void loadProjectData()}><RefreshCw size={13} />{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button><span className="count-chip"><Film size={15} />{timelines.length}</span></div></div>
    <div className="timeline-toolbar"><label>{locale === 'vi' ? 'Project' : 'Project'}<select className="timeline-project-select" value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={locale === 'vi' ? 'Project Timeline' : 'Timeline project'}><option value="">{locale === 'vi' ? 'Chọn project' : 'Choose a project'}</option>{snapshot.projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>{project && <span className="state-label"><ShieldCheck size={13} />{connected ? (locale === 'vi' ? 'Core đã kết nối' : 'Core connected') : (locale === 'vi' ? 'Core offline' : 'Core offline')}</span>}</div>
    {!connected && <div className="inline-state warning"><CloudOff size={14} /><span>{locale === 'vi' ? 'Core đang offline. Có thể xem dữ liệu đã tải; command thay đổi canonical sẽ bị khoá.' : 'Core is offline. Loaded data remains visible; canonical mutations are disabled.'}</span></div>}
    {error && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{error}</span><button className="subtle-button tiny" onClick={() => void loadProjectData()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}
    {actionError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{actionError}</span>{needsUser && <small>{locale === 'vi' ? 'Core cần bạn xử lý điều kiện hoặc xung đột rồi thử lại.' : 'Core needs you to resolve the condition or conflict before retrying.'}</small>}</div>}
    {!project ? <EmptyState icon={Film} title={locale === 'vi' ? 'Chưa có project' : 'No project selected'} detail={locale === 'vi' ? 'Tạo project trước khi xây dựng timeline.' : 'Create a project before building a timeline.'} /> : loading ? <LoadingState label={locale === 'vi' ? 'Đang đọc Media Profile và timeline từ Core…' : 'Reading Media Profile and timelines from Core…'} /> : <div className="timeline-grid">
      <section className="workspace-panel timeline-card timeline-list-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><Film size={16} /></span><div><h2>{locale === 'vi' ? 'Timeline của project' : 'Project timelines'}</h2><p>{locale === 'vi' ? 'Chọn một timeline để xem checkpoint.' : 'Select a timeline to inspect its checkpoints.'}</p></div></div><span className="count-chip">{timelines.length}</span></div>{timelines.length === 0 ? <EmptyState icon={Film} title={locale === 'vi' ? 'Chưa có timeline' : 'No timelines yet'} detail={locale === 'vi' ? 'Cần Media Profile đã duyệt để tạo timeline đầu tiên.' : 'An approved Media Profile is required before creating the first timeline.'} /> : <div className="timeline-record-list">{timelines.map((timeline) => <button type="button" className={`timeline-row ${timeline.id === selectedTimelineId ? 'active' : ''}`} key={timeline.id} onClick={() => setSelectedTimelineId(timeline.id ?? null)}><span className="timeline-row-icon"><Layers3 size={15} /></span><span className="workspace-record-main"><strong>{timeline.title}</strong><small>{timeline.code ?? timeline.id} · v{timeline.rowVersion}</small></span><ArrowRight size={14} /></button>)}</div>}
        <form className="workspace-form timeline-form" onSubmit={createTimeline}><div className="form-grid two"><label>{locale === 'vi' ? 'Tên timeline' : 'Timeline title'}<input value={timelineTitle} onChange={(event) => setTimelineTitle(event.target.value)} placeholder={locale === 'vi' ? 'Ví dụ: Bản dựng chính' : 'For example: Main cut'} disabled={!connected || mutating !== null} /></label><label>{locale === 'vi' ? 'Mã ổn định' : 'Stable code'}<input value={timelineCode} onChange={(event) => setTimelineCode(event.target.value.toUpperCase())} placeholder="MAIN" disabled={!connected || mutating !== null} /></label></div><button className="primary-button small" type="submit" disabled={!connected || !approvedProfile?.id || !timelineTitle.trim() || !timelineCode.trim() || mutating !== null || !client.createTimeline}>{mutating === 'timeline-create' ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}{locale === 'vi' ? 'Tạo timeline' : 'Create timeline'}</button>{!approvedProfile && <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Timeline chỉ pin Media Profile revision đã APPROVED.' : 'A timeline can only pin an APPROVED Media Profile revision.'}</p>}</form>
      </section>
      <section className="workspace-panel timeline-card timeline-profile-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon amber"><Database size={16} /></span><div><h2>{locale === 'vi' ? 'Media Profile' : 'Media Profile'}</h2><p>{locale === 'vi' ? 'Rational rõ ràng; không tự động approve.' : 'Explicit rationals; approval is always separate.'}</p></div></div>{approvedProfile && <span className="health-pill healthy"><span />{locale === 'vi' ? 'Đã duyệt' : 'Approved'}</span>}</div>{profileRevisions.length === 0 && <EmptyInline icon={Info} text={locale === 'vi' ? 'Chưa có revision Media Profile.' : 'No Media Profile revision yet.'} />}<div className="timeline-profile-revisions">{profileRevisions.map((revision) => { const nextState = mediaProfileTransition(revision.state); return <div className="timeline-profile-revision" key={revision.id}><div><strong>{revision.id ?? 'revision'}</strong><small>{timelineStateLabel(revision.state, locale)} · {revision.width}×{revision.height} · {rationalLabel(revision.timelineRate)} · v{revision.rowVersion}</small></div>{nextState && <button className="subtle-button tiny" disabled={!connected || mutating !== null} onClick={() => void transitionProfile(revision, nextState)}>{mutating === `profile-transition:${revision.id}` ? <RefreshCw size={12} className="spin" /> : <ArrowRight size={12} />}{timelineStateLabel(nextState, locale)}</button>}</div> })}</div><form className="workspace-form timeline-profile-form" onSubmit={createProfile}><div className="form-grid two"><label>{locale === 'vi' ? 'Frame rate (num)' : 'Frame rate (num)'}<input value={profileDraft.timelineRateNum} onChange={updateProfileDraft('timelineRateNum')} inputMode="numeric" disabled={!connected || mutating !== null} /></label><label>{locale === 'vi' ? 'Frame rate (den)' : 'Frame rate (den)'}<input value={profileDraft.timelineRateDen} onChange={updateProfileDraft('timelineRateDen')} inputMode="numeric" disabled={!connected || mutating !== null} /></label><label>{locale === 'vi' ? 'Time base (num)' : 'Time base (num)'}<input value={profileDraft.timeBaseNum} onChange={updateProfileDraft('timeBaseNum')} inputMode="numeric" disabled={!connected || mutating !== null} /></label><label>{locale === 'vi' ? 'Time base (den)' : 'Time base (den)'}<input value={profileDraft.timeBaseDen} onChange={updateProfileDraft('timeBaseDen')} inputMode="numeric" disabled={!connected || mutating !== null} /></label><label>{locale === 'vi' ? 'Chiều rộng' : 'Width'}<input value={profileDraft.width} onChange={updateProfileDraft('width')} inputMode="numeric" disabled={!connected || mutating !== null} /></label><label>{locale === 'vi' ? 'Chiều cao' : 'Height'}<input value={profileDraft.height} onChange={updateProfileDraft('height')} inputMode="numeric" disabled={!connected || mutating !== null} /></label></div><button type="submit" className="primary-button small" disabled={!connected || mutating !== null || !client.createMediaProfileRevision}>{mutating === 'profile-create' ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}{locale === 'vi' ? 'Lưu Media Profile candidate' : 'Save Media Profile candidate'}</button></form></section>
      <section className="workspace-panel timeline-card timeline-workspace-card">
        <div className="card-heading"><div className="card-title-with-icon"><span className="card-icon green"><Layers3 size={16} /></span><div><h2>{locale === 'vi' ? 'Checkpoint workspace' : 'Checkpoint workspace'}</h2><p>{selectedTimeline ? `${selectedTimeline.title} · ${selectedTimeline.code ?? '—'}` : (locale === 'vi' ? 'Chọn timeline bên trái.' : 'Select a timeline on the left.')}</p></div></div>{currentRevision && <span className="state-label">{timelineStateLabel(currentRevision.state, locale)}</span>}</div>
        {workspaceLoading ? <LoadingState label={locale === 'vi' ? 'Đang đọc checkpoint…' : 'Reading checkpoint…'} /> : workspaceError ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{workspaceError}</span><button className="subtle-button tiny" onClick={() => selectedTimelineId && void loadWorkspace(selectedTimelineId)}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div> : !workspace ? <EmptyState icon={Layers3} title={locale === 'vi' ? 'Chọn timeline' : 'Select a timeline'} detail={locale === 'vi' ? 'Workspace sẽ hiển thị revision cụ thể sau khi Core trả về.' : 'The workspace appears after Core returns a specific revision.'} /> : <>
          <div className="timeline-metrics"><div><span>{locale === 'vi' ? 'Revision' : 'Revision'}</span><strong>{currentRevision?.id ?? '—'}</strong></div><div><span>{locale === 'vi' ? 'Duration' : 'Duration'}</span><strong>{rationalLabel(currentRevision?.duration)}</strong></div><div><span>{locale === 'vi' ? 'Tracks' : 'Tracks'}</span><strong>{currentRevision?.tracks.length ?? 0}</strong></div><div><span>{locale === 'vi' ? 'Readiness' : 'Readiness'}</span><strong>{currentRevision?.readinessState ?? 'UNKNOWN'}</strong></div></div>
          {workspace.needsYou.length > 0 && <div className="inline-state warning"><UserRound size={14} /><span>{locale === 'vi' ? `Core cần bạn xử lý ${workspace.needsYou.length} mục.` : `Core needs you to resolve ${workspace.needsYou.length} item${workspace.needsYou.length === 1 ? '' : 's'}.`}</span></div>}
          <div className="timeline-revision-list">{revisions.length === 0 ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Chưa có checkpoint.' : 'No checkpoints yet.'} /> : revisions.map((revision) => { const nextState = timelineRevisionTransition(revision.state); return <div className="timeline-revision-row" key={revision.id}><div><strong>{revision.id ?? 'revision'}</strong><small>{timelineStateLabel(revision.state, locale)} · {rationalLabel(revision.duration)} · {revision.tracks.length} {locale === 'vi' ? 'track' : 'tracks'} · v{revision.rowVersion}</small></div>{nextState && <button type="button" className="subtle-button tiny" disabled={!connected || mutating !== null || (nextState === 'APPROVED' && !client.openReview)} onClick={() => void transitionRevision(revision, nextState)}>{mutating === `timeline-transition:${revision.id}` ? <RefreshCw size={12} className="spin" /> : nextState === 'APPROVED' ? <CheckCircle2 size={12} /> : <ArrowRight size={12} />}{nextState === 'APPROVED' ? (locale === 'vi' ? 'Mở review' : 'Open review') : timelineStateLabel(nextState, locale)}</button>}</div> })}</div>
          <div className="timeline-working-panel">
            <div className="card-heading"><div className="card-title-with-icon"><span className="card-icon blue"><Command size={16} /></span><div><h3>{locale === 'vi' ? 'Phiên chỉnh sửa bản nháp' : 'Working draft session'}</h3><p>{locale === 'vi' ? 'Mỗi thao tác pin revision, client và version cụ thể; autosave không approve canon.' : 'Every edit pins an exact revision, client and version; autosave never approves canon.'}</p></div></div>{workingWorkspace?.session && <span className={`health-pill ${workingWorkspace.session.state === 'CLEAN' ? 'healthy' : 'warning'}`}><span />{workingWorkspace.session.state}</span>}</div>
            {workingLoading ? <LoadingState label={locale === 'vi' ? 'Đang khôi phục phiên chỉnh sửa…' : 'Restoring the editing session…'} /> : workingError ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{workingError}</span><button type="button" className="subtle-button tiny" onClick={() => selectedTimelineId && void loadWorkingSession(selectedTimelineId)}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div> : !workingWorkspace?.session ? <div className="working-session-empty"><p>{locale === 'vi' ? 'Chưa có phiên đang mở. Core sẽ bắt đầu từ revision hiện tại đang được chọn.' : 'No editing session is open. Core will start from the selected current revision.'}</p><button type="button" className="primary-button small" disabled={!connected || !currentRevision?.id || !currentRevision.editHash || mutating !== null || !client.beginTimelineWorkingSession} onClick={() => void beginWorkingSession()}>{mutating === 'timeline-working-begin' ? <RefreshCw size={14} className="spin" /> : <Command size={14} />}{locale === 'vi' ? 'Mở phiên chỉnh sửa' : 'Open editing session'}</button>{currentRevision && !currentRevision.editHash && <small className="warning-text">{locale === 'vi' ? 'Revision chưa có content hash để pin an toàn.' : 'This revision has no content hash for a safe exact pin.'}</small>}</div> : <>
              <div className="timeline-metrics working-session-metrics"><div><span>{locale === 'vi' ? 'Base revision' : 'Base revision'}</span><strong title={workingWorkspace.session.baseContentHash}>{workingWorkspace.session.baseRevisionId ?? '—'}</strong></div><div><span>{locale === 'vi' ? 'Trạng thái' : 'State'}</span><strong>{workingWorkspace.session.state}</strong></div><div><span>{locale === 'vi' ? 'Thao tác' : 'Operations'}</span><strong>{workingWorkspace.session.lastAcknowledgedOpSeq}</strong></div><div><span>{locale === 'vi' ? 'Bản nháp' : 'Draft'}</span><strong>{workingWorkspace.session.draftHash?.slice(0, 12) ?? '—'}</strong></div></div>
              {workingWorkspace.session.nextStep && <p className="readonly-note"><Info size={14} />{workingWorkspace.session.nextStep}</p>}
              <form className="workspace-form working-marker-form" onSubmit={applyMarker}><div className="form-grid three"><label>{locale === 'vi' ? 'Marker num' : 'Marker num'}<input value={markerNum} onChange={(event) => setMarkerNum(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>{locale === 'vi' ? 'Marker den' : 'Marker den'}<input value={markerDen} onChange={(event) => setMarkerDen(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>{locale === 'vi' ? 'Nhãn marker' : 'Marker label'}<input value={markerLabel} onChange={(event) => setMarkerLabel(event.target.value)} maxLength={300} disabled={!connected || mutating !== null || !workingEditable} /></label></div><button type="submit" className="subtle-button tiny" disabled={!connected || mutating !== null || !client.applyTimelineEditOps || !workingEditable}>{mutating === 'timeline-working-apply' ? <RefreshCw size={12} className="spin" /> : <Plus size={12} />}{locale === 'vi' ? 'Thêm marker vào draft' : 'Add marker to draft'}</button></form>
              <div className="working-clip-tools">
                <div className="working-tool-heading"><strong>{locale === 'vi' ? 'Clip operations' : 'Clip operations'}</strong><span>{locale === 'vi' ? 'Mọi thay đổi vẫn là draft và có thể undo.' : 'Every change remains a draft and can be undone.'}</span></div>
                <label>{locale === 'vi' ? 'Clip hiện tại' : 'Target clip'}<select value={clipTargetId} onChange={(event) => setClipTargetId(event.target.value)} disabled={!connected || mutating !== null || !workingEditable}><option value="">{locale === 'vi' ? 'Chọn clip' : 'Choose a clip'}</option>{workingClips.map(({ track, clip }) => <option value={clip.id ?? ''} key={`${track.id ?? track.orderIndex}-${clip.id}`}>{track.name} · {clip.id}</option>)}</select></label>
                <div className="working-clip-operation-grid">
                  <form className="workspace-form" onSubmit={applyMoveClip}><div className="form-grid two"><label>{locale === 'vi' ? 'Move num' : 'Move num'}<input value={clipMoveNum} onChange={(event) => setClipMoveNum(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>{locale === 'vi' ? 'Move den' : 'Move den'}<input value={clipMoveDen} onChange={(event) => setClipMoveDen(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label></div><button type="submit" className="subtle-button tiny" disabled={!connected || mutating !== null || !workingEditable || workingClips.length === 0}>{locale === 'vi' ? 'Di chuyển' : 'Move'}</button></form>
                  <form className="workspace-form" onSubmit={applyTrimClip}><div className="form-grid three"><label>{locale === 'vi' ? 'Cạnh' : 'Edge'}<select value={clipTrimEdge} onChange={(event) => setClipTrimEdge(event.target.value as 'IN' | 'OUT')} disabled={!connected || mutating !== null || !workingEditable}><option value="IN">IN</option><option value="OUT">OUT</option></select></label><label>{locale === 'vi' ? 'Trim num' : 'Trim num'}<input value={clipTrimNum} onChange={(event) => setClipTrimNum(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>{locale === 'vi' ? 'Trim den' : 'Trim den'}<input value={clipTrimDen} onChange={(event) => setClipTrimDen(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label></div><button type="submit" className="subtle-button tiny" disabled={!connected || mutating !== null || !workingEditable || workingClips.length === 0}>{locale === 'vi' ? 'Trim' : 'Trim'}</button></form>
                  <button type="button" className="subtle-button tiny danger-button" onClick={() => void applyDeleteClip()} disabled={!connected || mutating !== null || !workingEditable || workingClips.length === 0}>{locale === 'vi' ? 'Xoá clip' : 'Delete clip'}</button>
                </div>
                <form className="workspace-form working-insert-form" onSubmit={applyInsertClip}><div className="form-grid two"><label>{locale === 'vi' ? 'Track ID' : 'Track ID'}<select value={insertTrackId} onChange={(event) => setInsertTrackId(event.target.value)} disabled={!connected || mutating !== null || !workingEditable}><option value="">{locale === 'vi' ? 'Chọn track' : 'Choose a track'}</option>{workingTracks.map((track) => <option value={track.id ?? ''} key={track.id ?? track.orderIndex}>{track.name} · {track.id}</option>)}</select></label><label>{locale === 'vi' ? 'Asset cho clip' : 'Clip asset'}<select aria-label={locale === 'vi' ? 'Asset cho clip' : 'Clip asset'} value={insertAssetRevisionId} onChange={(event) => setInsertAssetRevisionId(event.target.value)} disabled={!connected || mutating !== null || !workingEditable || assetsLoading || assets.length === 0}><option value="">{assetsLoading ? (locale === 'vi' ? 'Đang đọc asset…' : 'Loading assets…') : assets.length === 0 ? (locale === 'vi' ? 'Chưa có asset project' : 'No project assets') : (locale === 'vi' ? 'Chọn asset đã verify' : 'Choose a verified asset')}</option>{assets.map((asset) => <option value={asset.revisionId ?? ''} key={asset.id} disabled={!timelineAssetIsSelectable(asset, projectId)}>{timelineAssetOptionLabel(asset, projectId, locale)}</option>)}</select></label><label>{locale === 'vi' ? 'Clip ID (tuỳ chọn)' : 'Clip ID (optional)'}<input value={insertClipId} onChange={(event) => setInsertClipId(event.target.value)} disabled={!connected || mutating !== null || !workingEditable} /></label></div><div className="form-grid four"><label>Timeline in num<input value={insertTimelineInNum} onChange={(event) => setInsertTimelineInNum(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>Timeline in den<input value={insertTimelineInDen} onChange={(event) => setInsertTimelineInDen(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>Timeline out num<input value={insertTimelineOutNum} onChange={(event) => setInsertTimelineOutNum(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>Timeline out den<input value={insertTimelineOutDen} onChange={(event) => setInsertTimelineOutDen(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label></div><div className="form-grid four"><label>Source in num<input value={insertSourceInNum} onChange={(event) => setInsertSourceInNum(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>Source in den<input value={insertSourceInDen} onChange={(event) => setInsertSourceInDen(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>Source out num<input value={insertSourceOutNum} onChange={(event) => setInsertSourceOutNum(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label><label>Source out den<input value={insertSourceOutDen} onChange={(event) => setInsertSourceOutDen(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !workingEditable} /></label></div><button type="submit" className="subtle-button tiny" disabled={!connected || mutating !== null || !workingEditable || workingTracks.length === 0 || !insertAssetRevisionId.trim()}>{locale === 'vi' ? 'Chèn clip' : 'Insert clip'}</button></form>
                 {previewAsset && <div className="timeline-asset-preview" key={`${projectId}:${selectedTimelineId ?? ''}:${workingSession?.id ?? ''}:${clipTargetId}:${insertAssetRevisionId}:${previewAsset.revisionId ?? ''}`}><div className="working-tool-heading"><strong>{locale === 'vi' ? 'Xem thử asset đang chọn' : 'Preview selected asset'}</strong><span>{previewAsset.name} · {previewAsset.revisionId?.slice(0, 16) ?? '—'}</span></div>{timelineAssetIsSelectable(previewAsset, projectId) ? <AssetPreview asset={previewAsset} locale={locale} client={client} purpose="TIMELINE_PREVIEW" /> : <p className="readonly-note warning-text"><AlertCircle size={14} />{timelineAssetBlocker(previewAsset, projectId, locale)}</p>}</div>}
                 {!previewAsset && <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Chọn một asset exact để xem thử trước khi chèn clip.' : 'Choose an exact asset to preview it before inserting a clip.'}</p>}
                {assetsError && <p className="readonly-note warning-text"><AlertCircle size={14} />{assetsError}</p>}
                {assets.length > 0 && assets.every((asset) => !timelineAssetIsSelectable(asset, projectId)) && <p className="readonly-note warning-text"><Info size={14} />{locale === 'vi' ? 'Chưa có asset đủ điều kiện. Mỗi dòng bị khoá sẽ nêu lý do; hãy hoàn tất materialization và rights/consent trước.' : 'No asset is eligible yet. Locked options explain the reason; finish materialization and rights/consent first.'}</p>}
                <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Chỉ gửi exact asset revision đã verify; Core vẫn kiểm tra lại project, readiness và rights trước khi ghi draft.' : 'Only an exact verified asset revision is submitted; Core rechecks project scope, readiness, and rights before writing the draft.'}</p>
              </div>
              <div className="working-draft-records"><strong>{locale === 'vi' ? 'Draft hiện tại' : 'Current draft'}</strong>{workingTracks.map((track) => <div className="working-draft-row" key={track.id ?? track.orderIndex}><span>{track.name}</span><small>{track.clips.length} {locale === 'vi' ? 'clip' : 'clips'}</small></div>)}<div className="working-draft-row"><span>{locale === 'vi' ? 'Markers' : 'Markers'}</span><small>{workingSession?.draft.markers.length ?? 0}</small></div></div>
              <div className="working-session-actions"><button type="button" className="subtle-button tiny" disabled={!connected || mutating !== null || workingWorkspace.session.historyCursorSeq < 1 || !client.undoTimelineEditOp || !workingEditable} onClick={() => void runWorkingCommand('undo')}><Undo2 size={13} />Undo</button><button type="button" className="subtle-button tiny" disabled={!connected || mutating !== null || !workingWorkspace.session.operations.some((operation) => operation.opSeq === workingWorkspace.session!.historyCursorSeq + 1 && operation.historyState === 'UNDONE') || !client.redoTimelineEditOp || !workingEditable} onClick={() => void runWorkingCommand('redo')}><Redo2 size={13} />Redo</button><button type="button" className="subtle-button tiny" disabled={!connected || mutating !== null || !client.autosaveTimelineWorkingSession || !workingEditable} onClick={() => void runWorkingCommand('autosave')}><Save size={13} />Autosave</button><button type="button" className="primary-button small" disabled={!connected || mutating !== null || !client.checkpointTimelineWorkingSession || workingWorkspace.session.draftHash !== workingWorkspace.session.autosavedHash || ['CLOSED', 'ABANDONED', 'CONFLICT', 'RECOVERY_REQUIRED'].includes(workingWorkspace.session.state)} onClick={() => void runWorkingCommand('checkpoint')}><CheckCircle2 size={13} />{locale === 'vi' ? 'Tạo checkpoint' : 'Create checkpoint'}</button><button type="button" className="subtle-button tiny" disabled={!connected || mutating !== null || !client.closeTimelineWorkingSession || workingWorkspace.session.state !== 'CLEAN' || workingWorkspace.session.draftHash !== workingWorkspace.session.autosavedHash} onClick={() => void runWorkingCommand('close', 'SAVE')}><XCircle size={13} />{locale === 'vi' ? 'Đóng sạch' : 'Close cleanly'}</button><button type="button" className="subtle-button tiny danger-button" disabled={!connected || mutating !== null || !client.closeTimelineWorkingSession || ['CLOSED', 'ABANDONED'].includes(workingWorkspace.session.state)} onClick={() => { if (window.confirm(locale === 'vi' ? 'Giữ draft và đóng phiên? Bạn sẽ cần mở phiên mới để tiếp tục.' : 'Keep the draft and close this session? You will need a new session to continue.')) void runWorkingCommand('close', 'ABANDON') }}><XCircle size={13} />{locale === 'vi' ? 'Đóng, giữ draft' : 'Abandon with draft'}</button></div>
              <section className="working-history-card" aria-labelledby="working-history-title">
                <div className="working-tool-heading"><strong id="working-history-title">{locale === 'vi' ? 'Lịch sử thao tác' : 'Operation history'}</strong><span>{locale === 'vi' ? 'Chỉ đọc; dữ liệu đến từ Core.' : 'Read-only evidence from Core.'}</span><button type="button" className="subtle-button tiny" onClick={() => void loadWorkingHistory(true)} disabled={!connected || workingHistoryLoading || !client.getTimelineWorkingHistory}>{workingHistoryLoading ? <RefreshCw size={12} className="spin" /> : <RefreshCw size={12} />}{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button></div>
                {!client.getTimelineWorkingHistory ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Bridge hiện tại chưa cung cấp history phiên chỉnh sửa.' : 'This bridge does not expose working-session history yet.'} /> : workingHistoryLoading && !workingHistory ? <LoadingState label={locale === 'vi' ? 'Đang đọc history…' : 'Reading operation history…'} /> : workingHistoryError ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{workingHistoryError}</span><button type="button" className="subtle-button tiny" onClick={() => void loadWorkingHistory(!workingHistory)} disabled={workingHistoryLoading}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button>{workingHistoryNeedsUser && <small>{locale === 'vi' ? 'Core cần bạn xử lý điều kiện rồi thử lại.' : 'Core needs you to resolve the condition before retrying.'}</small>}</div> : !workingHistory ? <div className="working-history-empty"><p>{locale === 'vi' ? 'Chưa tải history của phiên này.' : 'The history for this session has not been loaded.'}</p><button type="button" className="subtle-button tiny" onClick={() => void loadWorkingHistory(true)} disabled={!connected || workingHistoryLoading}>{locale === 'vi' ? 'Đọc history' : 'Load history'}</button></div> : <>
                  {historyOperations.length === 0 ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Phiên này chưa có thao tác.' : 'This session has no operations yet.'} /> : <div className="working-history-list">{historyOperations.map((operation) => { const relatedActions = historyActions.filter((action) => action.targetOpSeq === operation.opSeq); const hashPreview = timelineHistoryHashPreview(operation.resultHash); return <article className="working-history-row" key={operation.id ?? `operation-${operation.opSeq}`}><div className="working-history-main"><strong>#{operation.opSeq} · {timelineHistoryOperationLabel(operation.opType, locale)}</strong><small>{timelineHistoryStateLabel(operation.historyState, locale)}{operation.createdAt ? ` · ${formatRelativeSnapshot(operation.createdAt, locale)}` : ''}</small>{relatedActions.map((action) => <small className="working-history-action" key={action.id ?? `action-${action.actionSeq}`}>{timelineHistoryActionLabel(action.actionType, locale)}{action.targetOpSeq === null || action.targetOpSeq === undefined ? '' : ` · #${action.targetOpSeq}`}{action.createdAt ? ` · ${formatRelativeSnapshot(action.createdAt, locale)}` : ''}</small>)}</div><span className="record-code" title={hashPreview === '—' ? undefined : operation.resultHash}>{hashPreview}</span></article> })}</div>}
                  {workingHistory.cursor.hasMore && <button type="button" className="subtle-button tiny working-history-more" onClick={() => void loadWorkingHistory(false)} disabled={!connected || workingHistoryLoading}>{workingHistoryLoading ? <RefreshCw size={12} className="spin" /> : <ArrowRight size={12} />}{locale === 'vi' ? 'Tải thêm' : 'Load more'}</button>}
                </>}
              </section>
              <p className="readonly-note"><Info size={14} />{locale === 'vi' ? `${workingWorkspace.session.draft.markers.length} marker · ${workingWorkspace.session.operations.length} operation · history action ${workingWorkspace.session.historyActions.length}.` : `${workingWorkspace.session.draft.markers.length} markers · ${workingWorkspace.session.operations.length} operations · ${workingWorkspace.session.historyActions.length} history actions.`}</p>
            </>}
          </div>
          {currentRevision && selectedTimelineId && <TimelineTimingPanel projectId={projectId} timelineId={selectedTimelineId} revision={currentRevision} connected={connected} locale={locale} client={client} onToast={onToast} assets={assets} assetsLoading={assetsLoading} assetsError={assetsError} />}
          {currentRevision && <div className="timeline-track-list">{currentRevision.tracks.map((track) => <div className="timeline-track-row" key={track.id ?? `${track.trackType}-${track.orderIndex}`}><span><strong>{track.name}</strong><small>{track.trackType} · {track.clips.length} {locale === 'vi' ? 'clip' : 'clips'}</small></span><span className="record-code">{track.enabled ? 'ON' : 'OFF'}</span></div>)}</div>}
          <form className="workspace-form timeline-checkpoint-form" onSubmit={createRevision}>
            <div className="form-grid two"><label>{locale === 'vi' ? 'Duration num' : 'Duration num'}<input value={durationNum} onChange={(event) => setDurationNum(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !approvedProfile} /></label><label>{locale === 'vi' ? 'Duration den' : 'Duration den'}<input value={durationDen} onChange={(event) => setDurationDen(event.target.value)} inputMode="numeric" disabled={!connected || mutating !== null || !approvedProfile} /></label></div>
            <label>{locale === 'vi' ? 'Tracks JSON (VIDEO)' : 'Tracks JSON (VIDEO)'}<textarea aria-label="Tracks JSON" value={tracksJson} onChange={(event) => setTracksJson(event.target.value)} rows={5} spellCheck={false} placeholder={'[{"trackType":"VIDEO","orderIndex":0,"name":"Picture","enabled":true,"clips":[]}]'} disabled={!connected || mutating !== null || !approvedProfile} /></label>
            <label>{locale === 'vi' ? 'Markers JSON' : 'Markers JSON'}<textarea aria-label="Markers JSON" value={markersJson} onChange={(event) => setMarkersJson(event.target.value)} rows={3} spellCheck={false} placeholder={'[{"time":{"num":0,"den":1},"markerType":"NOTE","label":"Beat"}]'} disabled={!connected || mutating !== null || !approvedProfile} /></label>
            <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Chỉ track VIDEO; clip phải dùng rational timelineIn/timelineOut. Core sẽ kiểm tra overlap, bounds, asset readiness và rights.' : 'VIDEO tracks only; clips use rational timelineIn/timelineOut. Core validates overlap, bounds, asset readiness, and rights.'}</p>
            <button type="submit" className="primary-button small" disabled={!connected || !approvedProfile?.id || !workspace || mutating !== null || !client.createTimelineRevision}>{mutating === 'timeline-revision-create' ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}{locale === 'vi' ? 'Lưu checkpoint' : 'Save checkpoint'}</button>
          </form>
          <p className="timeline-deferred"><Info size={14} />{locale === 'vi' ? 'V1 chỉ ghi checkpoint duration/tracks/markers qua Core. Playback, render và export chưa có control trong workspace này.' : 'V1 only records duration/tracks/markers through Core. Playback, render and export controls are deferred.'}</p>
        </>}
      </section>
    </div>}
  </div>
}

function timingStateLabel(state: string | undefined, locale: Locale) {
  if (!state) return '—'
  const labels: Record<string, { vi: string; en: string }> = {
    DRAFT: { vi: 'Bản nháp', en: 'Draft' },
    TIMED: { vi: 'Đã canh thời gian', en: 'Timed' },
    CANDIDATE: { vi: 'Chờ duyệt', en: 'Candidate' },
    REVIEWED: { vi: 'Đã review', en: 'Reviewed' },
    SELECTED: { vi: 'Đã chọn', en: 'Selected' },
    APPROVED: { vi: 'Đã duyệt', en: 'Approved' },
    STALE: { vi: 'Đã cũ', en: 'Stale' },
    REJECTED: { vi: 'Từ chối', en: 'Rejected' },
  }
  return labels[state]?.[locale] ?? state
}

function nextAudioTimingState(state: string | undefined): TimelineTimingLifecycleState | null {
  if (state === 'DRAFT') return 'CANDIDATE'
  if (state === 'CANDIDATE') return 'SELECTED'
  if (state === 'TIMED') return 'REVIEWED'
  return null
}

function nextSubtitleTimingState(state: string | undefined): TimelineTimingLifecycleState | null {
  if (state === 'DRAFT') return 'TIMED'
  if (state === 'TIMED') return 'REVIEWED'
  return null
}

function TimelineTimingPanel({ projectId, timelineId, revision, connected, locale, client, onToast, assets, assetsLoading, assetsError }: { projectId: string; timelineId: string; revision: TimelineRevision; connected: boolean; locale: Locale; client: CoreClient; onToast: (message: string) => void; assets: AssetSummary[]; assetsLoading: boolean; assetsError: string | null }) {
  const [audioTiming, setAudioTiming] = useState<AudioCueTiming | null>(null)
  const [subtitleTiming, setSubtitleTiming] = useState<SubtitleTiming | null>(null)
  const [timingImpact, setTimingImpact] = useState<TimelineTimingImpact | null>(null)
  const [loading, setLoading] = useState(false)
  const [timingError, setTimingError] = useState<string | null>(null)
  const [needsUser, setNeedsUser] = useState(false)
  const [mutating, setMutating] = useState<string | null>(null)
  const [cueType, setCueType] = useState('SILENCE')
  const [cueTitle, setCueTitle] = useState('Room tone')
  const [cueStartNum, setCueStartNum] = useState('0')
  const [cueStartDen, setCueStartDen] = useState('1')
  const [cueEndNum, setCueEndNum] = useState('1')
  const [cueEndDen, setCueEndDen] = useState('1')
  const [cueIntent, setCueIntent] = useState('')
  const [cueAssetRevisionId, setCueAssetRevisionId] = useState('')
  const [subtitleLocale, setSubtitleLocale] = useState('vi-VN')
  const [subtitleTitle, setSubtitleTitle] = useState('Tiếng Việt')
  const [subtitleStartNum, setSubtitleStartNum] = useState('0')
  const [subtitleStartDen, setSubtitleStartDen] = useState('1')
  const [subtitleEndNum, setSubtitleEndNum] = useState('1')
  const [subtitleEndDen, setSubtitleEndDen] = useState('1')
  const [subtitleText, setSubtitleText] = useState('')
  const revisionId = revision.id ?? ''
  const timelineHash = revision.editHash?.toLowerCase() ?? ''
  const canWrite = connected && Boolean(revisionId && /^[0-9a-f]{64}$/i.test(timelineHash)) && !mutating
  const existingSubtitleTrack = subtitleTiming?.tracks.find((item) => item.subtitleTrack?.locale === subtitleLocale.trim() && item.subtitleTrack?.id && !item.revision?.stale)?.subtitleTrack ?? null

  const loadTiming = useCallback(async (signal?: AbortSignal) => {
    if (!revisionId || !timelineHash) {
      setAudioTiming(null); setSubtitleTiming(null); setTimingImpact(null); setTimingError(null); setLoading(false)
      return
    }
    if (!client.getTimelineAudioTiming && !client.getTimelineSubtitleTiming) {
      setAudioTiming(null); setSubtitleTiming(null); setTimingImpact(null); setTimingError(locale === 'vi' ? 'Core chưa cung cấp metadata audio/phụ đề.' : 'Core does not expose audio/subtitle metadata yet.'); setLoading(false)
      return
    }
    setLoading(true); setTimingError(null); setNeedsUser(false); setAudioTiming(null); setSubtitleTiming(null); setTimingImpact(null)
    try {
      const [audioResult, subtitleResult, impactResult] = await Promise.all([
        client.getTimelineAudioTiming ? client.getTimelineAudioTiming(projectId, timelineId, revisionId, signal) : Promise.resolve(null),
        client.getTimelineSubtitleTiming ? client.getTimelineSubtitleTiming(projectId, timelineId, revisionId, signal) : Promise.resolve(null),
        client.getTimelineTimingImpact ? client.getTimelineTimingImpact(projectId, timelineId, revisionId, signal) : Promise.resolve(null),
      ])
      if (signal?.aborted) return
      setAudioTiming(audioResult)
      setSubtitleTiming(subtitleResult)
      setTimingImpact(impactResult)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (!signal?.aborted) { setTimingError(workspaceErrorMessage(cause, locale)); setNeedsUser(cause instanceof CoreClientError && cause.needsUser) }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [client, locale, projectId, revisionId, timelineHash, timelineId])

  useEffect(() => {
    const controller = new AbortController()
    void loadTiming(controller.signal)
    return () => controller.abort()
  }, [loadTiming])

  // Asset choices are exact revision IDs. Never carry a choice across a
  // project/timeline/checkpoint boundary, and drop it if the refreshed
  // projection no longer proves the revision eligible.
  useEffect(() => {
    setCueAssetRevisionId('')
  }, [projectId, timelineId, revisionId])

  useEffect(() => {
    setCueAssetRevisionId((current) => current && assets.some((asset) => asset.revisionId === current && timelineAssetIsSelectable(asset, projectId)) ? current : '')
  }, [assets, projectId])

  useEffect(() => {
    if (cueType === 'SILENCE') setCueAssetRevisionId('')
  }, [cueType])

  const createAudioCue = async (event: FormEvent) => {
    event.preventDefault()
    if (!client.createAudioCueRevision || !canWrite) return
    const start = checkedRational(cueStartNum, cueStartDen, true)
    const end = checkedRational(cueEndNum, cueEndDen, false)
    if (!start || !end || !cueTitle.trim() || (cueType !== 'SILENCE' && !cueAssetRevisionId.trim())) {
      setTimingError(locale === 'vi' ? 'Cue cần title, khoảng rational hợp lệ và asset revision khi không phải SILENCE.' : 'The cue needs a title, a valid rational interval, and an asset revision unless it is SILENCE.')
      setNeedsUser(true)
      return
    }
    setMutating('audio-create'); setTimingError(null); setNeedsUser(false)
    try {
      await client.createAudioCueRevision(projectId, timelineId, { timelineRevisionId: revisionId, timelineContentHash: timelineHash, cueType, title: cueTitle.trim(), start, end, intentText: cueIntent.trim(), selectedAssetRevisionId: cueAssetRevisionId.trim() || null }, `audio-cue-create:${timelineId}:${revisionId}:${cueType}:${cueTitle}:${start.num}/${start.den}:${end.num}/${end.den}`)
      await loadTiming()
      onToast(locale === 'vi' ? 'Đã ghi audio cue trên checkpoint hiện tại.' : 'Audio cue metadata was saved against the current checkpoint.')
    } catch (cause) {
      setTimingError(workspaceErrorMessage(cause, locale)); setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
    } finally { setMutating(null) }
  }

  const createSubtitleTrack = async (event: FormEvent) => {
    event.preventDefault()
    if (!client.createSubtitleTrackRevision || !canWrite) return
    const start = checkedRational(subtitleStartNum, subtitleStartDen, true)
    const end = checkedRational(subtitleEndNum, subtitleEndDen, false)
    if (!start || !end || !subtitleLocale.trim() || !subtitleTitle.trim() || !subtitleText.trim()) {
      setTimingError(locale === 'vi' ? 'Phụ đề cần locale, title, text và khoảng rational hợp lệ.' : 'Subtitles need a locale, title, text, and a valid rational interval.')
      setNeedsUser(true)
      return
    }
    setMutating('subtitle-create'); setTimingError(null); setNeedsUser(false)
    try {
      await client.createSubtitleTrackRevision(projectId, timelineId, { timelineRevisionId: revisionId, timelineContentHash: timelineHash, locale: subtitleLocale.trim(), title: subtitleTitle.trim(), segments: [{ start, end, locale: subtitleLocale.trim(), text: subtitleText.trim() }], subtitleTrackId: existingSubtitleTrack?.id, expectedTrackVersion: existingSubtitleTrack?.rowVersion }, `subtitle-track-create:${timelineId}:${revisionId}:${existingSubtitleTrack?.id ?? 'new'}:${existingSubtitleTrack?.rowVersion ?? 0}:${subtitleLocale}:${subtitleTitle}:${start.num}/${start.den}:${end.num}/${end.den}:${subtitleText}`)
      setSubtitleText('')
      await loadTiming()
      onToast(locale === 'vi' ? 'Đã ghi track phụ đề trên checkpoint hiện tại.' : 'Subtitle timing metadata was saved against the current checkpoint.')
    } catch (cause) {
      setTimingError(workspaceErrorMessage(cause, locale)); setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
    } finally { setMutating(null) }
  }

  const transitionAudio = async (audioCueId: string, revisionIdToTransition: string, state: TimelineTimingLifecycleState, rowVersion: number) => {
    if (!client.transitionAudioCueRevision || !canWrite) return
    setMutating(`audio-transition:${revisionIdToTransition}`); setTimingError(null); setNeedsUser(false)
    try {
      await client.transitionAudioCueRevision(projectId, timelineId, audioCueId, revisionIdToTransition, state, rowVersion, { timelineRevisionId: revisionId, timelineContentHash: timelineHash }, `audio-cue-transition:${revisionIdToTransition}:${rowVersion}:${state}`)
      await loadTiming()
      onToast(locale === 'vi' ? `Audio cue đã chuyển sang ${timingStateLabel(state, locale)}.` : `Audio cue moved to ${timingStateLabel(state, locale)}.`)
    } catch (cause) {
      setTimingError(workspaceErrorMessage(cause, locale)); setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
    } finally { setMutating(null) }
  }

  const transitionSubtitle = async (trackId: string, revisionIdToTransition: string, state: TimelineTimingLifecycleState, rowVersion: number) => {
    if (!client.transitionSubtitleTrackRevision || !canWrite) return
    setMutating(`subtitle-transition:${revisionIdToTransition}`); setTimingError(null); setNeedsUser(false)
    try {
      await client.transitionSubtitleTrackRevision(projectId, timelineId, trackId, revisionIdToTransition, state, rowVersion, { timelineRevisionId: revisionId, timelineContentHash: timelineHash }, `subtitle-track-transition:${revisionIdToTransition}:${rowVersion}:${state}`)
      await loadTiming()
      onToast(locale === 'vi' ? `Track phụ đề đã chuyển sang ${timingStateLabel(state, locale)}.` : `Subtitle track moved to ${timingStateLabel(state, locale)}.`)
    } catch (cause) {
      setTimingError(workspaceErrorMessage(cause, locale)); setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
    } finally { setMutating(null) }
  }

  const staleCount = timingImpact?.counts.staleTotal ?? [...(audioTiming?.cues ?? []), ...(subtitleTiming?.tracks ?? [])].filter((item) => Boolean(item.revision?.stale || item.revision?.state === 'STALE')).length
  return <div className="timeline-timing-panel">
    <div className="card-heading"><div className="card-title-with-icon"><span className="card-icon amber"><Languages size={16} /></span><div><h3>{locale === 'vi' ? 'Audio cue & phụ đề' : 'Audio cues & subtitles'}</h3><p>{locale === 'vi' ? 'Metadata pin đúng checkpoint; không phát, render hoặc sinh media ở đây.' : 'Metadata is pinned to this checkpoint; playback, rendering, and generation are out of scope.'}</p></div></div>{staleCount > 0 && <span className="health-pill warning"><span />{staleCount} STALE</span>}</div>
    {!timelineHash && <div className="inline-state warning"><AlertCircle size={14} /><span>{locale === 'vi' ? 'Checkpoint thiếu content hash nên metadata bị khoá để tránh ghi sai dependency.' : 'This checkpoint has no content hash, so metadata writes are disabled to avoid an unsafe dependency pin.'}</span></div>}
    {timingImpact && timingImpact.counts.staleTotal > 0 && <div className="inline-state warning"><AlertCircle size={14} /><span>{locale === 'vi' ? `${timingImpact.counts.staleTotal} revision audio/phụ đề đang STALE do dependency thay đổi. Hãy tạo revision mới trên checkpoint hiện tại.` : `${timingImpact.counts.staleTotal} audio/subtitle revisions are STALE because a dependency changed. Create new revisions on the current checkpoint.`}</span></div>}
    {loading ? <LoadingState label={locale === 'vi' ? 'Đang đọc metadata timing…' : 'Reading timing metadata…'} /> : timingError ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{timingError}</span><button type="button" className="subtle-button tiny" onClick={() => void loadTiming()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button>{needsUser && <small>{locale === 'vi' ? 'Core cần bạn xử lý điều kiện rồi thử lại.' : 'Core needs you to resolve the condition before retrying.'}</small>}</div> : <>
      <div className="timeline-timing-columns">
        <section className="timeline-timing-section"><div className="working-tool-heading"><strong>{locale === 'vi' ? 'Audio cue' : 'Audio cues'}</strong><span>{audioTiming?.cues.length ?? 0}</span></div>{!client.getTimelineAudioTiming ? <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Bridge hiện tại chưa hỗ trợ audio metadata.' : 'This bridge does not expose audio metadata yet.'}</p> : (audioTiming?.cues.length ?? 0) === 0 ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Chưa có audio cue.' : 'No audio cue yet.'} /> : <div className="timeline-timing-list">{audioTiming?.cues.map((item, index) => { const cue = item.audioCue; const itemRevision = item.revision; const nextState = nextAudioTimingState(itemRevision?.state); return <div className={`timeline-timing-row ${itemRevision?.stale ? 'stale' : ''}`} key={itemRevision?.id ?? cue?.id ?? index}><div><strong>{cue?.title ?? 'Audio cue'}</strong><small>{cue?.cueType ?? 'UNKNOWN'} · {rationalLabel(itemRevision?.start)} → {rationalLabel(itemRevision?.end)} · {timingStateLabel(itemRevision?.state, locale)}</small>{itemRevision?.assetGate && itemRevision.assetGate.state !== 'NOT_APPLICABLE' && <small className={itemRevision.assetGate.state === 'READY' ? '' : 'warning-text'}>{locale === 'vi' ? `Asset: ${itemRevision.assetGate.state} · rights ${itemRevision.assetGate.rightsStatus ?? 'UNKNOWN'}${itemRevision.assetGate.reason ? ` · ${itemRevision.assetGate.reason}` : ''}` : `Asset: ${itemRevision.assetGate.state} · rights ${itemRevision.assetGate.rightsStatus ?? 'UNKNOWN'}${itemRevision.assetGate.reason ? ` · ${itemRevision.assetGate.reason}` : ''}`}</small>}{itemRevision?.stale && <small className="warning-text">{itemRevision.staleReason ? `${itemRevision.staleReason} · ` : ''}{itemRevision.nextStep ?? (locale === 'vi' ? 'Tạo lại trên checkpoint mới.' : 'Create a new revision on the current checkpoint.')}</small>}</div>{nextState && cue?.id && itemRevision?.id && <button type="button" className="subtle-button tiny" disabled={!canWrite || !client.transitionAudioCueRevision} onClick={() => void transitionAudio(cue.id!, itemRevision.id!, nextState, itemRevision.rowVersion)}>{mutating === `audio-transition:${itemRevision.id}` ? <RefreshCw size={12} className="spin" /> : <ArrowRight size={12} />}{timingStateLabel(nextState, locale)}</button>}</div> })}</div>}
          <form className="workspace-form timeline-timing-form" onSubmit={createAudioCue}><div className="form-grid two"><label>{locale === 'vi' ? 'Loại cue' : 'Cue type'}<select value={cueType} onChange={(event) => setCueType(event.target.value)} disabled={!canWrite}><option value="SILENCE">SILENCE</option><option value="DIALOGUE">DIALOGUE</option><option value="ADR">ADR</option><option value="NONVERBAL">NONVERBAL</option><option value="FOLEY">FOLEY</option><option value="SFX">SFX</option><option value="AMBIENCE">AMBIENCE</option><option value="ROOM_TONE">ROOM_TONE</option><option value="MUSIC">MUSIC</option></select></label><label>{locale === 'vi' ? 'Tên cue' : 'Cue title'}<input value={cueTitle} onChange={(event) => setCueTitle(event.target.value)} maxLength={200} disabled={!canWrite} /></label></div><div className="form-grid four"><label>Start num<input value={cueStartNum} onChange={(event) => setCueStartNum(event.target.value)} inputMode="numeric" disabled={!canWrite} /></label><label>Start den<input value={cueStartDen} onChange={(event) => setCueStartDen(event.target.value)} inputMode="numeric" disabled={!canWrite} /></label><label>End num<input value={cueEndNum} onChange={(event) => setCueEndNum(event.target.value)} inputMode="numeric" disabled={!canWrite} /></label><label>End den<input value={cueEndDen} onChange={(event) => setCueEndDen(event.target.value)} inputMode="numeric" disabled={!canWrite} /></label></div><label>{locale === 'vi' ? 'Ý định (tuỳ chọn)' : 'Intent (optional)'}<textarea value={cueIntent} onChange={(event) => setCueIntent(event.target.value)} rows={2} maxLength={8000} disabled={!canWrite} /></label>{cueType !== 'SILENCE' && <><label>{locale === 'vi' ? 'Asset audio đã verify' : 'Verified audio asset'}<select aria-label={locale === 'vi' ? 'Asset audio' : 'Audio asset'} value={cueAssetRevisionId} onChange={(event) => setCueAssetRevisionId(event.target.value)} disabled={!canWrite || assetsLoading || assets.length === 0}><option value="">{assetsLoading ? (locale === 'vi' ? 'Đang đọc asset…' : 'Loading assets…') : assets.length === 0 ? (locale === 'vi' ? 'Chưa có asset project' : 'No project assets') : (locale === 'vi' ? 'Chọn asset đã verify' : 'Choose a verified asset')}</option>{assets.map((asset) => <option value={asset.revisionId ?? ''} key={asset.id} disabled={!timelineAssetIsSelectable(asset, projectId)}>{timelineAssetOptionLabel(asset, projectId, locale)}</option>)}</select></label>{assetsError && <small className="warning-text">{assetsError}</small>}</>}<button type="submit" className="subtle-button tiny" disabled={!canWrite || !client.createAudioCueRevision || (cueType !== 'SILENCE' && !cueAssetRevisionId.trim())}>{mutating === 'audio-create' ? <RefreshCw size={12} className="spin" /> : <Plus size={12} />}{locale === 'vi' ? 'Thêm audio cue' : 'Add audio cue'}</button></form>
        </section>
        <section className="timeline-timing-section"><div className="working-tool-heading"><strong>{locale === 'vi' ? 'Subtitle track' : 'Subtitle tracks'}</strong><span>{subtitleTiming?.tracks.length ?? 0}</span></div>{!client.getTimelineSubtitleTiming ? <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Bridge hiện tại chưa hỗ trợ subtitle metadata.' : 'This bridge does not expose subtitle metadata yet.'}</p> : (subtitleTiming?.tracks.length ?? 0) === 0 ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Chưa có track phụ đề.' : 'No subtitle track yet.'} /> : <div className="timeline-timing-list">{subtitleTiming?.tracks.map((item, index) => { const track = item.subtitleTrack; const itemRevision = item.revision; const nextState = nextSubtitleTimingState(itemRevision?.state); return <div className={`timeline-timing-row ${itemRevision?.stale ? 'stale' : ''}`} key={itemRevision?.id ?? track?.id ?? index}><div><strong>{track?.title ?? 'Subtitle track'}</strong><small>{track?.locale ?? 'UNKNOWN'} · {itemRevision?.segments.length ?? 0} {locale === 'vi' ? 'đoạn' : 'segments'} · {timingStateLabel(itemRevision?.state, locale)}</small>{itemRevision?.segments.slice(0, 2).map((segment) => <small key={segment.id ?? segment.segmentIndex}>{rationalLabel(segment.start)} → {rationalLabel(segment.end)} · {segment.text}</small>)}{itemRevision?.stale && <small className="warning-text">{itemRevision.staleReason ? `${itemRevision.staleReason} · ` : ''}{itemRevision.nextStep ?? (locale === 'vi' ? 'Tạo lại trên checkpoint mới.' : 'Create a new revision on the current checkpoint.')}</small>}</div>{nextState && track?.id && itemRevision?.id && <button type="button" className="subtle-button tiny" disabled={!canWrite || !client.transitionSubtitleTrackRevision} onClick={() => void transitionSubtitle(track.id!, itemRevision.id!, nextState, itemRevision.rowVersion)}>{mutating === `subtitle-transition:${itemRevision.id}` ? <RefreshCw size={12} className="spin" /> : <ArrowRight size={12} />}{timingStateLabel(nextState, locale)}</button>}</div> })}</div>}
          <form className="workspace-form timeline-timing-form" onSubmit={createSubtitleTrack}><div className="form-grid two"><label>{locale === 'vi' ? 'Locale' : 'Locale'}<input value={subtitleLocale} onChange={(event) => setSubtitleLocale(event.target.value)} maxLength={32} disabled={!canWrite} /></label><label>{locale === 'vi' ? 'Tên track' : 'Track title'}<input value={subtitleTitle} onChange={(event) => setSubtitleTitle(event.target.value)} maxLength={200} disabled={!canWrite} /></label></div><div className="form-grid four"><label>Start num<input value={subtitleStartNum} onChange={(event) => setSubtitleStartNum(event.target.value)} inputMode="numeric" disabled={!canWrite} /></label><label>Start den<input value={subtitleStartDen} onChange={(event) => setSubtitleStartDen(event.target.value)} inputMode="numeric" disabled={!canWrite} /></label><label>End num<input value={subtitleEndNum} onChange={(event) => setSubtitleEndNum(event.target.value)} inputMode="numeric" disabled={!canWrite} /></label><label>End den<input value={subtitleEndDen} onChange={(event) => setSubtitleEndDen(event.target.value)} inputMode="numeric" disabled={!canWrite} /></label></div><label>{locale === 'vi' ? 'Nội dung phụ đề' : 'Subtitle text'}<textarea value={subtitleText} onChange={(event) => setSubtitleText(event.target.value)} rows={2} maxLength={2000} disabled={!canWrite} placeholder={locale === 'vi' ? 'Nhập một đoạn; có thể tạo revision mới cho các đoạn tiếp theo.' : 'Enter one segment; create a new revision for additional segments.'} /></label><button type="submit" className="subtle-button tiny" disabled={!canWrite || !client.createSubtitleTrackRevision}>{mutating === 'subtitle-create' ? <RefreshCw size={12} className="spin" /> : <Plus size={12} />}{locale === 'vi' ? 'Thêm track phụ đề' : 'Add subtitle track'}</button></form>
        </section>
      </div>
    </>}
    <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Mọi cue/track đều pin timing_dependency_revision_id + content hash. Khi checkpoint mới xuất hiện, bản cũ chuyển STALE; Core không tự approve hoặc tự chọn asset.' : 'Every cue/track pins timing_dependency_revision_id + content hash. A newer checkpoint makes old records STALE; Core never auto-approves or silently chooses an asset.'}</p>
  </div>
}

export function ReviewView({ snapshot, locale, client, onToast }: { snapshot: DashboardSnapshot; locale: Locale; client: CoreClient; onToast: (message: string) => void }) {
  const [projectId, setProjectId] = useState(() => snapshot.projects[0]?.id ?? '')
  const [reviews, setReviews] = useState<ReviewSession[]>([])
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null)
  const [reviewWorkspace, setReviewWorkspace] = useState<ReviewWorkspace | null>(null)
  const [timelines, setTimelines] = useState<TimelineSummary[]>([])
  const [timelineId, setTimelineId] = useState<string | null>(null)
  const [timelineWorkspace, setTimelineWorkspace] = useState<TimelineWorkspace | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [needsUser, setNeedsUser] = useState(false)
  const [mutating, setMutating] = useState<string | null>(null)
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | 'REPAIR' | 'ABSTAIN'>('APPROVE')
  const [notes, setNotes] = useState('')
  const [reasonCodes, setReasonCodes] = useState('')
  const loadGenerationRef = useRef(0)
  const detailGenerationRef = useRef(0)

  const connected = snapshot.system.connected && !snapshot.system.offline && (client.isLive?.() ?? true)
  const project = snapshot.projects.find((candidate) => candidate.id === projectId) ?? null
  const selectedReview = reviewWorkspace?.review ?? reviews.find((item) => item.id === selectedReviewId) ?? null
  const candidateRevisions = (timelineWorkspace?.revisions ?? []).filter((revision) => ['DRAFT_CHECKPOINT', 'CANDIDATE'].includes(revision.state))

  useEffect(() => {
    if (!projectId && snapshot.projects[0]) setProjectId(snapshot.projects[0].id)
    if (projectId && !snapshot.projects.some((candidate) => candidate.id === projectId)) setProjectId(snapshot.projects[0]?.id ?? '')
  }, [projectId, snapshot.projects])

  const loadProject = useCallback(async (signal?: AbortSignal) => {
    const generation = ++loadGenerationRef.current
    if (!projectId) {
      setReviews([]); setTimelines([]); setSelectedReviewId(null); setReviewWorkspace(null); setTimelineId(null); setTimelineWorkspace(null); setLoading(false); return
    }
    if (!client.getReviews || !client.getTimelines) {
      setError(locale === 'vi' ? 'Core chưa cung cấp workspace Review.' : 'Core does not expose the Review workspace yet.')
      setLoading(false)
      return
    }
    setLoading(true); setError(null); setActionError(null); setNeedsUser(false)
    try {
      const [reviewResult, timelineResult] = await Promise.all([client.getReviews(projectId, undefined, signal), client.getTimelines(projectId, signal)])
      if (signal?.aborted || generation !== loadGenerationRef.current) return
      setReviews(reviewResult)
      setSelectedReviewId((current) => current && reviewResult.some((item) => item.id === current) ? current : reviewResult[0]?.id ?? null)
      setTimelines(timelineResult)
      setTimelineId((current) => current && timelineResult.some((item) => item.id === current) ? current : timelineResult[0]?.id ?? null)
    } catch (cause) {
      if ((cause instanceof DOMException && cause.name === 'AbortError') || generation !== loadGenerationRef.current) return
      setError(workspaceErrorMessage(cause, locale)); setReviews([]); setTimelines([]); setSelectedReviewId(null); setReviewWorkspace(null); setTimelineId(null); setTimelineWorkspace(null)
    } finally {
      if (!signal?.aborted && generation === loadGenerationRef.current) setLoading(false)
    }
  }, [client, locale, projectId])

  useEffect(() => {
    const controller = new AbortController()
    setReviews([]); setSelectedReviewId(null); setReviewWorkspace(null); setTimelines([]); setTimelineId(null); setTimelineWorkspace(null)
    void loadProject(controller.signal)
    return () => controller.abort()
  }, [loadProject])

  const loadReview = useCallback(async (reviewId: string, signal?: AbortSignal) => {
    if (!client.getReview || !projectId) return
    const generation = ++detailGenerationRef.current
    setDetailLoading(true); setActionError(null)
    try {
      const next = await client.getReview(projectId, reviewId, signal)
      if (signal?.aborted || generation !== detailGenerationRef.current) return
      setReviewWorkspace(next)
      if (next.review?.humanReview) {
        setDecision(next.review.humanReview.decision as 'APPROVE' | 'REJECT' | 'REPAIR' | 'ABSTAIN')
        setNotes(next.review.humanReview.notes ?? '')
        setReasonCodes(next.review.humanReview.reasonCodes.join(', '))
      } else {
        setDecision('APPROVE'); setNotes(''); setReasonCodes('')
      }
    } catch (cause) {
      if ((cause instanceof DOMException && cause.name === 'AbortError') || generation !== detailGenerationRef.current) return
      setActionError(workspaceErrorMessage(cause, locale)); setReviewWorkspace(null)
    } finally {
      if (!signal?.aborted && generation === detailGenerationRef.current) setDetailLoading(false)
    }
  }, [client, locale, projectId])

  useEffect(() => {
    if (!selectedReviewId || !projectId) { setReviewWorkspace(null); return }
    const controller = new AbortController()
    void loadReview(selectedReviewId, controller.signal)
    return () => controller.abort()
  }, [loadReview, projectId, selectedReviewId])

  const loadTimeline = useCallback(async (selectedId: string, signal?: AbortSignal) => {
    if (!client.getTimelineWorkspace || !projectId) return
    try {
      const next = await client.getTimelineWorkspace(projectId, selectedId, signal)
      if (!signal?.aborted) setTimelineWorkspace(next)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setActionError(workspaceErrorMessage(cause, locale)); setTimelineWorkspace(null)
    }
  }, [client, locale, projectId])

  useEffect(() => {
    if (!timelineId || !projectId) { setTimelineWorkspace(null); return }
    const controller = new AbortController()
    setTimelineWorkspace(null)
    void loadTimeline(timelineId, controller.signal)
    return () => controller.abort()
  }, [loadTimeline, projectId, timelineId])

  const openReview = async (revision: TimelineRevision) => {
    if (!client.openReview || !projectId || !revision.id || mutating) return
    setMutating(`review-open:${revision.id}`); setActionError(null); setNeedsUser(false)
    try {
      const next = await client.openReview(projectId, revision.id, revision.rowVersion, `review-open:${revision.id}:${revision.rowVersion}`)
      if (next.review?.id) setSelectedReviewId(next.review.id)
      setReviewWorkspace(next)
      setReviews((current) => next.review ? [next.review, ...current.filter((item) => item.id !== next.review?.id)] : current)
      onToast(locale === 'vi' ? 'Đã mở review cho checkpoint.' : 'Review opened for the checkpoint.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser); setActionError(workspaceErrorMessage(cause, locale))
    } finally { setMutating(null) }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!client.submitReview || !projectId || !selectedReview?.id || !['OPEN', 'IN_PROGRESS'].includes(selectedReview.state) || mutating) return
    setMutating(`review-submit:${selectedReview.id}`); setActionError(null); setNeedsUser(false)
    try {
      const next = await client.submitReview(projectId, selectedReview.id, decision, selectedReview.rowVersion, notes.trim(), reasonCodes.split(',').map((item) => item.trim()).filter(Boolean), `review-submit:${selectedReview.id}:${selectedReview.rowVersion}:${decision}:${notes}`)
      setReviewWorkspace(next)
      if (next.review) setReviews((current) => [next.review as ReviewSession, ...current.filter((item) => item.id !== next.review?.id)])
      onToast(locale === 'vi' ? 'Đã ghi quyết định review vào Core.' : 'The review decision was recorded in Core.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser); setActionError(workspaceErrorMessage(cause, locale))
    } finally { setMutating(null) }
  }

  const approveTimeline = async () => {
    const transition = client.transitionTimelineRevision
    if (!transition || !projectId || !reviewWorkspace?.review?.id || !reviewWorkspace.subject?.id || !reviewWorkspace.subject.timelineId || !['SUBMITTED'].includes(reviewWorkspace.review.state) || reviewWorkspace.review.humanReview?.decision !== 'APPROVE' || mutating) return
    setMutating(`timeline-approve:${reviewWorkspace.subject.id}`); setActionError(null); setNeedsUser(false)
    try {
      const dependencySnapshotHash = reviewWorkspace.review.dependencySnapshotHash ?? reviewWorkspace.snapshot?.hash
      if (!dependencySnapshotHash) {
        throw new CoreClientError(locale === 'vi' ? 'Review thiếu dependency snapshot hash.' : 'The review is missing its dependency snapshot hash.', { code: 'REVIEW_SNAPSHOT_REQUIRED', category: 'VALIDATION', needsUser: true })
      }
      await transition(projectId, reviewWorkspace.subject.timelineId, reviewWorkspace.subject.id, 'APPROVED', reviewWorkspace.subject.rowVersion, `timeline-approve:${reviewWorkspace.subject.id}:${reviewWorkspace.subject.rowVersion}:${reviewWorkspace.review.id}`, reviewWorkspace.review.id, dependencySnapshotHash)
      onToast(locale === 'vi' ? 'Timeline đã được approve bằng review hiện tại.' : 'The timeline was approved with the current review.')
      await loadProject()
      await loadReview(reviewWorkspace.review.id)
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser); setActionError(workspaceErrorMessage(cause, locale))
    } finally { setMutating(null) }
  }

  return <div className="page review-page">
    <div className="page-heading"><div><p className="eyebrow">HUMAN REVIEW</p><h1>{locale === 'vi' ? 'Duyệt checkpoint' : 'Review checkpoints'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Ghi quyết định trên đúng revision và dependency snapshot. Không có playback hoặc render giả trong workspace này.' : 'Record a decision against an exact revision and dependency snapshot. Playback and rendering are intentionally absent here.'}</p></div><div className="page-heading-actions"><button className="subtle-button tiny" onClick={() => void loadProject()}><RefreshCw size={13} />{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button><span className="count-chip"><CheckCircle2 size={15} />{reviews.length}</span></div></div>
    <div className="timeline-toolbar"><label>{locale === 'vi' ? 'Project' : 'Project'}<select className="timeline-project-select" value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={locale === 'vi' ? 'Project review' : 'Review project'}><option value="">{locale === 'vi' ? 'Chọn project' : 'Choose a project'}</option>{snapshot.projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>{project && <span className="state-label"><ShieldCheck size={13} />{connected ? (locale === 'vi' ? 'Core đã kết nối' : 'Core connected') : (locale === 'vi' ? 'Core offline' : 'Core offline')}</span>}</div>
    {!connected && <div className="inline-state warning"><CloudOff size={14} /><span>{locale === 'vi' ? 'Core đang offline. Review là dữ liệu canonical nên thao tác ghi bị khoá.' : 'Core is offline. Review is canonical data, so mutations are disabled.'}</span></div>}
    {error && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{error}</span><button className="subtle-button tiny" onClick={() => void loadProject()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}
    {actionError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{actionError}</span>{needsUser && <small>{locale === 'vi' ? 'Core cần bạn xử lý điều kiện hoặc xung đột rồi thử lại.' : 'Core needs you to resolve the condition or conflict before retrying.'}</small>}</div>}
    {!project ? <EmptyState icon={CheckCircle2} title={locale === 'vi' ? 'Chưa có project' : 'No project selected'} detail={locale === 'vi' ? 'Tạo project trước khi mở review.' : 'Create a project before opening a review.'} /> : loading ? <LoadingState label={locale === 'vi' ? 'Đang đọc review từ Core…' : 'Reading reviews from Core…'} /> : <div className="review-grid">
      <section className="workspace-panel review-list-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><CheckCircle2 size={16} /></span><div><h2>{locale === 'vi' ? 'Review đã ghi' : 'Recorded reviews'}</h2><p>{locale === 'vi' ? 'Mỗi mục pin một revision cụ thể.' : 'Each item pins one exact revision.'}</p></div></div><span className="count-chip">{reviews.length}</span></div>{reviews.length === 0 ? <EmptyState icon={CheckCircle2} title={locale === 'vi' ? 'Chưa có review' : 'No reviews yet'} detail={locale === 'vi' ? 'Chọn candidate checkpoint bên phải để mở review.' : 'Choose a candidate checkpoint on the right to open a review.'} /> : <div className="workspace-record-list">{reviews.map((item) => <button type="button" className={`timeline-row ${item.id === selectedReview?.id ? 'active' : ''}`} key={item.id} onClick={() => setSelectedReviewId(item.id ?? null)}><span className="timeline-row-icon"><CheckCircle2 size={15} /></span><span className="workspace-record-main"><strong>{item.humanReview?.decision ?? (locale === 'vi' ? 'Đang mở' : 'Open')}</strong><small>{item.subjectRevisionId ?? item.subjectId} · v{item.rowVersion}</small></span><span className={`record-code ${item.stale ? 'warning-text' : ''}`}>{item.state}</span><ArrowRight size={14} /></button>)}</div>}
        <div className="review-candidate-picker"><div className="card-heading"><div><h3>{locale === 'vi' ? 'Candidate checkpoint' : 'Candidate checkpoints'}</h3><p>{locale === 'vi' ? 'Mở review mới khi checkpoint đã đủ điều kiện.' : 'Open a new review once the checkpoint is ready.'}</p></div><select value={timelineId ?? ''} onChange={(event) => setTimelineId(event.target.value || null)} aria-label={locale === 'vi' ? 'Timeline cần review' : 'Timeline for review'}><option value="">{locale === 'vi' ? 'Chọn timeline' : 'Choose timeline'}</option>{timelines.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></div>{timelineWorkspace && candidateRevisions.length > 0 ? <div className="timeline-revision-list">{candidateRevisions.map((revision) => <div className="timeline-revision-row" key={revision.id}><div><strong>{revision.id}</strong><small>{timelineStateLabel(revision.state, locale)} · {rationalLabel(revision.duration)} · {revision.readinessState}</small></div><button type="button" className="subtle-button tiny" disabled={!connected || mutating !== null || !client.openReview} onClick={() => void openReview(revision)}>{mutating === `review-open:${revision.id}` ? <RefreshCw size={12} className="spin" /> : <Plus size={12} />}{locale === 'vi' ? 'Mở review' : 'Open review'}</button></div>)}</div> : <EmptyInline icon={Info} text={locale === 'vi' ? 'Chưa có candidate checkpoint.' : 'No candidate checkpoint is available.'} />}</div>
      </section>
      <section className="workspace-panel review-detail-card">{detailLoading ? <LoadingState label={locale === 'vi' ? 'Đang đọc bằng chứng review…' : 'Reading review evidence…'} /> : !selectedReview ? <EmptyState icon={Info} title={locale === 'vi' ? 'Chọn một review' : 'Select a review'} detail={locale === 'vi' ? 'Review detail sẽ hiển thị snapshot, readiness và quyết định.' : 'Review details will show the snapshot, readiness and decision.'} /> : <>
        <div className="card-heading"><div className="card-title-with-icon"><span className="card-icon green"><ShieldCheck size={16} /></span><div><h2>{locale === 'vi' ? 'Review workspace' : 'Review workspace'}</h2><p>{selectedReview.subjectRevisionId ?? selectedReview.subjectId} · v{selectedReview.rowVersion}</p></div></div><span className={`state-label ${selectedReview.stale ? 'warning-text' : ''}`}>{selectedReview.stale ? (locale === 'vi' ? 'STALE' : 'STALE') : selectedReview.state}</span></div>
        {selectedReview.stale && <div className="inline-state warning"><AlertCircle size={14} /><span>{locale === 'vi' ? 'Snapshot review không còn khớp với revision hiện tại. Không thể approve bằng bằng chứng cũ.' : 'The review snapshot no longer matches the current revision. Old evidence cannot approve it.'}</span></div>}
        <div className="timeline-metrics"><div><span>{locale === 'vi' ? 'Revision' : 'Revision'}</span><strong>{reviewWorkspace?.subject?.id ?? selectedReview.subjectRevisionId ?? '—'}</strong></div><div><span>{locale === 'vi' ? 'Readiness' : 'Readiness'}</span><strong>{reviewWorkspace?.subject?.readinessState ?? 'UNKNOWN'}</strong></div><div><span>{locale === 'vi' ? 'Snapshot' : 'Snapshot'}</span><strong title={reviewWorkspace?.snapshot?.hash}>{reviewWorkspace?.snapshot?.stale ? 'STALE' : (reviewWorkspace?.snapshot?.hash?.slice(0, 12) ?? '—')}</strong></div><div><span>{locale === 'vi' ? 'Tracks' : 'Tracks'}</span><strong>{reviewWorkspace?.subject?.tracks.length ?? 0}</strong></div></div>
        <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Core chỉ cho approve khi review SUBMITTED, quyết định APPROVE, readiness READY và snapshot hash vẫn khớp.' : 'Core approves only when the review is SUBMITTED with APPROVE, readiness is READY, and the snapshot hash still matches.'}</p>
        {selectedReview.state === 'SUBMITTED' ? <div className="review-submitted-card"><strong>{locale === 'vi' ? 'Đã gửi quyết định' : 'Decision submitted'}</strong><span>{selectedReview.humanReview?.decision ?? '—'} · {selectedReview.humanReview?.reviewedAt ?? selectedReview.submittedAt ?? '—'}</span>{selectedReview.humanReview?.notes && <p>{selectedReview.humanReview.notes}</p>}{selectedReview.humanReview?.decision === 'APPROVE' && !selectedReview.stale && <button className="primary-button small" type="button" disabled={!connected || mutating !== null || !client.transitionTimelineRevision} onClick={() => void approveTimeline()}>{mutating?.startsWith('timeline-approve:') ? <RefreshCw size={14} className="spin" /> : <Check size={14} />}{locale === 'vi' ? 'Approve timeline bằng review này' : 'Approve timeline with this review'}</button>}</div> : <form className="workspace-form review-submit-form" onSubmit={submit}><div className="form-grid two"><label>{locale === 'vi' ? 'Quyết định' : 'Decision'}<select value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)} disabled={!connected || mutating !== null || selectedReview.stale}><option value="APPROVE">APPROVE</option><option value="REJECT">REJECT</option><option value="REPAIR">REPAIR</option><option value="ABSTAIN">ABSTAIN</option></select></label><label>{locale === 'vi' ? 'Review version' : 'Review version'}<input value={selectedReview.rowVersion} readOnly /></label></div><label>{locale === 'vi' ? 'Ghi chú' : 'Notes'}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={8000} disabled={!connected || mutating !== null || selectedReview.stale} placeholder={locale === 'vi' ? 'Nêu nhận xét có thể audit.' : 'Add an auditable note.'} /></label><label>{locale === 'vi' ? 'Mã lý do (phân cách bằng dấu phẩy)' : 'Reason codes (comma separated)'}<input value={reasonCodes} onChange={(event) => setReasonCodes(event.target.value)} disabled={!connected || mutating !== null || selectedReview.stale} /></label><button className="primary-button small" type="submit" disabled={!connected || mutating !== null || selectedReview.stale || !client.submitReview}>{mutating?.startsWith('review-submit:') ? <RefreshCw size={14} className="spin" /> : <CheckCircle2 size={14} />}{locale === 'vi' ? 'Gửi quyết định' : 'Submit decision'}</button></form>}
      </>}</section>
    </div>}
  </div>
}

function downloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function downloadString(value: unknown, maximum = 500) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : undefined
}

function downloadHash(value: unknown) {
  const hash = downloadString(value, 64)?.toLowerCase()
  return hash && /^[0-9a-f]{64}$/.test(hash) ? hash : undefined
}

function downloadInteger(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) ? number : undefined
}

function downloadRational(value: unknown) {
  const source = downloadRecord(value)
  const num = downloadInteger(source.num)
  const den = downloadInteger(source.den)
  return num !== undefined && den !== undefined && den > 0 ? { num, den } : undefined
}

function compactDownloadRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function safeHandoffManifestDocument(value: Record<string, unknown> | undefined) {
  const source = downloadRecord(value)
  const target = downloadRecord(source.target)
  const sourceDocument = downloadRecord(source.source)
  const mediaProfile = downloadRecord(sourceDocument.media_profile ?? sourceDocument.mediaProfile)
  const review = downloadRecord(sourceDocument.review)
  const tracks = Array.isArray(sourceDocument.tracks) ? sourceDocument.tracks.map((rawTrack) => {
    const track = downloadRecord(rawTrack)
    const clips = Array.isArray(track.clips) ? track.clips.map((rawClip) => {
      const clip = downloadRecord(rawClip)
      return compactDownloadRecord({
        id: downloadString(clip.id, 160),
        asset_revision_id: downloadString(clip.asset_revision_id ?? clip.assetRevisionId, 160),
        source_in: clip.source_in === null || clip.sourceIn === null ? null : downloadRational(clip.source_in ?? clip.sourceIn),
        source_out: clip.source_out === null || clip.sourceOut === null ? null : downloadRational(clip.source_out ?? clip.sourceOut),
        timeline_in: downloadRational(clip.timeline_in ?? clip.timelineIn),
        timeline_out: downloadRational(clip.timeline_out ?? clip.timelineOut),
        speed: downloadRational(clip.speed),
      })
    }) : []
    return compactDownloadRecord({
      id: downloadString(track.id, 160),
      track_type: downloadString(track.track_type ?? track.trackType, 80),
      order_index: downloadInteger(track.order_index ?? track.orderIndex),
      name: downloadString(track.name, 500),
      enabled: typeof track.enabled === 'boolean' ? track.enabled : undefined,
      clips,
    })
  }) : []
  const markers = Array.isArray(sourceDocument.markers) ? sourceDocument.markers.map((rawMarker) => {
    const marker = downloadRecord(rawMarker)
    return compactDownloadRecord({
      id: downloadString(marker.id, 160),
      time: downloadRational(marker.time),
      marker_type: downloadString(marker.marker_type ?? marker.markerType, 120),
      label: downloadString(marker.label, 500),
    })
  }) : []
  return compactDownloadRecord({
    manifest_type: downloadString(source.manifest_type ?? source.manifestType, 120),
    manifest_schema_version: downloadInteger(source.manifest_schema_version ?? source.manifestSchemaVersion),
    deliverable_type: downloadString(source.deliverable_type ?? source.deliverableType, 120),
    target: compactDownloadRecord({
      editor: downloadString(target.editor, 120),
      version: downloadString(target.version, 120),
      profile: downloadString(target.profile, 80),
      compatibility_profile_version: downloadString(target.compatibility_profile_version ?? target.compatibilityProfileVersion, 120),
    }),
    source: compactDownloadRecord({
      project_id: downloadString(sourceDocument.project_id ?? sourceDocument.projectId, 160),
      timeline_id: downloadString(sourceDocument.timeline_id ?? sourceDocument.timelineId, 160),
      timeline_revision_id: downloadString(sourceDocument.timeline_revision_id ?? sourceDocument.timelineRevisionId, 160),
      revision_number: downloadInteger(sourceDocument.revision_number ?? sourceDocument.revisionNumber),
      lifecycle_state: downloadString(sourceDocument.lifecycle_state ?? sourceDocument.lifecycleState, 80),
      content_hash: downloadHash(sourceDocument.content_hash ?? sourceDocument.contentHash),
      duration: downloadRational(sourceDocument.duration),
      media_profile: compactDownloadRecord({
        revision_id: downloadString(mediaProfile.revision_id ?? mediaProfile.revisionId, 160),
        lifecycle_state: downloadString(mediaProfile.lifecycle_state ?? mediaProfile.lifecycleState, 80),
        timeline_rate: downloadRational(mediaProfile.timeline_rate ?? mediaProfile.timelineRate),
        time_base: downloadRational(mediaProfile.time_base ?? mediaProfile.timeBase),
        pixel_aspect: downloadRational(mediaProfile.pixel_aspect ?? mediaProfile.pixelAspect),
        width: downloadInteger(mediaProfile.width),
        height: downloadInteger(mediaProfile.height),
        working_color_space: downloadString(mediaProfile.working_color_space ?? mediaProfile.workingColorSpace, 120),
        transfer_function: downloadString(mediaProfile.transfer_function ?? mediaProfile.transferFunction, 120),
        hdr_policy: downloadString(mediaProfile.hdr_policy ?? mediaProfile.hdrPolicy, 120),
        audio_sample_rate: downloadInteger(mediaProfile.audio_sample_rate ?? mediaProfile.audioSampleRate),
        audio_channel_layout: downloadString(mediaProfile.audio_channel_layout ?? mediaProfile.audioChannelLayout, 120),
      }),
      review: compactDownloadRecord({
        session_id: downloadString(review.session_id ?? review.sessionId, 160),
        state: downloadString(review.state, 80),
        decision: downloadString(review.decision, 80),
        dependency_snapshot_hash: downloadHash(review.dependency_snapshot_hash ?? review.dependencySnapshotHash),
        subject_content_hash: downloadHash(review.subject_content_hash ?? review.subjectContentHash),
      }),
      tracks,
      markers,
    }),
  })
}

function safeHandoffCompatibility(value: HandoffWorkspace['compatibilityReport'] | undefined) {
  if (!value) return undefined
  return compactDownloadRecord({
    profile_version: downloadString(value.profileVersion, 120),
    target_editor: downloadString(value.targetEditor, 120),
    target_version: downloadString(value.targetVersion, 120),
    editable_claim: value.editableClaim === true,
    entries: value.entries.map((entry) => compactDownloadRecord({ feature: downloadString(entry.feature, 120), status: downloadString(entry.status, 40), detail: downloadString(entry.detail, 1000) })),
    counts: value.counts ? Object.fromEntries(Object.entries(value.counts).filter(([key, count]) => /^[A-Z_]+$/.test(key) && downloadInteger(count) !== undefined).map(([key, count]) => [key, downloadInteger(count)])) : undefined,
    next_step: downloadString(value.nextStep, 1000),
  })
}

function safeHandoffSanitization(value: HandoffWorkspace['sanitizationReport'] | undefined) {
  if (!value) return undefined
  return compactDownloadRecord({
    policy: downloadString(value.policy, 120),
    recorded: value.recorded === true,
    removed_fields: value.removedFields.filter((field) => typeof field === 'string' && field.length <= 160),
    next_step: downloadString(value.nextStep, 1000),
  })
}

function handoffDownloadFilename(session: HandoffWorkspace['exportSession'], manifest: HandoffWorkspace['handoffManifest']) {
  const rawTarget = session?.targetEditor ?? manifest?.targetEditor ?? 'manifest'
  const target = rawTarget.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'manifest'
  const hash = downloadHash(manifest?.manifestHash) ?? 'unverified'
  return `cineforge-handoff-${target}-${hash.slice(0, 16)}.json`
}

function downloadHandoffEvidence(session: HandoffWorkspace['exportSession'], manifest: HandoffWorkspace['handoffManifest'], compatibility: HandoffWorkspace['compatibilityReport'] | undefined, sanitization: HandoffWorkspace['sanitizationReport'] | undefined) {
  const manifestHash = downloadHash(manifest?.manifestHash)
  if (!session || !manifest || !manifestHash || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof document === 'undefined') return false
  const payload = {
    schema: 'CINEFORGE_HANDOFF_EVIDENCE_V1',
    manifest_hash: manifestHash,
    export_session: compactDownloadRecord({
      id: downloadString(session.id, 160),
      project_id: downloadString(session.projectId, 160),
      timeline_revision_id: downloadString(session.timelineRevisionId, 160),
      deliverable_type: downloadString(session.deliverableType, 120),
      target_profile: downloadString(session.targetProfile, 80),
      target_editor: downloadString(session.targetEditor, 120),
      target_version: downloadString(session.targetVersion, 120),
      state: downloadString(session.state, 80),
      output_manifest_id: downloadString(session.outputManifestId, 160),
      review_session_id: downloadString(session.reviewSessionId, 160),
      dependency_snapshot_hash: downloadHash(session.dependencySnapshotHash),
      subject_content_hash: downloadHash(session.subjectContentHash),
      media_profile_revision_id: downloadString(session.mediaProfileRevisionId, 160),
      next_step: downloadString(session.nextStep, 1000),
      row_version: downloadInteger(session.rowVersion),
      created_at: downloadString(session.createdAt, 80),
      updated_at: downloadString(session.updatedAt, 80),
    }),
    handoff_manifest: compactDownloadRecord({
      id: downloadString(manifest.id, 160),
      export_session_id: downloadString(manifest.exportSessionId, 160),
      project_id: downloadString(manifest.projectId, 160),
      target_editor: downloadString(manifest.targetEditor, 120),
      target_version: downloadString(manifest.targetVersion, 120),
      compatibility_profile_version: downloadString(manifest.compatibilityProfileVersion, 120),
      manifest_hash: manifestHash,
      manifest: safeHandoffManifestDocument(manifest.manifest),
      artifact_allowlist: manifest.artifactAllowlist.map((artifact) => compactDownloadRecord({
        asset_revision_id: downloadString(artifact.assetRevisionId, 160),
        asset_id: downloadString(artifact.assetId, 160),
        semantic_role: downloadString(artifact.semanticRole, 160),
        rebuildability: downloadString(artifact.rebuildability, 80),
        hash_algorithm: downloadString(artifact.hashAlgorithm, 80),
        content_hash: downloadHash(artifact.contentHash),
        byte_size: downloadInteger(artifact.byteSize),
        availability_state: downloadString(artifact.availabilityState, 80),
        review_state: downloadString(artifact.reviewState, 80),
        availability_evidence_state: downloadString(artifact.availabilityEvidenceState, 80),
      })),
      compatibility: safeHandoffCompatibility(compatibility ?? manifest.compatibility),
      sanitization_report: safeHandoffSanitization(sanitization ?? manifest.sanitizationReport),
    }),
  }
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = handoffDownloadFilename(session, manifest)
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body?.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    const revoke = () => URL.revokeObjectURL(objectUrl)
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') window.setTimeout(revoke, 0)
    else revoke()
  }
  return true
}

export function HandoffView({ snapshot, locale, client, onToast }: { snapshot: DashboardSnapshot; locale: Locale; client: CoreClient; onToast: (message: string) => void }) {
  const [projectId, setProjectId] = useState(() => snapshot.projects[0]?.id ?? '')
  const [handoffs, setHandoffs] = useState<HandoffListItem[]>([])
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null)
  const [selectedWorkspace, setSelectedWorkspace] = useState<HandoffWorkspace | null>(null)
  const [timelines, setTimelines] = useState<TimelineSummary[]>([])
  const [timelineId, setTimelineId] = useState<string | null>(null)
  const [timelineWorkspace, setTimelineWorkspace] = useState<TimelineWorkspace | null>(null)
  const [reviews, setReviews] = useState<ReviewSession[]>([])
  const [externalEdits, setExternalEdits] = useState<ExternalEdit[]>([])
  const [returnedAssets, setReturnedAssets] = useState<AssetSummary[]>([])
  const [externalEditLoading, setExternalEditLoading] = useState(false)
  const [selectedReturnedRevisionId, setSelectedReturnedRevisionId] = useState('')
  const [lineageConfidence, setLineageConfidence] = useState<ExternalEditLineageConfidence>('PARTIAL')
  const [externalEditMutating, setExternalEditMutating] = useState(false)
  const [targetEditor, setTargetEditor] = useState('UNKNOWN_EDITOR')
  const [targetVersion, setTargetVersion] = useState('1')
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [needsUser, setNeedsUser] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [downloadLoading, setDownloadLoading] = useState(false)
  const loadGenerationRef = useRef(0)
  const projectEpochRef = useRef(0)
  const projectIdRef = useRef(projectId)
  if (projectIdRef.current !== projectId) {
    projectIdRef.current = projectId
    projectEpochRef.current += 1
  }

  const connected = snapshot.system.connected && !snapshot.system.offline && (client.isLive?.() ?? true)
  const project = snapshot.projects.find((candidate) => candidate.id === projectId) ?? null
  const selectedHandoff = selectedWorkspace?.exportSession ?? handoffs.find((item) => item.exportSession.id === selectedHandoffId)?.exportSession ?? null
  const approvedRevision = (timelineWorkspace?.revisions ?? []).find((revision) => revision.state === 'APPROVED') ?? null
  const approvalReview = approvedRevision?.id
    ? reviews.find((review) => review.subjectRevisionId === approvedRevision.id && review.state === 'SUBMITTED' && review.humanReview?.decision === 'APPROVE' && !review.stale)
    : null
  const dependencySnapshotHash = approvalReview?.dependencySnapshotHash ?? approvalReview?.humanReview?.dependencySnapshotHash ?? ''
  const canCreate = Boolean(connected && client.createHandoffManifest && projectId && approvedRevision?.id && approvalReview?.id && dependencySnapshotHash && approvedRevision.rowVersion > 0 && targetEditor.trim() && targetVersion.trim() && !mutating)
  // Do not expose a clickable-looking mutation control while exact
  // timeline/review evidence is still loading. Offline and unsupported
  // bridges still render the disabled control with an explanation.
  const createControlReady = !connected || !client.getTimelineWorkspace || timelineWorkspace !== null
  const buildableStates = new Set(['PREFLIGHT', 'FAILED', 'BLOCKED_RIGHTS', 'BLOCKED_MEDIA'])
  const exactSelectedSession = selectedWorkspace?.exportSession?.id && selectedWorkspace.exportSession.id === selectedHandoff?.id
    ? selectedWorkspace.exportSession
    : null
  const canBuild = Boolean(
    connected && client.buildTimelineInterchangeExport && exactSelectedSession?.id
      && buildableStates.has(String(exactSelectedSession.state).toUpperCase())
      && exactSelectedSession.dependencySnapshotHash && Number.isSafeInteger(exactSelectedSession.rowVersion)
      && exactSelectedSession.rowVersion > 0 && !mutating,
  )
  useEffect(() => {
    if (!projectId && snapshot.projects[0]) setProjectId(snapshot.projects[0].id)
    if (projectId && !snapshot.projects.some((candidate) => candidate.id === projectId)) setProjectId(snapshot.projects[0]?.id ?? '')
  }, [projectId, snapshot.projects])

  const loadProject = useCallback(async (signal?: AbortSignal) => {
    const generation = ++loadGenerationRef.current
    if (!projectId) {
      setHandoffs([]); setSelectedHandoffId(null); setSelectedWorkspace(null); setTimelines([]); setTimelineId(null); setTimelineWorkspace(null); setReviews([]); setExternalEdits([]); setReturnedAssets([]); setSelectedReturnedRevisionId(''); setExternalEditLoading(false); setLoading(false); return
    }
    if (!client.getHandoffs || !client.getTimelines || !client.getReviews) {
      setError(locale === 'vi' ? 'Core chưa cung cấp đầy đủ workspace bàn giao.' : 'Core does not expose the complete handoff workspace yet.')
      setLoading(false)
      return
    }
    setLoading(true); setExternalEditLoading(Boolean(client.getExternalEdits || client.getAssets)); setError(null); setActionError(null); setNeedsUser(false)
    try {
      const [handoffResult, timelineResult, reviewResult, externalEditResult, assetResult] = await Promise.all([
        client.getHandoffs(projectId, undefined, signal),
        client.getTimelines(projectId, signal),
        client.getReviews(projectId, undefined, signal),
        client.getExternalEdits ? client.getExternalEdits(projectId, undefined, signal).catch(() => ({ items: [] as ExternalEdit[] })) : Promise.resolve({ items: [] as ExternalEdit[] }),
        client.getAssets ? client.getAssets(projectId, signal).catch(() => [] as AssetSummary[]) : Promise.resolve([] as AssetSummary[]),
      ])
      if (signal?.aborted || generation !== loadGenerationRef.current) return
      setHandoffs(handoffResult)
      setSelectedHandoffId((current) => current && handoffResult.some((item) => item.exportSession.id === current) ? current : handoffResult[0]?.exportSession.id ?? null)
      setTimelines(timelineResult)
      setTimelineId((current) => current && timelineResult.some((item) => item.id === current) ? current : timelineResult[0]?.id ?? null)
      setReviews(reviewResult)
      setExternalEdits(externalEditResult.items)
      setReturnedAssets(assetResult)
      setSelectedReturnedRevisionId((current) => current && assetResult.some((asset) => asset.revisionId === current) ? current : '')
    } catch (cause) {
      if ((cause instanceof DOMException && cause.name === 'AbortError') || generation !== loadGenerationRef.current) return
      setError(workspaceErrorMessage(cause, locale)); setHandoffs([]); setSelectedHandoffId(null); setSelectedWorkspace(null); setTimelines([]); setTimelineId(null); setTimelineWorkspace(null); setReviews([]); setExternalEdits([]); setReturnedAssets([]); setSelectedReturnedRevisionId('')
    } finally {
      if (!signal?.aborted && generation === loadGenerationRef.current) { setLoading(false); setExternalEditLoading(false) }
    }
  }, [client, locale, projectId])

  useEffect(() => {
    const controller = new AbortController()
    setHandoffs([]); setSelectedHandoffId(null); setSelectedWorkspace(null); setTimelines([]); setTimelineId(null); setTimelineWorkspace(null); setReviews([]); setExternalEdits([]); setReturnedAssets([]); setSelectedReturnedRevisionId('')
    void loadProject(controller.signal)
    return () => controller.abort()
  }, [loadProject])

  useEffect(() => {
    if (!timelineId || !projectId || !client.getTimelineWorkspace) { setTimelineWorkspace(null); return }
    const controller = new AbortController()
    setTimelineWorkspace(null)
    void client.getTimelineWorkspace(projectId, timelineId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setTimelineWorkspace(next)
    }).catch((cause) => {
      if (!controller.signal.aborted) setActionError(workspaceErrorMessage(cause, locale))
    })
    return () => controller.abort()
  }, [client, locale, projectId, timelineId])

  const selectedWorkspaceId = selectedWorkspace?.exportSession?.id ?? null

  useEffect(() => {
    if (!selectedHandoffId || !projectId || !client.getHandoff) { setSelectedWorkspace(null); return }
    // A successful create already returns the immutable workspace. Keep that
    // evidence visible while the list projection catches up instead of
    // clearing it and making a slow detail read look like a failed command.
    if (selectedWorkspaceId === selectedHandoffId) { setDetailLoading(false); return }
    const controller = new AbortController()
    setDetailLoading(true); setActionError(null)
    void client.getHandoff(projectId, selectedHandoffId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setSelectedWorkspace(next)
    }).catch((cause) => {
      if (!controller.signal.aborted) { setSelectedWorkspace(null); setActionError(workspaceErrorMessage(cause, locale)) }
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false) })
    return () => controller.abort()
  }, [client, locale, projectId, selectedHandoffId, selectedWorkspaceId])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!client.createHandoffManifest || !canCreate || !approvedRevision?.id || !approvalReview?.id) return
    // Invalidate any initial/list projection still in flight. A stale list
    // response must not clear the workspace returned by this successful
    // command after the user has already selected it.
    // Invalidate an older list projection, but keep the command response
    // authoritative if a same-project refresh races with this mutation.
    // Only a project boundary change may discard the response.
    ++loadGenerationRef.current
    const createProjectEpoch = projectEpochRef.current
    setMutating(true); setActionError(null); setNeedsUser(false)
    const cleanEditor = targetEditor.trim().toUpperCase()
    const cleanVersion = targetVersion.trim()
    const idempotencyKey = `handoff:${projectId}:${approvedRevision.id}:${approvalReview.id}:${dependencySnapshotHash}:${cleanEditor}:${cleanVersion}`
    try {
      const next = await client.createHandoffManifest(projectId, {
        timelineRevisionId: approvedRevision.id,
        reviewSessionId: approvalReview.id,
        dependencySnapshotHash,
        targetEditor: cleanEditor,
        targetVersion: cleanVersion,
        targetProfile: 'GENERIC_INTERCHANGE',
        expectedVersion: approvedRevision.rowVersion,
      }, idempotencyKey)
      if (createProjectEpoch !== projectEpochRef.current || projectIdRef.current !== projectId) return
      // The command response is the authoritative immutable workspace. Update
      // the list and detail from it immediately; a separate list refresh can
      // lag and must not clear the just-created evidence between these state
      // updates. The user can still refresh later to reconcile other changes.
      if (next.exportSession?.id && next.handoffManifest) {
        const createdItem: HandoffListItem = { exportSession: next.exportSession, handoffManifest: next.handoffManifest }
        setHandoffs((current) => [createdItem, ...current.filter((item) => item.exportSession.id !== next.exportSession?.id)])
        setSelectedHandoffId(next.exportSession.id)
      }
      setSelectedWorkspace(next)
      onToast(locale === 'vi' ? 'Đã tạo manifest bàn giao bất biến từ bằng chứng đã approve.' : 'Created an immutable handoff manifest from approved evidence.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      if (createProjectEpoch === projectEpochRef.current) setLoading(false)
      setMutating(false)
    }
  }

  const compatibility = selectedWorkspace?.handoffManifest?.compatibility ?? selectedWorkspace?.compatibilityReport
  const sanitization = selectedWorkspace?.handoffManifest?.sanitizationReport ?? selectedWorkspace?.sanitizationReport
  const manifest = selectedWorkspace?.handoffManifest
  const session = selectedWorkspace?.exportSession ?? selectedHandoff
  const returnedInterchangeAssets = useMemo(() => returnedAssets.filter((asset) => {
    const assetType = String(asset.assetType ?? '').toUpperCase()
    const originType = String(asset.originType ?? '').toUpperCase()
    const availability = String(asset.availability ?? '').toUpperCase()
    const state = String(asset.state ?? '').toUpperCase()
    return Boolean(asset.revisionId) && assetType === 'TIMELINE_INTERCHANGE' && ['IMPORTED', 'EXTERNAL_EDIT', 'HANDOFF_RETURN'].includes(originType) && availability === 'AVAILABLE' && state !== 'ARCHIVED' && state !== 'DELETED'
  }), [returnedAssets])
  const selectedExternalEdits = useMemo(() => {
    if (!session?.id && !manifest?.id) return []
    return externalEdits.filter((item) => (session?.id && item.exportSessionId === session.id) || (manifest?.id && item.handoffManifestId === manifest.id))
  }, [externalEdits, manifest?.id, session?.id])
  const canRegisterExternalEdit = Boolean(
    connected && client.registerExternalEdit && session?.state === 'COMPLETED' && session.id && manifest?.id
      && Number.isSafeInteger(session.rowVersion) && session.rowVersion > 0 && selectedReturnedRevisionId && !externalEditMutating,
  )
  const sessionNextStep = selectedWorkspace?.nextStep ?? session?.nextStep ?? (
    String(session?.state ?? 'UNKNOWN').toUpperCase() === 'UNKNOWN'
      ? (locale === 'vi' ? 'Core chưa xác nhận lifecycle; tải lại và không tự nhận artifact.' : 'Core has not confirmed the lifecycle; refresh and do not adopt the artifact automatically.')
      : (locale === 'vi' ? 'Manifest chỉ chứa metadata an toàn; chưa có file media hoặc đường dẫn cục bộ.' : 'The manifest contains safe metadata only; no media bytes or local paths are included.')
  )
  const build = async () => {
    if (!client.buildTimelineInterchangeExport || !canBuild || !projectId || !session?.id || !session.dependencySnapshotHash) return
    ++loadGenerationRef.current
    const buildProjectEpoch = projectEpochRef.current
    setMutating(true); setActionError(null); setNeedsUser(false)
    try {
      const next = await client.buildTimelineInterchangeExport(projectId, session.id, session.dependencySnapshotHash, session.rowVersion, `timeline-interchange:${projectId}:${session.id}:${session.dependencySnapshotHash}:${session.rowVersion}`)
      if (buildProjectEpoch !== projectEpochRef.current || projectIdRef.current !== projectId) return
      const merged: HandoffWorkspace = {
        ...next,
        handoffManifest: next.handoffManifest ?? selectedWorkspace?.handoffManifest ?? null,
        compatibilityReport: next.compatibilityReport.entries.length > 0 ? next.compatibilityReport : (selectedWorkspace?.compatibilityReport ?? next.compatibilityReport),
        sanitizationReport: next.sanitizationReport ?? selectedWorkspace?.sanitizationReport,
      }
      const builtSession = merged.exportSession
      if (builtSession?.id) {
        setHandoffs((current) => current.map((item) => item.exportSession.id === builtSession.id
          ? { ...item, exportSession: builtSession, handoffManifest: merged.handoffManifest ?? item.handoffManifest }
          : item))
      }
      setSelectedWorkspace(merged)
      onToast(locale === 'vi' ? 'Đã build và verify timeline interchange trong kho nội dung cục bộ.' : 'Built and verified the timeline interchange in the local content store.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
      if (session.id && client.getHandoff) {
        try { setSelectedWorkspace(await client.getHandoff(projectId, session.id)) } catch { /* preserve the primary error */ }
      }
    } finally {
      if (buildProjectEpoch === projectEpochRef.current) setMutating(false)
    }
  }
  const download = () => {
    if (!session || !manifest) return
    setActionError(null)
    try {
      if (!downloadHandoffEvidence(session, manifest, compatibility, sanitization)) {
        setActionError(locale === 'vi' ? 'Trình duyệt hiện tại không hỗ trợ tải manifest an toàn.' : 'This browser cannot create a safe manifest download.')
        return
      }
      onToast(locale === 'vi' ? 'Đã tải bản sao manifest metadata đã redacted.' : 'Downloaded the redacted metadata manifest copy.')
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : (locale === 'vi' ? 'Không thể tạo file manifest.' : 'Could not create the manifest file.'))
    }
  }
  const downloadInterchange = async () => {
    if (!client.resolveTimelineInterchangeDownload || !projectId || !session?.id || session.state !== 'COMPLETED' || !session.outputAssetRevisionId) return
    setDownloadLoading(true); setActionError(null); setNeedsUser(false)
    try {
      const capability = await client.resolveTimelineInterchangeDownload(projectId, session.id)
      if (!capability.downloadUrl) throw new Error(locale === 'vi' ? 'Core không trả về capability tải xuống hợp lệ.' : 'Core did not return a valid download capability.')
      const anchor = document.createElement('a')
      anchor.href = capability.downloadUrl
      anchor.download = `cineforge-timeline-interchange-${session.id.slice(0, 12)}.json`
      anchor.rel = 'noopener'
      anchor.click()
      onToast(locale === 'vi' ? 'Đã bắt đầu tải file timeline interchange đã verify.' : 'Started downloading the verified timeline interchange.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      setDownloadLoading(false)
    }
  }
  useEffect(() => {
    if (!session?.id || session.state !== 'COMPLETED') {
      setSelectedReturnedRevisionId('')
      return
    }
    setSelectedReturnedRevisionId((current) => {
      if (current && returnedInterchangeAssets.some((asset) => asset.revisionId === current)) return current
      // Do not silently choose the first returned asset. Registration is a
      // mutating, auditable action and the user must select the exact managed
      // revision that came back from the editor.
      return ''
    })
  }, [returnedInterchangeAssets, session?.id, session?.outputAssetRevisionId, session?.state])

  const registerExternalEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!client.registerExternalEdit || !canRegisterExternalEdit || !projectId || !session?.id || !manifest?.id || !selectedReturnedRevisionId) return
    const projectEpoch = projectEpochRef.current
    setExternalEditMutating(true); setActionError(null); setNeedsUser(false)
    // A failed validation may be repaired by granting rights or importing a
    // corrected asset. Keep each submit idempotent while in flight, but use a
    // fresh key for the next attempt so Core does not replay the old failure.
    const attemptToken = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const idempotencyKey = `external-edit-register:${attemptToken}`
    try {
      const next = await client.registerExternalEdit(projectId, {
        handoffManifestId: manifest.id,
        exportSessionId: session.id,
        returnedAssetRevisionId: selectedReturnedRevisionId,
        expectedVersion: session.rowVersion,
        lineageConfidence,
      }, idempotencyKey)
      if (projectEpoch !== projectEpochRef.current || projectIdRef.current !== projectId) return
      setExternalEdits((current) => [next, ...current.filter((item) => item.id !== next.id)])
      onToast(locale === 'vi' ? 'Đã đăng ký interchange trả về. Timeline canonical vẫn không thay đổi.' : 'Registered the returned interchange. The canonical timeline was not changed.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      if (projectEpoch === projectEpochRef.current) setExternalEditMutating(false)
    }
  }

  const externalEditConfidenceLabel = (value: ExternalEditLineageConfidence) => {
    const labels: Record<ExternalEditLineageConfidence, [string, string]> = {
      EXACT: ['Exact bytes', 'Exact bytes'], PARTIAL: ['Có thể chỉnh sửa một phần', 'Partial edit'], FLATTENED: ['Đã flatten', 'Flattened'], UNKNOWN: ['Chưa biết', 'Unknown'],
    }
    return labels[value]?.[locale === 'vi' ? 0 : 1] ?? value
  }
  const externalEditStateLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      REGISTERED: ['Đã đăng ký', 'Registered'], RECEIVED: ['Đã nhận', 'Received'], VALIDATING: ['Đang kiểm tra', 'Validating'], BLOCKED_SCHEMA: ['Bị chặn schema', 'Schema blocked'], BLOCKED_SCOPE: ['Bị chặn phạm vi', 'Scope blocked'], BLOCKED_MEDIA: ['Bị chặn media', 'Media blocked'], BLOCKED_RIGHTS: ['Bị chặn quyền', 'Rights blocked'], FAILED: ['Thất bại', 'Failed'],
    }
    const normalized = String(value ?? 'UNKNOWN').toUpperCase()
    return labels[normalized]?.[locale === 'vi' ? 0 : 1] ?? normalized
  }
  const externalEditDiffValue = (value: Record<string, unknown> | undefined) => {
    if (!value || Object.keys(value).length === 0) return '—'
    return Object.entries(value).slice(0, 3).map(([key, item]) => `${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`).join(' · ')
  }
  return <div className="page handoff-page">
    <div className="page-heading"><div><p className="eyebrow">TIMELINE HANDOFF</p><h1>{locale === 'vi' ? 'Bàn giao timeline' : 'Timeline handoff'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Tạo manifest metadata bất biến từ timeline đã approve. Không render, transcode hoặc ghi file đích trong bước này.' : 'Create an immutable metadata manifest from an approved timeline. This step does not render, transcode or write to a destination.'}</p></div><div className="page-heading-actions"><button className="subtle-button tiny" onClick={() => void loadProject()} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} />{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button><span className="count-chip"><PackageOpen size={15} />{handoffs.length}</span></div></div>
    <div className="timeline-toolbar"><label>{locale === 'vi' ? 'Project' : 'Project'}<select className="timeline-project-select" value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={locale === 'vi' ? 'Project bàn giao' : 'Handoff project'}><option value="">{locale === 'vi' ? 'Chọn project' : 'Choose a project'}</option>{snapshot.projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>{project && <span className={`state-label ${connected ? '' : 'warning-text'}`}><ShieldCheck size={13} />{connected ? (locale === 'vi' ? 'Core đã kết nối' : 'Core connected') : (locale === 'vi' ? 'Core offline' : 'Core offline')}</span>}</div>
    {!connected && <div className="inline-state warning"><CloudOff size={14} /><span>{locale === 'vi' ? 'Core đang offline. Handoff là dữ liệu canonical nên thao tác ghi bị khoá.' : 'Core is offline. Handoff is canonical data, so mutations are disabled.'}</span></div>}
    {error && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{error}</span><button className="subtle-button tiny" onClick={() => void loadProject()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}
    {actionError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{actionError}</span>{needsUser && <small>{locale === 'vi' ? 'Core cần bạn xử lý điều kiện hoặc xung đột rồi thử lại.' : 'Core needs you to resolve the condition or conflict before retrying.'}</small>}</div>}
    {!project ? <EmptyState icon={PackageOpen} title={locale === 'vi' ? 'Chưa có project' : 'No project selected'} detail={locale === 'vi' ? 'Tạo project trước khi bàn giao timeline.' : 'Create a project before handing off a timeline.'} /> : loading ? <LoadingState label={locale === 'vi' ? 'Đang đọc handoff từ Core…' : 'Reading handoffs from Core…'} /> : <div className="handoff-grid">
      <section className="workspace-panel handoff-list-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><PackageOpen size={16} /></span><div><h2>{locale === 'vi' ? 'Manifest đã tạo' : 'Created manifests'}</h2><p>{locale === 'vi' ? 'Mỗi manifest pin exact revision và bằng chứng review.' : 'Each manifest pins an exact revision and review evidence.'}</p></div></div><span className="count-chip">{handoffs.length}</span></div>{handoffs.length === 0 ? <EmptyState icon={PackageOpen} title={locale === 'vi' ? 'Chưa có manifest' : 'No manifests yet'} detail={locale === 'vi' ? 'Chọn timeline đã approve ở bên phải để tạo manifest.' : 'Choose an approved timeline on the right to create a manifest.'} /> : <div className="workspace-record-list">{handoffs.map((item) => <button type="button" className={`timeline-row ${item.exportSession.id === selectedHandoffId ? 'active' : ''}`} key={item.exportSession.id} onClick={() => setSelectedHandoffId(item.exportSession.id ?? null)}><span className="timeline-row-icon"><PackageOpen size={15} /></span><span className="workspace-record-main"><strong>{item.handoffManifest.targetEditor ?? item.exportSession.targetEditor ?? 'UNKNOWN_EDITOR'}</strong><small>{item.handoffManifest.manifestHash?.slice(0, 16) ?? '—'} · {item.exportSession.timelineRevisionId ?? '—'}</small></span><span className="record-code">{item.exportSession.state}</span><ArrowRight size={14} /></button>)}</div>}
        <div className="handoff-create-panel"><div className="card-heading"><div><h3>{locale === 'vi' ? 'Tạo handoff mới' : 'Create a handoff'}</h3><p>{locale === 'vi' ? 'Chỉ khả dụng khi evidence hiện tại đã approve.' : 'Available only when current evidence is approved.'}</p></div></div><form className="workspace-form" onSubmit={create}><label>{locale === 'vi' ? 'Timeline' : 'Timeline'}<select value={timelineId ?? ''} onChange={(event) => setTimelineId(event.target.value || null)} disabled={mutating}><option value="">{locale === 'vi' ? 'Chọn timeline' : 'Choose timeline'}</option>{timelines.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>{approvedRevision ? <div className="handoff-evidence"><span><strong>{locale === 'vi' ? 'Revision đã approve' : 'Approved revision'}</strong><code>{approvedRevision.id}</code></span><span><strong>{locale === 'vi' ? 'Review APPROVE' : 'APPROVE review'}</strong><code>{approvalReview?.id ?? (locale === 'vi' ? 'Thiếu' : 'Missing')}</code></span><span><strong>Dependency snapshot</strong><code>{dependencySnapshotHash || 'MISSING'}</code></span></div> : <div className="inline-state warning"><Info size={14} />{locale === 'vi' ? 'Timeline này chưa có revision APPROVED.' : 'This timeline has no APPROVED revision.'}</div>}<div className="form-grid two"><label>{locale === 'vi' ? 'Editor đích' : 'Target editor'}<input value={targetEditor} onChange={(event) => setTargetEditor(event.target.value)} placeholder="GENERIC" disabled={mutating} /></label><label>{locale === 'vi' ? 'Phiên bản' : 'Version'}<input value={targetVersion} onChange={(event) => setTargetVersion(event.target.value)} placeholder="1" disabled={mutating} /></label></div>{createControlReady ? <button className="primary-button small" type="submit" disabled={!canCreate}>{mutating ? <RefreshCw size={14} className="spin" /> : <PackageOpen size={14} />}{locale === 'vi' ? 'Tạo manifest' : 'Create manifest'}</button> : <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Đang đọc exact revision và review từ Core…' : 'Reading exact revision and review evidence from Core…'}</p>}</form></div>
      </section>
      <section className="workspace-panel handoff-detail-card">{detailLoading ? <LoadingState label={locale === 'vi' ? 'Đang đọc manifest…' : 'Reading manifest…'} /> : !session ? <EmptyState icon={Info} title={locale === 'vi' ? 'Chọn một manifest' : 'Select a manifest'} detail={locale === 'vi' ? 'Chi tiết chain-of-custody và compatibility sẽ hiển thị ở đây.' : 'Chain-of-custody and compatibility details will appear here.'} /> : <>
         <div className="card-heading"><div className="card-title-with-icon"><span className="card-icon green"><ShieldCheck size={16} /></span><div><h2>{locale === 'vi' ? 'Handoff workspace' : 'Handoff workspace'}</h2><p>{session.timelineRevisionId ?? '—'} · v{session.rowVersion}</p></div></div><div className="handoff-detail-actions"><button type="button" className="subtle-button tiny" onClick={download} disabled={!manifest?.manifestHash || detailLoading}><Download size={13} />{locale === 'vi' ? 'Tải manifest JSON' : 'Download manifest JSON'}</button>{client.buildTimelineInterchangeExport && <button type="button" className="primary-button small" onClick={() => void build()} disabled={!canBuild}>{mutating ? <RefreshCw size={13} className="spin" /> : <Zap size={13} />}{locale === 'vi' ? 'Tạo interchange đã verify' : 'Build verified interchange'}</button>}{client.resolveTimelineInterchangeDownload && <button type="button" className="subtle-button tiny" onClick={() => void downloadInterchange()} disabled={downloadLoading || session.state !== 'COMPLETED' || !session.outputAssetRevisionId}><Download size={13} />{downloadLoading ? (locale === 'vi' ? 'Đang chuẩn bị…' : 'Preparing…') : (locale === 'vi' ? 'Tải interchange đã verify' : 'Download verified interchange')}</button>}<span className="state-label">{session.state}</span></div></div>
        <div className="timeline-metrics"><div><span>{locale === 'vi' ? 'Editor' : 'Editor'}</span><strong>{session.targetEditor ?? manifest?.targetEditor ?? 'UNKNOWN'}</strong></div><div><span>{locale === 'vi' ? 'Phiên bản' : 'Version'}</span><strong>{session.targetVersion ?? manifest?.targetVersion ?? 'UNKNOWN'}</strong></div><div><span>Manifest SHA-256</span><strong title={selectedWorkspace?.manifestHash ?? manifest?.manifestHash}>{(selectedWorkspace?.manifestHash ?? manifest?.manifestHash)?.slice(0, 16) ?? '—'}</strong></div><div><span>{locale === 'vi' ? 'Allowlist' : 'Allowlist'}</span><strong>{manifest?.artifactAllowlist.length ?? 0}</strong></div></div>
         <p className="readonly-note"><Info size={14} />{sessionNextStep}</p>
         {session.state === 'COMPLETED' && session.outputContentHash && <div className="handoff-evidence"><span><strong>{locale === 'vi' ? 'Interchange SHA-256' : 'Interchange SHA-256'}</strong><code>{session.outputContentHash}</code></span><span><strong>{locale === 'vi' ? 'Kích thước' : 'Byte size'}</strong><code>{session.outputByteSize ?? 0} bytes</code></span><span><strong>{locale === 'vi' ? 'Asset revision' : 'Asset revision'}</strong><code>{session.outputAssetRevisionId ?? '—'}</code></span></div>}
        {(client.getExternalEdits || client.registerExternalEdit) && <div className="handoff-section external-edit-section"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon amber"><ArrowRight size={16} /></span><div><h3>{locale === 'vi' ? 'Interchange trả về' : 'Returned interchange'}</h3><p>{locale === 'vi' ? 'Đăng ký lineage của file đã trả về sau khi Core kiểm tra exact handoff, asset managed, hash và rights.' : 'Register returned-file lineage after Core checks the exact handoff, managed asset, hash and rights.'}</p></div></div><span className="count-chip">{selectedExternalEdits.length}</span></div>
          {externalEditLoading ? <LoadingState label={locale === 'vi' ? 'Đang đọc interchange trả về…' : 'Reading returned interchanges…'} /> : selectedExternalEdits.length === 0 ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Chưa có interchange trả về nào được đăng ký cho handoff này.' : 'No returned interchange has been registered for this handoff yet.'} /> : <div className="external-edit-list">{selectedExternalEdits.map((item) => <div className="external-edit-card" key={item.id ?? `${item.exportSessionId}:${item.returnedAssetRevisionId}`}><div className="external-edit-card-heading"><strong>{externalEditStateLabel(item.validationState)}</strong><span className={`record-code ${item.validationState === 'REGISTERED' ? 'success' : 'warning'}`}>{externalEditConfidenceLabel(item.lineageConfidence)}</span></div><div className="external-edit-facts"><span>{locale === 'vi' ? 'Asset trả về' : 'Returned asset'}: <code>{item.returnedAssetRevisionId ?? '—'}</code></span><span>{locale === 'vi' ? 'Rights' : 'Rights'}: <strong>{item.returnedRightsStatus}</strong></span><span>{locale === 'vi' ? 'Hash' : 'Hash'}: <code>{item.sourceDocumentHash?.slice(0, 16) ?? '—'}</code></span><span>{locale === 'vi' ? 'Diff' : 'Diffs'}: <strong>{item.contractDiffCount}</strong></span></div>{item.contractDiffs.length > 0 && <div className="external-edit-diffs">{item.contractDiffs.slice(0, 4).map((diff, index) => <div key={diff.id ?? `${diff.diffType}-${index}`}><span>{diff.diffType ?? 'OTHER'} · {diff.severity ?? 'INFO'}</span><small>{externalEditDiffValue(diff.before)} → {externalEditDiffValue(diff.after)}</small></div>)}</div>}<p className="staging-next-step">{item.nextStep ?? (locale === 'vi' ? 'Không có bước tiếp theo.' : 'No next step recorded.')}</p></div>)}</div>}
          {session.state !== 'COMPLETED' ? <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Chỉ có thể đăng ký sau khi export session COMPLETED và output evidence đã được Core verify.' : 'Registration is available only after the export session is COMPLETED and output evidence is verified by Core.'}</p> : !client.registerExternalEdit ? <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Bridge hiện tại chỉ hỗ trợ xem lineage; chưa có command đăng ký.' : 'This bridge can only show lineage; registration is not exposed.'}</p> : <form className="workspace-form external-edit-form" onSubmit={registerExternalEdit}><div className="form-grid two"><label>{locale === 'vi' ? 'Asset interchange trả về' : 'Returned interchange asset'}<select aria-label={locale === 'vi' ? 'Asset interchange trả về' : 'Returned interchange asset'} value={selectedReturnedRevisionId} onChange={(event) => setSelectedReturnedRevisionId(event.target.value)} disabled={externalEditMutating || returnedInterchangeAssets.length === 0}><option value="">{returnedInterchangeAssets.length === 0 ? (locale === 'vi' ? 'Chưa có asset managed khả dụng' : 'No available managed asset') : (locale === 'vi' ? 'Chọn asset đã import' : 'Choose an imported asset')}</option>{returnedInterchangeAssets.map((asset) => <option key={asset.revisionId} value={asset.revisionId}>{asset.name} · {asset.revisionId} · {formatBytes(asset.byteSize)}{asset.contentHash ? ` · ${asset.contentHash.slice(0, 12)}` : ''}</option>)}</select></label><label>{locale === 'vi' ? 'Độ tin cậy lineage' : 'Lineage confidence'}<select value={lineageConfidence} onChange={(event) => setLineageConfidence(event.target.value as ExternalEditLineageConfidence)} disabled={externalEditMutating}><option value="PARTIAL">{externalEditConfidenceLabel('PARTIAL')}</option><option value="FLATTENED">{externalEditConfidenceLabel('FLATTENED')}</option><option value="UNKNOWN">{externalEditConfidenceLabel('UNKNOWN')}</option><option value="EXACT">{externalEditConfidenceLabel('EXACT')}</option></select></label></div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'EXACT chỉ hợp lệ khi bytes returned khớp exact output; Core sẽ từ chối khai báo sai. Đăng ký không apply edit, không approve và không publish.' : 'EXACT is valid only when returned bytes match the exact output; Core rejects false claims. Registration does not apply edits, approve, or publish.'}</p><button className="primary-button small" type="submit" disabled={!canRegisterExternalEdit}>{externalEditMutating ? <RefreshCw size={13} className="spin" /> : <ArrowRight size={13} />}{locale === 'vi' ? 'Đăng ký interchange trả về' : 'Register returned interchange'}</button></form>}
        </div>}
        {compatibility && <div className="handoff-section"><div className="card-heading"><div><h3>{locale === 'vi' ? 'Tương thích đích' : 'Target compatibility'}</h3><p>{compatibility.profileVersion ?? '—'} · {compatibility.editableClaim ? (locale === 'vi' ? 'Có thể chỉnh sửa theo claim' : 'Editable claim') : (locale === 'vi' ? 'Không claim editable' : 'No editable claim')}</p></div></div><div className="compatibility-list">{compatibility.entries.map((entry) => <div className="compatibility-row" key={`${entry.feature}:${entry.status}`}><span>{entry.feature}</span><span className={`compatibility-status ${entry.status.toLowerCase()}`}>{entry.status}</span><small>{entry.detail}</small></div>)}</div></div>}
        {manifest && <div className="handoff-section"><div className="card-heading"><div><h3>{locale === 'vi' ? 'Artifact allowlist' : 'Artifact allowlist'}</h3><p>{locale === 'vi' ? 'Chỉ revision/hash/size và trạng thái readiness được phép đi qua.' : 'Only revision/hash/size and readiness state cross the boundary.'}</p></div></div>{manifest.artifactAllowlist.length === 0 ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Không có media artifact được pin.' : 'No media artifacts are pinned.'} /> : <div className="artifact-list">{manifest.artifactAllowlist.map((artifact) => <div className="artifact-row" key={`${artifact.assetRevisionId}:${artifact.contentHash}`}><span><strong>{artifact.assetRevisionId ?? artifact.assetId ?? '—'}</strong><small>{artifact.semanticRole ?? '—'} · {artifact.byteSize} bytes · {artifact.availabilityState ?? 'UNKNOWN'}</small></span><code>{artifact.contentHash ?? 'NO_HASH'}</code></div>)}</div>}</div>}
        {sanitization && <div className="handoff-section"><div className="card-heading"><div><h3>{locale === 'vi' ? 'Sanitization report' : 'Sanitization report'}</h3><p>{sanitization.policy ?? 'HANDOFF_SANITIZATION_V1'}</p></div><span className="state-label">{sanitization.recorded ? 'RECORDED' : 'UNKNOWN'}</span></div><div className="sanitization-list">{sanitization.removedFields.map((field) => <code key={field}>{field}</code>)}</div></div>}
      </>}</section>
    </div>}
  </div>
}

const STAGING_RECONCILABLE_STATES = new Set(['WRITING', 'COMPLETE', 'VERIFIED'])

function formatStagingState(value: string | undefined, locale: Locale) {
  const state = String(value ?? 'UNKNOWN').toUpperCase()
  const labels: Record<string, { vi: string; en: string }> = {
    UNKNOWN: { vi: 'Chưa xác định', en: 'Unknown' },
    WRITING: { vi: 'Đang ghi', en: 'Writing' },
    COMPLETE: { vi: 'Đã ghi xong', en: 'Complete' },
    VERIFIED: { vi: 'Đã kiểm tra', en: 'Verified' },
    ORPHANED: { vi: 'Mồ côi', en: 'Orphaned' },
    QUARANTINED: { vi: 'Đã cách ly', en: 'Quarantined' },
    FAILED: { vi: 'Thất bại', en: 'Failed' },
    REGISTERED: { vi: 'Đã đăng ký', en: 'Registered' },
  }
  return labels[state]?.[locale === 'vi' ? 'vi' : 'en'] ?? state
}

function stagingNextStep(stateValue: string | undefined, locale: Locale) {
  const state = String(stateValue ?? 'UNKNOWN').toUpperCase()
  const steps: Record<string, { vi: string; en: string }> = {
    UNKNOWN: { vi: 'Core chưa xác nhận lifecycle; tải lại và không tự nhận bytes.', en: 'Core has not confirmed the lifecycle; refresh and do not adopt bytes automatically.' },
    WRITING: { vi: 'Reconcile để Core kiểm tra file tạm và identity.', en: 'Reconcile so Core can check the temporary file and identity.' },
    COMPLETE: { vi: 'Reconcile để Core xác minh hash trước bước tiếp theo.', en: 'Reconcile so Core can verify the hash before the next step.' },
    VERIFIED: { vi: 'Core đã có bằng chứng hash; không đồng nghĩa asset đã READY.', en: 'Core has hash evidence; this does not mean the asset is READY.' },
    ORPHANED: { vi: 'File tạm không còn hoặc không an toàn; chọn lại import từ file gốc.', en: 'The temporary file is missing or unsafe; start a new import from the original.' },
    QUARANTINED: { vi: 'Bằng chứng không khớp; xem lỗi và xử lý file gốc trước khi import lại.', en: 'Evidence did not match; inspect the error and handle the original before importing again.' },
    FAILED: { vi: 'Core không thể hoàn tất staging; kiểm tra lỗi rồi thử một import mới.', en: 'Core could not complete staging; inspect the error and start a new import.' },
    REGISTERED: { vi: 'Staging đã gắn với asset; chuyển sang kiểm tra readiness ở Thư viện.', en: 'Staging is registered to an asset; check readiness in the Library.' },
  }
  return steps[state]?.[locale === 'vi' ? 'vi' : 'en'] ?? steps.UNKNOWN[locale === 'vi' ? 'vi' : 'en']
}

function stagingEvidenceLabel(value: string | undefined, locale: Locale) {
  if (!value) return '—'
  const normalized = value.toUpperCase()
  if (normalized === 'PRESENT') return locale === 'vi' ? 'Có bằng chứng' : 'Present'
  if (normalized === 'ABSENT') return locale === 'vi' ? 'Không có' : 'Absent'
  if (normalized === 'UNKNOWN') return locale === 'vi' ? 'Chưa biết' : 'Unknown'
  return normalized
}

function formatStagingHash(value: string | undefined) {
  if (!value) return '—'
  return value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value
}

function StagingEvidenceRow({ item, locale, connected, mutating, onReconcile }: { item: StagingEvidence; locale: Locale; connected: boolean; mutating: string | null; onReconcile: (item: StagingEvidence) => void }) {
  const state = String(item.state || 'UNKNOWN').toUpperCase()
  const canReconcile = Boolean(connected && item.id && STAGING_RECONCILABLE_STATES.has(state) && !mutating)
  return <div className="staging-evidence-row">
    <div className="staging-evidence-main">
      <div className="staging-evidence-heading"><strong>{item.tempName ?? item.id ?? (locale === 'vi' ? 'Staging không tên' : 'Unnamed staging')}</strong><span className={`record-code ${state === 'VERIFIED' ? 'success' : state === 'REGISTERED' ? 'success' : state === 'UNKNOWN' ? 'warning' : 'warning'}`}>{formatStagingState(state, locale)}</span></div>
      <small>{item.id ?? '—'} · v{item.rowVersion}</small>
      <div className="staging-evidence-facts"><span>{locale === 'vi' ? 'Kích thước' : 'Size'}: {item.currentSize === undefined ? '—' : formatBytes(item.currentSize)} / {item.expectedSize === undefined ? '—' : formatBytes(item.expectedSize)}</span><span>{item.hashAlgorithm ?? 'SHA-256'}: {formatStagingHash(item.sha256)}</span><span>{locale === 'vi' ? 'Reparse' : 'Reparse'}: {stagingEvidenceLabel(item.reparseState, locale)}</span></div>
      <div className="staging-evidence-facts"><span>{locale === 'vi' ? 'Identity nguồn' : 'Source identity'}: {stagingEvidenceLabel(item.sourceFileIdentityState, locale)}</span><span>{locale === 'vi' ? 'Identity OS' : 'OS identity'}: {stagingEvidenceLabel(item.osFileIdentityState, locale)}</span><span>{locale === 'vi' ? 'Finalize' : 'Finalize'}: {stagingEvidenceLabel(item.finalizationIdentityState, locale)}</span></div>
      <p className="staging-next-step">{stagingNextStep(state, locale)}</p>
    </div>
    <button type="button" className="subtle-button tiny" disabled={!canReconcile} onClick={() => onReconcile(item)}>{mutating === `staging-reconcile:${item.id}` ? <RefreshCw size={12} className="spin" /> : <RefreshCw size={12} />}{locale === 'vi' ? 'Reconcile' : 'Reconcile'}</button>
  </div>
}

const RELEASE_GATE_ORDER = ['PICTURE', 'AUDIO', 'LOCALIZATION', 'TECHNICAL_MEDIA', 'QC', 'RIGHTS', 'MISSING_MEDIA', 'UNRESOLVED_DECISIONS'] as const
const RELEASE_SAFE_EVIDENCE_KEYS = new Set(['asset_revision_id', 'asset_count', 'availability_state', 'availability_evidence_state', 'review_state', 'asset_lifecycle_state', 'storage_class', 'location_state', 'rights_status', 'cue_count', 'track_count', 'review_count', 'approved_candidate_count', 'clip_count', 'media_profile_revision_id', 'timeline_id', 'timeline_revision_id', 'content_hash', 'state', 'width', 'height', 'audio_sample_rate', 'id', 'title', 'severity', 'blocking_scope_type', 'stale', 'locale', 'segment_count', 'asset_state', 'review_session_id', 'decision', 'count'])

function releaseGateLabel(key: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    PICTURE: ['Picture lock', 'Picture lock'], AUDIO: ['Âm thanh', 'Audio'], LOCALIZATION: ['Bản địa hoá', 'Localization'],
    TECHNICAL_MEDIA: ['Media kỹ thuật', 'Technical media'], QC: ['QC / review', 'QC / review'], RIGHTS: ['Quyền & consent', 'Rights & consent'],
    MISSING_MEDIA: ['Media đã materialize', 'Materialized media'], UNRESOLVED_DECISIONS: ['Quyết định đang mở', 'Open decisions'],
  }
  return labels[key]?.[locale === 'vi' ? 0 : 1] ?? key
}

function releaseStateLabel(state: ReleaseGateState | ReleaseReadiness['overallState'], locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    PASS: ['Đạt', 'Pass'], FAIL: ['Bị chặn', 'Blocked'], UNKNOWN: ['Chưa kiểm tra', 'Not checked'], NOT_APPLICABLE: ['Không áp dụng', 'Not applicable'],
    READY: ['Sẵn sàng', 'Ready'], BLOCKED: ['Bị chặn', 'Blocked'], NOT_CHECKED: ['Chưa đủ bằng chứng', 'Not checked'],
  }
  return labels[state]?.[locale === 'vi' ? 0 : 1] ?? state
}

function releaseStateClass(state: ReleaseGateState | ReleaseReadiness['overallState']): string {
  if (state === 'PASS' || state === 'READY') return 'pass'
  if (state === 'FAIL' || state === 'BLOCKED') return 'fail'
  if (state === 'NOT_APPLICABLE') return 'na'
  return 'unknown'
}

function releaseEvidenceLabel(key: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    asset_count: ['Số asset', 'Assets'], cue_count: ['Số cue', 'Cues'], track_count: ['Số track', 'Tracks'], review_count: ['Số review', 'Reviews'],
    approved_candidate_count: ['Approved candidate', 'Approved candidates'], clip_count: ['Số clip', 'Clips'], asset_revision_id: ['Asset revision', 'Asset revision'],
    timeline_id: ['Timeline', 'Timeline'], timeline_revision_id: ['Timeline revision', 'Timeline revision'], media_profile_revision_id: ['Media profile revision', 'Media profile revision'],
    content_hash: ['Content hash', 'Content hash'], rights_status: ['Rights', 'Rights'], availability_state: ['Availability', 'Availability'],
    availability_evidence_state: ['Evidence', 'Evidence'], review_state: ['Review state', 'Review state'], location_state: ['Location', 'Location'],
    storage_class: ['Storage class', 'Storage class'], state: ['State', 'State'], stale: ['Stale', 'Stale'], locale: ['Locale', 'Locale'],
    segment_count: ['Số đoạn', 'Segments'], decision: ['Decision', 'Decision'], count: ['Số lượng', 'Count'],
  }
  return labels[key]?.[locale === 'vi' ? 0 : 1] ?? key.replace(/_/g, ' ')
}

function releaseEvidenceFacts(gate: ReleaseGate, locale: Locale): Array<{ label: string; value: string }> {
  return Object.entries(gate.evidence ?? {}).filter(([key]) => RELEASE_SAFE_EVIDENCE_KEYS.has(key)).flatMap(([key, value]) => {
    if (Array.isArray(value)) return [{ label: releaseEvidenceLabel(key, locale), value: `${value.length} ${locale === 'vi' ? 'mục' : value.length === 1 ? 'item' : 'items'}` }]
    if (value && typeof value === 'object') return []
    if (value === null || value === undefined) return []
    const text = typeof value === 'string' && value.length > 24 ? `${value.slice(0, 20)}…` : String(value)
    return [{ label: releaseEvidenceLabel(key, locale), value: text }]
  }).slice(0, 8)
}

function releaseGateFor(readiness: ReleaseReadiness, key: string): ReleaseGate {
  return readiness.gates.find((gate) => gate.key === key) ?? { key, state: 'UNKNOWN', blocking: true, reason: 'GATE_EVIDENCE_MISSING', nextStep: 'Refresh Core readiness before continuing.', evidence: {} }
}

function releaseCandidateStateLabel(state: ReleaseCandidate['state'], locale: Locale): string {
  if (state === 'DRAFT') return locale === 'vi' ? 'Bản nháp' : 'Draft'
  if (state === 'CANCELLED') return locale === 'vi' ? 'Đã huỷ' : 'Cancelled'
  return locale === 'vi' ? 'Không xác định' : 'Unknown'
}

function releaseCandidateStateClass(state: ReleaseCandidate['state']): string {
  if (state === 'DRAFT') return 'unknown'
  if (state === 'CANCELLED') return 'na'
  return 'fail'
}

const RELEASE_CANDIDATE_HASH = /^[a-f0-9]{64}$/i

function safeReleaseCandidateText(value: unknown, maxLength = 512): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  let safe = value.slice(0, maxLength).replace(/(?:[A-Za-z]:[\\/]|\\\\|(?:file|https?):\/\/)[^\s"'<>]*/gi, '[redacted]')
  safe = safe.replace(/(?:^|[\s(])\/(?:[^\/\s]+\/)+[^\/\s]*/g, (match) => match.startsWith('/') ? '[redacted]' : `${match[0]}[redacted]`)
  return safe
}

function safeReleaseCandidateId(value: unknown): string | undefined {
  return safeReleaseCandidateText(value, 160)
}

function normalizeReleaseCandidate(value: unknown): ReleaseCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const rawState = typeof source.state === 'string' ? source.state.toUpperCase() : 'UNKNOWN'
  const rawVersion = Number(source.rowVersion ?? source.row_version)
  const rawSnapshotVersion = Number(source.snapshotSchemaVersion ?? source.readiness_snapshot_schema_version)
  const hash = (camel: string, snake: string) => {
    const candidate = safeReleaseCandidateText(source[camel] ?? source[snake], 64)
    return candidate && RELEASE_CANDIDATE_HASH.test(candidate) ? candidate.toLowerCase() : undefined
  }
  return {
    id: safeReleaseCandidateId(source.id ?? source.releaseCandidateId ?? source.release_candidate_id),
    projectId: safeReleaseCandidateId(source.projectId ?? source.project_id),
    timelineRevisionId: safeReleaseCandidateId(source.timelineRevisionId ?? source.timeline_revision_id),
    audioMasterAssetRevisionId: safeReleaseCandidateId(source.audioMasterAssetRevisionId ?? source.audio_master_asset_revision_id),
    mediaProfileRevisionId: safeReleaseCandidateId(source.mediaProfileRevisionId ?? source.media_profile_revision_id),
    reviewSessionId: safeReleaseCandidateId(source.reviewSessionId ?? source.review_session_id),
    readinessDigest: hash('readinessDigest', 'readiness_digest'),
    rightsSnapshotHash: hash('rightsSnapshotHash', 'rights_snapshot_hash'),
    state: rawState === 'DRAFT' || rawState === 'CANCELLED' ? rawState : 'UNKNOWN',
    nextStep: safeReleaseCandidateText(source.nextStep ?? source.next_step),
    rowVersion: Number.isSafeInteger(rawVersion) && rawVersion >= 1 ? rawVersion : 0,
    snapshotSchemaVersion: Number.isSafeInteger(rawSnapshotVersion) && rawSnapshotVersion >= 1 && rawSnapshotVersion <= 100 ? rawSnapshotVersion : 0,
    createdAt: safeReleaseCandidateText(source.createdAt ?? source.created_at, 80),
    updatedAt: safeReleaseCandidateText(source.updatedAt ?? source.updated_at, 80),
    cancelledAt: safeReleaseCandidateText(source.cancelledAt ?? source.cancelled_at, 80),
    idempotentReplay: source.idempotentReplay === true || source.idempotent_replay === true,
  }
}

function releaseCandidateFingerprint(readiness: ReleaseReadiness, projectId: string): string {
  const sourceEntries = Object.entries(readiness.exactSource ?? {})
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify([projectId, readiness.gateManifestHash ?? 'unknown', sourceEntries])
}

function releaseCandidateKey(readiness: ReleaseReadiness, projectId: string, intentNonce = 'intent'): string {
  // The Core idempotency key is bounded to 200 characters. Keep the exact
  // source material in the deterministic input, then append a compact hash so
  // two different pinned sources cannot become the same truncated prefix.
  const sourceEntries = Object.entries(readiness.exactSource ?? {})
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .sort(([left], [right]) => left.localeCompare(right))
  const source = JSON.stringify(sourceEntries)
  const material = `${projectId}|${readiness.gateManifestHash ?? 'unknown'}|${source}|${intentNonce}`
  let hashA = 2166136261
  let hashB = 2654435761
  for (let index = 0; index < material.length; index += 1) {
    const code = material.charCodeAt(index)
    hashA = Math.imul(hashA ^ code, 16777619)
    hashB = Math.imul(hashB ^ code, 2246822519)
  }
  const compactHash = `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0).toString(16).padStart(8, '0')}`
  // Header values must remain valid HTTP tokens even when an untrusted bridge
  // response supplies a malformed project id or readiness hash. The original
  // values still participate in the compact digest above, so this cannot make
  // distinct source pins collide through prefix sanitization alone.
  const safeProjectId = projectId.replace(/[^A-Za-z0-9._~-]/g, '_').slice(0, 64) || 'unknown'
  const safeManifestHash = /^[a-f0-9]{64}$/i.test(readiness.gateManifestHash ?? '') ? (readiness.gateManifestHash ?? '').toLowerCase() : 'unknown'
  const safeNonce = intentNonce.replace(/[^A-Za-z0-9._~-]/g, '_').slice(0, 32) || 'intent'
  const readable = `release-candidate-create:${safeProjectId}:${safeManifestHash}:${compactHash}:${safeNonce}`
  return readable.length <= 200 ? readable : `release-candidate-create:${compactHash}:${safeManifestHash}:${safeNonce}`
}

export function ReleaseView({ snapshot, locale, client }: { snapshot: DashboardSnapshot; locale: Locale; client: CoreClient }) {
  const [projectId, setProjectId] = useState(() => snapshot.projects[0]?.id ?? '')
  const [readiness, setReadiness] = useState<ReleaseReadiness | null>(null)
  const [candidates, setCandidates] = useState<ReleaseCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidateError, setCandidateError] = useState<string | null>(null)
  const [mutating, setMutating] = useState<string | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<ReleaseCandidate | null>(null)
  const [candidateDetailLoading, setCandidateDetailLoading] = useState(false)
  const [candidateDetailError, setCandidateDetailError] = useState<string | null>(null)
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const candidateIntentSequenceRef = useRef(0)
  const candidateIntentKeysRef = useRef(new Map<string, { key: string; projectId: string; readinessDigest: string }>())
  const project = snapshot.projects.find((candidate) => candidate.id === projectId)
  const connected = Boolean(snapshot.system.connected && !snapshot.system.offline && (client.isLive?.() ?? true))
  const supported = typeof client.getReleaseReadiness === 'function'
  const candidateListSupported = typeof client.getReleaseCandidates === 'function'
  const candidateCreateSupported = typeof client.createReleaseCandidateDraft === 'function'
  const candidateCancelSupported = typeof client.cancelReleaseCandidateDraft === 'function'

  const candidateIntent = (currentReadiness: ReleaseReadiness, currentProjectId: string) => {
    const fingerprint = releaseCandidateFingerprint(currentReadiness, currentProjectId)
    const existing = candidateIntentKeysRef.current.get(fingerprint)
    if (existing) return { fingerprint, key: existing.key }
    candidateIntentSequenceRef.current += 1
    const nonce = `${Date.now().toString(36)}-${candidateIntentSequenceRef.current.toString(36)}`
    const key = releaseCandidateKey(currentReadiness, currentProjectId, nonce)
    candidateIntentKeysRef.current.set(fingerprint, {
      key,
      projectId: currentProjectId,
      readinessDigest: currentReadiness.gateManifestHash ?? '',
    })
    return { fingerprint, key }
  }

  const clearCandidateIntents = (currentProjectId: string, readinessDigest?: string) => {
    for (const [fingerprint, value] of candidateIntentKeysRef.current) {
      if (value.projectId === currentProjectId && (!readinessDigest || value.readinessDigest === readinessDigest)) {
        candidateIntentKeysRef.current.delete(fingerprint)
      }
    }
  }

  useEffect(() => {
    if (!snapshot.projects.some((candidate) => candidate.id === projectId)) {
      generationRef.current += 1
      abortRef.current?.abort()
      setReadiness(null)
      setCandidates([])
      setSelectedCandidateId(null)
      setSelectedCandidate(null)
      setCandidateDetailError(null)
      setError(null)
      setCandidateError(null)
      setMutating(null)
      setProjectId(snapshot.projects[0]?.id ?? '')
    }
  }, [projectId, snapshot.projects])

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setReadiness(null)
    setCandidates([])
    setSelectedCandidateId(null)
    setSelectedCandidate(null)
    setCandidateDetailError(null)
    setError(null)
    setCandidateError(null)
    // A project change or manual refresh invalidates any in-flight mutation as
    // well as its read models. Otherwise a stale promise could leave the new
    // project permanently disabled after its generation has moved on.
    setMutating(null)
    setLoading(false)
    if (!projectId) return
    if (!connected) {
      setError(locale === 'vi' ? 'Core đang offline. Readiness và candidate cần dữ liệu canonical mới nhất; không dùng snapshot cũ để kết luận.' : 'Core is offline. Readiness and candidates require current canonical data; an old snapshot cannot be used as a conclusion.')
      return
    }
    if (!supported) {
      setError(locale === 'vi' ? 'Bridge hiện tại chưa hỗ trợ release readiness.' : 'This bridge does not expose release readiness yet.')
      return
    }
    setLoading(true)
    const candidateRequest = candidateListSupported
      ? client.getReleaseCandidates!(projectId, controller.signal).then((value) => ({ value, error: null as unknown })).catch((cause: unknown) => ({ value: null, error: cause }))
      : Promise.resolve({ value: null, error: null as unknown })
    try {
      const [next, candidateResult] = await Promise.all([client.getReleaseReadiness!(projectId, controller.signal), candidateRequest])
      if (generation !== generationRef.current || controller.signal.aborted) return
      if (next.projectId !== projectId) {
        setError(locale === 'vi' ? 'Core trả về readiness không thuộc project đang chọn; không thể kết luận an toàn.' : 'Core returned readiness for a different project; no safe conclusion can be shown.')
        return
      }
      setReadiness(next)
      if (candidateResult.error) setCandidateError(workspaceErrorMessage(candidateResult.error, locale))
      else if (candidateResult.value) {
        const items = candidateResult.value.items
        if (!Array.isArray(items)) {
          setCandidateError(locale === 'vi' ? 'Core trả về danh sách candidate không hợp lệ; không hiển thị dữ liệu chưa xác minh.' : 'Core returned an invalid candidate list; unverified data is hidden.')
        } else {
          const scoped = items.map(normalizeReleaseCandidate).filter((candidate): candidate is ReleaseCandidate => Boolean(candidate && candidate.projectId === projectId))
          for (const candidate of scoped) {
            if (candidate.state === 'CANCELLED' && candidate.readinessDigest) clearCandidateIntents(projectId, candidate.readinessDigest)
          }
          setCandidates(scoped)
          setSelectedCandidateId((current) => current && scoped.some((candidate) => candidate.id === current) ? current : scoped[0]?.id ?? null)
        }
      }
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return
      if (generation === generationRef.current) setError(workspaceErrorMessage(cause, locale))
    } finally {
      if (generation === generationRef.current && !controller.signal.aborted) setLoading(false)
    }
  }, [candidateListSupported, client, connected, locale, projectId, supported])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  const switchProject = (nextProjectId: string) => {
    if (nextProjectId === projectId) return
    generationRef.current += 1
    abortRef.current?.abort()
    setProjectId(nextProjectId)
    // Clear the old projection in the same event as the selection change. The
    // next effect will load the new project; until then no old readiness or
    // candidate can be mistaken for evidence belonging to it.
    setReadiness(null)
    setCandidates([])
    setSelectedCandidateId(null)
    setSelectedCandidate(null)
    setCandidateDetailError(null)
    setError(null)
    setCandidateError(null)
    setMutating(null)
    setLoading(false)
  }

  const inspectCandidate = useCallback(async (candidate: ReleaseCandidate) => {
    setSelectedCandidateId(candidate.id ?? null)
    setSelectedCandidate(candidate)
    setCandidateDetailError(null)
    if (!candidate.id || !client.getReleaseCandidate) return
    setCandidateDetailLoading(true)
    try {
      const detail = await client.getReleaseCandidate(projectId, candidate.id)
      const normalized = normalizeReleaseCandidate(detail)
      if (!normalized || normalized.projectId !== projectId || normalized.id !== candidate.id) {
        setCandidateDetailError(locale === 'vi' ? 'Core trả về candidate không đúng project; chi tiết bị ẩn.' : 'Core returned a candidate outside the selected project; details are hidden.')
        return
      }
      setSelectedCandidate(normalized)
    } catch (cause) {
      setCandidateDetailError(workspaceErrorMessage(cause, locale))
    } finally {
      setCandidateDetailLoading(false)
    }
  }, [client, locale, projectId])

  const createCandidate = useCallback(async () => {
    if (!connected || !project || !readiness || readiness.projectId !== projectId || readiness.overallState !== 'READY' || !projectId || !candidateListSupported || !candidateCreateSupported || !client.createReleaseCandidateDraft || mutating) return
    const generation = generationRef.current
    const intent = candidateIntent(readiness, projectId)
    setMutating('create')
    setCandidateError(null)
    try {
      const created = await client.createReleaseCandidateDraft(projectId, intent.key)
      if (generation === generationRef.current && created) {
        const normalized = normalizeReleaseCandidate(created)
        const valid = Boolean(normalized && normalized.projectId === projectId
          && normalized.id && normalized.state === 'DRAFT'
          && Number.isSafeInteger(normalized.rowVersion) && normalized.rowVersion >= 1)
        if (valid && normalized) setCandidates((current) => [normalized, ...current.filter((item) => item.id !== normalized.id)])
        else setCandidateError(normalized?.projectId !== projectId
          ? (locale === 'vi' ? 'Core trả về candidate không thuộc project đang chọn; candidate bị ẩn để giữ isolation.' : 'Core returned a candidate for a different project; it was hidden to preserve isolation.')
          : (locale === 'vi' ? 'Core trả về candidate thiếu identity hoặc state hợp lệ; bản ghi bị ẩn.' : 'Core returned a candidate without a valid identity or state; it was hidden.'))
      }
    } catch (cause) {
      if (generation === generationRef.current) setCandidateError(workspaceErrorMessage(cause, locale))
    } finally {
      if (generation === generationRef.current) setMutating(null)
    }
  }, [candidateCreateSupported, candidateIntent, candidateListSupported, client, connected, locale, mutating, project, projectId, readiness])

  const cancelCandidate = useCallback(async (candidate: ReleaseCandidate) => {
    if (!connected || !project || !candidateCancelSupported || !candidate.id || candidate.projectId !== projectId || candidate.state !== 'DRAFT' || !projectId || !client.cancelReleaseCandidateDraft || !Number.isSafeInteger(candidate.rowVersion) || candidate.rowVersion < 1 || mutating) return
    const confirmed = window.confirm(locale === 'vi' ? 'Huỷ release candidate bản nháp này? Thao tác sẽ được ghi audit và không thể hoàn tác.' : 'Cancel this release candidate draft? The action is audited and cannot be undone.')
    if (!confirmed) return
    const generation = generationRef.current
    setMutating(`cancel:${candidate.id}`)
    setCandidateError(null)
    try {
      const submittedVersion = candidate.rowVersion
      const cancelled = await client.cancelReleaseCandidateDraft(projectId, candidate.id, submittedVersion, `release-candidate-cancel:${candidate.id}:v${submittedVersion}`)
      if (generation === generationRef.current) {
        const normalized = normalizeReleaseCandidate(cancelled)
        if (!normalized || normalized.id !== candidate.id || normalized.projectId !== projectId || normalized.state !== 'CANCELLED' || !Number.isSafeInteger(normalized.rowVersion) || normalized.rowVersion <= submittedVersion) {
          setCandidateError(locale === 'vi' ? 'Core trả về kết quả huỷ không hợp lệ; bản ghi hiện tại được giữ nguyên.' : 'Core returned an invalid cancellation result; the current row was kept unchanged.')
        } else {
          clearCandidateIntents(projectId, candidate.readinessDigest)
          setCandidates((current) => current.map((item) => item.id === candidate.id ? normalized : item))
        }
      }
    } catch (cause) {
      if (generation === generationRef.current) setCandidateError(workspaceErrorMessage(cause, locale))
    } finally {
      if (generation === generationRef.current) setMutating(null)
    }
  }, [candidateCancelSupported, clearCandidateIntents, client, connected, locale, mutating, project, projectId])

  const overallState = readiness?.overallState ?? 'NOT_CHECKED'
  const cancelledForCurrentReadiness = Boolean(readiness?.gateManifestHash && candidates.some((candidate) => candidate.projectId === projectId && candidate.readinessDigest === readiness.gateManifestHash && candidate.state === 'CANCELLED'))
  const canCreate = Boolean(connected && project && readiness?.projectId === projectId && readiness?.overallState === 'READY' && candidateListSupported && candidateCreateSupported && !cancelledForCurrentReadiness && !mutating)
  const candidateBlocker = !connected
    ? (locale === 'vi' ? 'Core offline; candidate chỉ dùng dữ liệu canonical hiện tại.' : 'Core is offline; candidates require current canonical data.')
    : !project
      ? (locale === 'vi' ? 'Project hiện tại không còn trong workspace.' : 'The selected project is no longer in this workspace.')
      : !candidateListSupported
        ? (locale === 'vi' ? 'Bridge chưa hỗ trợ danh sách candidate.' : 'This bridge does not expose the candidate list.')
        : !candidateCreateSupported
          ? (locale === 'vi' ? 'Bridge chưa hỗ trợ tạo candidate.' : 'This bridge does not expose candidate creation.')
          : cancelledForCurrentReadiness
            ? (locale === 'vi' ? 'Exact readiness này đã có candidate bị huỷ; cần source/revision mới trước khi tạo lại.' : 'This exact readiness already has a cancelled candidate; create a new source/revision before trying again.')
            : readiness && readiness.overallState !== 'READY'
              ? (locale === 'vi' ? 'Chỉ tạo candidate khi readiness là READY. FAIL và UNKNOWN đều chặn.' : 'A candidate can be created only when readiness is READY. FAIL and UNKNOWN both block it.')
              : null
  return <div className="page release-page">
    <div className="page-heading"><div><p className="eyebrow">{locale === 'vi' ? 'SẴN SÀNG PHÁT HÀNH' : 'RELEASE READINESS'}</p><h1>{locale === 'vi' ? 'Kiểm tra readiness' : 'Release readiness'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Core kiểm tra đúng revision trước khi lưu một candidate metadata-only. Master, export và publish là boundary riêng.' : 'Core checks exact revisions before saving a metadata-only candidate. Mastering, export and publish are separate boundaries.'}</p></div><button className="subtle-button" onClick={() => void load()} disabled={loading || !projectId}><RefreshCw size={15} className={loading ? 'spin' : ''} />{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button></div>
    <div className="release-toolbar"><label>{locale === 'vi' ? 'Project' : 'Project'}<select className="release-project-select" value={projectId} onChange={(event) => switchProject(event.target.value)} aria-label={locale === 'vi' ? 'Project readiness' : 'Readiness project'}><option value="">{locale === 'vi' ? 'Chọn project' : 'Choose a project'}</option>{snapshot.projects.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>{project && <span className="state-label"><ShieldCheck size={13} />{connected ? (locale === 'vi' ? 'Core đã kết nối' : 'Core connected') : (locale === 'vi' ? 'Core offline' : 'Core offline')}</span>}</div>
    {error && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{error}</span><button type="button" className="subtle-button tiny" onClick={() => void load()} disabled={loading}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}
    {loading && <LoadingState label={locale === 'vi' ? 'Đang kiểm tra tám gate và candidate từ Core…' : 'Checking eight gates and candidates from Core…'} />}
    {!loading && !error && !readiness && !project && <EmptyState icon={ShieldCheck} title={locale === 'vi' ? 'Chưa có project' : 'No project selected'} detail={locale === 'vi' ? 'Tạo project trước khi kiểm tra readiness.' : 'Create a project before checking readiness.'} />}
    {readiness && <>
      <section className="release-overview-card"><div><p className="eyebrow">{locale === 'vi' ? 'KẾT LUẬN HIỆN TẠI' : 'CURRENT CONCLUSION'}</p><div className="release-overview-heading"><span className={`release-status ${releaseStateClass(overallState)}`}><span />{releaseStateLabel(overallState, locale)}</span><strong>{readiness.projectTitle ?? project?.name ?? projectId}</strong></div><p>{readiness.nextStep ?? (locale === 'vi' ? 'Refresh sau khi xử lý blocker.' : 'Refresh after resolving the blocker.')}</p></div><div className="release-overview-facts"><div><span>{locale === 'vi' ? 'Gate chặn' : 'Blocking gates'}</span><strong>{readiness.blockingCount}</strong></div><div><span>UNKNOWN</span><strong>{readiness.unknownCount}</strong></div><div><span>Manifest hash</span><strong title={readiness.gateManifestHash}>{readiness.gateManifestHash?.slice(0, 12) ?? '—'}</strong></div></div></section>
      <section className="release-candidates-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><PackageOpen size={16} /></span><div><h2>{locale === 'vi' ? 'Metadata release candidate' : 'Release candidate metadata'}</h2><p>{locale === 'vi' ? 'Bản nháp giữ exact refs và digest; chưa có master bytes hoặc thao tác publish.' : 'Drafts keep exact refs and digests; no master bytes or publish action exists here.'}</p></div></div><button type="button" className="primary-button small" onClick={() => void createCandidate()} disabled={!canCreate} title={candidateBlocker ?? undefined}>{mutating === 'create' ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}{locale === 'vi' ? 'Tạo candidate' : 'Create candidate'}</button></div>{candidateBlocker && <p className="readonly-note"><Info size={14} />{candidateBlocker}</p>}{!connected && <p className="readonly-note"><CloudOff size={14} />{locale === 'vi' ? 'Core offline; tạo và huỷ candidate bị khoá.' : 'Core is offline; candidate creation and cancellation are disabled.'}</p>}{!candidateListSupported && <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Bridge hiện tại chưa hỗ trợ danh sách release candidate.' : 'This bridge does not expose the release candidate list yet.'}</p>}{candidateError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{candidateError}</span><button type="button" className="subtle-button tiny" onClick={() => void load()} disabled={loading}>{locale === 'vi' ? 'Tải lại' : 'Retry'}</button></div>}{candidateListSupported && candidates.length === 0 && <div className="empty-inline"><PackageOpen size={16} /><span>{locale === 'vi' ? 'Chưa có candidate metadata.' : 'No release candidate metadata yet.'}</span></div>}{candidateListSupported && candidates.length > 0 && <div className="release-candidate-list">{candidates.map((candidate) => <article className={`release-candidate-row ${selectedCandidateId === candidate.id ? 'active' : ''}`} key={candidate.id ?? `${candidate.timelineRevisionId}-${candidate.readinessDigest}`}><div className="release-candidate-main"><div className="release-candidate-heading"><strong>{candidate.id ?? (locale === 'vi' ? 'Candidate không tên' : 'Unnamed candidate')}</strong><span className={`release-status ${releaseCandidateStateClass(candidate.state)}`}><span />{releaseCandidateStateLabel(candidate.state, locale)}</span></div><small>{locale === 'vi' ? 'Timeline revision' : 'Timeline revision'}: {candidate.timelineRevisionId ?? '—'} · v{candidate.rowVersion}</small><div className="release-candidate-facts"><span>{locale === 'vi' ? 'Media profile' : 'Media profile'}: {candidate.mediaProfileRevisionId ?? '—'}</span><span>{locale === 'vi' ? 'QC review' : 'QC review'}: {candidate.reviewSessionId ?? '—'}</span><span>{locale === 'vi' ? 'Readiness digest' : 'Readiness digest'}: {candidate.readinessDigest?.slice(0, 12) ?? '—'}</span><span>{locale === 'vi' ? 'Rights hash' : 'Rights hash'}: {candidate.rightsSnapshotHash?.slice(0, 12) ?? '—'}</span></div><p className="release-next-step">{candidate.nextStep ?? (locale === 'vi' ? 'Metadata-only; chưa có master.' : 'Metadata-only; no master exists.')}</p></div><div className="release-candidate-actions">{client.getReleaseCandidate && candidate.id && <button type="button" className="subtle-button tiny" onClick={() => void inspectCandidate(candidate)} disabled={candidateDetailLoading && selectedCandidateId === candidate.id}>{candidateDetailLoading && selectedCandidateId === candidate.id ? <RefreshCw size={12} className="spin" /> : <Info size={12} />}{locale === 'vi' ? 'Chi tiết' : 'Details'}</button>}{candidate.state === 'DRAFT' && candidate.id && candidate.projectId === projectId && Number.isSafeInteger(candidate.rowVersion) && candidate.rowVersion >= 1 && <button type="button" className="subtle-button tiny" onClick={() => void cancelCandidate(candidate)} disabled={!connected || !candidateCancelSupported || mutating !== null}>{mutating === `cancel:${candidate.id}` ? <RefreshCw size={12} className="spin" /> : <XCircle size={12} />}{locale === 'vi' ? 'Huỷ draft' : 'Cancel draft'}</button>}</div></article>)}</div>}{client.getReleaseCandidate && selectedCandidateId && <section className="release-candidate-detail" aria-live="polite">{candidateDetailLoading ? <LoadingState label={locale === 'vi' ? 'Đang đọc chi tiết candidate…' : 'Reading candidate details…'} /> : candidateDetailError ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{candidateDetailError}</span><button type="button" className="subtle-button tiny" onClick={() => { const current = candidates.find((candidate) => candidate.id === selectedCandidateId); if (current) void inspectCandidate(current) }}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div> : selectedCandidate ? <><div className="card-heading"><div><strong>{locale === 'vi' ? 'Chi tiết release candidate' : 'Release candidate details'}</strong><small>{selectedCandidate.id} · row v{selectedCandidate.rowVersion}</small></div><span className={`release-status ${releaseCandidateStateClass(selectedCandidate.state)}`}><span />{releaseCandidateStateLabel(selectedCandidate.state, locale)}</span></div><div className="release-candidate-facts release-candidate-detail-facts"><span><small>Timeline revision</small><strong>{selectedCandidate.timelineRevisionId ?? '—'}</strong></span><span><small>Media profile</small><strong>{selectedCandidate.mediaProfileRevisionId ?? '—'}</strong></span><span><small>Review session</small><strong>{selectedCandidate.reviewSessionId ?? '—'}</strong></span><span><small>Readiness digest</small><strong title={selectedCandidate.readinessDigest}>{selectedCandidate.readinessDigest?.slice(0, 16) ?? '—'}</strong></span><span><small>Rights snapshot</small><strong title={selectedCandidate.rightsSnapshotHash}>{selectedCandidate.rightsSnapshotHash?.slice(0, 16) ?? '—'}</strong></span></div><p className="readonly-note"><Info size={14} />{selectedCandidate.nextStep ?? (locale === 'vi' ? 'Metadata-only; master/export/publish chưa được bật.' : 'Metadata-only; mastering/export/publish are not enabled.')}</p></> : null}</section>}<p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Candidate là metadata immutable có cancel audit. Render, export, sign và publish chưa được bật.' : 'A candidate is immutable metadata with an audited cancel transition. Render, export, signing and publish are not enabled.'}</p></section>
      <div className="release-gate-list">{RELEASE_GATE_ORDER.map((key) => { const gate = releaseGateFor(readiness, key); const facts = releaseEvidenceFacts(gate, locale); return <section className={`release-gate-card ${releaseStateClass(gate.state)}`} key={key}><div className="release-gate-heading"><div><p className="eyebrow">{key}</p><h2>{releaseGateLabel(key, locale)}</h2></div><span className={`release-status ${releaseStateClass(gate.state)}`}><span />{releaseStateLabel(gate.state, locale)}</span></div>{gate.reason && <p className="release-gate-reason">{gate.reason}</p>}{facts.length > 0 && <div className="release-evidence-facts">{facts.map((fact) => <span key={`${fact.label}-${fact.value}`}><small>{fact.label}</small><strong title={fact.value}>{fact.value}</strong></span>)}</div>}{gate.nextStep && <p className="release-next-step"><Info size={13} />{gate.nextStep}</p>}</section> })}</div>
      <section className="release-boundary-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><ShieldCheck size={16} /></span><div><h2>{locale === 'vi' ? 'Boundary tiếp theo' : 'Next boundary'}</h2><p>{locale === 'vi' ? 'Readiness và candidate không tự tạo master, export hay công bố nội dung.' : 'Readiness and candidates never create a master, export bytes or publish content.'}</p></div></div></div><div className="release-boundary-actions"><button type="button" className="subtle-button" disabled>{locale === 'vi' ? 'Export master — chưa mở' : 'Export master — unavailable'}</button><button type="button" className="subtle-button" disabled>{locale === 'vi' ? 'Publish — cần release manifest' : 'Publish — requires release manifest'}</button></div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Export và Publish là boundary riêng, cần contract và confirmation riêng.' : 'Export and Publish are separate boundaries with separate contracts and confirmation.'}</p></section>
    </>}
  </div>
}

export function SettingsView({ snapshot, locale, client, theme, onThemeChange, onLocaleChange, onRefresh, refreshLabel, onToast }: { snapshot: DashboardSnapshot; locale: Locale; client: CoreClient; theme: Theme; onThemeChange: (theme: Theme) => void; onLocaleChange: (locale: Locale) => void; onRefresh: () => void; refreshLabel: string; onToast: (message: string) => void }) {
  const connected = snapshot.system.connected && !snapshot.system.offline && (client.isLive?.() ?? true)
  const backupStateLabel = formatBackupState(snapshot.system.backupState, locale)
  const backupAtLabel = snapshot.system.backupAt ? formatRelativeSnapshot(snapshot.system.backupAt, locale) : null
  const [backups, setBackups] = useState<BackupSummary[]>([])
  const [admission, setAdmission] = useState<StorageAdmission | null>(null)
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null)
  const [selectedWorkspace, setSelectedWorkspace] = useState<BackupWorkspace | null>(null)
  const [restoreEstimate, setRestoreEstimate] = useState<BackupRestoreWorkspace | null>(null)
  const [restoreEstimateLoading, setRestoreEstimateLoading] = useState(false)
  const [restoreEstimateError, setRestoreEstimateError] = useState<string | null>(null)
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null)
  const [recoveryStatusLoading, setRecoveryStatusLoading] = useState(false)
  const [recoveryStatusError, setRecoveryStatusError] = useState<string | null>(null)
  const [scrubHealth, setScrubHealth] = useState<StorageScrubHealth | null>(null)
  const [scrubHealthLoading, setScrubHealthLoading] = useState(false)
  const [scrubHealthError, setScrubHealthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [needsUser, setNeedsUser] = useState(false)
  const [staging, setStaging] = useState<StagingWorkspace | null>(null)
  const [stagingLoading, setStagingLoading] = useState(false)
  const [stagingError, setStagingError] = useState<string | null>(null)
  const [stagingActionError, setStagingActionError] = useState<string | null>(null)
  const [stagingNeedsUser, setStagingNeedsUser] = useState(false)
  const [mutating, setMutating] = useState<string | null>(null)
  const loadGenerationRef = useRef(0)
  const detailGenerationRef = useRef(0)
  const stagingLoadGenerationRef = useRef(0)
  const supportsBackupRead = Boolean(client.getBackups && client.getStorageAdmission)
  const supportsBackupDetail = Boolean(client.getBackup)
  const supportsStaging = Boolean(client.getStaging && client.reconcileStaging)
  const supportsRecoveryStatus = Boolean(client.getRecoveryStatus)
  const supportsScrubHealth = Boolean(client.getStorageScrubHealth)

  const loadBackupList = useCallback(async (signal?: AbortSignal) => {
    const generation = ++loadGenerationRef.current
    if (!client.getBackups || !client.getStorageAdmission) {
      setBackups([])
      setAdmission(null)
      setSelectedBackupId(null)
      setSelectedWorkspace(null)
      setError(locale === 'vi' ? 'Bridge hiện tại chưa cung cấp workspace backup.' : 'This bridge does not expose the backup workspace yet.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [nextBackups, nextAdmission] = await Promise.all([client.getBackups(signal), client.getStorageAdmission(signal)])
      if (signal?.aborted || generation !== loadGenerationRef.current) return
      setBackups(nextBackups)
      setAdmission(nextAdmission)
      setSelectedBackupId((current) => current && nextBackups.some((backup) => backup.id === current) ? current : nextBackups[0]?.id ?? null)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (generation !== loadGenerationRef.current) return
      setError(workspaceErrorMessage(cause, locale))
      setBackups([])
      setAdmission(null)
      setSelectedBackupId(null)
      setSelectedWorkspace(null)
    } finally {
      if (!signal?.aborted && generation === loadGenerationRef.current) setLoading(false)
    }
  }, [client, locale])

  const loadBackupDetail = useCallback(async (backupId: string, signal?: AbortSignal) => {
    const generation = ++detailGenerationRef.current
    if (!client.getBackup) {
      setSelectedWorkspace(null)
      setDetailLoading(false)
      return
    }
    setDetailLoading(true)
    try {
      const next = await client.getBackup(backupId, signal)
      if (!signal?.aborted && generation === detailGenerationRef.current) setSelectedWorkspace(next)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (!signal?.aborted && generation === detailGenerationRef.current) setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      if (!signal?.aborted && generation === detailGenerationRef.current) setDetailLoading(false)
    }
  }, [client, locale])

  const loadStaging = useCallback(async (signal?: AbortSignal) => {
    const generation = ++stagingLoadGenerationRef.current
    // A refresh starts a new evidence generation. Keep no stale rows visible
    // while Core is answering; a failed reconcile itself never calls this path
    // and therefore preserves the last known evidence for the user.
    setStaging(null)
    setStagingError(null)
    if (!client.getStaging) {
      setStaging(null)
      setStagingError(locale === 'vi' ? 'Bridge hiện tại chưa cung cấp evidence staging.' : 'This bridge does not expose staging evidence yet.')
      setStagingLoading(false)
      return
    }
    setStagingLoading(true)
    try {
      const next = await client.getStaging(undefined, 100, signal)
      if (signal?.aborted || generation !== stagingLoadGenerationRef.current) return
      setStaging(next)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (generation !== stagingLoadGenerationRef.current) return
      setStaging(null)
      setStagingError(workspaceErrorMessage(cause, locale))
    } finally {
      if (!signal?.aborted && generation === stagingLoadGenerationRef.current) setStagingLoading(false)
    }
  }, [client, locale])

  const loadRecoveryStatus = useCallback(async (signal?: AbortSignal) => {
    if (!client.getRecoveryStatus) {
      setRecoveryStatus(null)
      setRecoveryStatusError(locale === 'vi' ? 'Bridge hiện tại chưa cung cấp trạng thái phục hồi.' : 'This bridge does not expose recovery status yet.')
      setRecoveryStatusLoading(false)
      return
    }
    setRecoveryStatusLoading(true)
    setRecoveryStatusError(null)
    try {
      const next = await client.getRecoveryStatus(signal)
      if (!signal?.aborted) setRecoveryStatus(next)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (!signal?.aborted) {
        setRecoveryStatus(null)
        setRecoveryStatusError(workspaceErrorMessage(cause, locale))
      }
    } finally {
      if (!signal?.aborted) setRecoveryStatusLoading(false)
    }
  }, [client, locale])

  const loadScrubHealth = useCallback(async (signal?: AbortSignal) => {
    if (!client.getStorageScrubHealth) {
      setScrubHealth(null)
      setScrubHealthError(locale === 'vi' ? 'Bridge hiện tại chưa cung cấp kiểm tra integrity của managed object.' : 'This bridge does not expose managed-object integrity evidence yet.')
      setScrubHealthLoading(false)
      return
    }
    setScrubHealthLoading(true)
    setScrubHealthError(null)
    try {
      const next = await client.getStorageScrubHealth({ limit: 100 }, signal)
      if (!signal?.aborted) setScrubHealth(next)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (!signal?.aborted) {
        setScrubHealth(null)
        setScrubHealthError(workspaceErrorMessage(cause, locale))
      }
    } finally {
      if (!signal?.aborted) setScrubHealthLoading(false)
    }
  }, [client, locale])

  useEffect(() => {
    const controller = new AbortController()
    void loadBackupList(controller.signal)
    return () => controller.abort()
  }, [loadBackupList])

  useEffect(() => {
    const controller = new AbortController()
    void loadStaging(controller.signal)
    return () => controller.abort()
  }, [loadStaging])

  useEffect(() => {
    const controller = new AbortController()
    void loadRecoveryStatus(controller.signal)
    return () => controller.abort()
  }, [loadRecoveryStatus])

  useEffect(() => {
    const controller = new AbortController()
    void loadScrubHealth(controller.signal)
    return () => controller.abort()
  }, [loadScrubHealth])

  useEffect(() => {
    if (!selectedBackupId) {
      setSelectedWorkspace(null)
      setRestoreEstimate(null)
      setRestoreEstimateError(null)
      return
    }
    const controller = new AbortController()
    setActionError(null)
    setRestoreEstimate(null)
    setRestoreEstimateError(null)
    void loadBackupDetail(selectedBackupId, controller.signal)
    return () => controller.abort()
  }, [loadBackupDetail, selectedBackupId])

  const admissionKnown = Boolean(admission
    && Number.isSafeInteger(admission.estimatedBytes)
    && Number.isSafeInteger(admission.availableBytes)
    && (admission.availableBytes ?? 0) >= (admission.estimatedBytes ?? Number.MAX_SAFE_INTEGER)
    && !snapshot.system.storagePressure)
  const admissionReason = !admission
    ? (locale === 'vi' ? 'Chưa có bằng chứng dung lượng từ Core.' : 'Core has not provided storage evidence yet.')
    : snapshot.system.storagePressure
      ? (locale === 'vi' ? 'Core đang báo storage pressure; giải phóng dung lượng rồi tải lại.' : 'Core reports storage pressure; free space and refresh.')
      : !Number.isSafeInteger(admission.estimatedBytes) || !Number.isSafeInteger(admission.availableBytes)
        ? (locale === 'vi' ? 'Core chưa xác minh đủ estimated/available bytes.' : 'Core has not verified estimated and available bytes.')
        : (admission.availableBytes ?? 0) < (admission.estimatedBytes ?? Number.MAX_SAFE_INTEGER)
          ? (locale === 'vi' ? 'Dung lượng trống thấp hơn estimate; backup bị khoá.' : 'Free space is below the estimate; backup is disabled.')
          : (locale === 'vi' ? 'Đủ dung lượng theo admission hiện tại.' : 'Storage admission currently passes.')

  const createBackup = async () => {
    if (!client.createBackup || !connected || !admissionKnown || mutating) return
    setMutating('backup-create')
    setActionError(null)
    setNeedsUser(false)
    try {
      // A fresh user retry gets a fresh command key after a transient storage
      // failure; duplicate delivery of the same key remains Core-idempotent.
      const key = `backup-create:${crypto.randomUUID()}`
      const result = await client.createBackup({ durabilityClass: admission?.durabilityClass ?? 'LOCAL_WRITABLE' }, key)
      if (result.backup?.id) setSelectedBackupId(result.backup.id)
      await loadBackupList()
      onToast(locale === 'vi' ? 'Đã tạo và verify backup local.' : 'Local backup created and verified.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      setMutating(null)
    }
  }

  const verifyBackup = async () => {
    if (!client.verifyBackup || !selectedBackupId || !connected || mutating) return
    setMutating(`backup-verify:${selectedBackupId}`)
    setActionError(null)
    setNeedsUser(false)
    try {
      await client.verifyBackup(selectedBackupId, `backup-verify:${selectedBackupId}:${crypto.randomUUID()}`)
      await loadBackupList()
      await loadBackupDetail(selectedBackupId)
      onToast(locale === 'vi' ? 'Đã kiểm tra lại integrity của backup.' : 'Backup integrity was verified again.')
    } catch (cause) {
      setNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setActionError(workspaceErrorMessage(cause, locale))
    } finally {
      setMutating(null)
    }
  }

  const inspectRestoreEstimate = async () => {
    if (!client.getBackupRestoreEstimate || !selectedBackupId || !connected || mutating || restoreEstimateLoading) return
    setRestoreEstimateLoading(true)
    setRestoreEstimateError(null)
    try {
      const next = await client.getBackupRestoreEstimate(selectedBackupId)
      setRestoreEstimate(next)
    } catch (cause) {
      setRestoreEstimateError(workspaceErrorMessage(cause, locale))
    } finally {
      setRestoreEstimateLoading(false)
    }
  }

  const reconcileStaging = async (item: StagingEvidence) => {
    const state = String(item.state || 'UNKNOWN').toUpperCase()
    if (!client.reconcileStaging || !connected || !item.id || !STAGING_RECONCILABLE_STATES.has(state) || mutating) return
    setMutating(`staging-reconcile:${item.id}`)
    setStagingActionError(null)
    setStagingNeedsUser(false)
    try {
      await client.reconcileStaging(item.id, `staging-reconcile:${item.id}:${crypto.randomUUID()}`)
      onToast(locale === 'vi' ? 'Core đã hoàn tất kiểm tra staging.' : 'Core completed the staging reconciliation check.')
      await loadStaging()
    } catch (cause) {
      // Preserve the previously loaded evidence after a failed command so a
      // user can still see the exact state Core last confirmed.
      setStagingNeedsUser(cause instanceof CoreClientError && cause.needsUser)
      setStagingActionError(workspaceErrorMessage(cause, locale))
    } finally {
      setMutating(null)
    }
  }

  const recoveryCard = <section className="settings-card settings-recovery-card"><div className="card-heading"><div className="card-title-with-icon"><span className={`card-icon ${recoveryStatus?.readinessState === 'PASS' ? 'green' : 'amber'}`}><ShieldCheck size={16} /></span><div><h2>{locale === 'vi' ? 'Trạng thái phục hồi' : 'Recovery posture'}</h2><p>{locale === 'vi' ? 'Evidence chỉ đọc từ Core; UNKNOWN luôn cần reconcile trước khi khôi phục.' : 'Read-only Core evidence; UNKNOWN always requires reconciliation before recovery.'}</p></div></div><span className={`health-pill ${recoveryStatus?.readinessState === 'PASS' ? 'healthy' : 'attention'}`}><span />{recoveryStatus?.readinessState ?? (recoveryStatusLoading ? '…' : 'UNKNOWN')}</span></div>{!supportsRecoveryStatus ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Bridge chưa hỗ trợ trạng thái phục hồi.' : 'The bridge does not expose recovery status yet.'} /> : recoveryStatusLoading ? <LoadingState label={locale === 'vi' ? 'Đang đọc trạng thái phục hồi…' : 'Reading recovery posture…'} /> : recoveryStatusError ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{recoveryStatusError}</span><button type="button" className="subtle-button tiny" onClick={() => void loadRecoveryStatus()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div> : recoveryStatus ? <><div className="system-facts"><div><span>{locale === 'vi' ? 'Readiness' : 'Readiness'}</span><strong>{recoveryStatus.readinessState}</strong></div><div><span>{locale === 'vi' ? 'Recovery epoch' : 'Recovery epoch'}</span><strong>{recoveryStatus.recoveryEpochState ?? 'UNKNOWN'}</strong></div><div><span>{locale === 'vi' ? 'External reality' : 'External reality'}</span><strong>{recoveryStatus.externalRealityState ?? 'UNKNOWN'}</strong></div><div><span>{locale === 'vi' ? 'Kích hoạt restore' : 'Restore activation'}</span><strong>{recoveryStatus.restoreActivationState ?? 'NOT_IMPLEMENTED'}</strong></div></div><div className="backup-verification-list"><strong>{locale === 'vi' ? 'Các kiểm tra' : 'Checks'}</strong>{recoveryStatus.checks.map((check) => <div className="backup-verification-row" key={`${check.id}-${check.state}`}><span>{check.id}</span><small>{check.state}{check.code ? ` · ${check.code}` : ''}</small></div>)}</div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Bản ghi này không tạo epoch, không đóng băng dispatch và không thay đổi dữ liệu. Chỉ recovery flow có contract đầy đủ mới được phép kích hoạt.' : 'This record does not create an epoch, freeze dispatch, or mutate data. Activation requires the complete recovery contract.'}</p></> : <EmptyInline icon={Info} text={locale === 'vi' ? 'Chưa có evidence phục hồi.' : 'No recovery evidence is available.'} />}</section>

  const scrubStatus = scrubHealth?.status ?? 'UNKNOWN'
  const scrubStatusClass = scrubStatus === 'PASS' ? 'healthy' : 'attention'
  const scrubCard = <section className="settings-card settings-scrub-card"><div className="card-heading"><div className="card-title-with-icon"><span className={`card-icon ${scrubStatus === 'PASS' ? 'green' : 'amber'}`}><ShieldCheck size={16} /></span><div><h2>{locale === 'vi' ? 'Integrity managed object' : 'Managed-object integrity'}</h2><p>{locale === 'vi' ? 'Kiểm tra đọc-only theo giới hạn rõ ràng; không sửa hoặc xoá bytes.' : 'Bounded read-only evidence; bytes are never repaired or deleted.'}</p></div></div><span className={`health-pill ${scrubStatusClass}`}><span />{scrubHealthLoading ? '…' : scrubStatus}</span></div>{!supportsScrubHealth ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Bridge chưa hỗ trợ kiểm tra integrity của managed object.' : 'The bridge does not expose managed-object integrity evidence yet.'} /> : scrubHealthLoading ? <LoadingState label={locale === 'vi' ? 'Đang kiểm tra độ toàn vẹn của dữ liệu…' : 'Checking data integrity…'} /> : scrubHealthError ? <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{scrubHealthError}</span><button type="button" className="subtle-button tiny" onClick={() => void loadScrubHealth()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div> : scrubHealth ? <><div className="system-facts"><div><span>{locale === 'vi' ? 'Kết quả' : 'Result'}</span><strong>{scrubHealth.status}</strong></div><div><span>{locale === 'vi' ? 'Đã kiểm tra' : 'Checked'}</span><strong>{scrubHealth.scan.checkedCount}/{scrubHealth.scan.managedObjectCount}</strong></div><div><span>{locale === 'vi' ? 'Bytes đã đọc' : 'Bytes read'}</span><strong>{formatBytes(scrubHealth.scan.checkedBytes)}</strong></div><div><span>{locale === 'vi' ? 'Giới hạn' : 'Limit'}</span><strong>{scrubHealth.limits.maxObjects} · {formatBytes(scrubHealth.limits.maxBytes)}</strong></div><div><span>{locale === 'vi' ? 'Phạm vi' : 'Scope'}</span><strong>{scrubHealth.scan.complete ? (locale === 'vi' ? 'Đầy đủ' : 'Complete') : (locale === 'vi' ? 'Một phần' : 'Partial')}</strong></div></div>{scrubHealth.scan.truncated && <p className="readonly-note warning-text"><Info size={14} />{locale === 'vi' ? 'Giới hạn object/bytes đã dừng lượt kiểm tra; kết quả là UNKNOWN cho tới khi đọc tiếp phần còn lại.' : 'The object/byte limit stopped this pass; the result remains UNKNOWN until the remaining range is checked.'}</p>}{scrubHealth.scan.unknownCount > 0 && <p className="readonly-note warning-text"><Info size={14} />{locale === 'vi' ? `${scrubHealth.scan.unknownCount} object chưa thể xác minh đầy đủ.` : `${scrubHealth.scan.unknownCount} object could not be fully verified.`}</p>}{scrubHealth.objects.length > 0 && <div className="backup-verification-list"><strong>{locale === 'vi' ? 'Evidence gần nhất' : 'Recent evidence'}</strong>{scrubHealth.objects.slice(0, 8).map((item, index) => <div className="backup-verification-row" key={item.id ?? `${item.contentHash}-${index}`}><span title={item.contentHash}>{item.contentHash?.slice(0, 12) ?? item.id ?? '—'}</span><small>{item.state}{item.code ? ` · ${item.code}` : ''}</small></div>)}</div>}<div className="settings-backup-actions"><button type="button" className="subtle-button small" onClick={() => void loadScrubHealth()} disabled={scrubHealthLoading}>{scrubHealthLoading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}{locale === 'vi' ? 'Kiểm tra lại' : 'Check again'}</button></div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'PASS chỉ có nghĩa là phạm vi đã đọc khớp metadata. UNKNOWN không được nâng thành PASS; repair, quarantine và GC chưa được bật.' : 'PASS only covers the bytes read in this range. UNKNOWN is never promoted to PASS; repair, quarantine and GC are not enabled.'}</p></> : <EmptyInline icon={Info} text={locale === 'vi' ? 'Chưa có evidence integrity.' : 'No integrity evidence is available.'} />}</section>

  return <div className="page settings-page"><div className="page-heading"><div><p className="eyebrow">{locale === 'vi' ? 'HỆ THỐNG' : 'SYSTEM'}</p><h1>{locale === 'vi' ? 'Cài đặt' : 'Settings'}</h1><p className="page-subtitle">{locale === 'vi' ? 'Các tuỳ chọn hiển thị và durability local do Core kiểm soát.' : 'Display preferences and local durability controls owned by Core.'}</p></div><button className="subtle-button" onClick={onRefresh}><RefreshCw size={15} />{refreshLabel}</button></div><div className="settings-grid">{recoveryCard}{scrubCard}<section className="settings-card"><div className="card-heading"><div className="card-title-with-icon"><span className="card-icon violet"><Settings2 size={16} /></span><div><h2>{locale === 'vi' ? 'Giao diện' : 'Appearance'}</h2><p>{locale === 'vi' ? 'Lưu cục bộ trên máy này.' : 'Saved locally on this machine.'}</p></div></div></div><div className="setting-row"><div><strong>{locale === 'vi' ? 'Giao diện màu' : 'Theme'}</strong><small>{theme === 'dark' ? (locale === 'vi' ? 'Tối' : 'Dark') : (locale === 'vi' ? 'Sáng' : 'Light')}</small></div><button className="toggle-button" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')} aria-label={locale === 'vi' ? 'Đổi giao diện' : 'Toggle theme'}><span className={theme === 'dark' ? 'on' : ''} /></button></div><div className="setting-row"><div><strong>{locale === 'vi' ? 'Ngôn ngữ' : 'Language'}</strong><small>{locale === 'vi' ? 'Tiếng Việt' : 'English'}</small></div><button className="locale-button bordered" onClick={() => onLocaleChange(locale === 'vi' ? 'en' : 'vi')}><Languages size={14} />{locale === 'vi' ? 'VI' : 'EN'}</button></div></section><section className="settings-card"><div className="card-heading"><div className="card-title-with-icon"><span className={`card-icon ${connected ? 'green' : 'amber'}`}><Database size={16} /></span><div><h2>{locale === 'vi' ? 'Core & dữ liệu' : 'Core & data'}</h2><p>{locale === 'vi' ? 'Thông tin kết nối đọc từ dashboard gần nhất.' : 'Connection details from the latest dashboard.'}</p></div></div><span className={`health-pill ${connected ? 'healthy' : 'attention'}`}><span />{connected ? (locale === 'vi' ? 'Đã kết nối' : 'Connected') : (locale === 'vi' ? 'Cần kiểm tra' : 'Check connection')}</span></div><div className="system-facts"><div><span>{locale === 'vi' ? 'Kết nối' : 'Connection'}</span><strong>{connected ? (locale === 'vi' ? 'Loopback local' : 'Local loopback') : (locale === 'vi' ? 'Offline' : 'Offline')}</strong></div><div><span>{locale === 'vi' ? 'Dung lượng đã dùng' : 'Storage used'}</span><strong>{snapshot.system.storageUsed}</strong></div><div><span>{locale === 'vi' ? 'Tổng dung lượng' : 'Storage total'}</span><strong>{snapshot.system.storageTotal}</strong></div><div><span>{locale === 'vi' ? 'Backup gần nhất' : 'Latest backup'}</span><strong>{backupStateLabel}{backupAtLabel ? ` · ${backupAtLabel}` : ''}</strong></div><div><span>{locale === 'vi' ? 'Snapshot gần nhất' : 'Latest snapshot'}</span><strong>{formatRelativeSnapshot(snapshot.generatedAt, locale)}</strong></div>{snapshot.system.storagePressure && <div><span>{locale === 'vi' ? 'Dung lượng dự phòng' : 'Storage reserve'}</span><strong>{locale === 'vi' ? 'Cần xử lý' : 'Needs attention'}</strong></div>}</div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Cài đặt này không thay đổi quyền, RLS hoặc dữ liệu. Mọi command quan trọng vẫn cần Core xác nhận.' : 'These settings do not change permissions, RLS, or data. Important commands still require Core confirmation.'}</p></section>
      <section className="settings-card settings-backup-card"><div className="card-heading"><div className="card-title-with-icon"><span className={`card-icon ${admissionKnown ? 'green' : 'amber'}`}><HardDrive size={16} /></span><div><h2>{locale === 'vi' ? 'Backup local đã xác minh' : 'Verified local backups'}</h2><p>{locale === 'vi' ? 'Snapshot SQLite và managed objects được Core admission trước khi ghi.' : 'Core admits the SQLite snapshot and managed objects before writing.'}</p></div></div><span className="count-chip">{backups.length}</span></div>{!connected && <div className="inline-state warning"><CloudOff size={14} /><span>{locale === 'vi' ? 'Core đang offline; dữ liệu đã tải vẫn giữ nguyên nhưng command bị khoá.' : 'Core is offline; loaded evidence stays visible but commands are disabled.'}</span></div>}{error && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{error}</span><button type="button" className="subtle-button tiny" onClick={() => void loadBackupList()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}{supportsBackupRead && <div className="backup-admission"><div><span>{locale === 'vi' ? 'Admission' : 'Admission'}</span><strong>{admissionKnown ? (locale === 'vi' ? 'Đủ điều kiện' : 'Ready') : (locale === 'vi' ? 'Chưa đạt' : 'Not ready')}</strong></div><div><span>{locale === 'vi' ? 'Estimate' : 'Estimate'}</span><strong>{admission?.estimatedBytes === undefined ? '—' : formatBytes(admission.estimatedBytes)}</strong></div><div><span>{locale === 'vi' ? 'Còn trống' : 'Available'}</span><strong>{admission?.availableBytes === undefined ? '—' : formatBytes(admission.availableBytes)}</strong></div><div><span>{locale === 'vi' ? 'Reserve' : 'Reserve'}</span><strong>{admission?.reserveBytes === undefined ? '—' : formatBytes(admission.reserveBytes)}</strong></div></div>}{supportsBackupRead && <p className={`readonly-note ${admissionKnown ? '' : 'warning-text'}`}><Info size={14} />{admissionReason}</p>}<div className="settings-backup-actions"><button type="button" className="primary-button small" onClick={() => void createBackup()} disabled={!connected || loading || mutating !== null || !supportsBackupRead || !client.createBackup || !admissionKnown}>{mutating === 'backup-create' ? <RefreshCw size={14} className="spin" /> : <HardDrive size={14} />}{locale === 'vi' ? 'Tạo backup' : 'Create backup'}</button><button type="button" className="subtle-button small" onClick={() => void loadBackupList()} disabled={loading || mutating !== null}>{loading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}{locale === 'vi' ? 'Tải lại' : 'Refresh'}</button></div>{actionError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{actionError}</span>{needsUser && <small>{locale === 'vi' ? 'Core cần bạn xử lý điều kiện rồi thử lại.' : 'Core needs you to resolve the condition before retrying.'}</small>}</div>}{loading ? <LoadingState label={locale === 'vi' ? 'Đang đọc admission và backup…' : 'Reading storage admission and backups…'} /> : backups.length === 0 ? <EmptyInline icon={HardDrive} text={supportsBackupRead ? (locale === 'vi' ? 'Chưa có backup VERIFIED.' : 'No VERIFIED backup yet.') : (locale === 'vi' ? 'Bridge chưa hỗ trợ backup.' : 'The bridge does not expose backups yet.')} /> : <div className="workspace-record-list">{backups.map((backup) => <button type="button" className={`timeline-row ${backup.id === selectedBackupId ? 'active' : ''}`} key={backup.id} onClick={() => setSelectedBackupId(backup.id ?? null)}><span className="timeline-row-icon"><HardDrive size={15} /></span><span className="workspace-record-main"><strong>{backup.destinationName ?? backup.id ?? 'Backup'}</strong><small>{backup.state} · {backup.byteSize === undefined ? '—' : formatBytes(backup.byteSize)} · {backup.completedAt ? formatRelativeSnapshot(backup.completedAt, locale) : '—'}</small></span><span className={`record-code ${backup.state === 'VERIFIED' ? 'success' : 'warning'}`}>{backup.state}</span><ArrowRight size={14} /></button>)}</div>}</section>
      <section className="settings-card settings-backup-detail-card">{detailLoading ? <LoadingState label={locale === 'vi' ? 'Đang đọc chi tiết backup…' : 'Reading backup details…'} /> : !selectedWorkspace?.backup ? <EmptyState icon={Info} title={locale === 'vi' ? 'Chọn một backup' : 'Select a backup'} detail={supportsBackupDetail ? (locale === 'vi' ? 'Core sẽ hiển thị manifest metadata đã redacted.' : 'Core will show redacted manifest metadata.') : (locale === 'vi' ? 'Bridge chưa cung cấp chi tiết backup.' : 'The bridge does not expose backup details yet.')} /> : <><div className="card-heading"><div><h2>{locale === 'vi' ? 'Chi tiết backup' : 'Backup details'}</h2><p>{selectedWorkspace.backup.id ?? '—'} · v{selectedWorkspace.backup.rowVersion}</p></div><span className={`health-pill ${selectedWorkspace.backup.state === 'VERIFIED' ? 'healthy' : 'warning'}`}><span />{selectedWorkspace.backup.state}</span></div><div className="system-facts"><div><span>{locale === 'vi' ? 'Nơi lưu an toàn' : 'Safe destination'}</span><strong>{selectedWorkspace.backup.destinationName ?? '—'}</strong></div><div><span>{locale === 'vi' ? 'Manifest' : 'Manifest'}</span><strong>{selectedWorkspace.backup.manifestName ?? '—'}</strong></div><div><span>{locale === 'vi' ? 'Snapshot' : 'Snapshot'}</span><strong>{selectedWorkspace.backup.snapshotName ?? '—'}</strong></div><div><span>{locale === 'vi' ? 'Managed objects' : 'Managed objects'}</span><strong>{selectedWorkspace.backup.objectCount ?? '—'}</strong></div><div><span>{locale === 'vi' ? 'Dung lượng' : 'Bytes'}</span><strong>{selectedWorkspace.backup.byteSize === undefined ? '—' : formatBytes(selectedWorkspace.backup.byteSize)}</strong></div><div><span>Manifest SHA-256</span><strong title={selectedWorkspace.backup.manifestSha256}>{selectedWorkspace.backup.manifestSha256?.slice(0, 16) ?? '—'}</strong></div></div><div className="settings-backup-actions"><button type="button" className="subtle-button small" onClick={() => void verifyBackup()} disabled={!connected || mutating !== null || !client.verifyBackup || !selectedBackupId}>{mutating === `backup-verify:${selectedBackupId}` ? <RefreshCw size={14} className="spin" /> : <ShieldCheck size={14} />}{locale === 'vi' ? 'Verify lại' : 'Verify again'}</button><button type="button" className="subtle-button small" onClick={() => void inspectRestoreEstimate()} disabled={!connected || mutating !== null || restoreEstimateLoading || !client.getBackupRestoreEstimate || !selectedBackupId}>{restoreEstimateLoading ? <RefreshCw size={14} className="spin" /> : <ShieldCheck size={14} />}{locale === 'vi' ? 'Kiểm tra kế hoạch restore' : 'Inspect restore plan'}</button></div>{restoreEstimateError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{restoreEstimateError}</span><button type="button" className="subtle-button tiny" onClick={() => void inspectRestoreEstimate()} disabled={restoreEstimateLoading}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}<div className="backup-verification-list"><strong>{locale === 'vi' ? 'Lịch sử verify' : 'Verification history'}</strong>{selectedWorkspace.verifications.length === 0 ? <small>{locale === 'vi' ? 'Chưa có bản ghi.' : 'No verification record.'}</small> : selectedWorkspace.verifications.map((verification) => <div className="backup-verification-row" key={verification.id ?? `${verification.outcome}-${verification.createdAt}`}><span>{verification.outcome}</span><small>{verification.integrityState} · {verification.createdAt ? formatRelativeSnapshot(verification.createdAt, locale) : '—'}</small></div>)}</div>{restoreEstimate?.restoreEstimate && <div className="backup-verification-list"><strong>{locale === 'vi' ? 'Kế hoạch restore (read-only)' : 'Restore preflight (read-only)'}</strong><div className="system-facts"><div><span>{locale === 'vi' ? 'Preflight' : 'Preflight'}</span><strong>{restoreEstimate.restoreEstimate.preflightState}</strong></div><div><span>{locale === 'vi' ? 'Dung lượng ước tính' : 'Estimated bytes'}</span><strong>{restoreEstimate.restoreEstimate.estimatedRestoreBytes === null || restoreEstimate.restoreEstimate.estimatedRestoreBytes === undefined ? '—' : formatBytes(restoreEstimate.restoreEstimate.estimatedRestoreBytes)}</strong></div><div><span>{locale === 'vi' ? 'Thời gian lý thuyết' : 'Theoretical duration'}</span><strong>{restoreEstimate.restoreEstimate.estimatedRestoreDurationMs === null || restoreEstimate.restoreEstimate.estimatedRestoreDurationMs === undefined ? '—' : `${Math.ceil(restoreEstimate.restoreEstimate.estimatedRestoreDurationMs / 1000)}s`}</strong></div><div><span>{locale === 'vi' ? 'Kích hoạt' : 'Activation'}</span><strong>{restoreEstimate.restoreEstimate.activationState ?? 'NOT_IMPLEMENTED'}</strong></div></div><div className="backup-verification-list">{restoreEstimate.restoreEstimate.checks.map((check) => <div className="backup-verification-row" key={`${check.id}-${check.state}`}><span>{check.id}</span><small>{check.state}{check.code ? ` · ${check.code}` : ''}</small></div>)}</div><p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Đây chỉ là kiểm tra integrity và kế hoạch. CineForge chưa copy, activate hoặc thay đổi dữ liệu khi xem preflight.' : 'This only verifies integrity and plans recovery. CineForge does not copy, activate, or mutate data during preflight.'}</p></div>}<p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Chỉ hiển thị tên an toàn, hash và integrity evidence. Restore activation cần recovery epoch và chưa được mở.' : 'Only safe names, hashes, and integrity evidence are shown. Restore activation requires a recovery epoch and is not available yet.'}</p></>}</section>
      <section className="settings-card settings-staging-card"><div className="card-heading"><div className="card-title-with-icon"><span className={`card-icon ${staging?.items.length ? 'amber' : 'green'}`}><FileIcon size={16} /></span><div><h2>{locale === 'vi' ? 'Staging import' : 'Import staging'}</h2><p>{locale === 'vi' ? 'Bằng chứng redacted cho file tạm; không tự nhận bytes hoặc xoá dữ liệu.' : 'Redacted evidence for temporary import files; no byte adoption or deletion.'}</p></div></div><span className="count-chip">{staging?.items.length ?? 0}</span></div>{!connected && <div className="inline-state warning"><CloudOff size={14} /><span>{locale === 'vi' ? 'Core đang offline; reconcile bị khoá nhưng evidence đã tải vẫn được giữ.' : 'Core is offline; reconciliation is disabled while loaded evidence stays visible.'}</span></div>}{stagingError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{stagingError}</span><button type="button" className="subtle-button tiny" onClick={() => void loadStaging()}>{locale === 'vi' ? 'Thử lại' : 'Retry'}</button></div>}{supportsStaging && <p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Chỉ các trạng thái WRITING, COMPLETE và VERIFIED mới cho phép Core reconcile. ORPHANED, QUARANTINED, FAILED, REGISTERED và UNKNOWN đều không được tự động sửa.' : 'Only WRITING, COMPLETE, and VERIFIED can be reconciled by Core. ORPHANED, QUARANTINED, FAILED, REGISTERED, and UNKNOWN are never auto-repaired.'}</p>}<div className="settings-backup-actions"><button type="button" className="subtle-button small" onClick={() => void loadStaging()} disabled={stagingLoading || mutating !== null || !supportsStaging}>{stagingLoading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}{locale === 'vi' ? 'Tải lại evidence' : 'Refresh evidence'}</button></div>{stagingActionError && <div className="inline-state warning" role="alert"><AlertCircle size={14} /><span>{stagingActionError}</span>{stagingNeedsUser && <small>{locale === 'vi' ? 'Core cần bạn xử lý điều kiện rồi mới thử lại.' : 'Core needs you to resolve the condition before retrying.'}</small>}</div>}{stagingLoading ? <LoadingState label={locale === 'vi' ? 'Đang đọc staging evidence…' : 'Reading staging evidence…'} /> : !supportsStaging ? <EmptyInline icon={Info} text={locale === 'vi' ? 'Bridge chưa hỗ trợ staging workspace.' : 'The bridge does not expose the staging workspace yet.'} /> : !staging || staging.items.length === 0 ? <EmptyInline icon={CheckCircle2} text={locale === 'vi' ? 'Không có staging cần xử lý.' : 'No staging evidence needs attention.'} /> : <div className="staging-evidence-list">{staging.items.map((item, index) => <StagingEvidenceRow item={item} locale={locale} connected={connected} mutating={mutating} onReconcile={(next) => void reconcileStaging(next)} key={item.id ?? `${item.state}-${item.updatedAt ?? item.createdAt ?? index}`} />)}</div>}<p className="readonly-note"><Info size={14} />{locale === 'vi' ? 'Originals, canon, backup và release master không bị xoá. UNKNOWN không bao giờ được nâng thành PASS.' : 'Originals, canon, backups, and release masters are never deleted. UNKNOWN is never promoted to PASS.'}</p></section></div></div>
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

function ErrorState({ message, detail, retryLabel, onRetry }: { message: string; detail?: string; retryLabel: string; onRetry: () => void }) {
  return <div className="error-state"><div className="error-icon"><CloudOff size={24} /></div><h2>{message}</h2><p>{detail ?? 'CineForge không giả vờ đã lưu thay đổi. Kiểm tra Core rồi thử lại.'}</p><button className="primary-button" onClick={onRetry}>{retryLabel}</button></div>
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
  return <div className="overlay-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="search-dialog" role="dialog" aria-modal="true" aria-label={t.searchPlaceholder}><div className="search-dialog-input"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} /><kbd>ESC</kbd></div><div className="search-dialog-body">{filtered.length ? <>{filtered.map((project) => <button className="search-result" key={project.id} onClick={() => onSelectProject(project)}><span className="result-thumb" style={{ background: project.cover }} /><span><strong>{project.name}</strong><small>{project.kind} · {project.stage}</small></span><ArrowRight size={15} /></button>)}</> : <div className="search-empty"><Search size={20} /><p>{query ? t.searchNoResults : t.searchHint}</p></div>}</div><div className="search-dialog-footer"><span>{t.commandHint}</span><span><kbd>↵</kbd> {t.view}</span></div></div></div>
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
