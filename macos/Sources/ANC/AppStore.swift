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
        }
        if t.hasPrefix("notification:") {
            Task { await self.refreshNotifications() }
        }
    }
}
