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

    private let api = APIClient.shared
    private var ws: WebSocketClient?
    private var wsCancellable: AnyCancellable?

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
        } catch {
            self.lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
