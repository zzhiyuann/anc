import SwiftUI

struct AgentDetailView: View {
    @EnvironmentObject var store: AppStore
    let role: String

    @State private var selectedTab = 0
    @State private var personaEdit = false
    @State private var personaDraft = ""
    @State private var terminalTimer: Timer? = nil
    @State private var messageText = ""
    @State private var selectedMemoryFile: String? = nil
    @State private var memoryEditMode = false
    @State private var memoryDraft = ""

    private var detail: AgentDetail? { store.agentDetail }

    var body: some View {
        VStack(spacing: 0) {
            if let detail {
                headerSection(detail)
                Divider()
                statsBar(detail)
                Divider()
                tabContent
            } else {
                ProgressView("Loading agent...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task {
            store.selectedAgentRole = role
            await store.fetchAgentDetail(role)
            await store.fetchAgentPersona(role)
        }
    }

    // MARK: - Header

    private func headerSection(_ detail: AgentDetail) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 36))
                .foregroundColor(.ancAccent)

            VStack(alignment: .leading, spacing: 2) {
                Text(detail.name)
                    .font(.system(size: 18, weight: .bold))
                Text("@\(detail.role)")
                    .font(.system(size: 13))
                    .foregroundColor(.ancMuted)
            }

            Spacer()

            // Status pill
            let isActive = detail.activeSessions > 0
            Text(isActive ? "Active" : "Offline")
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background((isActive ? Color.green : Color.gray).opacity(0.15))
                .foregroundColor(isActive ? .green : .gray)
                .clipShape(Capsule())
        }
        .padding(16)
    }

    // MARK: - Stats Bar

    private func statsBar(_ detail: AgentDetail) -> some View {
        HStack(spacing: 20) {
            miniStat("Active", "\(detail.activeSessions)", .green)
            miniStat("Idle", "\(detail.idleSessions)", .yellow)
            miniStat("Suspended", "\(detail.suspendedSessions)", .orange)
            miniStat("Max", "\(detail.maxConcurrency)", .ancMuted)
            if let model = detail.model {
                miniStat("Model", model, .blue)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func miniStat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 1) {
            Text(value)
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(.ancMuted)
        }
    }

    // MARK: - Tabs

    private var tabContent: some View {
        VStack(spacing: 0) {
            // Tab bar
            HStack(spacing: 0) {
                tabButton("Persona", index: 0)
                tabButton("Terminal", index: 1)
                tabButton("Memory", index: 2)
                tabButton("Sessions", index: 3)
                tabButton("Cost", index: 4)
                tabButton("Activity", index: 5)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.top, 4)

            Divider()

            // Tab content
            Group {
                switch selectedTab {
                case 0: personaTab
                case 1: terminalTab
                case 2: memoryTab
                case 3: sessionsTab
                case 4: costTab
                case 5: activityTab
                default: Text("Unknown tab")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func tabButton(_ title: String, index: Int) -> some View {
        Button {
            withAnimation(.spring(duration: 0.2)) { selectedTab = index }
            onTabChange(index)
        } label: {
            Text(title)
                .font(.system(size: 12, weight: selectedTab == index ? .semibold : .regular))
                .foregroundColor(selectedTab == index ? .ancAccent : .ancMuted)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(selectedTab == index ? Color.ancAccent.opacity(0.1) : Color.clear)
                .cornerRadius(6)
        }
        .buttonStyle(.plain)
    }

    private func onTabChange(_ index: Int) {
        stopTerminalPolling()
        switch index {
        case 0: Task { await store.fetchAgentPersona(role) }
        case 1:
            Task { await store.fetchAgentOutputs(role) }
            startTerminalPolling()
        case 2: Task { await store.fetchAgentMemoryList(role) }
        case 3: Task { await store.fetchAgentDetail(role) }
        case 4: Task { await store.refreshBudgetSeries(role: role) }
        case 5: Task { await store.refreshEvents(role: role) }
        default: break
        }
    }

    // MARK: - Persona Tab

    private var personaTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Persona")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    if !personaEdit {
                        Button("Edit") {
                            personaDraft = store.agentPersona ?? ""
                            personaEdit = true
                        }
                        .buttonStyle(.borderless)
                    }
                }

                if personaEdit {
                    TextEditor(text: $personaDraft)
                        .font(.system(size: 12, design: .monospaced))
                        .frame(minHeight: 300)
                        .padding(4)
                        .background(Color.ancSurface)
                        .cornerRadius(6)
                    HStack {
                        Spacer()
                        Button("Cancel") { personaEdit = false }
                            .buttonStyle(.borderless)
                        Button("Save") {
                            personaEdit = false
                            let draft = personaDraft
                            Task { await store.saveAgentPersona(role, body: draft) }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }
                } else if let body = store.agentPersona {
                    Text(body)
                        .font(.system(size: 12))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text("No persona found")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                }
            }
            .padding(16)
        }
    }

    // MARK: - Terminal Tab

    private var terminalTab: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if store.agentOutputs.isEmpty {
                        Text("No active sessions")
                            .font(.system(size: 12))
                            .foregroundColor(.ancMuted)
                            .padding(16)
                    } else {
                        ForEach(store.agentOutputs) { output in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(output.issueKey)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(.ancAccent)
                                if output.output.isEmpty {
                                    Text("(no output yet)")
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundColor(.ancMuted)
                                } else {
                                    Text(output.output)
                                        .font(.system(size: 11, design: .monospaced))
                                        .textSelection(.enabled)
                                }
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.black.opacity(0.8))
                            .foregroundColor(.green)
                            .cornerRadius(6)
                        }
                    }
                }
                .padding(16)
            }

            Divider()

            // Message input
            HStack(spacing: 8) {
                let hasActiveTask = store.tasks.contains(where: { $0.assignee == role && $0.state == .running })
                TextField(hasActiveTask ? "Send message to agent..." : "No active task to send message to", text: $messageText)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
                Button("Send") {
                    let msg = messageText
                    messageText = ""
                    // Find an active task assigned to this agent to dispatch the message
                    let activeTask = store.tasks.first(where: { $0.assignee == role && $0.state == .running })
                    Task { await store.dispatch(role: role, taskId: activeTask?.id, message: msg) }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(messageText.trimmingCharacters(in: .whitespaces).isEmpty
                    || !store.tasks.contains(where: { $0.assignee == role && $0.state == .running }))
            }
            .padding(10)
        }
    }

    private func startTerminalPolling() {
        terminalTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
            Task { @MainActor in
                await store.fetchAgentOutputs(role)
            }
        }
    }

    private func stopTerminalPolling() {
        terminalTimer?.invalidate()
        terminalTimer = nil
    }

    // MARK: - Memory Tab

    private var memoryTab: some View {
        HSplitView {
            // File list
            VStack(spacing: 0) {
                HStack {
                    Text("Memory Files")
                        .font(.system(size: 12, weight: .semibold))
                    Spacer()
                }
                .padding(8)
                Divider()

                if store.agentMemoryFiles.isEmpty {
                    Text("No memory files")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(store.agentMemoryFiles, id: \.self, selection: $selectedMemoryFile) { file in
                        Text(file)
                            .font(.system(size: 12))
                            .lineLimit(1)
                    }
                    .listStyle(.sidebar)
                    .onChange(of: selectedMemoryFile) { _, newFile in
                        if let file = newFile {
                            Task { await store.fetchAgentMemoryFile(role, filename: file) }
                            memoryEditMode = false
                        }
                    }
                }
            }
            .frame(minWidth: 180, maxWidth: 250)

            // File content
            VStack(spacing: 0) {
                if let content = store.agentMemoryContent {
                    HStack {
                        Text(content.filename)
                            .font(.system(size: 12, weight: .semibold))
                        Spacer()
                        if !memoryEditMode {
                            Button("Edit") {
                                memoryDraft = content.body
                                memoryEditMode = true
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    .padding(8)
                    Divider()

                    if memoryEditMode {
                        TextEditor(text: $memoryDraft)
                            .font(.system(size: 12, design: .monospaced))
                        HStack {
                            Spacer()
                            Button("Cancel") { memoryEditMode = false }
                                .buttonStyle(.borderless)
                            Button("Save") {
                                memoryEditMode = false
                                let draft = memoryDraft
                                if let file = selectedMemoryFile {
                                    Task { await store.saveAgentMemoryFile(role, filename: file, body: draft) }
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                        .padding(8)
                    } else {
                        ScrollView {
                            Text(content.body)
                                .font(.system(size: 12, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                        }
                    }
                } else {
                    Text("Select a memory file")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
    }

    // MARK: - Sessions Tab

    private var sessionsTab: some View {
        VStack(spacing: 0) {
            if let detail, !detail.sessions.isEmpty {
                List {
                    ForEach(detail.sessions) { session in
                        HStack(spacing: 10) {
                            Circle()
                                .fill(session.state == "active" ? Color.green : (session.state == "idle" ? Color.yellow : Color.gray))
                                .frame(width: 8, height: 8)
                            Text(session.issueKey)
                                .font(.system(size: 12, design: .monospaced))
                                .lineLimit(1)
                            Spacer()
                            Text(session.state.capitalized)
                                .font(.system(size: 11))
                                .foregroundColor(.ancMuted)
                            if let uptime = session.uptime {
                                Text(formatUptime(uptime))
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundColor(.ancMuted)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "terminal")
                        .font(.system(size: 24))
                        .foregroundColor(.ancMuted)
                    Text("No active sessions")
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    // MARK: - Cost Tab

    private var costTab: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !store.budgetSeries.isEmpty {
                // Sparkline
                Text("Cost (14 days)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.ancMuted)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                SparklineView(data: store.budgetSeries.map { $0.usd })
                    .frame(height: 120)
                    .padding(.horizontal, 16)

                // Day-by-day
                List {
                    ForEach(store.budgetSeries.reversed()) { day in
                        HStack {
                            Text(day.date)
                                .font(.system(size: 12, design: .monospaced))
                            Spacer()
                            Text(String(format: "$%.2f", day.usd))
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .foregroundColor(day.usd > 0 ? .orange : .ancMuted)
                            Text("\(day.tokens) tokens")
                                .font(.system(size: 11))
                                .foregroundColor(.ancMuted)
                                .frame(width: 100, alignment: .trailing)
                        }
                    }
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
            } else {
                Text("No cost data available")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            await store.refreshBudgetSeries(role: role)
        }
    }

    // MARK: - Activity Tab

    private var activityTab: some View {
        VStack(spacing: 0) {
            if store.systemEvents.isEmpty {
                Text("No events")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(store.systemEvents) { event in
                        HStack(spacing: 8) {
                            Image(systemName: eventIcon(event.eventType))
                                .font(.system(size: 11))
                                .foregroundColor(eventColor(event.eventType))
                                .frame(width: 16)

                            VStack(alignment: .leading, spacing: 1) {
                                HStack {
                                    Text(event.eventType)
                                        .font(.system(size: 12, weight: .medium))
                                    if let key = event.issueKey {
                                        Text(key)
                                            .font(.system(size: 11, design: .monospaced))
                                            .foregroundColor(.ancMuted)
                                            .lineLimit(1)
                                    }
                                }
                                if let detail = event.detail {
                                    Text(detail)
                                        .font(.system(size: 11))
                                        .foregroundColor(.ancMuted)
                                }
                            }

                            Spacer()

                            Text(event.createdAt)
                                .font(.system(size: 10))
                                .foregroundColor(.ancMuted)
                        }
                        .padding(.vertical, 2)
                    }
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
            }
        }
        .task {
            await store.refreshEvents(role: role)
        }
    }

    // MARK: - Helpers

    private func formatUptime(_ seconds: Int) -> String {
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m" }
        return "\(seconds / 3600)h \((seconds % 3600) / 60)m"
    }

    private func eventIcon(_ type: String) -> String {
        switch type {
        case "spawned": return "play.circle"
        case "idle": return "pause.circle"
        case "suspended": return "stop.circle"
        case "resumed": return "arrow.clockwise.circle"
        default: return "circle"
        }
    }

    private func eventColor(_ type: String) -> Color {
        switch type {
        case "spawned": return .green
        case "idle": return .yellow
        case "suspended": return .red
        case "resumed": return .blue
        default: return .gray
        }
    }
}

// MARK: - Sparkline

struct SparklineView: View {
    let data: [Double]

    var body: some View {
        GeometryReader { geo in
            let maxVal = max(data.max() ?? 1, 1)
            let w = geo.size.width
            let h = geo.size.height
            let stepX = data.count > 1 ? w / CGFloat(data.count - 1) : w

            Path { path in
                for (i, val) in data.enumerated() {
                    let x = CGFloat(i) * stepX
                    let y = h - (CGFloat(val / maxVal) * h)
                    if i == 0 {
                        path.move(to: CGPoint(x: x, y: y))
                    } else {
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                }
            }
            .stroke(Color.ancAccent, lineWidth: 2)

            // Fill
            Path { path in
                for (i, val) in data.enumerated() {
                    let x = CGFloat(i) * stepX
                    let y = h - (CGFloat(val / maxVal) * h)
                    if i == 0 {
                        path.move(to: CGPoint(x: x, y: h))
                        path.addLine(to: CGPoint(x: x, y: y))
                    } else {
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                }
                path.addLine(to: CGPoint(x: CGFloat(data.count - 1) * stepX, y: h))
                path.closeSubpath()
            }
            .fill(Color.ancAccent.opacity(0.1))
        }
    }
}
