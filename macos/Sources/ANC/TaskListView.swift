import SwiftUI

// MARK: - Sort & Filter types

enum TaskSortField: String, CaseIterable {
    case created = "Created"
    case priority = "Priority"
    case title = "Title"
}

// MARK: - TaskListView

struct TaskListView: View {
    @EnvironmentObject var store: AppStore
    @State private var searchText = ""
    @State private var sortField: TaskSortField = .created
    @State private var sortAscending = false
    @State private var filterStates: Set<TaskEntityState> = []
    @State private var filterPriorities: Set<Int> = []
    @State private var filterAssignees: Set<String> = []
    @State private var filterProjects: Set<String> = []
    @State private var multiSelection: Set<String> = []

    private var filteredTasks: [ANCTask] {
        var result = store.tasks

        // Search
        if !searchText.isEmpty {
            let q = searchText.lowercased()
            result = result.filter {
                $0.title.lowercased().contains(q) ||
                ($0.description?.lowercased().contains(q) ?? false) ||
                ($0.assignee?.lowercased().contains(q) ?? false) ||
                $0.id.lowercased().contains(q)
            }
        }

        // Filter by state
        if !filterStates.isEmpty {
            result = result.filter { filterStates.contains($0.state) }
        }

        // Filter by priority
        if !filterPriorities.isEmpty {
            result = result.filter { filterPriorities.contains($0.priority) }
        }

        // Filter by assignee
        if !filterAssignees.isEmpty {
            result = result.filter {
                if let a = $0.assignee { return filterAssignees.contains(a) }
                return filterAssignees.contains("(unassigned)")
            }
        }

        // Filter by project
        if !filterProjects.isEmpty {
            result = result.filter {
                if let p = $0.projectId { return filterProjects.contains(p) }
                return filterProjects.contains("(none)")
            }
        }

        return result
    }

    private var sortedTasks: [ANCTask] {
        let tasks = filteredTasks
        let sorted: [ANCTask]
        switch sortField {
        case .created:
            sorted = tasks.sorted { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }
        case .priority:
            sorted = tasks.sorted { $0.priority < $1.priority }
        case .title:
            sorted = tasks.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        }
        return sortAscending ? sorted : sorted.reversed()
    }

    private var groupedByStatus: [(TaskEntityState, [ANCTask])] {
        let order: [TaskEntityState] = [.running, .todo, .review, .done, .failed, .canceled]
        let grouped = Dictionary(grouping: sortedTasks) { $0.state }
        return order.compactMap { state in
            guard let tasks = grouped[state], !tasks.isEmpty else { return nil }
            return (state, tasks)
        }
    }

    private var uniqueAssignees: [String] {
        let assignees = Set(store.tasks.compactMap { $0.assignee })
        var result = Array(assignees).sorted()
        if store.tasks.contains(where: { $0.assignee == nil }) {
            result.insert("(unassigned)", at: 0)
        }
        return result
    }

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack(spacing: 8) {
                Text("Tasks")
                    .font(.system(size: 16, weight: .semibold))
                Text("\(filteredTasks.count)")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.ancMuted.opacity(0.15))
                    .clipShape(Capsule())
                Spacer()

                // Multi-select toggle
                Button {
                    isMultiSelectMode.toggle()
                    if !isMultiSelectMode { multiSelection.removeAll() }
                } label: {
                    Image(systemName: isMultiSelectMode ? "checkmark.circle.fill" : "checkmark.circle")
                        .font(.system(size: 12))
                        .foregroundColor(isMultiSelectMode ? .ancAccent : .ancMuted)
                }
                .buttonStyle(.borderless)
                .help("Multi-select")

                // Filter menus
                filterMenu
                sortMenu

                Button {
                    store.showCreateTask = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(.borderless)
                .keyboardShortcut("n", modifiers: .command)
                .help("New Task (⌘N)")

                Button {
                    Task { await store.refreshTasks() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12))
                }
                .buttonStyle(.borderless)
                .help("Refresh")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            // Active filter chips
            if hasActiveFilters {
                filterChipsBar
            }

            Divider()

