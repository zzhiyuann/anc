import SwiftUI

struct SearchSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var focused: Bool

    private var results: [SearchResult] {
        guard !query.isEmpty else { return [] }
        let q = query.lowercased()
        var items: [SearchResult] = []

        // Tasks
        for task in store.tasks where task.title.lowercased().contains(q)
            || (task.description?.lowercased().contains(q) ?? false)
            || task.id.lowercased().contains(q) {
            items.append(SearchResult(
                id: "task-\(task.id)",
                icon: "checklist",
                title: task.title,
                subtitle: task.state.displayName,
                kind: .task(task.id)
            ))
        }

        // Projects
        for project in store.projects where project.name.lowercased().contains(q)
            || (project.description?.lowercased().contains(q) ?? false) {
            items.append(SearchResult(
                id: "project-\(project.id)",
                icon: "folder",
                title: project.name,
                subtitle: project.description ?? "",
                kind: .project(project.id)
            ))
        }

        // Agents
        for agent in store.agents where agent.role.lowercased().contains(q)
            || agent.name.lowercased().contains(q) {
            items.append(SearchResult(
                id: "agent-\(agent.role)",
                icon: "person.circle",
                title: agent.name,
                subtitle: agent.role,
                kind: .agent(agent.role)
            ))
        }

        // Navigation items
        for nav in NavItem.allCases where nav.title.lowercased().contains(q) {
            items.append(SearchResult(
                id: "nav-\(nav.rawValue)",
                icon: nav.systemImage,
                title: nav.title,
                subtitle: "Navigate",
                kind: .nav(nav)
            ))
        }

        return Array(items.prefix(20))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Search field
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 16))
                    .foregroundColor(.ancMuted)
                TextField("Search tasks, projects, agents...", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 16))
                    .focused($focused)
                    .onSubmit { selectFirst() }

                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.ancMuted)
                    }
                    .buttonStyle(.borderless)
                }

                Button("Esc") {
                    dismiss()
                }
                .buttonStyle(.borderless)
                .font(.system(size: 11))
                .foregroundColor(.ancMuted)
                .keyboardShortcut(.escape, modifiers: [])
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            // Results
            if query.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 24))
                        .foregroundColor(.ancMuted)
                    Text("Type to search everywhere")
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if results.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "questionmark.circle")
                        .font(.system(size: 24))
                        .foregroundColor(.ancMuted)
                    Text("No results for \"\(query)\"")
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(results) { result in
                        Button {
                            select(result)
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: result.icon)
                                    .font(.system(size: 14))
                                    .foregroundColor(.ancAccent)
                                    .frame(width: 20)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(result.title)
                                        .font(.system(size: 13, weight: .medium))
                                        .lineLimit(1)
                                    Text(result.subtitle)
                                        .font(.system(size: 11))
                                        .foregroundColor(.ancMuted)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Text(result.kindLabel)
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundColor(.ancMuted)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.ancMuted.opacity(0.12))
                                    .clipShape(Capsule())
                            }
                            .padding(.vertical, 4)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .listStyle(.plain)
            }
        }
        .frame(width: 540, height: 400)
        .background(Color.ancBackground)
        .onAppear { focused = true }
    }

    private func selectFirst() {
        if let first = results.first {
            select(first)
        }
    }

    private func select(_ result: SearchResult) {
        switch result.kind {
        case .task(let id):
            store.selectTask(id)
            store.searchNavigateTo = .tasks
        case .project(let id):
            store.selectedProjectId = id
            store.searchNavigateTo = .projects
        case .agent(let role):
            store.selectedAgentRole = role
            store.searchNavigateTo = .members
        case .nav(let item):
            store.searchNavigateTo = item
        }
        dismiss()
    }
}

// MARK: - SearchResult model

struct SearchResult: Identifiable {
    let id: String
    let icon: String
    let title: String
    let subtitle: String
    let kind: SearchResultKind

    var kindLabel: String {
        switch kind {
        case .task: return "Task"
        case .project: return "Project"
        case .agent: return "Agent"
        case .nav: return "Nav"
        }
    }
}

enum SearchResultKind {
    case task(String)
    case project(String)
    case agent(String)
    case nav(NavItem)
}
