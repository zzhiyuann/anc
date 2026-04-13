import SwiftUI

struct ContentPane: View {
    @EnvironmentObject var store: AppStore
    let selection: NavItem

    var body: some View {
        Group {
            switch selection {
            case .tasks:
                TasksListView()
            case .inbox:
                placeholder("Inbox", subtitle: "\(store.notifications.count) notifications")
            case .dashboard:
                placeholder("Dashboard", subtitle: "Phase 2")
            case .projects:
                ProjectsListView()
            case .members:
                AgentsListView()
            case .views:
                placeholder("Views", subtitle: "Phase 2")
            case .settings:
                placeholder("Settings", subtitle: "Phase 2")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.ancBackground)
    }

    @ViewBuilder
    private func placeholder(_ title: String, subtitle: String) -> some View {
        VStack(spacing: 6) {
            Text(title).font(.system(size: 22, weight: .semibold))
            Text(subtitle).font(.system(size: 13)).foregroundColor(.ancMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Tasks

struct TasksListView: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Tasks")
                    .font(.system(size: 18, weight: .semibold))
                Text("\(store.tasks.count)")
                    .font(.system(size: 13))
                    .foregroundColor(.ancMuted)
                Spacer()
                Button {
                    Task { await store.refreshTasks() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 8)

            Divider()

            if !store.connected && store.tasks.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "wifi.slash")
                        .font(.system(size: 28))
                        .foregroundColor(.ancMuted)
                    Text("Disconnected from backend")
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                    if let err = store.lastError {
                        Text(err).font(.system(size: 11)).foregroundColor(.ancMuted).multilineTextAlignment(.center).padding(.horizontal, 24)
                    }
                    Button("Retry") { Task { await store.refreshAll() } }
                        .buttonStyle(.borderedProminent)
                        .padding(.top, 4)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.tasks.isEmpty {
                VStack(spacing: 6) {
                    Text("No tasks")
                        .font(.system(size: 14, weight: .medium))
                    Text("Tasks created in the dashboard will appear here.")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: $store.selectedTaskId) {
                    ForEach(store.tasks) { task in
                        TaskRowView(task: task)
                            .tag(task.id)
                    }
                }
                .listStyle(.inset)
            }
        }
    }
}

struct TaskRowView: View {
    let task: ANCTask

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(task.state.color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(task.state.displayName)
                        .font(.system(size: 11))
                        .foregroundColor(.ancMuted)
                    if let assignee = task.assignee {
                        Text("·").foregroundColor(.ancMuted)
                        Text(assignee).font(.system(size: 11)).foregroundColor(.ancMuted)
                    }
                }
            }
            Spacer()
            Text(task.id.prefix(8))
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.ancMuted)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Projects

struct ProjectsListView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Projects").font(.system(size: 18, weight: .semibold))
                Spacer()
            }
            .padding(16)
            Divider()
            List(store.projects) { p in
                HStack {
                    Circle().fill(Color.ancAccent).frame(width: 8, height: 8)
                    Text(p.name)
                    Spacer()
                    if let s = p.state { Text(s.rawValue).font(.system(size: 11)).foregroundColor(.ancMuted) }
                }
            }
            .listStyle(.inset)
        }
    }
}

// MARK: - Agents

struct AgentsListView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Members").font(.system(size: 18, weight: .semibold))
                Spacer()
            }
            .padding(16)
            Divider()
            List(store.agents) { a in
                HStack {
                    Image(systemName: "person.circle.fill").foregroundColor(.ancAccent)
                    VStack(alignment: .leading) {
                        Text(a.name).font(.system(size: 13, weight: .medium))
                        Text(a.role).font(.system(size: 11)).foregroundColor(.ancMuted)
                    }
                    Spacer()
                    Text("\(a.activeSessions)/\(a.maxConcurrency)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.ancMuted)
                }
            }
            .listStyle(.inset)
        }
    }
}
