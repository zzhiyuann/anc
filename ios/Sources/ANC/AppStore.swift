import Foundation
import SwiftUI
import Combine

@MainActor
final class AppStore: ObservableObject {
    @Published var connected: Bool = false
    @Published var lastError: String? = nil

    @Published var tasks: [ANCTask] = []
    @Published var projects: [ANCProject] = []
    @Published var agents: [AgentStatus] = []
    @Published var notifications: [ANCNotification] = []

    @Published var selectedTaskId: String? = nil
    @Published var selectedTaskDetail: TaskDetailResponse? = nil
    @Published var showCreateTask: Bool = false

    // Pulse data
    @Published var briefing: DailyBriefing? = nil
    @Published var objectives: [Objective] = []
    @Published var decisions: [Decision] = []
    @Published var budgetConfig: BudgetConfigResponse? = nil
    @Published var killSwitchPaused: Bool = false

    // Agent detail
    @Published var selectedAgentRole: String? = nil
    @Published var agentDetail: AgentDetail? = nil
    @Published var agentPersona: String? = nil
    @Published var agentOutputs: [AgentOutput] = []
    @Published var agentMemoryFiles: [String] = []
    @Published var agentMemoryContent: AgentMemoryFileResponse? = nil

    private let api = APIClient.shared
    private var ws: WebSocketClient?
    private var wsCancellable: AnyCancellable?

    var serverURL: String {
        get { UserDefaults.standard.string(forKey: "serverURL") ?? "http://192.168.1.100:3849" }
        set {
            UserDefaults.standard.set(newValue, forKey: "serverURL")
            Task {
                await api.updateBaseURL(newValue)
                ws?.updateURL(wsURL(from: newValue))
            }
        }
    }

    var unreadCount: Int {
        notifications.filter { $0.readAt == nil }.count
    }

    func bootstrap() async {
        await refreshAll()
        startWebSocket()
    }

    func refreshAll() async {
        async let t: () = refreshTasks()
        async let p: () = refreshProjects()
        async let a: () = refreshAgents()
        async let n: () = refreshNotifications()
        _ = await (t, p, a, n)
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
            let res: NotificationsResponse = try await api.fetch("notifications")
            self.notifications = res.notifications
        } catch {
            // non-fatal
        }
    }

    private func wsURL(from serverURL: String) -> URL {
        let base = serverURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let wsBase = base.replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")
        return URL(string: "\(wsBase)/ws")!
    }

    private func startWebSocket() {
        let url = wsURL(from: serverURL)
        let client = WebSocketClient(url: url)
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
            // non-fatal
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
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Notifications

    func markNotificationRead(_ id: Int) async {
        do {
            let _: OkResponse = try await api.post("notifications/\(id)/read", body: EmptyBody())
            await refreshNotifications()
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

    func refreshBudgetConfig() async {
        do {
            let res: BudgetConfigResponse = try await api.fetch("config/budget")
            self.budgetConfig = res
        } catch {
            // non-fatal
        }
    }

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

    // MARK: - Dispatch

    func dispatchToAgent(role: String, taskId: String?, message: String?) async {
        let payload = DispatchPayload(role: role, taskId: taskId, message: message)
        do {
            let _: OkResponse = try await api.post("dispatch", body: payload)
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Key Results

    func updateKeyResult(objectiveId: String, krId: String, current: Double) async {
        let payload = PatchKeyResultPayload(current: current)
        do {
            let _: OkResponse = try await api.patch("pulse/objectives/\(objectiveId)/key-results/\(krId)", body: payload)
            await refreshObjectives()
        } catch {
            // non-fatal
        }
    }

    // MARK: - Budget

    func toggleUnlimitedMode() async {
        let isCurrentlyDisabled = budgetConfig?.disabled == true
        let payload = ToggleBudgetPayload(disabled: !isCurrentlyDisabled)
        do {
            let _: OkResponse = try await api.patch("config/budget", body: payload)
            await refreshBudgetConfig()
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func testConnection() async -> Bool {
        return await api.testConnection()
    }
}

private struct EmptyBody: Encodable {}
