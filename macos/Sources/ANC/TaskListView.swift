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
            if !filterStates.isEmpty || !filterPriorities.isEmpty || !filterAssignees.isEmpty {
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
            Divider()
            Button("Clear All Filters") {
                filterStates.removeAll()
                filterPriorities.removeAll()
                filterAssignees.removeAll()
            }
            .disabled(filterStates.isEmpty && filterPriorities.isEmpty && filterAssignees.isEmpty)
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 12))
                .foregroundColor(hasActiveFilters ? .ancAccent : .ancMuted)
        }
        .menuStyle(.borderlessButton)
        .frame(width: 24)
        .help("Filter")
    }

    private var hasActiveFilters: Bool {
        !filterStates.isEmpty || !filterPriorities.isEmpty || !filterAssignees.isEmpty
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
        List(selection: $store.selectedTaskId) {
            ForEach(groupedByStatus, id: \.0) { state, tasks in
                Section {
                    ForEach(tasks) { task in
                        TaskRowView(task: task, isSelected: store.selectedTaskId == task.id)
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

    private func deleteSelected() {
        guard let id = store.selectedTaskId else { return }
        Task { await store.deleteTask(id: id) }
    }
}

// MARK: - TaskRowView

struct TaskRowView: View {
    let task: ANCTask
    var isSelected: Bool = false

    var body: some View {
        HStack(spacing: 8) {
            // State circle
            Circle()
                .fill(task.state.color)
                .frame(width: 8, height: 8)

            // Priority glyph
            Text(priorityGlyph(task.priority))
                .font(.system(size: 12))
                .frame(width: 16)

            // Title
            Text(task.title)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(1)

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
