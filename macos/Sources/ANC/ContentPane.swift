import SwiftUI

struct ContentPane: View {
    @EnvironmentObject var store: AppStore
    let selection: NavItem

    var body: some View {
        Group {
            switch selection {
            case .tasks:
                TaskListView()
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
