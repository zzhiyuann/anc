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

    var body: some View {
        VStack(spacing: 0) {
            // Tab picker
            Picker("Section", selection: $selectedTab) {
                Text("Info").tag(0)
                Text("Sessions").tag(1)
                Text("Persona").tag(2)
                Text("Memory").tag(3)
            }
            .pickerStyle(.segmented)
            .padding()

            switch selectedTab {
            case 0:
                AgentInfoSection(role: role)
            case 1:
                AgentSessionsSection(role: role)
            case 2:
                AgentPersonaSection(role: role)
            case 3:
                AgentMemorySection(role: role)
            default:
                EmptyView()
            }
        }
        .navigationTitle(store.agentDetail?.name ?? role)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            store.selectedAgentRole = role
            async let d: () = store.fetchAgentDetail(role)
            async let p: () = store.fetchAgentPersona(role)
            async let m: () = store.fetchAgentMemoryList(role)
            _ = await (d, p, m)
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

// Make String identifiable for sheet binding
extension String: @retroactive Identifiable {
    public var id: String { self }
}
