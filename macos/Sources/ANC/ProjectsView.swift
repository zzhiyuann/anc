import SwiftUI

// MARK: - Projects Table View

struct ProjectsView: View {
    @EnvironmentObject var store: AppStore
    @State private var searchText = ""
    @State private var sortOrder = [KeyPathComparator(\ProjectWithStats.name)]
    @State private var selectedProjectId: String? = nil
    @State private var showCreateProject = false

    private var filteredProjects: [ProjectWithStats] {
        let projects = store.projectsWithStats
        if searchText.isEmpty { return projects }
        let q = searchText.lowercased()
        return projects.filter {
            $0.name.lowercased().contains(q) ||
            ($0.description?.lowercased().contains(q) ?? false) ||
            ($0.lead?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack(spacing: 8) {
                Text("Projects")
                    .font(.system(size: 16, weight: .semibold))
                Text("\(filteredProjects.count)")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.ancMuted.opacity(0.15))
                    .clipShape(Capsule())
                Spacer()

                Button {
                    Task { await store.refreshProjectsWithStats() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12))
                }
                .buttonStyle(.borderless)
                .help("Refresh")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            Divider()

            if filteredProjects.isEmpty {
                emptyState
            } else {
                projectsList
            }
        }
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search projects...")
        .task {
            await store.refreshProjectsWithStats()
        }
        .onChange(of: selectedProjectId) { _, newVal in
            store.selectedProjectId = newVal
        }
    }

    private var projectsList: some View {
        List(selection: $selectedProjectId) {
            ForEach(filteredProjects) { project in
                ProjectRowView(project: project)
                    .tag(project.id)
            }
        }
        .listStyle(.inset(alternatesRowBackgrounds: true))
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "folder")
                .font(.system(size: 28))
                .foregroundColor(.ancMuted)
            Text("No projects")
                .font(.system(size: 14, weight: .medium))
            Text("Projects will appear here when created")
                .font(.system(size: 12))
                .foregroundColor(.ancMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Project Row

struct ProjectRowView: View {
    let project: ProjectWithStats

    var body: some View {
        HStack(spacing: 10) {
            // Color dot
            Circle()
                .fill(projectColor)
                .frame(width: 10, height: 10)

            // Name
            VStack(alignment: .leading, spacing: 1) {
                Text(project.name)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                if let desc = project.description, !desc.isEmpty {
                    Text(desc)
                        .font(.system(size: 11))
                        .foregroundColor(.ancMuted)
                        .lineLimit(1)
                }
            }
            .frame(minWidth: 120, alignment: .leading)

            Spacer()

            // Health pill
            if let health = project.health {
                healthPill(health)
            }

            // Priority
            if let p = project.priority {
                Text(priorityGlyph(p))
                    .font(.system(size: 12))
                    .frame(width: 20)
            }

            // Lead
            if let lead = project.lead {
                HStack(spacing: 3) {
                    Image(systemName: "person.circle")
                        .font(.system(size: 11))
                    Text(lead)
                        .font(.system(size: 11))
                }
                .foregroundColor(.ancMuted)
                .frame(minWidth: 60, alignment: .leading)
            }

            // Stats
            if let stats = project.stats {
                HStack(spacing: 4) {
                    statChip("\(stats.done)/\(stats.total)", color: .green)
                }
            }

            // State
            if let state = project.state {
                Text(state.rawValue.capitalized)
                    .font(.system(size: 11))
                    .foregroundColor(.ancMuted)
                    .frame(width: 60, alignment: .trailing)
            }
        }
        .padding(.vertical, 3)
    }

    private var projectColor: Color {
        if let hex = project.color {
            return Color(hex: hex)
        }
        return .ancAccent
    }

    private func healthPill(_ health: String) -> some View {
        Text(health.replacingOccurrences(of: "-", with: " ").capitalized)
            .font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(healthColor(health).opacity(0.15))
            .foregroundColor(healthColor(health))
            .clipShape(Capsule())
    }

    private func healthColor(_ health: String) -> Color {
        switch health {
        case "on-track": return .green
        case "at-risk": return .orange
        case "off-track": return .red
        default: return .gray
        }
    }

    private func statChip(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 10, design: .monospaced))
            .foregroundColor(color)
    }
}

// MARK: - Color hex extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: Double
        if hex.count == 6 {
            r = Double((int >> 16) & 0xFF) / 255.0
            g = Double((int >> 8) & 0xFF) / 255.0
            b = Double(int & 0xFF) / 255.0
        } else {
            r = 0; g = 0; b = 0
        }
        self.init(red: r, green: g, blue: b)
    }
}