            // Content
            if !store.connected && store.tasks.isEmpty {
                disconnectedView
            } else if store.tasks.isEmpty {
                emptyView
            } else if sortedTasks.isEmpty {
                noMatchView
            } else {
                taskListContent
            }
        }
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search tasks...")
        .sheet(isPresented: $store.showCreateTask) {
            CreateTaskSheet()
                .environmentObject(store)
        }
        .onDeleteCommand {
            deleteSelected()
        }
        .onKeyPress(.upArrow) {
            navigateTask(direction: -1)
            return .handled
        }
        .onKeyPress(.downArrow) {
            navigateTask(direction: 1)
            return .handled
        }
    }

    // MARK: - Filter Menu

    private var filterMenu: some View {
        Menu {
            Menu("Status") {
                ForEach(TaskEntityState.allCases, id: \.self) { state in
                    Button {
                        toggleFilter(&filterStates, state)
                    } label: {
                        HStack {
                            if filterStates.contains(state) {
                                Image(systemName: "checkmark")
                            }
                            Circle().fill(state.color).frame(width: 8, height: 8)
                            Text(state.displayName)
                        }
                    }
                }
            }
            Menu("Priority") {
                ForEach(TaskPriority.allCases, id: \.self) { p in
                    Button {
                        toggleFilter(&filterPriorities, p.rawValue)
                    } label: {
                        HStack {
                            if filterPriorities.contains(p.rawValue) {
                                Image(systemName: "checkmark")
                            }
                            Text(priorityGlyph(p.rawValue))
                            Text(p.displayName)
                        }
                    }
                }
            }
            Menu("Assignee") {
                ForEach(uniqueAssignees, id: \.self) { name in
                    Button {
                        toggleFilter(&filterAssignees, name)
                    } label: {
                        HStack {
                            if filterAssignees.contains(name) {
                                Image(systemName: "checkmark")
                            }
                            Text(name)
                        }
                    }
                }
            }
            Menu("Project") {
                ForEach(uniqueProjects, id: \.0) { id, name in
                    Button {
                        toggleFilter(&filterProjects, id)
                    } label: {
                        HStack {
                            if filterProjects.contains(id) {
                                Image(systemName: "checkmark")
                            }
                            Text(name)
                        }
                    }
                }
            }
            Divider()
            Button("Clear All Filters") {
                filterStates.removeAll()
                filterPriorities.removeAll()
                filterAssignees.removeAll()
                filterProjects.removeAll()
            }
            .disabled(filterStates.isEmpty && filterPriorities.isEmpty && filterAssignees.isEmpty && filterProjects.isEmpty)
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 12))
                .foregroundColor(hasActiveFilters ? .ancAccent : .ancMuted)
        }
        .menuStyle(.borderlessButton)
        .frame(width: 24)
        .help("Filter")
    }

    private var uniqueProjects: [(String, String)] {
        var result: [(String, String)] = []
        let projectIds = Set(store.tasks.compactMap { $0.projectId })
        for id in projectIds.sorted() {
            let name = store.projects.first { $0.id == id }?.name ?? id
            result.append((id, name))
        }
        if store.tasks.contains(where: { $0.projectId == nil }) {
            result.insert(("(none)", "(no project)"), at: 0)
        }
        return result
    }

    private var hasActiveFilters: Bool {
        !filterStates.isEmpty || !filterPriorities.isEmpty || !filterAssignees.isEmpty || !filterProjects.isEmpty
    }

    // MARK: - Sort Menu

    private var sortMenu: some View {
        Menu {
            ForEach(TaskSortField.allCases, id: \.self) { field in
                Button {
                    if sortField == field {
                        sortAscending.toggle()
                    } else {
                        sortField = field
                        sortAscending = false
                    }
                } label: {
                    HStack {
                        if sortField == field {
                            Image(systemName: sortAscending ? "chevron.up" : "chevron.down")
                        }
                        Text(field.rawValue)
                    }
                }
            }
        } label: {
            Image(systemName: "arrow.up.arrow.down")
                .font(.system(size: 12))
        }
        .menuStyle(.borderlessButton)
        .frame(width: 24)
        .help("Sort")
    }

    // MARK: - Filter Chips Bar

    private var filterChipsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(filterStates), id: \.self) { state in
                    chipView(state.displayName, color: state.color) {
                        filterStates.remove(state)
                    }
                }
                ForEach(Array(filterPriorities).sorted(), id: \.self) { p in
                    let prio = TaskPriority(rawValue: p) ?? .medium
                    chipView(prio.displayName, color: .ancAccent) {
                        filterPriorities.remove(p)
                    }
                }
                ForEach(Array(filterAssignees).sorted(), id: \.self) { name in
                    chipView(name, color: .purple) {
                        filterAssignees.remove(name)
                    }
                }
                ForEach(Array(filterProjects).sorted(), id: \.self) { projId in
                    let name = store.projects.first { $0.id == projId }?.name ?? projId
                    chipView(name, color: .teal) {
                        filterProjects.remove(projId)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 4)
        }
    }

    private func chipView(_ label: String, color: Color, onRemove: @escaping () -> Void) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label).font(.system(size: 11))
            Button(action: onRemove) {
                Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
            }
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(color.opacity(0.1))
        .clipShape(Capsule())
    }

    // MARK: - Task List Content

    private var taskListContent: some View {
        VStack(spacing: 0) {
            // Bulk actions bar when multi-selecting
            if !multiSelection.isEmpty {
                bulkActionsBar
            }

            List(selection: multiSelection.isEmpty ? $store.selectedTaskId : nil) {
                ForEach(groupedByStatus, id: \.0) { state, tasks in
                    Section {
                        ForEach(tasks) { task in
                            HStack(spacing: 0) {
                                if isMultiSelectMode {
                                    Image(systemName: multiSelection.contains(task.id) ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 14))
                                        .foregroundColor(multiSelection.contains(task.id) ? .ancAccent : .ancMuted)
                                        .onTapGesture {
                                            toggleMultiSelect(task.id)
                                        }
                                        .padding(.trailing, 6)
                                }
                                TaskRowView(task: task, isSelected: store.selectedTaskId == task.id, projectName: projectName(for: task.projectId))
                            }
                            .tag(task.id)
                        }
                    } header: {
                        HStack(spacing: 6) {
                            Circle().fill(state.color).frame(width: 8, height: 8)
                            Text(state.displayName)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.ancMuted)
                            Text("\(tasks.count)")
                                .font(.system(size: 11))
                                .foregroundColor(.ancMuted)
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .onChange(of: store.selectedTaskId) { _, newId in
                if let id = newId {
                    store.selectTask(id)
                }
            }
        }
    }

    @State private var isMultiSelectMode = false

    private func toggleMultiSelect(_ id: String) {
        if multiSelection.contains(id) {
            multiSelection.remove(id)
        } else {
            multiSelection.insert(id)
        }
        if multiSelection.isEmpty {
            isMultiSelectMode = false
        }
    }

    private var bulkActionsBar: some View {
        HStack(spacing: 8) {
            Text("\(multiSelection.count) selected")
                .font(.system(size: 12, weight: .medium))

            Spacer()

            Menu("Set Status") {
                ForEach(TaskEntityState.allCases, id: \.self) { state in
                    Button {
                        bulkSetStatus(state)
                    } label: {
                        HStack {
                            Circle().fill(state.color).frame(width: 8, height: 8)
                            Text(state.displayName)
                        }
                    }
                }
            }
            .menuStyle(.borderlessButton)
            .fixedSize()

            Menu("Set Priority") {
                ForEach(TaskPriority.allCases, id: \.self) { p in
                    Button {
                        bulkSetPriority(p.rawValue)
                    } label: {
                        Text("\(priorityGlyph(p.rawValue)) \(p.displayName)")
                    }
                }
            }
            .menuStyle(.borderlessButton)
            .fixedSize()

            Button {
                bulkDelete()
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 11))
                    .foregroundColor(.red)
            }
            .buttonStyle(.borderless)

            Button("Done") {
                multiSelection.removeAll()
                isMultiSelectMode = false
            }
            .buttonStyle(.borderless)
            .font(.system(size: 12))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(Color.ancAccent.opacity(0.08))
    }

    private func bulkSetStatus(_ state: TaskEntityState) {
        let ids = multiSelection
        for id in ids {
            Task { await store.updateTask(id: id, patch: PatchTaskPayload(state: state.rawValue)) }
        }
        multiSelection.removeAll()
        isMultiSelectMode = false
    }

    private func bulkSetPriority(_ priority: Int) {
        let ids = multiSelection
        for id in ids {
            Task { await store.updateTask(id: id, patch: PatchTaskPayload(priority: priority)) }
        }
        multiSelection.removeAll()
        isMultiSelectMode = false
    }

    private func bulkDelete() {
        let ids = multiSelection
        for id in ids {
            Task { await store.deleteTask(id: id) }
        }
        multiSelection.removeAll()
        isMultiSelectMode = false
    }

    private func projectName(for projectId: String?) -> String? {
        guard let projectId else { return nil }
        return store.projects.first { $0.id == projectId }?.name ?? projectId
    }

    // MARK: - State views

    private var disconnectedView: some View {
        VStack(spacing: 8) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 28))
                .foregroundColor(.ancMuted)
            Text("Disconnected from backend")
                .font(.system(size: 13))
                .foregroundColor(.ancMuted)
            if let err = store.lastError {
                Text(err)
                    .font(.system(size: 11))
                    .foregroundColor(.ancMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            Button("Retry") {
                Task { await store.refreshAll() }
            }
            .buttonStyle(.borderedProminent)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: 8) {
            Image(systemName: "checklist")
                .font(.system(size: 32))
                .foregroundColor(.ancMuted)
            Text("No tasks yet")
                .font(.system(size: 14, weight: .medium))
            Text("Press ⌘N to create one")
                .font(.system(size: 12))
                .foregroundColor(.ancMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noMatchView: some View {
        VStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 24))
                .foregroundColor(.ancMuted)
            Text("No matching tasks")
                .font(.system(size: 13))
                .foregroundColor(.ancMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Helpers

    private func toggleFilter<T: Hashable>(_ set: inout Set<T>, _ value: T) {
        if set.contains(value) { set.remove(value) } else { set.insert(value) }
    }

    private func navigateTask(direction: Int) {
        let allTasks = sortedTasks
        guard !allTasks.isEmpty else { return }
        if let current = store.selectedTaskId,
           let idx = allTasks.firstIndex(where: { $0.id == current }) {
            let newIdx = min(max(idx + direction, 0), allTasks.count - 1)
            store.selectTask(allTasks[newIdx].id)
        } else {
            store.selectTask(allTasks[direction > 0 ? 0 : allTasks.count - 1].id)
        }
    }

    private func deleteSelected() {
        guard let id = store.selectedTaskId else { return }
        Task { await store.deleteTask(id: id) }
    }
}

// MARK: - TaskRowView

struct TaskRowView: View {
    let task: ANCTask
    var isSelected: Bool = false
    var projectName: String? = nil

    var body: some View {
        HStack(spacing: 8) {
            // Priority glyph
            Text(priorityGlyph(task.priority))
                .font(.system(size: 12))
                .frame(width: 16)

            // Title
            Text(task.title)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(1)

            // State pill
            Text(task.state.displayName)
                .font(.system(size: 10, weight: .medium))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(task.state.color.opacity(0.15))
                .foregroundColor(task.state.color)
                .clipShape(Capsule())

            Spacer(minLength: 4)

            // Assignee
            if let assignee = task.assignee {
                HStack(spacing: 3) {
                    Image(systemName: "person.circle")
                        .font(.system(size: 11))
                        .foregroundColor(.ancMuted)
                    Text(assignee)
                        .font(.system(size: 11))
                        .foregroundColor(.ancMuted)
                }
            }

            // Project pill
            if task.projectId != nil {
                Text(projectName ?? task.projectId ?? "")
                    .font(.system(size: 10))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Color.ancAccent.opacity(0.1))
                    .foregroundColor(.ancAccent)
                    .clipShape(Capsule())
                    .lineLimit(1)
            }

            // Relative time
            if let ts = task.createdAt {
                Text(relativeTime(ts))
                    .font(.system(size: 11))
                    .foregroundColor(.ancMuted)
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}

// MARK: - Helpers

func priorityGlyph(_ priority: Int) -> String {
    switch priority {
    case 1: return "🔴"
    case 2: return "🟠"
    case 3: return "🟡"
    case 4: return "🔵"
    default: return "⚪"
    }
}

func relativeTime(_ epochMs: Double) -> String {
    let date = Date(timeIntervalSince1970: epochMs / 1000)
    let interval = Date().timeIntervalSince(date)

    if interval < 60 { return "now" }
    if interval < 3600 { return "\(Int(interval / 60))m" }
    if interval < 86400 { return "\(Int(interval / 3600))h" }
    if interval < 604800 { return "\(Int(interval / 86400))d" }
    return "\(Int(interval / 604800))w"
}
