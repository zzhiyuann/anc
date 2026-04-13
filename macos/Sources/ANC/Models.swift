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
