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
    @State private var showEditProject = false
    @State private var showDeleteConfirm = false
    @State private var editingProject: ProjectWithStats? = nil
    @State private var projectToDelete: ProjectWithStats? = nil
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
                    .font(.inter(16, weight: .semibold))
                Text("\(filteredProjects.count)")
                    .font(.inter(12))
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
                            .font(.inter(11))
                        Text("New Project")
                            .font(.inter(12))
                    }
                }
                .buttonStyle(.borderless)
                .help("Create new project")

                Button {
                    Task { await store.refreshProjectsWithStats() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.inter(12))
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
        .sheet(isPresented: $showEditProject) {
            if let project = editingProject {
                EditProjectSheet(project: project)
                    .environmentObject(store)
            }
        }
        .alert("Delete Project?", isPresented: $showDeleteConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                if let project = projectToDelete {
                    Task {
                        await store.deleteProject(id: project.id)
                        if selectedProjectId == project.id { selectedProjectId = nil }
                    }
                }
            }
        } message: {
            Text("This will permanently delete \"\(projectToDelete?.name ?? "")\". This action cannot be undone.")
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
                        .contextMenu {
                            Button("Edit") {
                                editingProject = project
                                showEditProject = true
                            }
                            Divider()
                            Button("Archive") {
                                Task { await store.updateProject(id: project.id, patch: PatchProjectPayload(state: "archived")) }
                            }
                            Button("Delete", role: .destructive) {
                                projectToDelete = project
                                showDeleteConfirm = true
                            }
                        }
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
                    .font(.inter(11, weight: .semibold))
                    .foregroundColor(.ancMuted)
                if sortColumn == column {
                    Image(systemName: sortAscending ? "chevron.up" : "chevron.down")
                        .font(.inter(8))
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
                .font(.inter(28))
                .foregroundColor(.ancMuted)
            Text("No projects")
                .font(.inter(14, weight: .medium))
            Text("Projects will appear here when created")
                .font(.inter(12))
                .foregroundColor(.ancMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Project Row

struct ProjectRowView: View {
    let project: ProjectWithStats

    var body: some View {
        HStack(spacing: 0) {
            // Name (with color dot)
            HStack(spacing: 8) {
                Circle()
                    .fill(projectColor)
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 1) {
                    Text(project.name)
                        .font(.inter(13, weight: .medium))
                        .lineLimit(1)
                    if let desc = project.description, !desc.isEmpty {
                        Text(desc)
                            .font(.inter(11))
                            .foregroundColor(.ancMuted)
                            .lineLimit(1)
                    }
                }
            }
            .frame(minWidth: 140, alignment: .leading)

            // Health
            Group {
                if let health = project.health {
                    healthPill(health)
                } else {
                    Text("--")
                        .font(.inter(10))
                        .foregroundColor(.ancMuted.opacity(0.5))
                }
            }
            .frame(minWidth: 70, alignment: .leading)

            // Priority
            Group {
                if let p = project.priority {
                    Text(priorityGlyph(p))
                        .font(.inter(12))
                } else {
                    Text("--")
                        .font(.inter(10))
                        .foregroundColor(.ancMuted.opacity(0.5))
                }
            }
            .frame(minWidth: 60, alignment: .leading)

            // Lead
            Group {
                if let lead = project.lead {
                    HStack(spacing: 3) {
                        Image(systemName: "person.circle")
                            .font(.inter(11))
                        Text(lead)
                            .font(.inter(11))
                    }
                    .foregroundColor(.ancMuted)
                } else {
                    Text("--")
                        .font(.inter(10))
                        .foregroundColor(.ancMuted.opacity(0.5))
                }
            }
            .frame(minWidth: 80, alignment: .leading)

            // Target Date
            Group {
                if let target = project.targetDate {
                    Text(target)
                        .font(.inter(11))
                        .foregroundColor(.ancMuted)
                } else {
                    Text("--")
                        .font(.inter(10))
                        .foregroundColor(.ancMuted.opacity(0.5))
                }
            }
            .frame(minWidth: 80, alignment: .leading)

            // Tasks
            Group {
                if let stats = project.stats {
                    statChip("\(stats.done)/\(stats.total)", color: .green)
                } else {
                    Text("--")
                        .font(.inter(10))
                        .foregroundColor(.ancMuted.opacity(0.5))
                }
            }
            .frame(minWidth: 60, alignment: .leading)

            // Status
            Group {
                if let state = project.state {
                    Text(state.rawValue.capitalized)
                        .font(.inter(11))
                        .foregroundColor(.ancMuted)
                } else {
                    Text("--")
                        .font(.inter(10))
                        .foregroundColor(.ancMuted.opacity(0.5))
                }
            }
            .frame(minWidth: 60, alignment: .leading)
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
            .font(.inter(10, weight: .medium))
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
    @State private var pickerColor = Color(hex: "#3B82F6")
    @State private var priority = 3

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("New Project")
                    .font(.inter(16, weight: .semibold))
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.inter(16))
                        .foregroundColor(.ancMuted)
                }
                .buttonStyle(.borderless)
            }
            .padding(16)

            Divider()

            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Name").font(.inter(12, weight: .medium)).foregroundColor(.ancMuted)
                    TextField("Project name", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .font(.inter(13))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Description").font(.inter(12, weight: .medium)).foregroundColor(.ancMuted)
                    TextField("Optional description", text: $description)
                        .textFieldStyle(.roundedBorder)
                        .font(.inter(13))
                }

                HStack {
                    Text("Color").font(.inter(12, weight: .medium)).foregroundColor(.ancMuted).frame(width: 70, alignment: .leading)
                    ColorPicker("", selection: $pickerColor, supportsOpacity: false)
                        .labelsHidden()
                }

                HStack {
                    Text("Priority").font(.inter(12, weight: .medium)).foregroundColor(.ancMuted).frame(width: 70, alignment: .leading)
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
                            color: pickerColor.toHex(),
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
        .frame(width: 420, height: 380)
    }
}

// MARK: - Edit Project Sheet

struct EditProjectSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let project: ProjectWithStats

    @State private var name = ""
    @State private var description = ""
    @State private var pickerColor = Color(hex: "#3B82F6")
    @State private var priority = 3
    @State private var state = "active"

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Edit Project")
                    .font(.inter(16, weight: .semibold))
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.inter(16))
                        .foregroundColor(.ancMuted)
                }
                .buttonStyle(.borderless)
            }
            .padding(16)

            Divider()

            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Name").font(.inter(12, weight: .medium)).foregroundColor(.ancMuted)
                    TextField("Project name", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .font(.inter(13))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Description").font(.inter(12, weight: .medium)).foregroundColor(.ancMuted)
                    TextField("Optional description", text: $description)
                        .textFieldStyle(.roundedBorder)
                        .font(.inter(13))
                }

                HStack {
                    Text("Color").font(.inter(12, weight: .medium)).foregroundColor(.ancMuted).frame(width: 70, alignment: .leading)
                    ColorPicker("", selection: $pickerColor, supportsOpacity: false)
                        .labelsHidden()
                }

                HStack {
                    Text("Priority").font(.inter(12, weight: .medium)).foregroundColor(.ancMuted).frame(width: 70, alignment: .leading)
                    Picker("", selection: $priority) {
                        ForEach(TaskPriority.allCases, id: \.self) { p in
                            Text("\(priorityGlyph(p.rawValue)) \(p.displayName)").tag(p.rawValue)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }

                HStack {
                    Text("State").font(.inter(12, weight: .medium)).foregroundColor(.ancMuted).frame(width: 70, alignment: .leading)
                    Picker("", selection: $state) {
                        Text("Active").tag("active")
                        Text("Paused").tag("paused")
                        Text("Archived").tag("archived")
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
                Button("Save") {
                    Task {
                        await store.updateProject(id: project.id, patch: PatchProjectPayload(
                            name: name.trimmingCharacters(in: .whitespaces),
                            description: description.isEmpty ? nil : description,
                            color: pickerColor.toHex(),
                            priority: priority,
                            state: state
                        ))
                        dismiss()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
            .padding(16)
        }
        .frame(width: 420, height: 440)
        .onAppear {
            name = project.name
            description = project.description ?? ""
            if let hex = project.color { pickerColor = Color(hex: hex) }
            priority = project.priority ?? 3
            state = project.state?.rawValue ?? "active"
        }
    }
}

// MARK: - Color hex extension

extension Color {
    func toHex() -> String {
        let nsColor = NSColor(self)
        guard let rgb = nsColor.usingColorSpace(.sRGB) else { return "#3B82F6" }
        let r = Int(rgb.redComponent * 255)
        let g = Int(rgb.greenComponent * 255)
        let b = Int(rgb.blueComponent * 255)
        return String(format: "#%02X%02X%02X", r, g, b)
    }

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
