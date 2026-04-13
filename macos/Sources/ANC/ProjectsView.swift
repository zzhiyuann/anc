import SwiftUI

enum ProjectSortColumn: String {
    case name, health, priority, lead, targetDate, tasks, status
}

// MARK: - Projects Table View

struct ProjectsView: View {
    @EnvironmentObject var store: AppStore
    @State private var searchText = ""
    @State private var sortOrder = [KeyPathComparator(\ProjectWithStats.name)]
    @State private var selectedProjectId: String? = nil
    @State private var showCreateProject = false
    @State private var sortColumn: ProjectSortColumn = .name
    @State private var sortAscending = true

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

    private var sortedProjects: [ProjectWithStats] {
        let projects = filteredProjects
        let sorted: [ProjectWithStats]
        switch sortColumn {
        case .name:
            sorted = projects.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .health:
            sorted = projects.sorted { ($0.health ?? "") < ($1.health ?? "") }
        case .priority:
            sorted = projects.sorted { ($0.priority ?? 99) < ($1.priority ?? 99) }
        case .lead:
            sorted = projects.sorted { ($0.lead ?? "") < ($1.lead ?? "") }
        case .targetDate:
            sorted = projects.sorted { ($0.targetDate ?? "") < ($1.targetDate ?? "") }
        case .tasks:
            sorted = projects.sorted { ($0.stats?.total ?? 0) < ($1.stats?.total ?? 0) }
        case .status:
            sorted = projects.sorted { ($0.state?.rawValue ?? "") < ($1.state?.rawValue ?? "") }
        }
        return sortAscending ? sorted : sorted.reversed()
    }

    private func toggleSort(_ column: ProjectSortColumn) {
        if sortColumn == column {
            sortAscending.toggle()
        } else {
            sortColumn = column
            sortAscending = true
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
                    showCreateProject = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 11))
                        Text("New Project")
                            .font(.system(size: 12))
                    }
                }
                .buttonStyle(.borderless)
                .help("Create new project")

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
                projectsTable
            }
        }
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search projects...")
        .task {
            await store.refreshProjectsWithStats()
        }
        .onChange(of: selectedProjectId) { _, newVal in
            store.selectedProjectId = newVal
        }
        .sheet(isPresented: $showCreateProject) {
            CreateProjectSheet()
                .environmentObject(store)
        }
    }

    private var projectsTable: some View {
        VStack(spacing: 0) {
            // Column headers
            HStack(spacing: 0) {
                sortableHeader("Name", column: .name, minWidth: 140)
                sortableHeader("Health", column: .health, minWidth: 70)
                sortableHeader("Priority", column: .priority, minWidth: 60)
                sortableHeader("Lead", column: .lead, minWidth: 80)
                sortableHeader("Target", column: .targetDate, minWidth: 80)
                sortableHeader("Tasks", column: .tasks, minWidth: 60)
                sortableHeader("Status", column: .status, minWidth: 60)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(Color.ancSurface)

            Divider()

            List(selection: $selectedProjectId) {
                ForEach(sortedProjects) { project in
                    ProjectRowView(project: project)
                        .tag(project.id)
                }
            }
            .listStyle(.inset(alternatesRowBackgrounds: true))
        }
    }

    private func sortableHeader(_ title: String, column: ProjectSortColumn, minWidth: CGFloat) -> some View {
        Button {
            toggleSort(column)
        } label: {
            HStack(spacing: 3) {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.ancMuted)
                if sortColumn == column {
                    Image(systemName: sortAscending ? "chevron.up" : "chevron.down")
                        .font(.system(size: 8))
                        .foregroundColor(.ancAccent)
                }
            }
            .frame(minWidth: minWidth, alignment: .leading)
        }
        .buttonStyle(.plain)
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

// MARK: - Create Project Sheet

struct CreateProjectSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var color = "#3B82F6"
    @State private var priority = 3

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("New Project")
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundColor(.ancMuted)
                }
                .buttonStyle(.borderless)
            }
            .padding(16)

            Divider()

            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Name").font(.system(size: 12, weight: .medium)).foregroundColor(.ancMuted)
                    TextField("Project name", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 13))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Description").font(.system(size: 12, weight: .medium)).foregroundColor(.ancMuted)
                    TextField("Optional description", text: $description)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 13))
                }

                HStack {
                    Text("Priority").font(.system(size: 12, weight: .medium)).foregroundColor(.ancMuted).frame(width: 70, alignment: .leading)
                    Picker("", selection: $priority) {
                        ForEach(TaskPriority.allCases, id: \.self) { p in
                            Text("\(priorityGlyph(p.rawValue)) \(p.displayName)").tag(p.rawValue)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }
            }
            .padding(16)

            Spacer()
            Divider()

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Create") {
                    Task {
                        await store.createProject(
                            name: name.trimmingCharacters(in: .whitespaces),
                            description: description.isEmpty ? nil : description,
                            color: color,
                            priority: priority
                        )
                        dismiss()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
            .padding(16)
        }
        .frame(width: 420, height: 340)
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
