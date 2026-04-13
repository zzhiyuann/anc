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

// MARK: - Project with Stats (from /projects)

struct ProjectWithStats: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let color: String?
    let icon: String?
    let state: ProjectState?
    let createdBy: String?
    let createdAt: Double?
    let health: String?
    let priority: Int?
    let lead: String?
    let targetDate: String?
    let stats: ProjectStats?

    enum CodingKeys: String, CodingKey {
        case id, name, description, color, icon, state
        case createdBy = "createdBy"
        case createdAt = "createdAt"
        case health, priority, lead
        case targetDate = "targetDate"
        case stats
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? "(unnamed)"
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        color = try? c.decodeIfPresent(String.self, forKey: .color)
        icon = try? c.decodeIfPresent(String.self, forKey: .icon)
        state = try? c.decodeIfPresent(ProjectState.self, forKey: .state)
        createdBy = try? c.decodeIfPresent(String.self, forKey: .createdBy)
        createdAt = try? c.decodeIfPresent(Double.self, forKey: .createdAt)
        health = try? c.decodeIfPresent(String.self, forKey: .health)
        priority = try? c.decodeIfPresent(Int.self, forKey: .priority)
        lead = try? c.decodeIfPresent(String.self, forKey: .lead)
        targetDate = try? c.decodeIfPresent(String.self, forKey: .targetDate)
        stats = try? c.decodeIfPresent(ProjectStats.self, forKey: .stats)
    }
}

struct ProjectStats: Codable, Hashable {
    let total: Int
    let running: Int
    let queued: Int
    let done: Int
    let totalCostUsd: Double

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = (try? c.decode(Int.self, forKey: .total)) ?? 0
        running = (try? c.decode(Int.self, forKey: .running)) ?? 0
        queued = (try? c.decode(Int.self, forKey: .queued)) ?? 0
        done = (try? c.decode(Int.self, forKey: .done)) ?? 0
        totalCostUsd = (try? c.decode(Double.self, forKey: .totalCostUsd)) ?? 0
    }

    enum CodingKeys: String, CodingKey {
        case total, running, queued, done, totalCostUsd
    }
}

struct ProjectsWithStatsResponse: Codable {
    let projects: [ProjectWithStats]
}

// MARK: - Agent Detail (from /agents/:role)

struct AgentDetail: Codable, Identifiable, Hashable {
    var id: String { role }
    let name: String
    let role: String
    let model: String?
    let maxConcurrency: Int
    let activeSessions: Int
    let idleSessions: Int
    let suspendedSessions: Int
    let sessions: [AgentSession]
    let memoryCount: Int?

    enum CodingKeys: String, CodingKey {
        case name, role, model
        case maxConcurrency = "maxConcurrency"
        case activeSessions = "activeSessions"
        case idleSessions = "idleSessions"
        case suspendedSessions = "suspendedSessions"
        case sessions
        case memoryCount = "memoryCount"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        role = (try? c.decode(String.self, forKey: .role)) ?? ""
        model = try? c.decodeIfPresent(String.self, forKey: .model)
        maxConcurrency = (try? c.decode(Int.self, forKey: .maxConcurrency)) ?? 1
        activeSessions = (try? c.decode(Int.self, forKey: .activeSessions)) ?? 0
        idleSessions = (try? c.decode(Int.self, forKey: .idleSessions)) ?? 0
        suspendedSessions = (try? c.decode(Int.self, forKey: .suspendedSessions)) ?? 0
        sessions = (try? c.decode([AgentSession].self, forKey: .sessions)) ?? []
        memoryCount = try? c.decodeIfPresent(Int.self, forKey: .memoryCount)
    }
}

struct AgentSession: Codable, Identifiable, Hashable {
    var id: String { issueKey }
    let issueKey: String
    let state: String
    let uptime: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        issueKey = (try? c.decode(String.self, forKey: .issueKey)) ?? ""
        state = (try? c.decode(String.self, forKey: .state)) ?? "unknown"
        uptime = try? c.decodeIfPresent(Int.self, forKey: .uptime)
    }

    enum CodingKeys: String, CodingKey {
        case issueKey, state, uptime
    }
}

// MARK: - Agent Output

struct AgentOutputResponse: Codable {
    let outputs: [AgentOutput]
}

struct AgentOutput: Codable, Identifiable, Hashable {
    var id: String { issueKey }
    let issueKey: String
    let tmuxSession: String?
    let output: String

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        issueKey = (try? c.decode(String.self, forKey: .issueKey)) ?? ""
        tmuxSession = try? c.decodeIfPresent(String.self, forKey: .tmuxSession)
        output = (try? c.decode(String.self, forKey: .output)) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case issueKey, tmuxSession, output
    }
}

// MARK: - Agent Memory

struct AgentMemoryListResponse: Codable {
    let role: String
    let files: [String]
}

struct AgentMemoryFileResponse: Codable {
    let filename: String
    let body: String
    let mtime: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        filename = (try? c.decode(String.self, forKey: .filename)) ?? ""
        body = (try? c.decode(String.self, forKey: .body)) ?? ""
        mtime = try? c.decodeIfPresent(Double.self, forKey: .mtime)
    }

    enum CodingKeys: String, CodingKey {
        case filename, body, mtime
    }
}

