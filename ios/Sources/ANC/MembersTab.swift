import SwiftUI

struct MembersTab: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        NavigationStack {
            List {
                if store.agents.isEmpty && store.connected {
                    ContentUnavailableView("No Agents", systemImage: "person.2", description: Text("No agents registered."))
                } else if !store.connected {
                    ContentUnavailableView("Not Connected", systemImage: "wifi.slash", description: Text("Check server URL in Settings."))
                } else {
                    ForEach(store.agents) { agent in
                        NavigationLink(value: agent.role) {
                            AgentRowView(agent: agent)
                        }
                    }
                }
            }
            .navigationTitle("Members")
            .refreshable {
                await store.refreshAgents()
            }
            .navigationDestination(for: String.self) { role in
                AgentDetailView(role: role)
            }
        }
    }
}

// MARK: - Agent Row

struct AgentRowView: View {
    let agent: AgentStatus

    private var statusColor: Color {
        if agent.activeSessions > 0 { return .green }
        if agent.idleSessions > 0 { return .yellow }
        return .gray
    }

    private var statusText: String {
        if agent.activeSessions > 0 { return "Active (\(agent.activeSessions))" }
        if agent.idleSessions > 0 { return "Idle (\(agent.idleSessions))" }
        return "Offline"
    }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(statusColor.opacity(0.15))
                    .frame(width: 44, height: 44)
                Image(systemName: "person.fill")
                    .foregroundStyle(statusColor)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(agent.name)
                    .font(.body.weight(.medium))
                HStack(spacing: 8) {
                    Text(agent.role)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(statusText)
                        .font(.caption)
                        .foregroundStyle(statusColor)
                }
            }

            Spacer()

            Text("\(agent.activeSessions)/\(agent.maxConcurrency)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Agent Detail

struct AgentDetailView: View {
    @EnvironmentObject var store: AppStore
    let role: String
    @State private var selectedTab = 0
    @State private var showDispatchSheet = false

    var body: some View {
        VStack(spacing: 0) {
            // Tab picker
            Picker("Section", selection: $selectedTab) {
                Text("Persona").tag(0)
                Text("Terminal").tag(1)
                Text("Memory").tag(2)
                Text("Sessions").tag(3)
            }
            .pickerStyle(.segmented)
            .padding()

            switch selectedTab {
            case 0:
                AgentPersonaSection(role: role)
            case 1:
                AgentTerminalSection(role: role)
            case 2:
                AgentMemorySection(role: role)
            case 3:
                AgentSessionsSection(role: role)
            default:
                EmptyView()
            }
        }
        .navigationTitle(store.agentDetail?.name ?? role)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    let generator = UIImpactFeedbackGenerator(style: .medium)
                    generator.impactOccurred()
                    showDispatchSheet = true
                } label: {
                    Label("Dispatch", systemImage: "paperplane.fill")
                }
            }
        }
        .sheet(isPresented: $showDispatchSheet) {
            DispatchTaskSheet(role: role)
        }
        .task {
            store.selectedAgentRole = role
            async let d: () = store.fetchAgentDetail(role)
            async let p: () = store.fetchAgentPersona(role)
            async let o: () = store.fetchAgentOutputs(role)
            async let m: () = store.fetchAgentMemoryList(role)
            _ = await (d, p, o, m)
        }
    }
}

// MARK: - Agent Info Section

struct AgentInfoSection: View {
    @EnvironmentObject var store: AppStore
    let role: String

    var body: some View {
        List {
            if let detail = store.agentDetail {
                Section("Status") {
                    LabeledContent("Role", value: detail.role)
                    LabeledContent("Model", value: detail.model ?? "N/A")
                    LabeledContent("Max Concurrency", value: "\(detail.maxConcurrency)")
                    LabeledContent("Active Sessions", value: "\(detail.activeSessions)")
                    LabeledContent("Idle Sessions", value: "\(detail.idleSessions)")
                    LabeledContent("Suspended Sessions", value: "\(detail.suspendedSessions)")
                    if let mc = detail.memoryCount {
                        LabeledContent("Memory Files", value: "\(mc)")
                    }
                }
            } else {
                ProgressView("Loading...")
            }
        }
    }
}

// MARK: - Agent Sessions Section

struct AgentSessionsSection: View {
    @EnvironmentObject var store: AppStore
    let role: String

