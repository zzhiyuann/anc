import SwiftUI

struct ProjectDetailView: View {
    @EnvironmentObject var store: AppStore
    let projectId: String

    private var project: ProjectWithStats? {
        store.projectsWithStats.first { $0.id == projectId }
    }

    private var projectTasks: [ANCTask] {
        store.tasks.filter { $0.projectId == projectId }
    }

    private var groupedTasks: [(TaskEntityState, [ANCTask])] {
        let order: [TaskEntityState] = [.running, .todo, .review, .done, .failed, .canceled]
        let grouped = Dictionary(grouping: projectTasks) { $0.state }
        return order.compactMap { state in
            guard let tasks = grouped[state], !tasks.isEmpty else { return nil }
            return (state, tasks)
        }
    }

    var body: some View {
        Group {
            if let project {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        headerSection(project)
                        statsSection(project)
                        tasksSection
                        activeAgentsSection
                    }
                    .padding(20)
                }
            } else {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Loading project...")
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - Header

    private func headerSection(_ project: ProjectWithStats) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(hex: project.color ?? "#6b7280"))
                .frame(width: 32, height: 32)
                .overlay(
                    Text(project.icon ?? "")
                        .font(.system(size: 16))
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                    .font(.system(size: 20, weight: .bold))
                if let desc = project.description, !desc.isEmpty {
                    Text(desc)
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                }
            }

            Spacer()

            if let health = project.health {
                Text(health.replacingOccurrences(of: "-", with: " ").capitalized)
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(healthColor(health).opacity(0.15))
                    .foregroundColor(healthColor(health))
                    .clipShape(Capsule())
            }
        }
    }

    // MARK: - Stats

    private func statsSection(_ project: ProjectWithStats) -> some View {
        HStack(spacing: 16) {
            if let stats = project.stats {
                statCard("Todo", value: "\(stats.queued)", color: .gray)
                statCard("Running", value: "\(stats.running)", color: .blue)
                statCard("Done", value: "\(stats.done)", color: .green)
                statCard("Total", value: "\(stats.total)", color: .ancMuted)
                statCard("Cost", value: String(format: "$%.2f", stats.totalCostUsd), color: .orange)
            }

            if let target = project.targetDate {
                statCard("Target", value: target, color: .purple)
            }
        }
    }

    private func statCard(_ label: String, value: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 16, weight: .semibold, design: .monospaced))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.ancMuted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.ancSurface)
        .cornerRadius(8)
    }

    // MARK: - Tasks

    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tasks")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.ancMuted)

            if groupedTasks.isEmpty {
                Text("No tasks in this project")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
                    .padding(.vertical, 8)
            } else {
                ForEach(groupedTasks, id: \.0) { state, tasks in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Circle().fill(state.color).frame(width: 8, height: 8)
                            Text(state.displayName)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.ancMuted)
                            Text("\(tasks.count)")
                                .font(.system(size: 11))
                                .foregroundColor(.ancMuted)
                        }

                        ForEach(tasks) { task in
                            Button {
                                store.selectTask(task.id)
                            } label: {
                                HStack(spacing: 8) {
                                    Text(priorityGlyph(task.priority))
                                        .font(.system(size: 11))
                                    Text(task.title)
                                        .font(.system(size: 12))
                                        .lineLimit(1)
                                    Spacer()
                                    if let a = task.assignee {
                                        Text(a)
                                            .font(.system(size: 11))
                                            .foregroundColor(.ancMuted)
                                    }
                                }
                                .padding(.vertical, 3)
                                .padding(.horizontal, 8)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Active Agents

    private var activeAgentsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Active Agents")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.ancMuted)

            let taskAssignees = Set(projectTasks.compactMap { $0.assignee })
            let activeAgents = store.agents.filter { taskAssignees.contains($0.role) }

            if activeAgents.isEmpty {
                Text("No agents working on this project")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(activeAgents) { agent in
                    HStack(spacing: 8) {
                        Image(systemName: "person.circle.fill")
                            .foregroundColor(.ancAccent)
                        Text(agent.name)
                            .font(.system(size: 13, weight: .medium))
                        Spacer()
                        Text("\(agent.activeSessions) active")
                            .font(.system(size: 11))
                            .foregroundColor(.ancMuted)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func healthColor(_ health: String) -> Color {
        switch health {
        case "on-track": return .green
        case "at-risk": return .orange
        case "off-track": return .red
        default: return .gray
        }
    }
}
