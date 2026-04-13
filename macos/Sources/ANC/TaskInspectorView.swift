import SwiftUI

struct TaskInspectorView: View {
    @EnvironmentObject var store: AppStore
    @State private var showActivitySection = false
    @State private var showCostBreakdown = false
    @State private var showMemoryTrail = false
    @State private var dueDateValue: Date = Date()
    @State private var hasDueDate: Bool = false

    var body: some View {
        Group {
            if let detail = store.selectedTaskDetail {
                inspectorContent(detail)
            } else if store.selectedTaskId != nil {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 4) {
                    Text("Select a task")
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.ancBackground)
    }

    // MARK: - Inspector Content

    private func inspectorContent(_ detail: TaskDetailResponse) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                propertiesSection(detail)

                Divider()

                // Collapsible Activity section
                collapsibleSection("Activity", icon: "clock.arrow.circlepath", isExpanded: $showActivitySection) {
                    let humanEvents = detail.events.filter { activityEventTypes.contains($0.type) }
                    if humanEvents.isEmpty && detail.comments.isEmpty {
                        Text("No activity")
                            .font(.system(size: 11))
                            .foregroundColor(.ancMuted)
                    } else {
                        let recentEvents = Array(humanEvents.prefix(5))
                        ForEach(recentEvents) { event in
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(Color.ancMuted.opacity(0.5))
                                    .frame(width: 5, height: 5)
                                Text(event.type.replacingOccurrences(of: "agent:", with: "").replacingOccurrences(of: "task:", with: "").replacingOccurrences(of: "-", with: " "))
                                    .font(.system(size: 11))
                                    .foregroundColor(.ancMuted)
                                    .lineLimit(1)
                                Spacer()
                                Text(relativeTime(event.createdAt))
                                    .font(.system(size: 10))
                                    .foregroundColor(.ancMuted)
                            }
                        }
                    }
                }

                Divider()

