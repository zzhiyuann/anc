import Foundation
import SwiftUI
import Combine

@MainActor
final class AppStore: ObservableObject {
    @Published var connected: Bool = false
    @Published var lastError: String? = nil
    @Published var isLoading: Bool = false

    @Published var tasks: [ANCTask] = []
    @Published var projects: [ANCProject] = []
    @Published var agents: [AgentStatus] = []
    @Published var notifications: [ANCNotification] = []

    @Published var selectedTaskId: String? = nil
    @Published var selectedTaskDetail: TaskDetailResponse? = nil
    @Published var showCreateTask: Bool = false

    // Phase 3 data
    @Published var projectsWithStats: [ProjectWithStats] = []
    @Published var selectedProjectId: String? = nil
    @Published var selectedAgentRole: String? = nil
    @Published var agentDetail: AgentDetail? = nil
    @Published var agentPersona: String? = nil
    @Published var agentOutputs: [AgentOutput] = []
    @Published var agentMemoryFiles: [String] = []
    @Published var agentMemoryContent: AgentMemoryFileResponse? = nil
    @Published var systemEvents: [SystemEvent] = []
    @Published var briefing: DailyBriefing? = nil
    @Published var objectives: [Objective] = []
    @Published var decisions: [Decision] = []
    @Published var budgetConfig: BudgetConfigResponse? = nil
    @Published var budgetSeries: [BudgetDay] = []
    @Published var reviewConfig: ReviewConfigResponse? = nil
    @Published var killSwitchPaused: Bool = false
    @Published var selectedNotificationId: Int? = nil

    // Phase 4: Search + navigation
    @Published var showSearch: Bool = false
    @Published var showHelp: Bool = false
    @Published var searchNavigateTo: NavItem? = nil

    private let api = APIClient.shared
    private var ws: WebSocketClient?
    private var wsCancellable: AnyCancellable?
    private let notificationService = NotificationService.shared

    var unreadCount: Int {
        notifications.filter { $0.readAt == nil }.count
    }

    func bootstrap() async {
        notificationService.requestPermission()
        await refreshAll()
        startWebSocket()
        notificationService.updateDockBadge(unreadCount: unreadCount)
    }

    func refreshAll() async {
        isLoading = true
        async let t: () = refreshTasks()
        async let p: () = refreshProjects()
        async let a: () = refreshAgents()
        async let n: () = refreshNotifications()
        _ = await (t, p, a, n)
        isLoading = false
    }

    func refreshTasks() async {
        do {
            let res: TasksResponse = try await api.fetch("tasks")
            self.tasks = res.tasks
            self.connected = true
            self.lastError = nil
        } catch {
            self.connected = false
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func refreshProjects() async {
        do {
            let res: ProjectsResponse = try await api.fetch("projects")
            self.projects = res.projects
        } catch {
            // non-fatal
        }
    }

    func refreshAgents() async {
        do {
            let res: AgentsResponse = try await api.fetch("agents")
            self.agents = res.agents
        } catch {
            // non-fatal
        }
    }

    func refreshNotifications() async {
        do {
            let oldIds = Set(notifications.map { $0.id })
            let res: NotificationsResponse = try await api.fetch("notifications")
            self.notifications = res.notifications
            notificationService.updateDockBadge(unreadCount: unreadCount)

            // Deliver native notifications for new critical items
            for notif in res.notifications where !oldIds.contains(notif.id) {
                notificationService.checkAndDeliver(notif)
            }
        } catch {
            // non-fatal — endpoint may not exist
        }
    }

    private func startWebSocket() {
        let client = WebSocketClient(url: URL(string: "ws://localhost:3849/ws")!)
        self.ws = client
        wsCancellable = client.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] msg in
                self?.handleWsEvent(msg)
            }
        client.connect()
    }

    private func handleWsEvent(_ msg: WsMessage) {
        let t = msg.type
        if t == "snapshot" || t.hasPrefix("agent:") {
            Task { await self.refreshAgents() }
        }
        if t.hasPrefix("task:") || t == "snapshot" {
            Task { await self.refreshTasks() }
            // Refresh detail if we have one selected
            if let id = self.selectedTaskId {
                Task { await self.fetchTaskDetail(id) }
            }
        }
        if t.hasPrefix("notification:") {
            Task { await self.refreshNotifications() }
        }
    }

    // MARK: - Task CRUD

    func selectTask(_ id: String?) {
        self.selectedTaskId = id
        if let id {
            Task { await fetchTaskDetail(id) }
        } else {
            self.selectedTaskDetail = nil
        }
    }

