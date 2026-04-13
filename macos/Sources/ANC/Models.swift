import Foundation
import SwiftUI

// MARK: - Enums

enum TaskEntityState: String, Codable, CaseIterable {
    case todo
    case running
    case review
    case done
    case failed
    case canceled

    var displayName: String {
        switch self {
        case .todo: return "Todo"
        case .running: return "Running"
        case .review: return "Review"
        case .done: return "Done"
        case .failed: return "Failed"
        case .canceled: return "Canceled"
        }
    }

    var color: Color {
        switch self {
        case .todo: return .gray
        case .running: return .blue
        case .review: return .orange
        case .done: return .green
        case .failed: return .red
        case .canceled: return .secondary
        }
    }
}

enum TaskSource: String, Codable {
    case dashboard
    case linear
    case dispatch
    case duty
}

enum ProjectState: String, Codable {
    case active
    case paused
    case archived
}

enum TaskPriority: Int, Codable, CaseIterable {
    case none = 0
    case urgent = 1
    case high = 2
    case medium = 3
    case low = 4

    var displayName: String {
        switch self {
        case .none: return "No priority"
        case .urgent: return "Urgent"
        case .high: return "High"
        case .medium: return "Medium"
        case .low: return "Low"
        }
    }
}

// MARK: - Task

struct ANCTask: Codable, Identifiable, Hashable {
    let id: String
    let projectId: String?
    let title: String
    let description: String?
    let state: TaskEntityState
    let priority: Int
    let source: TaskSource?
    let parentTaskId: String?
    let createdBy: String?
    let linearIssueKey: String?
    let createdAt: Double?
    let completedAt: Double?
    let handoffSummary: String?
    let assignee: String?
    let labels: [String]?
    let dueDate: String?

    enum CodingKeys: String, CodingKey {
        case id
        case projectId = "project_id"
        case title
        case description
        case state
        case priority
        case source
        case parentTaskId = "parent_task_id"
        case createdBy = "created_by"
        case linearIssueKey = "linear_issue_key"
        case createdAt = "created_at"
        case completedAt = "completed_at"
        case handoffSummary = "handoff_summary"
        case assignee
        case labels
        case dueDate = "due_date"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        projectId = try? c.decodeIfPresent(String.self, forKey: .projectId)
        title = (try? c.decode(String.self, forKey: .title)) ?? "(untitled)"
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        state = (try? c.decode(TaskEntityState.self, forKey: .state)) ?? .todo
        priority = (try? c.decode(Int.self, forKey: .priority)) ?? 0
        source = try? c.decodeIfPresent(TaskSource.self, forKey: .source)
        parentTaskId = try? c.decodeIfPresent(String.self, forKey: .parentTaskId)
        createdBy = try? c.decodeIfPresent(String.self, forKey: .createdBy)
        linearIssueKey = try? c.decodeIfPresent(String.self, forKey: .linearIssueKey)
        createdAt = try? c.decodeIfPresent(Double.self, forKey: .createdAt)
        completedAt = try? c.decodeIfPresent(Double.self, forKey: .completedAt)
        handoffSummary = try? c.decodeIfPresent(String.self, forKey: .handoffSummary)
        assignee = try? c.decodeIfPresent(String.self, forKey: .assignee)
        labels = try? c.decodeIfPresent([String].self, forKey: .labels)
        dueDate = try? c.decodeIfPresent(String.self, forKey: .dueDate)
    }
}

struct TasksResponse: Codable {
    let tasks: [ANCTask]
}

// MARK: - Project

struct ANCProject: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let color: String?
    let state: ProjectState?
    let createdAt: Double?

    enum CodingKeys: String, CodingKey {
        case id, name, description, color, state
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? "(unnamed)"
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        color = try? c.decodeIfPresent(String.self, forKey: .color)
        state = try? c.decodeIfPresent(ProjectState.self, forKey: .state)
        createdAt = try? c.decodeIfPresent(Double.self, forKey: .createdAt)
    }
}

struct ProjectsResponse: Codable {
    let projects: [ANCProject]
}

// MARK: - Agent

struct AgentStatus: Codable, Identifiable, Hashable {
    var id: String { role }
    let role: String
    let name: String
    let activeSessions: Int
    let idleSessions: Int
    let maxConcurrency: Int

    enum CodingKeys: String, CodingKey {
        case role, name
        case activeSessions = "active_sessions"
        case idleSessions = "idle_sessions"
        case maxConcurrency = "max_concurrency"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = try c.decode(String.self, forKey: .role)
        name = (try? c.decode(String.self, forKey: .name)) ?? role
        activeSessions = (try? c.decode(Int.self, forKey: .activeSessions)) ?? 0
        idleSessions = (try? c.decode(Int.self, forKey: .idleSessions)) ?? 0
        maxConcurrency = (try? c.decode(Int.self, forKey: .maxConcurrency)) ?? 1
    }
}

struct AgentsResponse: Codable {
    let agents: [AgentStatus]
}

// MARK: - Notification

struct ANCNotification: Codable, Identifiable, Hashable {
    let id: Int
    let kind: String
    let severity: String
    let title: String
    let body: String?
    let taskId: String?
    let readAt: Double?
    let createdAt: Double

    enum CodingKeys: String, CodingKey {
        case id, kind, severity, title, body
        case taskId = "task_id"
        case readAt = "read_at"
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "alert"
        severity = (try? c.decode(String.self, forKey: .severity)) ?? "info"
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        body = try? c.decodeIfPresent(String.self, forKey: .body)
        taskId = try? c.decodeIfPresent(String.self, forKey: .taskId)
        readAt = try? c.decodeIfPresent(Double.self, forKey: .readAt)
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
    }
}

