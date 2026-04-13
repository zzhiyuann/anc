import SwiftUI

struct TasksTab: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        NavigationStack {
            TaskListView()
                .navigationTitle("Tasks")
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            let generator = UIImpactFeedbackGenerator(style: .medium)
                            generator.impactOccurred()
                            store.showCreateTask = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
                .sheet(isPresented: $store.showCreateTask) {
                    CreateTaskSheet()
                }
        }
    }
}

// MARK: - Task List

struct TaskListView: View {
    @EnvironmentObject var store: AppStore
    @State private var filterState: TaskEntityState? = nil
    @State private var isLoading = false

    private static let filterOptions: [(TaskEntityState?, String)] = [
        (nil, "All"),
        (.running, "Running"),
        (.todo, "Todo"),
        (.review, "Review"),
        (.done, "Done"),
    ]

    private var grouped: [(TaskEntityState, [ANCTask])] {
        let filtered = filterState == nil ? store.tasks : store.tasks.filter { $0.state == filterState }
        let dict = Dictionary(grouping: filtered, by: { $0.state })
        let order: [TaskEntityState] = [.running, .review, .todo, .done, .failed, .canceled]
        return order.compactMap { state in
            guard let items = dict[state], !items.isEmpty else { return nil }
            return (state, items)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Status filter
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Self.filterOptions, id: \.1) { state, label in
                        Button {
                            let generator = UIImpactFeedbackGenerator(style: .light)
                            generator.impactOccurred()
                            withAnimation(.easeInOut(duration: 0.2)) {
                                filterState = state
                            }
                        } label: {
                            Text(label)
                                .font(.subheadline.weight(filterState == state ? .semibold : .regular))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 6)
                                .background(filterState == state ? Color.ancAccent.opacity(0.15) : Color.ancSurface)
                                .foregroundStyle(filterState == state ? Color.ancAccent : .secondary)
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }

            List {
                if !store.connected {
                    Section {
                        VStack(spacing: 12) {
                            Image(systemName: "wifi.slash")
                                .font(.largeTitle)
                                .foregroundStyle(.red)
                            Text("Could not connect")
                                .font(.headline)
                            Text(store.lastError ?? "Check server URL in Settings")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                            Button {
                                let generator = UIImpactFeedbackGenerator(style: .medium)
                                generator.impactOccurred()
                                Task {
                                    isLoading = true
                                    await store.refreshTasks()
                                    isLoading = false
                                }
                            } label: {
                                HStack {
                                    if isLoading {
                                        ProgressView()
                                            .controlSize(.small)
                                    }
                                    Text("Retry")
                                }
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                    }
                } else if store.tasks.isEmpty {
                    Section {
                        VStack(spacing: 12) {
                            Image(systemName: "checklist")
                                .font(.largeTitle)
                                .foregroundStyle(.secondary)
                            Text("No Tasks")
                                .font(.headline)
                            Text("Create a new task to get started.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Button {
                                store.showCreateTask = true
                            } label: {
                                Label("New Task", systemImage: "plus")
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                    }
                } else if grouped.isEmpty && filterState != nil {
                    Section {
                        VStack(spacing: 12) {
                            Image(systemName: "line.3.horizontal.decrease.circle")
                                .font(.largeTitle)
                                .foregroundStyle(.secondary)
                            Text("No \(filterState?.displayName ?? "") Tasks")
                                .font(.headline)
                            Text("Try a different filter.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                    }
                } else {
                    ForEach(grouped, id: \.0) { state, tasks in
                        Section {
                            ForEach(tasks) { task in
                                NavigationLink(value: task.id) {
                                    TaskRowView(task: task)
                                }
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    Button(role: .destructive) {
                                        let generator = UIImpactFeedbackGenerator(style: .medium)
                                        generator.impactOccurred()
                                        Task { await store.deleteTask(id: task.id) }
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    if task.state == .todo {
                                        Button {
                                            let generator = UIImpactFeedbackGenerator(style: .medium)
                                            generator.impactOccurred()
                                            Task { await store.updateTask(id: task.id, patch: PatchTaskPayload(state: "running")) }
                                        } label: {
                                            Label("Start", systemImage: "play.fill")
                                        }
                                        .tint(Color.ancRunning)
                                    } else if task.state == .running {
                                        Button {
                                            let generator = UIImpactFeedbackGenerator(style: .medium)
                                            generator.impactOccurred()
                                            Task { await store.updateTask(id: task.id, patch: PatchTaskPayload(state: "done")) }
                                        } label: {
                                            Label("Done", systemImage: "checkmark")
                                        }
                                        .tint(.green)
                                    } else if task.state == .review {
                                        Button {
                                            let generator = UIImpactFeedbackGenerator(style: .medium)
                                            generator.impactOccurred()
                                            Task { await store.updateTask(id: task.id, patch: PatchTaskPayload(state: "done")) }
                                        } label: {
                                            Label("Approve", systemImage: "checkmark.seal")
                                        }
                                        .tint(.green)
                                    }
                                }
                            }
                        } header: {
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(state.color)
                                    .frame(width: 8, height: 8)
                                Text(state.displayName)
                                    .font(.subheadline.weight(.semibold))
                            }
                        }
                    }
                }
            }
            .refreshable {
                await store.refreshTasks()
            }
            .navigationDestination(for: String.self) { taskId in
                TaskDetailView(taskId: taskId)
            }
        }
    }
}

// MARK: - Task Row

struct TaskRowView: View {
    let task: ANCTask

    private var priorityIcon: String? {
        switch task.priority {
        case 1: return "exclamationmark.3"
        case 2: return "exclamationmark.2"
        case 3: return "exclamationmark"
        default: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(task.title)
                .font(.body)
                .lineLimit(2)

            HStack(spacing: 8) {
                if let icon = priorityIcon {
                    Image(systemName: icon)
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
                if let assignee = task.assignee {
                    Label(assignee, systemImage: "person")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let labels = task.labels, !labels.isEmpty {
                    Text(labels.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Task Detail

struct TaskDetailView: View {
    @EnvironmentObject var store: AppStore
    let taskId: String
    @State private var commentText = ""
    @State private var isEditingTitle = false
    @State private var editedTitle = ""
    @State private var isLoading = false

    private var detail: TaskDetailResponse? { store.selectedTaskDetail }
    private var task: ANCTask? { detail?.task ?? store.tasks.first { $0.id == taskId } }

    // Interleaved activity: comments + events sorted by time
    private var activityItems: [ActivityItem] {
        guard let detail else { return [] }
        var items: [ActivityItem] = []
        for comment in detail.comments {
            items.append(.comment(comment))
        }
        for event in detail.events {
            items.append(.event(event))
        }
        return items.sorted { $0.timestamp < $1.timestamp }
    }

    var body: some View {
        Group {
            if let task {
                List {
                    // Header
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            if isEditingTitle {
                                HStack {
                                    TextField("Title", text: $editedTitle)
                                        .font(.title2.weight(.semibold))
                                        .textFieldStyle(.roundedBorder)
                                    Button {
                                        let generator = UIImpactFeedbackGenerator(style: .light)
                                        generator.impactOccurred()
                                        let trimmed = editedTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                                        guard !trimmed.isEmpty else { return }
                                        isEditingTitle = false
                                        Task {
                                            await store.updateTask(id: taskId, patch: PatchTaskPayload(title: trimmed))
                                        }
                                    } label: {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(Color.ancAccent)
                                    }
                                    Button {
                                        isEditingTitle = false
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            } else {
                                Text(task.title)
                                    .font(.title2.weight(.semibold))
                                    .onTapGesture {
                                        editedTitle = task.title
                                        isEditingTitle = true
                                    }
                            }

                            HStack(spacing: 12) {
                                StatusBadge(state: task.state)
                                if let assignee = task.assignee {
                                    Label(assignee, systemImage: "person.circle")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                Text(TaskPriority(rawValue: task.priority)?.displayName ?? "")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }

                            if let desc = task.description, !desc.isEmpty {
                                Text(desc)
                                    .font(.body)
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 4)
                            }
                        }
                    }

                    // Cost
                    if let detail, detail.cost.totalUsd > 0 {
                        Section("Cost") {
                            HStack {
                                Text("Total")
                                Spacer()
                                Text(String(format: "$%.2f", detail.cost.totalUsd))
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(detail.cost.byAgent, id: \.role) { ac in
                                HStack {
                                    Text(ac.role)
                                    Spacer()
                                    Text(String(format: "$%.2f", ac.usd))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }

                    // Children (sub-issues)
                    if let detail, !detail.children.isEmpty {
                        Section("Sub-issues") {
                            ForEach(detail.children) { child in
                                NavigationLink(value: child.id) {
                                    HStack {
                                        Circle()
                                            .fill(child.state.color)
                                            .frame(width: 8, height: 8)
                                        Text(child.title)
                                            .lineLimit(1)
                                        Spacer()
                                        StatusBadge(state: child.state)
                                    }
                                }
                            }
                        }
                    }

                    // Resources / Attachments
                    if let detail, !detail.attachments.isEmpty {
                        Section("Resources") {
                            ForEach(detail.attachments) { att in
                                HStack {
                                    Image(systemName: iconForAttachment(att.kind))
                                        .foregroundStyle(Color.ancAccent)
                                    VStack(alignment: .leading) {
                                        Text(att.name)
                                            .font(.subheadline)
                                        Text(formatBytes(att.size))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }

                    // Activity stream (comments + events interleaved)
                    if let detail {
                        Section("Activity") {
                            if activityItems.isEmpty && detail.comments.isEmpty && detail.events.isEmpty {
                                HStack {
                                    Spacer()
                                    VStack(spacing: 4) {
                                        Image(systemName: "bubble.left.and.bubble.right")
                                            .font(.title3)
                                            .foregroundStyle(.secondary)
                                        Text("No activity yet")
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }
                                .padding(.vertical, 8)
                            } else {
                                ForEach(Array(activityItems.enumerated()), id: \.offset) { _, item in
                                    switch item {
                                    case .comment(let comment):
                                        VStack(alignment: .leading, spacing: 4) {
                                            HStack {
                                                Image(systemName: "bubble.left.fill")
                                                    .font(.caption)
                                                    .foregroundStyle(Color.ancAccent)
                                                Text(comment.author)
                                                    .font(.subheadline.weight(.medium))
                                                Spacer()
                                                Text(formatTimestamp(comment.createdAt))
                                                    .font(.caption2)
                                                    .foregroundStyle(.secondary)
                                            }
                                            Text(comment.body)
                                                .font(.body)
                                        }
                                        .padding(.vertical, 2)

                                    case .event(let event):
                                        HStack {
                                            Image(systemName: "bolt.fill")
                                                .font(.caption)
                                                .foregroundStyle(Color.ancMuted)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(event.type)
                                                    .font(.subheadline)
                                                if let role = event.role {
                                                    Text(role)
                                                        .font(.caption)
                                                        .foregroundStyle(.secondary)
                                                }
                                            }
                                            Spacer()
                                            Text(formatTimestamp(event.createdAt))
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }

                            // Comment composer
                            HStack {
                                TextField("Add comment...", text: $commentText, axis: .vertical)
                                    .textFieldStyle(.roundedBorder)
                                Button {
                                    let text = commentText.trimmingCharacters(in: .whitespacesAndNewlines)
                                    guard !text.isEmpty else { return }
                                    let generator = UIImpactFeedbackGenerator(style: .light)
                                    generator.impactOccurred()
                                    Task {
                                        await store.postComment(taskId: taskId, body: text)
                                        commentText = ""
                                    }
                                } label: {
                                    Image(systemName: "paperplane.fill")
                                        .foregroundStyle(
                                            commentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                            ? .secondary : Color.ancAccent
                                        )
                                }
                                .disabled(commentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                        }
                    }
                }
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Loading task...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(task?.title ?? "Task")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await store.fetchTaskDetail(taskId)
        }
        .onAppear {
            store.selectTask(taskId)
        }
    }

    private func formatTimestamp(_ ts: Double) -> String {
        let date = Date(timeIntervalSince1970: ts)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private func iconForAttachment(_ kind: String) -> String {
        switch kind {
        case "image": return "photo"
        case "code": return "doc.text"
        case "markdown": return "doc.richtext"
        default: return "doc"
        }
    }

    private func formatBytes(_ bytes: Int) -> String {
        let kb = Double(bytes) / 1024
        if kb < 1024 {
            return String(format: "%.1f KB", kb)
        }
        return String(format: "%.1f MB", kb / 1024)
    }
}

// MARK: - Activity Item (interleaved comments + events)

enum ActivityItem {
    case comment(TaskComment)
    case event(TaskEvent)

    var timestamp: Double {
        switch self {
        case .comment(let c): return c.createdAt
        case .event(let e): return e.createdAt
        }
    }
}

// MARK: - Status Badge

struct StatusBadge: View {
    let state: TaskEntityState

    var body: some View {
        Text(state.displayName)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(state.color.opacity(0.15))
            .foregroundStyle(state.color)
            .clipShape(Capsule())
    }
}

// MARK: - Create Task Sheet

struct CreateTaskSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var assignee = ""
    @State private var priority = 3
    @State private var projectId = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section {
                    Picker("Priority", selection: $priority) {
                        ForEach(TaskPriority.allCases, id: \.rawValue) { p in
                            Text(p.displayName).tag(p.rawValue)
                        }
                    }

                    if !store.agents.isEmpty {
                        Picker("Assignee", selection: $assignee) {
                            Text("Unassigned").tag("")
                            ForEach(store.agents) { agent in
                                Text(agent.name).tag(agent.role)
                            }
                        }
                    }

                    if !store.projects.isEmpty {
                        Picker("Project", selection: $projectId) {
                            Text("None").tag("")
                            ForEach(store.projects) { project in
                                Text(project.name).tag(project.id)
                            }
                        }
                    }
                }
            }
            .navigationTitle("New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let generator = UIImpactFeedbackGenerator(style: .medium)
                        generator.impactOccurred()
                        Task {
                            await store.createTask(
                                title: title,
                                description: description.isEmpty ? nil : description,
                                assignee: assignee.isEmpty ? nil : assignee,
                                priority: priority,
                                projectId: projectId.isEmpty ? nil : projectId
                            )
                            dismiss()
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