    func fetchTaskDetail(_ id: String) async {
        do {
            let res: TaskDetailResponse = try await api.fetch("tasks/\(id)")
            if self.selectedTaskId == id {
                self.selectedTaskDetail = res
            }
        } catch {
            // non-fatal: keep stale detail
        }
    }

    func createTask(title: String, description: String?, assignee: String?, priority: Int, projectId: String?) async {
        let payload = CreateTaskPayload(
            title: title,
            description: description,
            assignee: assignee,
            priority: priority,
            projectId: projectId
        )
        do {
            let res: SingleTaskResponse = try await api.post("tasks", body: payload)
            await refreshTasks()
            selectTask(res.task.id)
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func updateTask(id: String, patch: PatchTaskPayload) async {
        // Optimistic: update local list
        if let idx = tasks.firstIndex(where: { $0.id == id }) {
            // We cannot mutate ANCTask easily; just fire PATCH and refresh
            _ = idx
        }
        do {
            let _: SingleTaskResponse = try await api.patch("tasks/\(id)", body: patch)
            await refreshTasks()
            if selectedTaskId == id {
                await fetchTaskDetail(id)
            }
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func deleteTask(id: String) async {
        do {
            let _: DeleteResponse = try await api.delete("tasks/\(id)")
            tasks.removeAll { $0.id == id }
            if selectedTaskId == id {
                selectedTaskId = nil
                selectedTaskDetail = nil
            }
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func postComment(taskId: String, body: String) async {
        let payload = CreateCommentPayload(body: body, author: "ceo")
        do {
            let _: TaskComment = try await api.post("tasks/\(taskId)/comments", body: payload)
            await fetchTaskDetail(taskId)

            // Check for @mentions and dispatch
            let mentionPattern = /@(\w+)/
            let matches = body.matches(of: mentionPattern)
            for match in matches {
                let role = String(match.1)
                if agents.contains(where: { $0.role == role }) {
                    await dispatch(role: role, taskId: taskId, message: body)
                }
            }
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func dispatch(role: String, taskId: String?, message: String?) async {
        let payload = DispatchPayload(role: role, taskId: taskId, message: message)
        do {
            let _: OkResponse = try await api.post("dispatch", body: payload)
        } catch {
            // non-fatal
        }
    }

    // MARK: - Projects with Stats

    func refreshProjectsWithStats() async {
        do {
            let res: ProjectsWithStatsResponse = try await api.fetch("projects")
            self.projectsWithStats = res.projects
        } catch {
            // non-fatal
        }
    }

    // MARK: - Projects CRUD

    func createProject(name: String, description: String?, color: String?, priority: Int?) async {
        let payload = CreateProjectPayload(name: name, description: description, color: color, priority: priority)
        do {
            let _: SingleProjectResponse = try await api.post("projects", body: payload)
            await refreshProjects()
            await refreshProjectsWithStats()
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Agent Detail

    func fetchAgentDetail(_ role: String) async {
        do {
            let res: AgentDetail = try await api.fetch("agents/\(role)")
            if self.selectedAgentRole == role {
                self.agentDetail = res
            }
        } catch {
            // non-fatal
        }
    }

    func fetchAgentPersona(_ role: String) async {
        do {
            let res: PersonaResponse = try await api.fetch("personas/\(role)")
            self.agentPersona = res.body
        } catch {
            self.agentPersona = nil
        }
    }

    func saveAgentPersona(_ role: String, body: String) async {
        struct PersonaBody: Encodable { let body: String }
        do {
            let _: PersonaResponse = try await api.patch("personas/\(role)", body: PersonaBody(body: body))
            self.agentPersona = body
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func fetchAgentOutputs(_ role: String) async {
        do {
            let res: AgentOutputResponse = try await api.fetch("agents/\(role)/output")
            self.agentOutputs = res.outputs
        } catch {
            self.agentOutputs = []
        }
    }

    func fetchAgentMemoryList(_ role: String) async {
        do {
            let res: AgentMemoryListResponse = try await api.fetch("agents/\(role)/memory")
            self.agentMemoryFiles = res.files
        } catch {
            self.agentMemoryFiles = []
        }
    }

    func fetchAgentMemoryFile(_ role: String, filename: String) async {
        do {
            let res: AgentMemoryFileResponse = try await api.fetch("agents/\(role)/memory/\(filename)")
            self.agentMemoryContent = res
        } catch {
            self.agentMemoryContent = nil
        }
    }

    func saveAgentMemoryFile(_ role: String, filename: String, body: String) async {
        struct MemoryBody: Encodable { let body: String }
        do {
            let _: AgentMemoryFileResponse = try await api.patch("agents/\(role)/memory/\(filename)", body: MemoryBody(body: body))
            await fetchAgentMemoryFile(role, filename: filename)
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Events

    func refreshEvents(role: String? = nil) async {
        do {
            var query: [String: String] = [:]
            if let role { query["role"] = role }
            let res: EventsResponse = try await api.fetch("events", query: query)
            self.systemEvents = res.events
        } catch {
            self.systemEvents = []
        }
    }

    // MARK: - Pulse

    func refreshBriefing() async {
        do {
            let res: DailyBriefing = try await api.fetch("pulse/briefing")
            self.briefing = res
        } catch {
            // non-fatal
        }
    }

    func refreshObjectives() async {
        do {
            let res: ObjectivesResponse = try await api.fetch("pulse/objectives")
            self.objectives = res.objectives
        } catch {
            self.objectives = []
        }
    }

    func refreshDecisions() async {
        do {
            let res: DecisionsResponse = try await api.fetch("pulse/decisions")
            self.decisions = res.decisions
        } catch {
            self.decisions = []
        }
    }

    func createObjective(title: String, description: String?, quarter: String?) async {
        let payload = CreateObjectivePayload(title: title, description: description, quarter: quarter)
        do {
            let _: Objective = try await api.post("pulse/objectives", body: payload)
            await refreshObjectives()
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func createDecision(title: String, rationale: String?, tags: [String]) async {
        let payload = CreateDecisionPayload(title: title, rationale: rationale, decidedBy: "ceo", tags: tags)
        do {
            let _: Decision = try await api.post("pulse/decisions", body: payload)
            await refreshDecisions()
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Budget & Review Config

    func refreshBudgetConfig() async {
        do {
            let res: BudgetConfigResponse = try await api.fetch("config/budget")
            self.budgetConfig = res
        } catch {
            // non-fatal
        }
    }

    func refreshBudgetSeries(role: String? = nil, days: Int = 14) async {
        do {
            var query: [String: String] = ["days": "\(days)"]
            if let role { query["role"] = role }
            let res: BudgetSeriesResponse = try await api.fetch("config/budget/series", query: query)
            self.budgetSeries = res.days
        } catch {
            self.budgetSeries = []
        }
    }

    func refreshReviewConfig() async {
        do {
            let res: ReviewConfigResponse = try await api.fetch("config/review")
            self.reviewConfig = res
        } catch {
            // non-fatal
        }
    }

    func updateBudget(daily: PatchBudgetLimit?, agents: [String: PatchBudgetLimit]?) async {
        let payload = PatchBudgetPayload(daily: daily, agents: agents)
        do {
            let _: BudgetConfigResponse = try await api.patch("config/budget", body: payload)
            await refreshBudgetConfig()
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func updateReview(roles: [String: String]) async {
        let payload = PatchReviewPayload(roles: roles)
        do {
            let _: ReviewConfigResponse = try await api.patch("config/review", body: payload)
            await refreshReviewConfig()
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Kill Switch

    func refreshKillSwitchStatus() async {
        do {
            let res: KillSwitchStatusResponse = try await api.fetch("kill-switch/status")
            self.killSwitchPaused = res.paused ?? false
        } catch {
            // non-fatal
        }
    }

    func toggleKillSwitch() async {
        let endpoint = killSwitchPaused ? "kill-switch/resume" : "kill-switch/pause"
        do {
            let _: KillSwitchResponse = try await api.post(endpoint, body: EmptyBody())
            self.killSwitchPaused.toggle()
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Notifications

    func markNotificationRead(_ id: Int) async {
        do {
            let _: OkResponse = try await api.post("notifications/\(id)/read", body: EmptyBody())
            if let idx = notifications.firstIndex(where: { $0.id == id }) {
                // Refresh to get updated state
                await refreshNotifications()
                _ = idx
            }
        } catch {
            // non-fatal
        }
    }

    func archiveNotification(_ id: Int) async {
        do {
            let _: OkResponse = try await api.post("notifications/\(id)/archive", body: EmptyBody())
            notifications.removeAll { $0.id == id }
        } catch {
            // non-fatal
        }
    }

    func markAllNotificationsRead() async {
        do {
            let _: OkResponse = try await api.post("notifications/mark-all-read", body: EmptyBody())
            await refreshNotifications()
        } catch {
            // non-fatal
        }
    }
}

private struct EmptyBody: Encodable {}