struct NotificationsResponse: Codable {
    let notifications: [ANCNotification]
}

// MARK: - WS

struct WsMessage: Codable {
    let type: String
    let ts: Double?
}

// MARK: - Task Detail (Full)

struct TaskDetailResponse: Codable {
    let task: ANCTask
    let sessions: [SessionOnTask]
    let events: [TaskEvent]
    let comments: [TaskComment]
    let attachments: [TaskAttachment]
    let cost: TaskCost
    let children: [ANCTask]
    let handoff: TaskHandoff?
}

struct SessionOnTask: Codable, Identifiable, Hashable {
    var id: String { issueKey }
    let issueKey: String
    let state: String

    enum CodingKeys: String, CodingKey {
        case issueKey, state
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        issueKey = (try? c.decode(String.self, forKey: .issueKey)) ?? ""
        state = (try? c.decode(String.self, forKey: .state)) ?? "unknown"
    }
}

struct TaskEvent: Codable, Identifiable, Hashable {
    let id: Int
    let taskId: String
    let role: String?
    let type: String
    let payload: String?
    let createdAt: Double

    enum CodingKeys: String, CodingKey {
        case id, taskId, role, type, payload, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(Int.self, forKey: .id)) ?? 0
        taskId = (try? c.decode(String.self, forKey: .taskId)) ?? ""
        role = try? c.decodeIfPresent(String.self, forKey: .role)
        type = (try? c.decode(String.self, forKey: .type)) ?? ""
        payload = try? c.decodeIfPresent(String.self, forKey: .payload)
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
    }
}

struct TaskComment: Codable, Identifiable, Hashable {
    let id: String
    let taskId: String
    let author: String
    let body: String
    let createdAt: Double

    enum CodingKeys: String, CodingKey {
        case id, taskId, author, body, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        taskId = (try? c.decode(String.self, forKey: .taskId)) ?? ""
        author = (try? c.decode(String.self, forKey: .author)) ?? "unknown"
        body = (try? c.decode(String.self, forKey: .body)) ?? ""
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
    }
}

struct TaskAttachment: Codable, Identifiable, Hashable {
    var id: String { name }
    let name: String
    let size: Int
    let mtime: Double
    let kind: String

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? c.decode(String.self, forKey: .name)) ?? "unknown"
        size = (try? c.decode(Int.self, forKey: .size)) ?? 0
        mtime = (try? c.decode(Double.self, forKey: .mtime)) ?? 0
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "file"
    }

    enum CodingKeys: String, CodingKey {
        case name, size, mtime, kind
    }
}

struct TaskCost: Codable, Hashable {
    let totalUsd: Double
    let byAgent: [AgentCost]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        totalUsd = (try? c.decode(Double.self, forKey: .totalUsd)) ?? 0
        byAgent = (try? c.decode([AgentCost].self, forKey: .byAgent)) ?? []
    }

    enum CodingKeys: String, CodingKey {
        case totalUsd, byAgent
    }
}

struct AgentCost: Codable, Hashable {
    let role: String
    let usd: Double
    let tokens: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = (try? c.decode(String.self, forKey: .role)) ?? ""
        usd = (try? c.decode(Double.self, forKey: .usd)) ?? 0
        tokens = try? c.decodeIfPresent(Int.self, forKey: .tokens)
    }

    enum CodingKeys: String, CodingKey {
        case role, usd, tokens
    }
}

struct TaskHandoff: Codable, Hashable {
    let summary: String?
    let nextSteps: [String]?

    enum CodingKeys: String, CodingKey {
        case summary
        case nextSteps = "next_steps"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        nextSteps = try? c.decodeIfPresent([String].self, forKey: .nextSteps)
    }
}

// MARK: - Create / Patch payloads

struct CreateTaskPayload: Encodable {
    let title: String
    var description: String?
    var assignee: String?
    var priority: Int = 3
    var projectId: String?
    var source: String = "dashboard"

    enum CodingKeys: String, CodingKey {
        case title, description, assignee, priority, source
        case projectId = "project_id"
    }
}

struct PatchTaskPayload: Encodable {
    var title: String?
    var description: String?
    var state: String?
    var priority: Int?
    var assignee: String?
    var labels: [String]?
    var projectId: String?
    var dueDate: String?

    enum CodingKeys: String, CodingKey {
        case title, description, state, priority, assignee, labels
        case projectId = "project_id"
        case dueDate = "due_date"
    }
}

struct CreateCommentPayload: Encodable {
    let body: String
    let author: String
}

struct SingleTaskResponse: Codable {
    let task: ANCTask
}

struct DeleteResponse: Codable {
    let ok: Bool?
    let deleted: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try? c.decodeIfPresent(Bool.self, forKey: .ok)
        deleted = try? c.decodeIfPresent(Bool.self, forKey: .deleted)
    }

    enum CodingKeys: String, CodingKey {
        case ok, deleted
    }
}

// MARK: - Navigation

enum NavItem: String, Hashable, Identifiable, CaseIterable {
    case inbox, dashboard, tasks, projects, members, views, settings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .inbox: return "Inbox"
        case .dashboard: return "Dashboard"
        case .tasks: return "Tasks"
        case .projects: return "Projects"
        case .members: return "Members"
        case .views: return "Views"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .inbox: return "tray"
        case .dashboard: return "rectangle.grid.2x2"
        case .tasks: return "checklist"
        case .projects: return "folder"
        case .members: return "person.2"
        case .views: return "rectangle.stack"
        case .settings: return "gearshape"
        }
    }
}
