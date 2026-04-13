import SwiftUI

struct InspectorPane: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        Group {
            if let projectId = store.selectedProjectId,
               let project = store.projectsWithStats.first(where: { $0.id == projectId }) {
                projectInspector(project)
            } else if let role = store.selectedAgentRole,
                      let agent = store.agents.first(where: { $0.role == role }) {
                agentInspector(agent)
            } else if let notifId = store.selectedNotificationId,
                      let notif = store.notifications.first(where: { $0.id == notifId }) {
                notificationInspector(notif)
            } else {
                VStack(spacing: 4) {
                    Image(systemName: "sidebar.right")
                        .font(.system(size: 24))
                        .foregroundColor(.ancMuted)
                    Text("Select an item")
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.ancBackground)
    }

    // MARK: - Project Inspector

    private func projectInspector(_ project: ProjectWithStats) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(project.name)
                    .font(.system(size: 16, weight: .semibold))
                if let desc = project.description, !desc.isEmpty {
                    Text(desc)
                        .font(.system(size: 12))
                        .foregroundColor(.ancForeground)
                }
                Divider()
                InspectorLabelRow("ID", project.id)
                if let health = project.health {
                    InspectorLabelRow("Health", health.replacingOccurrences(of: "-", with: " ").capitalized)
                }
                if let state = project.state {
                    InspectorLabelRow("State", state.rawValue.capitalized)
                }
                if let lead = project.lead {
                    InspectorLabelRow("Lead", lead)
                }
                if let priority = project.priority {
                    InspectorLabelRow("Priority", "\(priorityGlyph(priority)) \(TaskPriority(rawValue: priority)?.displayName ?? "")")
                }
                if let target = project.targetDate {
                    InspectorLabelRow("Target", target)
                }
                if let stats = project.stats {
                    Divider()
                    Text("Stats")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.ancMuted)
                    InspectorLabelRow("Total", "\(stats.total)")
                    InspectorLabelRow("Running", "\(stats.running)")
                    InspectorLabelRow("Done", "\(stats.done)")
                    InspectorLabelRow("Cost", String(format: "$%.2f", stats.totalCostUsd))
                }
                Spacer()
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - Agent Inspector

    private func agentInspector(_ agent: AgentStatus) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(.ancAccent)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(agent.name)
                            .font(.system(size: 16, weight: .semibold))
                        Text("@\(agent.role)")
                            .font(.system(size: 12))
                            .foregroundColor(.ancMuted)
                    }
                }
                Divider()
                InspectorLabelRow("Active", "\(agent.activeSessions)")
                InspectorLabelRow("Idle", "\(agent.idleSessions)")
                InspectorLabelRow("Max", "\(agent.maxConcurrency)")

                // Tasks assigned to this agent
                let agentTasks = store.tasks.filter { $0.assignee == agent.role }
                if !agentTasks.isEmpty {
                    Divider()
                    Text("Assigned Tasks")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.ancMuted)
                    ForEach(agentTasks.prefix(8)) { task in
                        HStack(spacing: 6) {
                            Circle().fill(task.state.color).frame(width: 6, height: 6)
                            Text(task.title)
                                .font(.system(size: 11))
                                .lineLimit(1)
                        }
                    }
                }
                Spacer()
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - Notification Inspector

    private func notificationInspector(_ notif: ANCNotification) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(notif.title)
                    .font(.system(size: 16, weight: .semibold))
                Divider()
                InspectorLabelRow("Kind", notif.kind.capitalized)
                InspectorLabelRow("Severity", notif.severity.capitalized)
                if let body = notif.body, !body.isEmpty {
                    Divider()
                    Text(body)
                        .font(.system(size: 12))
                        .foregroundColor(.ancForeground)
                        .textSelection(.enabled)
                }
                Spacer()
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct InspectorLabelRow: View {
    let label: String
    let value: String
    init(_ label: String, _ value: String) { self.label = label; self.value = value }
    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.ancMuted)
                .frame(width: 70, alignment: .leading)
            Text(value)
                .font(.system(size: 12))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
        }
    }
}