                // Collapsible Cost Breakdown
                collapsibleSection("Cost Breakdown", icon: "dollarsign.circle", isExpanded: $showCostBreakdown) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Total")
                                .font(.system(size: 12))
                                .foregroundColor(.ancMuted)
                            Spacer()
                            Text(String(format: "$%.4f", detail.cost.totalUsd))
                                .font(.system(size: 12, design: .monospaced))
                        }

                        ForEach(detail.cost.byAgent, id: \.role) { agent in
                            HStack {
                                Text(agent.role)
                                    .font(.system(size: 11))
                                    .foregroundColor(.ancMuted)
                                Spacer()
                                Text(String(format: "$%.4f", agent.usd))
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundColor(.ancMuted)
                            }
                        }
                    }
                }

                if !detail.sessions.isEmpty {
                    Divider()
                    sessionsSection(detail)
                }

                if let handoff = detail.handoff {
                    Divider()
                    handoffSection(handoff)
                }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onChange(of: store.selectedTaskId) { _, _ in
            // Reset collapsible state on task change
            showActivitySection = false
            showCostBreakdown = false
        }
    }

    // MARK: - Collapsible Section Helper

    private func collapsibleSection<Content: View>(_ title: String, icon: String, isExpanded: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.spring(duration: 0.2)) { isExpanded.wrappedValue.toggle() }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: isExpanded.wrappedValue ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9))
                    Image(systemName: icon)
                        .font(.system(size: 11))
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.ancMuted)
                }
            }
            .buttonStyle(.borderless)

            if isExpanded.wrappedValue {
                content()
                    .padding(.leading, 4)
            }
        }
    }

    // MARK: - Properties

    private func propertiesSection(_ detail: TaskDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Properties")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.ancMuted)

            // Status
            propertyRow("Status") {
                Picker("", selection: statusBinding(detail)) {
                    ForEach(TaskEntityState.allCases, id: \.self) { state in
                        HStack(spacing: 4) {
                            Circle().fill(state.color).frame(width: 8, height: 8)
                            Text(state.displayName)
                        }
                        .tag(state)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Priority
            propertyRow("Priority") {
                Picker("", selection: priorityBinding(detail)) {
                    ForEach(TaskPriority.allCases, id: \.self) { p in
                        HStack(spacing: 4) {
                            Text(priorityGlyph(p.rawValue))
                            Text(p.displayName)
                        }
                        .tag(p.rawValue)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Assignee
            propertyRow("Assignee") {
                Picker("", selection: assigneeBinding(detail)) {
                    Text("Unassigned").tag(String?.none)
                    ForEach(store.agents) { agent in
                        Text(agent.name).tag(Optional(agent.role))
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Labels
            propertyRow("Labels") {
                let labels = detail.task.labels ?? []
                if labels.isEmpty {
                    Text("None")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                } else {
                    FlowLayout(spacing: 4) {
                        ForEach(labels, id: \.self) { label in
                            Text(label)
                                .font(.system(size: 11))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.ancAccent.opacity(0.12))
                                .clipShape(Capsule())
                        }
                    }
                }
            }

            // Project
            propertyRow("Project") {
                Picker("", selection: projectBinding(detail)) {
                    Text("None").tag(String?.none)
                    ForEach(store.projects) { proj in
                        Text(proj.name).tag(Optional(proj.id))
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Due Date
            propertyRow("Due Date") {
                if detail.task.dueDate != nil || hasDueDate {
                    DatePicker("", selection: dueDateBinding(detail), displayedComponents: .date)
                        .labelsHidden()
                        .datePickerStyle(.field)
                } else {
                    Button("Set date") {
                        hasDueDate = true
                        dueDateValue = Date()
                    }
                    .buttonStyle(.borderless)
                    .font(.system(size: 12))
                    .foregroundColor(.ancAccent)
                }
            }

            // ID (read-only)
            propertyRow("ID") {
                Text(detail.task.id)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.ancMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            // Created (read-only)
            if let ts = detail.task.createdAt {
                propertyRow("Created") {
                    Text(formatDate(ts))
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                }
            }

            // Source
            if let source = detail.task.source {
                propertyRow("Source") {
                    Text(source.rawValue)
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                }
            }
        }
    }

    // MARK: - Sessions

    private func sessionsSection(_ detail: TaskDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Sessions")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.ancMuted)

            ForEach(detail.sessions) { session in
                HStack(spacing: 6) {
                    Circle()
                        .fill(session.state == "active" ? Color.green : (session.state == "idle" ? Color.yellow : Color.gray))
                        .frame(width: 6, height: 6)
                    Text(session.issueKey)
                        .font(.system(size: 11, design: .monospaced))
                        .lineLimit(1)
                    Spacer()
                    Text(session.state)
                        .font(.system(size: 11))
                        .foregroundColor(.ancMuted)
                }
            }
        }
    }

    // MARK: - Handoff

    private func handoffSection(_ handoff: TaskHandoff) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Handoff")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.ancMuted)

            if let summary = handoff.summary {
                Text(summary)
                    .font(.system(size: 12))
                    .foregroundColor(.ancForeground)
            }

            if let steps = handoff.nextSteps, !steps.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Next Steps:")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.ancMuted)
                    ForEach(steps, id: \.self) { step in
                        HStack(alignment: .top, spacing: 4) {
                            Text("•").foregroundColor(.ancMuted)
                            Text(step).font(.system(size: 11))
                        }
                    }
                }
            }
        }
    }

    // MARK: - Bindings

    private func statusBinding(_ detail: TaskDetailResponse) -> Binding<TaskEntityState> {
        Binding(
            get: { detail.task.state },
            set: { newState in
                Task {
                    await store.updateTask(id: detail.task.id, patch: PatchTaskPayload(state: newState.rawValue))
                }
            }
        )
    }

    private func priorityBinding(_ detail: TaskDetailResponse) -> Binding<Int> {
        Binding(
            get: { detail.task.priority },
            set: { newPriority in
                Task {
                    await store.updateTask(id: detail.task.id, patch: PatchTaskPayload(priority: newPriority))
                }
            }
        )
    }

    private func assigneeBinding(_ detail: TaskDetailResponse) -> Binding<String?> {
        Binding(
            get: { detail.task.assignee },
            set: { newAssignee in
                Task {
                    await store.updateTask(id: detail.task.id, patch: PatchTaskPayload(assignee: newAssignee))
                }
            }
        )
    }

    private func projectBinding(_ detail: TaskDetailResponse) -> Binding<String?> {
        Binding(
            get: { detail.task.projectId },
            set: { newProject in
                Task {
                    await store.updateTask(id: detail.task.id, patch: PatchTaskPayload(projectId: newProject))
                }
            }
        )
    }

    private func dueDateBinding(_ detail: TaskDetailResponse) -> Binding<Date> {
        Binding(
            get: {
                if let dateStr = detail.task.dueDate {
                    let formatter = DateFormatter()
                    formatter.dateFormat = "yyyy-MM-dd"
                    return formatter.date(from: dateStr) ?? Date()
                }
                return dueDateValue
            },
            set: { newDate in
                dueDateValue = newDate
                let formatter = DateFormatter()
                formatter.dateFormat = "yyyy-MM-dd"
                let dateStr = formatter.string(from: newDate)
                Task {
                    await store.updateTask(id: detail.task.id, patch: PatchTaskPayload(dueDate: dateStr))
                }
            }
        )
    }

    // MARK: - Helpers

    private func propertyRow<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.ancMuted)
                .frame(width: 70, alignment: .leading)
            content()
        }
    }

    private func formatDate(_ epochMs: Double) -> String {
        let date = Date(timeIntervalSince1970: epochMs / 1000)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - FlowLayout (simple horizontal wrapping)

struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = computeLayout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = computeLayout(proposal: ProposedViewSize(width: bounds.width, height: bounds.height), subviews: subviews)
        for (index, offset) in result.offsets.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + offset.x, y: bounds.minY + offset.y), proposal: .unspecified)
        }
    }

    private func computeLayout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, offsets: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var offsets: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            offsets.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), offsets)
    }
}