    var body: some View {
        List {
            if let detail = store.agentDetail {
                if detail.sessions.isEmpty {
                    ContentUnavailableView("No Sessions", systemImage: "terminal", description: Text("No active sessions for this agent."))
                } else {
                    ForEach(detail.sessions) { session in
                        HStack {
                            Circle()
                                .fill(session.state == "active" ? Color.green : (session.state == "idle" ? Color.yellow : Color.gray))
                                .frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.issueKey)
                                    .font(.subheadline.monospaced())
                                Text(session.state)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let uptime = session.uptime {
                                Text(formatUptime(uptime))
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else {
                ProgressView("Loading...")
            }
        }
    }

    private func formatUptime(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}

// MARK: - Agent Persona Section

struct AgentPersonaSection: View {
    @EnvironmentObject var store: AppStore
    let role: String

    var body: some View {
        ScrollView {
            if let persona = store.agentPersona {
                Text(persona)
                    .font(.body.monospaced())
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ContentUnavailableView("No Persona", systemImage: "doc.text", description: Text("Persona file not found."))
            }
        }
    }
}

// MARK: - Agent Memory Section

struct AgentMemorySection: View {
    @EnvironmentObject var store: AppStore
    let role: String
    @State private var selectedFile: String? = nil

    var body: some View {
        List {
            if store.agentMemoryFiles.isEmpty {
                ContentUnavailableView("No Memory Files", systemImage: "brain", description: Text("This agent has no memory files."))
            } else {
                ForEach(store.agentMemoryFiles, id: \.self) { file in
                    Button {
                        selectedFile = file
                        Task { await store.fetchAgentMemoryFile(role, filename: file) }
                    } label: {
                        HStack {
                            Image(systemName: "doc.text")
                                .foregroundStyle(Color.ancAccent)
                            Text(file)
                                .font(.subheadline)
                        }
                    }
                }
            }
        }
        .sheet(item: $selectedFile) { file in
            NavigationStack {
                ScrollView {
                    if let content = store.agentMemoryContent, content.filename == file {
                        Text(content.body)
                            .font(.body.monospaced())
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        ProgressView("Loading...")
                    }
                }
                .navigationTitle(file)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { selectedFile = nil }
                    }
                }
            }
        }
    }
}

// MARK: - Agent Terminal Section

struct AgentTerminalSection: View {
    @EnvironmentObject var store: AppStore
    let role: String

    var body: some View {
        ScrollView {
            if store.agentOutputs.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "terminal")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("No Output")
                        .font(.headline)
                    Text("This agent has no terminal output.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            } else {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(store.agentOutputs) { output in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(output.issueKey)
                                    .font(.caption.monospaced().weight(.semibold))
                                    .foregroundStyle(Color.ancAccent)
                                Spacer()
                                if let tmux = output.tmuxSession {
                                    Text(tmux)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Text(output.output)
                                .font(.caption.monospaced())
                                .foregroundStyle(.primary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(8)
                                .background(Color.black.opacity(0.05))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                    }
                }
                .padding()
            }
        }
        .refreshable {
            await store.fetchAgentOutputs(role)
        }
    }
}

// MARK: - Dispatch Task Sheet

struct DispatchTaskSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let role: String
    @State private var selectedTaskId: String = ""
    @State private var message: String = ""
    @State private var isDispatching = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Agent", value: role)
                }

                Section {
                    if !store.tasks.isEmpty {
                        Picker("Task", selection: $selectedTaskId) {
                            Text("None (new session)").tag("")
                            ForEach(store.tasks.filter { $0.state == .todo || $0.state == .running }) { task in
                                Text(task.title).tag(task.id)
                            }
                        }
                    }

                    TextField("Message (optional)", text: $message, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section {
                    Button {
                        let generator = UIImpactFeedbackGenerator(style: .heavy)
                        generator.impactOccurred()
                        isDispatching = true
                        Task {
                            await store.dispatchToAgent(
                                role: role,
                                taskId: selectedTaskId.isEmpty ? nil : selectedTaskId,
                                message: message.isEmpty ? nil : message
                            )
                            isDispatching = false
                            dismiss()
                        }
                    } label: {
                        HStack {
                            if isDispatching {
                                ProgressView()
                                    .controlSize(.small)
                            }
                            Text("Dispatch")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .disabled(isDispatching)
                }
            }
            .navigationTitle("Dispatch Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

// Make String identifiable for sheet binding
extension String: @retroactive Identifiable {
    public var id: String { self }
}