// MARK: - Persona

struct PersonaResponse: Codable {
    let role: String
    let body: String

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = (try? c.decode(String.self, forKey: .role)) ?? ""
        body = (try? c.decode(String.self, forKey: .body)) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case role, body
    }
}

// MARK: - Pulse

struct DailyBriefing: Codable {
    let generatedAt: Double?
    let yesterdayCompletions: [String]
    let todayQueue: [String]
    let costBurn: CostBurn?
    let wins: [String]
    let risks: [String]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try? c.decodeIfPresent(Double.self, forKey: .generatedAt)
        yesterdayCompletions = (try? c.decode([String].self, forKey: .yesterdayCompletions)) ?? []
        todayQueue = (try? c.decode([String].self, forKey: .todayQueue)) ?? []
        costBurn = try? c.decodeIfPresent(CostBurn.self, forKey: .costBurn)
        wins = (try? c.decode([String].self, forKey: .wins)) ?? []
        risks = (try? c.decode([String].self, forKey: .risks)) ?? []
    }

    enum CodingKeys: String, CodingKey {
        case generatedAt, yesterdayCompletions, todayQueue, costBurn, wins, risks
    }
}

struct CostBurn: Codable, Hashable {
    let spentUsd: Double
    let budgetUsd: Double

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        spentUsd = (try? c.decode(Double.self, forKey: .spentUsd)) ?? 0
        budgetUsd = (try? c.decode(Double.self, forKey: .budgetUsd)) ?? 0
    }

    enum CodingKeys: String, CodingKey {
        case spentUsd, budgetUsd
    }
}

// MARK: - Objectives / OKRs

struct ObjectivesResponse: Codable {
    let objectives: [Objective]
}

struct Objective: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let description: String?
    let quarter: String?
    let createdAt: Double?
    let keyResults: [KeyResult]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        quarter = try? c.decodeIfPresent(String.self, forKey: .quarter)
        createdAt = try? c.decodeIfPresent(Double.self, forKey: .createdAt)
        keyResults = (try? c.decode([KeyResult].self, forKey: .keyResults)) ?? []
    }

    enum CodingKeys: String, CodingKey {
        case id, title, description, quarter, createdAt, keyResults
    }
}

struct KeyResult: Codable, Identifiable, Hashable {
    let id: String
    let objectiveId: String?
    let title: String
    let metric: String?
    let target: Double
    let current: Double
    let createdAt: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        objectiveId = try? c.decodeIfPresent(String.self, forKey: .objectiveId)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        metric = try? c.decodeIfPresent(String.self, forKey: .metric)
        target = (try? c.decode(Double.self, forKey: .target)) ?? 0
        current = (try? c.decode(Double.self, forKey: .current)) ?? 0
        createdAt = try? c.decodeIfPresent(Double.self, forKey: .createdAt)
    }

    enum CodingKeys: String, CodingKey {
        case id, objectiveId, title, metric, target, current, createdAt
    }
}

// MARK: - Decisions

struct DecisionsResponse: Codable {
    let decisions: [Decision]
}

struct Decision: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let rationale: String?
    let decidedBy: String?
    let tags: [String]
    let createdAt: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        rationale = try? c.decodeIfPresent(String.self, forKey: .rationale)
        decidedBy = try? c.decodeIfPresent(String.self, forKey: .decidedBy)
        tags = (try? c.decode([String].self, forKey: .tags)) ?? []
        createdAt = try? c.decodeIfPresent(Double.self, forKey: .createdAt)
    }

    enum CodingKeys: String, CodingKey {
        case id, title, rationale, decidedBy, tags, createdAt
    }
}

// MARK: - Budget Config

struct BudgetConfigResponse: Codable {
    let config: BudgetConfig
    let disabled: Bool?
    let summary: BudgetSummary?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        config = (try? c.decode(BudgetConfig.self, forKey: .config)) ?? BudgetConfig(daily: nil, agents: [:])
        disabled = try? c.decodeIfPresent(Bool.self, forKey: .disabled)
        summary = try? c.decodeIfPresent(BudgetSummary.self, forKey: .summary)
    }

    enum CodingKeys: String, CodingKey {
        case config, disabled, summary
    }
}

struct BudgetConfig: Codable, Hashable {
    let daily: BudgetLimit?
    let agents: [String: BudgetLimit]

    init(daily: BudgetLimit?, agents: [String: BudgetLimit]) {
        self.daily = daily
        self.agents = agents
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        daily = try? c.decodeIfPresent(BudgetLimit.self, forKey: .daily)
        agents = (try? c.decode([String: BudgetLimit].self, forKey: .agents)) ?? [:]
    }

    enum CodingKeys: String, CodingKey {
        case daily, agents
    }
}

struct BudgetLimit: Codable, Hashable {
    let limit: Double
    let alertAt: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        limit = (try? c.decode(Double.self, forKey: .limit)) ?? 0
        alertAt = try? c.decodeIfPresent(Double.self, forKey: .alertAt)
    }

    enum CodingKeys: String, CodingKey {
        case limit, alertAt
    }
}

