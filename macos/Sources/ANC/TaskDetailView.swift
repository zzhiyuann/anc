import SwiftUI

struct TaskDetailView: View {
    @EnvironmentObject var store: AppStore
    @State private var editingTitle = false
    @State private var editingDescription = false
    @State private var titleDraft = ""
    @State private var descriptionDraft = ""
    @State private var commentText = ""
    @State private var showChildren = true
    @State private var showHandoff = false
    @State private var showRuntime = false

    var body: some View {
        Group {
            if let detail = store.selectedTaskDetail {
                detailContent(detail)
            } else if store.selectedTaskId != nil {
                ProgressView("Loading...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                placeholderView
            }
        }
        .background(Color.ancBackground)
    }

    // MARK: - Placeholder

    private var placeholderView: some View {
        VStack(spacing: 8) {
            Image(systemName: "doc.text")
                .font(.inter(28))
                .foregroundColor(.ancMuted)
            Text("Select a task")
                .font(.inter(14))
                .foregroundColor(.ancMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Detail Content

    private func detailContent(_ detail: TaskDetailResponse) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerSection(detail)
                titleSection(detail)
                descriptionSection(detail)

                // Runtime strip (shows active sessions)
                runtimeStrip(detail)

                childrenSection(detail)

                // Handoff section
                if let handoff = detail.handoff {
                    handoffDetailSection(handoff)
                }

                attachmentsSection(detail)

                activitySection(detail)
                commentComposer(detail)
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onChange(of: store.selectedTaskId) { _, _ in
            editingTitle = false
            editingDescription = false
        }
    }

    // MARK: - Header

    private func headerSection(_ detail: TaskDetailResponse) -> some View {
        HStack(spacing: 8) {
            // State chip
            HStack(spacing: 4) {
                Circle().fill(detail.task.state.color).frame(width: 8, height: 8)
                Text(detail.task.state.displayName)
                    .font(.inter(12, weight: .medium))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(detail.task.state.color.opacity(0.12))
            .clipShape(Capsule())

            // Priority chip
            Text(priorityGlyph(detail.task.priority))
                .font(.inter(13))

            if let by = detail.task.createdBy {
                Text("by \(by)")
                    .font(.inter(12))
                    .foregroundColor(.ancMuted)
            }

            Spacer()

            if let ts = detail.task.createdAt {
                Text(relativeTime(ts))
                    .font(.inter(12))
                    .foregroundColor(.ancMuted)
            }
        }
    }

    // MARK: - Title

    private func titleSection(_ detail: TaskDetailResponse) -> some View {
        Group {
            if editingTitle {
                TextField("Title", text: $titleDraft, onCommit: {
                    commitTitle(detail.task.id)
                })
                .textFieldStyle(.plain)
                .font(.inter(20, weight: .bold))
                .onExitCommand { editingTitle = false }
            } else {
                Text(detail.task.title)
                    .font(.inter(20, weight: .bold))
                    .onTapGesture {
                        titleDraft = detail.task.title
                        editingTitle = true
                    }
            }
        }
    }

    private func commitTitle(_ taskId: String) {
        editingTitle = false
        guard !titleDraft.isEmpty else { return }
        Task {
            await store.updateTask(id: taskId, patch: PatchTaskPayload(title: titleDraft))
        }
    }

    // MARK: - Description

    private func descriptionSection(_ detail: TaskDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Description")
                    .font(.inter(12, weight: .semibold))
                    .foregroundColor(.ancMuted)
                Spacer()
                if !editingDescription {
                    Button {
                        descriptionDraft = detail.task.description ?? ""
                        editingDescription = true
                    } label: {
                        Image(systemName: "pencil")
                            .font(.inter(11))
                            .foregroundColor(.ancMuted)
                    }
                    .buttonStyle(.borderless)
                }
            }

            if editingDescription {
                TextEditor(text: $descriptionDraft)
                    .font(.inter(13))
                    .frame(minHeight: 80, maxHeight: 200)
                    .padding(4)
                    .background(Color.ancSurface)
                    .cornerRadius(6)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.ancBorder, lineWidth: 1))
                HStack {
                    Spacer()
                    Button("Cancel") { editingDescription = false }
                        .buttonStyle(.borderless)
                    Button("Save") {
                        editingDescription = false
                        Task {
                            await store.updateTask(id: detail.task.id, patch: PatchTaskPayload(description: descriptionDraft))
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                }
            } else {
                let desc = detail.task.description ?? "No description"
                Text(desc)
                    .font(.inter(13))
                    .foregroundColor(detail.task.description == nil ? .ancMuted : .ancForeground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onTapGesture {
                        descriptionDraft = detail.task.description ?? ""
                        editingDescription = true
                    }
            }
        }
    }

    // MARK: - Runtime Strip

    private func runtimeStrip(_ detail: TaskDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.spring(duration: 0.2)) { showRuntime.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: showRuntime ? "chevron.down" : "chevron.right")
                        .font(.inter(10))
                    Circle()
                        .fill(detail.sessions.isEmpty ? Color.gray : Color.ancRunning)
                        .frame(width: 6, height: 6)
                    Text(detail.sessions.isEmpty ? "No active sessions" : "\(detail.sessions.count) active session\(detail.sessions.count == 1 ? "" : "s")")
                        .font(.inter(12, weight: .medium))
                        .foregroundColor(detail.sessions.isEmpty ? .ancMuted : .ancForeground)
                    Spacer()
                    // Show first session state as one-liner
                    if !showRuntime, let first = detail.sessions.first {
                        Text(first.state.capitalized)
                            .font(.inter(11))
                            .foregroundColor(.ancMuted)
                    }
                }
            }
            .buttonStyle(.borderless)

            if showRuntime {
                ForEach(detail.sessions) { session in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(session.state == "active" ? Color.green : (session.state == "idle" ? Color.yellow : Color.gray))
                            .frame(width: 6, height: 6)
                        Text(session.issueKey)
                            .font(.system(size: 11, design: .monospaced))
                            .lineLimit(1)
                        Spacer()
                        Text(session.state.capitalized)
                            .font(.inter(11))
                            .foregroundColor(.ancMuted)
                    }
                    .padding(.leading, 16)
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(10)
        .background(Color.ancRunning.opacity(0.06))
        .cornerRadius(8)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.ancRunning.opacity(0.2), lineWidth: 1))
    }

    // MARK: - Handoff Detail Section

    private func handoffDetailSection(_ handoff: TaskHandoff) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.spring(duration: 0.2)) { showHandoff.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: showHandoff ? "chevron.down" : "chevron.right")
                        .font(.inter(10))
                    Image(systemName: "arrow.right.circle")
                        .font(.inter(11))
                        .foregroundColor(.orange)
                    Text("Handoff")
                        .font(.inter(12, weight: .semibold))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    if !showHandoff {
                        Text("Show full handoff")
                            .font(.inter(11))
                            .foregroundColor(.ancAccent)
                    }
                }
            }
            .buttonStyle(.borderless)

            if showHandoff {
                VStack(alignment: .leading, spacing: 8) {
                    if let summary = handoff.summary {
                        Text(summary)
                            .font(.inter(12))
                            .foregroundColor(.ancForeground)
                            .textSelection(.enabled)
                    }

                    if let steps = handoff.nextSteps, !steps.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Next Steps:")
                                .font(.inter(11, weight: .medium))
                                .foregroundColor(.ancMuted)
                            ForEach(steps, id: \.self) { step in
                                HStack(alignment: .top, spacing: 4) {
                                    Text("•").foregroundColor(.ancMuted)
                                    Text(step).font(.inter(11))
                                }
                            }
                        }
                    }
                }
                .padding(.leading, 16)
                .padding(.top, 4)
            }
        }
        .padding(10)
        .background(Color.orange.opacity(0.05))
        .cornerRadius(8)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.orange.opacity(0.2), lineWidth: 1))
    }

    // MARK: - Children / Sub-issues

    private func childrenSection(_ detail: TaskDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.spring(duration: 0.2)) { showChildren.toggle() }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: showChildren ? "chevron.down" : "chevron.right")
                        .font(.inter(10))
                    Text("Sub-issues")
                        .font(.inter(12, weight: .semibold))
                        .foregroundColor(.ancMuted)
                    if detail.children.isEmpty {
                        Text("None")
                            .font(.inter(11))
                            .foregroundColor(.ancMuted)
                    } else {
                        let done = detail.children.filter { $0.state == .done }.count
                        Text("\(done)/\(detail.children.count)")
                            .font(.inter(11))
                            .foregroundColor(.ancMuted)
                    }
                }
            }
            .buttonStyle(.borderless)

            if showChildren {
                if detail.children.isEmpty {
                    Text("No sub-issues")
                        .font(.inter(11))
                        .foregroundColor(.ancMuted)
                        .padding(.leading, 16)
                } else {
                    ForEach(detail.children) { child in
                        HStack(spacing: 8) {
                            Circle().fill(child.state.color).frame(width: 6, height: 6)
                            Text(child.title)
                                .font(.inter(12))
                                .lineLimit(1)
                            Spacer()
                            Text(child.state.displayName)
                                .font(.inter(11))
                                .foregroundColor(.ancMuted)
                        }
                        .padding(.leading, 16)
                        .padding(.vertical, 2)
                    }
                }
            }
        }
    }

    // MARK: - Attachments

    private func attachmentsSection(_ detail: TaskDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Attachments")
                    .font(.inter(12, weight: .semibold))
                    .foregroundColor(.ancMuted)
                if !detail.attachments.isEmpty {
                    Text("\(detail.attachments.count)")
                        .font(.inter(10))
                        .foregroundColor(.ancMuted)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.ancMuted.opacity(0.15))
                        .clipShape(Capsule())
                }
            }
            if detail.attachments.isEmpty {
                Text("No attachments")
                    .font(.inter(11))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(detail.attachments) { att in
                    HStack(spacing: 6) {
                        Image(systemName: "doc")
                            .font(.inter(11))
                            .foregroundColor(.ancMuted)
                        Text(att.name)
                            .font(.inter(12))
                        Spacer()
                        Text(formatBytes(att.size))
                            .font(.inter(11))
                            .foregroundColor(.ancMuted)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    // MARK: - Activity Stream

    private func activitySection(_ detail: TaskDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Activity")
                .font(.inter(12, weight: .semibold))
                .foregroundColor(.ancMuted)

            // Interleave events and comments, sorted by time
            let items = buildActivityItems(detail)
            if items.isEmpty {
                Text("No activity yet")
                    .font(.inter(12))
                    .foregroundColor(.ancMuted)
                    .padding(.vertical, 4)
            } else {
                ForEach(items) { item in
                    activityRow(item)
                }
            }
        }
    }

    private func activityRow(_ item: ActivityItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            // Timeline dot
            VStack(spacing: 0) {
                Circle()
                    .fill(item.isComment ? Color.ancAccent : Color.ancMuted.opacity(0.5))
                    .frame(width: 8, height: 8)
                Rectangle()
                    .fill(Color.ancBorder)
                    .frame(width: 1)
                    .frame(maxHeight: .infinity)
            }
            .frame(width: 8)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    if let role = item.role {
                        Text(role)
                            .font(.inter(11, weight: .semibold))
                            .foregroundColor(.ancForeground)
                    }
                    Text(item.typeLabel)
                        .font(.inter(11))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    Text(relativeTime(item.timestamp))
                        .font(.inter(10))
                        .foregroundColor(.ancMuted)
                }

                if let body = item.body, !body.isEmpty {
                    Text(body)
                        .font(.inter(12))
                        .foregroundColor(.ancForeground)
                        .padding(.top, 1)
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Comment Composer

    @State private var showMentionPicker = false

    private func commentComposer(_ detail: TaskDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider()

            // @mention suggestions
            if showMentionPicker {
                mentionSuggestions
            }

            HStack(spacing: 8) {
                TextField("Add a comment... (@ to mention)", text: $commentText)
                    .textFieldStyle(.roundedBorder)
                    .font(.inter(13))
                    .onSubmit { sendComment(detail.task.id) }
                    .onChange(of: commentText) { _, newVal in
                        showMentionPicker = newVal.hasSuffix("@")
                    }

                Button {
                    showMentionPicker.toggle()
                } label: {
                    Image(systemName: "at")
                        .font(.inter(12))
                        .foregroundColor(.ancMuted)
                }
                .buttonStyle(.borderless)
                .help("Mention agent")

                Button {
                    sendComment(detail.task.id)
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.inter(13))
                }
                .buttonStyle(.borderless)
                .disabled(commentText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private var mentionSuggestions: some View {
        HStack(spacing: 4) {
            ForEach(store.agents) { agent in
                Button {
                    // Insert @role into comment
                    if commentText.hasSuffix("@") {
                        commentText += agent.role + " "
                    } else {
                        commentText += "@\(agent.role) "
                    }
                    showMentionPicker = false
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "person.circle")
                            .font(.inter(10))
                        Text(agent.name)
                            .font(.inter(11))
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Color.ancSurface)
                    .cornerRadius(4)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func sendComment(_ taskId: String) {
        let text = commentText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        commentText = ""
        Task { await store.postComment(taskId: taskId, body: text) }
    }
}

// MARK: - Activity Item

struct ActivityItem: Identifiable {
    let id: String
    let timestamp: Double
    let role: String?
    let typeLabel: String
    let body: String?
    let isComment: Bool
}

// Only show human-readable activity events, not process capture noise
let activityEventTypes: Set<String> = [
    "task:created", "task:state-changed", "task:updated", "task:renamed",
    "task:assigned", "task:dispatched", "task:completed",
    "task:feedback-delivered", "task:feedback-pending", "task:all-children-done",
    "agent:spawned", "agent:completed", "agent:failed",
    "agent:idle", "agent:suspended", "agent:resumed",
    "attachment:added", "handoff:attached", "label:added", "label:removed",
]

private func buildActivityItems(_ detail: TaskDetailResponse) -> [ActivityItem] {
    var items: [ActivityItem] = []

    for event in detail.events {
        // Skip noisy process capture events (tool calls, file reads, bash commands)
        guard activityEventTypes.contains(event.type) else { continue }

        let label = event.type
            .replacingOccurrences(of: "agent:", with: "")
            .replacingOccurrences(of: "task:", with: "")
            .replacingOccurrences(of: "-", with: " ")

        // Extract meaningful body from payload
        var body: String? = nil
        if let payload = event.payload,
           let data = payload.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            // Use human-readable fields first
            if let msg = dict["message"] as? String { body = msg }
            else if let preview = dict["preview"] as? String { body = preview }
            else if let detail = dict["detail"] as? String { body = detail }
            // State changes: "from X → to Y"
            else if event.type == "task:state-changed",
                    let from = dict["from"] as? String,
                    let to = dict["to"] as? String {
                body = "\(from) → \(to)"
            }
            // Dispatch: show role
            else if event.type == "task:dispatched",
                    let role = dict["role"] as? String {
                body = "dispatched \(role)"
            }
        }

        items.append(ActivityItem(
            id: "event-\(event.id)",
            timestamp: event.createdAt,
            role: event.role,
            typeLabel: label,
            body: body,
            isComment: false
        ))
    }

    for comment in detail.comments {
        items.append(ActivityItem(
            id: "comment-\(comment.id)",
            timestamp: comment.createdAt,
            role: comment.author,
            typeLabel: "commented",
            body: comment.body,
            isComment: true
        ))
    }

    items.sort { $0.timestamp > $1.timestamp }
    return items
}

private func formatBytes(_ bytes: Int) -> String {
    if bytes < 1024 { return "\(bytes) B" }
    if bytes < 1024 * 1024 { return "\(bytes / 1024) KB" }
    return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
}