struct BudgetSummary: Codable, Hashable {
    let today: BudgetSpent?
    let perAgent: [String: BudgetSpent]?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        today = try? c.decodeIfPresent(BudgetSpent.self, forKey: .today)
        perAgent = try? c.decodeIfPresent([String: BudgetSpent].self, forKey: .perAgent)
    }

    enum CodingKeys: String, CodingKey {
        case today, perAgent
    }
}

struct BudgetSpent: Codable, Hashable {
    let spent: Double
    let limit: Double

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        spent = (try? c.decode(Double.self, forKey: .spent)) ?? 0
        limit = (try? c.decode(Double.self, forKey: .limit)) ?? 0
    }

    enum CodingKeys: String, CodingKey {
        case spent, limit
    }
}

// MARK: - Budget Series

struct BudgetSeriesResponse: Codable {
    let role: String?
    let days: [BudgetDay]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = try? c.decodeIfPresent(String.self, forKey: .role)
        days = (try? c.decode([BudgetDay].self, forKey: .days)) ?? []
    }

    enum CodingKeys: String, CodingKey {
        case role, days
    }
}

struct BudgetDay: Codable, Identifiable, Hashable {
    var id: String { date }
    let date: String
    let usd: Double
    let tokens: Int

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = (try? c.decode(String.self, forKey: .date)) ?? ""
        usd = (try? c.decode(Double.self, forKey: .usd)) ?? 0
        tokens = (try? c.decode(Int.self, forKey: .tokens)) ?? 0
    }

    enum CodingKeys: String, CodingKey {
        case date, usd, tokens
    }
}

// MARK: - Review Config

struct ReviewConfigResponse: Codable {
    let config: ReviewConfig
    let resolvedDefault: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        config = (try? c.decode(ReviewConfig.self, forKey: .config)) ?? ReviewConfig(defaultPolicy: "normal", roles: [:])
        resolvedDefault = try? c.decodeIfPresent(String.self, forKey: .resolvedDefault)
    }

    enum CodingKeys: String, CodingKey {
        case config, resolvedDefault
    }
}

struct ReviewConfig: Codable, Hashable {
    let defaultPolicy: String
    let roles: [String: String]

    init(defaultPolicy: String, roles: [String: String]) {
        self.defaultPolicy = defaultPolicy
        self.roles = roles
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        defaultPolicy = (try? c.decode(String.self, forKey: .defaultPolicy)) ?? "normal"
        roles = (try? c.decode([String: String].self, forKey: .roles)) ?? [:]
    }

    enum CodingKeys: String, CodingKey {
        case defaultPolicy = "default"
        case roles
    }
}

// MARK: - Events

struct EventsResponse: Codable {
    let events: [SystemEvent]
}

struct SystemEvent: Codable, Identifiable, Hashable {
    let id: Int
    let eventType: String
    let role: String?
    let issueKey: String?
    let detail: String?
    let createdAt: String

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(Int.self, forKey: .id)) ?? 0
        eventType = (try? c.decode(String.self, forKey: .eventType)) ?? ""
        role = try? c.decodeIfPresent(String.self, forKey: .role)
        issueKey = try? c.decodeIfPresent(String.self, forKey: .issueKey)
        detail = try? c.decodeIfPresent(String.self, forKey: .detail)
        createdAt = (try? c.decode(String.self, forKey: .createdAt)) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id, eventType, role, issueKey, detail, createdAt
    }
}

// MARK: - Kill Switch

struct KillSwitchStatusResponse: Codable {
    let paused: Bool?
    let since: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        paused = try? c.decodeIfPresent(Bool.self, forKey: .paused)
        since = try? c.decodeIfPresent(Double.self, forKey: .since)
    }

    enum CodingKeys: String, CodingKey {
        case paused, since
    }
}

struct KillSwitchResponse: Codable {
    let ok: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try? c.decodeIfPresent(Bool.self, forKey: .ok)
    }

    enum CodingKeys: String, CodingKey {
        case ok
    }
}

// MARK: - Generic OK

struct OkResponse: Codable {
    let ok: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try? c.decodeIfPresent(Bool.self, forKey: .ok)
    }

    enum CodingKeys: String, CodingKey {
        case ok
    }
}

// MARK: - Create Payloads (Pulse)

struct CreateDecisionPayload: Encodable {
    let title: String
    let rationale: String?
    let decidedBy: String
    let tags: [String]
}

struct CreateObjectivePayload: Encodable {
    let title: String
    let description: String?
    let quarter: String?
}

struct PatchBudgetPayload: Encodable {
    let daily: PatchBudgetLimit?
    let agents: [String: PatchBudgetLimit]?
}

struct PatchBudgetLimit: Encodable {
    let limit: Double?
    let alertAt: Double?
}

struct PatchReviewPayload: Encodable {
    let roles: [String: String]?
}

// MARK: - Dispatch Payload

struct DispatchPayload: Encodable {
    let role: String
    let taskId: String?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case role
        case taskId = "task_id"
        case message
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
