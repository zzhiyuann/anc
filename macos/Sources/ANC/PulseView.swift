import SwiftUI

struct PulseView: View {
    @EnvironmentObject var store: AppStore
    @State private var showKillSwitchConfirm = false
    @State private var showNewDecision = false
    @State private var newDecisionTitle = ""
    @State private var newDecisionRationale = ""
    @State private var showNewObjective = false
    @State private var newObjectiveTitle = ""
    @State private var newObjectiveDescription = ""
    @State private var selectedQuarter = ""
    @State private var isBriefingRefreshing = false

    var body: some View {
        VStack(spacing: 0) {
            // Top bar
            HStack {
                Text("Dashboard")
                    .font(.inter(16, weight: .semibold))
                Spacer()

                Button {
                    Task { await refreshAll() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.inter(12))
                }
                .buttonStyle(.borderless)
                .help("Refresh")

                // Kill Switch
                Button {
                    showKillSwitchConfirm = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: store.killSwitchPaused ? "play.fill" : "stop.fill")
                        Text(store.killSwitchPaused ? "Resume" : "Kill Switch")
                    }
                    .font(.inter(11, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(store.killSwitchPaused ? Color.green : Color.red)
                    .cornerRadius(6)
                }
                .buttonStyle(.plain)
                .alert(
                    store.killSwitchPaused ? "Resume all agents?" : "Pause all agents?",
                    isPresented: $showKillSwitchConfirm
                ) {
                    Button("Cancel", role: .cancel) { }
                    Button(store.killSwitchPaused ? "Resume" : "Pause", role: store.killSwitchPaused ? .none : .destructive) {
                        Task { await store.toggleKillSwitch() }
                    }
                } message: {
                    Text(store.killSwitchPaused
                         ? "This will resume all suspended agent sessions."
                         : "This will suspend all running agent sessions immediately.")
                }
            }
            .padding(16)
            Divider()

            // Content grid
            ScrollView {
                HStack(alignment: .top, spacing: 16) {
                    // Left column
                    VStack(spacing: 16) {
                        briefingCard
                        needsInputCard
                        winsCard
                    }
                    .frame(maxWidth: .infinity)

                    // Right column
                    VStack(spacing: 16) {
                        okrsCard
                        decisionsCard
                        slowTasksCard
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(16)
            }
        }
        .task {
            await refreshAll()
        }
    }

    private func refreshAll() async {
        async let b: () = store.refreshBriefing()
        async let o: () = store.refreshObjectives()
        async let d: () = store.refreshDecisions()
        async let k: () = store.refreshKillSwitchStatus()
        async let n: () = store.refreshNotifications()
        _ = await (b, o, d, k, n)
    }

    // MARK: - Daily Briefing Card

    private var briefingCard: some View {
        DashboardCard(title: "Daily Briefing", icon: "sun.max") {
            HStack {
                Spacer()
                Button {
                    isBriefingRefreshing = true
                    Task {
                        await store.refreshBriefing()
                        isBriefingRefreshing = false
                    }
                } label: {
                    HStack(spacing: 4) {
                        if isBriefingRefreshing {
                            ProgressView()
                                .controlSize(.mini)
                        }
                        Image(systemName: "arrow.clockwise")
                            .font(.inter(10))
                        Text("Refresh")
                            .font(.inter(10))
                    }
                }
                .buttonStyle(.borderless)
                .disabled(isBriefingRefreshing)
            }
            .padding(.bottom, 4)

            if let briefing = store.briefing {
                VStack(alignment: .leading, spacing: 10) {
                    // Cost burn
                    if let burn = briefing.costBurn {
                        HStack {
                            Text("Budget:")
                                .font(.inter(11, weight: .semibold))
                                .foregroundColor(.ancMuted)
                            let pct = burn.budgetUsd > 0 ? (burn.spentUsd / burn.budgetUsd * 100) : 0
                            Text(String(format: "$%.2f / $%.0f (%.0f%%)", burn.spentUsd, burn.budgetUsd, pct))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(pct > 90 ? .red : (pct > 70 ? .orange : .green))
                        }

                        ProgressView(value: min(burn.spentUsd, burn.budgetUsd), total: max(burn.budgetUsd, 1))
                            .tint(burn.spentUsd > burn.budgetUsd ? .red : .ancAccent)
                    }

                    // Today's queue
                    if !briefing.todayQueue.isEmpty {
                        Text("Today's Queue")
                            .font(.inter(11, weight: .semibold))
                            .foregroundColor(.ancMuted)
                        ForEach(briefing.todayQueue, id: \.self) { item in
                            HStack(spacing: 6) {
                                Image(systemName: "circle")
                                    .font(.inter(6))
                                    .foregroundColor(.ancMuted)
                                Text(item)
                                    .font(.inter(12))
                                    .lineLimit(1)
                            }
                        }
                    }

                    // Yesterday's completions
                    if !briefing.yesterdayCompletions.isEmpty {
                        Text("Yesterday Completed")
                            .font(.inter(11, weight: .semibold))
                            .foregroundColor(.ancMuted)
                        ForEach(briefing.yesterdayCompletions, id: \.self) { item in
                            HStack(spacing: 6) {
                                Image(systemName: "checkmark.circle")
                                    .font(.inter(10))
                                    .foregroundColor(.green)
                                Text(item)
                                    .font(.inter(12))
                                    .lineLimit(1)
                            }
                        }
                    }

                    // Risks
                    if !briefing.risks.isEmpty {
                        Text("Risks")
                            .font(.inter(11, weight: .semibold))
                            .foregroundColor(.red)
                        ForEach(briefing.risks, id: \.self) { risk in
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.inter(10))
                                    .foregroundColor(.red)
                                Text(risk)
                                    .font(.inter(12))
                            }
                        }
                    }
                }
            } else {
                Text("Loading briefing...")
                    .font(.inter(12))
                    .foregroundColor(.ancMuted)
            }
        }
    }

    // MARK: - Needs Input

    private var needsInputCard: some View {
        DashboardCard(title: "Needs Input", icon: "exclamationmark.bubble") {
            let unreadMentions = store.notifications.filter { $0.readAt == nil && $0.kind == "dispatch" }
            if unreadMentions.isEmpty {
                Text("No pending mentions")
                    .font(.inter(12))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(unreadMentions.prefix(5)) { notif in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 6, height: 6)
                        Text(notif.title)
                            .font(.inter(12))
                            .lineLimit(1)
                        Spacer()
                        Text(relativeTime(notif.createdAt))
                            .font(.inter(10))
                            .foregroundColor(.ancMuted)
                    }
                }
                if unreadMentions.count > 5 {
                    Text("+\(unreadMentions.count - 5) more")
                        .font(.inter(11))
                        .foregroundColor(.ancMuted)
                }
            }
        }
    }

    // MARK: - Wins

    private var winsCard: some View {
        DashboardCard(title: "Recent Wins", icon: "trophy") {
            let doneTasks = store.tasks.filter { $0.state == .done }
                .sorted { ($0.completedAt ?? 0) > ($1.completedAt ?? 0) }
                .prefix(5)

            if doneTasks.isEmpty {
                Text("No completed tasks recently")
                    .font(.inter(12))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(Array(doneTasks)) { task in
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.inter(10))
                            .foregroundColor(.green)
                        Text(task.title)
                            .font(.inter(12))
                            .lineLimit(1)
                        Spacer()
                        if let assignee = task.assignee {
                            Text(assignee)
                                .font(.inter(10))
                                .foregroundColor(.ancMuted)
                        }
                    }
                }
            }
        }
    }

    // MARK: - OKRs

    private var availableQuarters: [String] {
        let quarters = Set(store.objectives.compactMap { $0.quarter })
        return ["All"] + quarters.sorted()
    }

    private var filteredObjectives: [Objective] {
        if selectedQuarter.isEmpty || selectedQuarter == "All" {
            return store.objectives
        }
        return store.objectives.filter { $0.quarter == selectedQuarter }
    }

    private var okrsCard: some View {
        DashboardCard(title: "OKRs", icon: "target") {
            // Quarter picker + create button
            HStack {
                Picker("Quarter", selection: $selectedQuarter) {
                    ForEach(availableQuarters, id: \.self) { q in
                        Text(q).tag(q)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .fixedSize()

                Spacer()

                Button {
                    showNewObjective = true
                } label: {
                    Label("New", systemImage: "plus")
                        .font(.inter(11))
                }
                .buttonStyle(.borderless)
                .sheet(isPresented: $showNewObjective) {
                    newObjectiveSheet
                }
            }

            if filteredObjectives.isEmpty {
                Text("No objectives defined")
                    .font(.inter(12))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(filteredObjectives) { obj in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(obj.title)
                                .font(.inter(13, weight: .medium))
                            Spacer()
                            if let q = obj.quarter {
                                Text(q)
                                    .font(.inter(10))
                                    .foregroundColor(.ancMuted)
                            }
                        }

                        ForEach(obj.keyResults) { kr in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(kr.title)
                                        .font(.inter(11))
                                    Spacer()
                                    Text("\(Int(kr.current))/\(Int(kr.target))")
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundColor(.ancMuted)
                                }
                                ProgressView(value: min(kr.current, kr.target), total: max(kr.target, 1))
                                    .tint(.ancAccent)
                            }
                        }

                        if obj.keyResults.isEmpty {
                            Text("No key results")
                                .font(.inter(11))
                                .foregroundColor(.ancMuted)
                        }
                    }

                    if obj.id != filteredObjectives.last?.id {
                        Divider()
                    }
                }
            }
        }
    }

    // MARK: - Decisions

    private var decisionsCard: some View {
        DashboardCard(title: "Decision Log", icon: "doc.plaintext") {
            VStack(alignment: .leading, spacing: 8) {
                if store.decisions.isEmpty {
                    Text("No decisions logged")
                        .font(.inter(12))
                        .foregroundColor(.ancMuted)
                } else {
                    ForEach(store.decisions.prefix(5)) { decision in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(decision.title)
                                    .font(.inter(12, weight: .medium))
                                Spacer()
                                if let by = decision.decidedBy {
                                    Text(by)
                                        .font(.inter(10))
                                        .foregroundColor(.ancMuted)
                                }
                            }
                            if let rationale = decision.rationale {
                                Text(rationale)
                                    .font(.inter(11))
                                    .foregroundColor(.ancMuted)
                                    .lineLimit(2)
                            }
                            if !decision.tags.isEmpty {
                                HStack(spacing: 4) {
                                    ForEach(decision.tags, id: \.self) { tag in
                                        Text(tag)
                                            .font(.inter(9))
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 1)
                                            .background(Color.ancAccent.opacity(0.1))
                                            .foregroundColor(.ancAccent)
                                            .cornerRadius(3)
                                    }
                                }
                            }
                        }

                        if decision.id != store.decisions.prefix(5).last?.id {
                            Divider()
                        }
                    }
                }

                Button {
                    showNewDecision = true
                } label: {
                    Label("New Decision", systemImage: "plus")
                        .font(.inter(11))
                }
                .buttonStyle(.borderless)
                .sheet(isPresented: $showNewDecision) {
                    newDecisionSheet
                }
            }
        }
    }

    // MARK: - Slow Tasks

    private var slowTasksCard: some View {
        DashboardCard(title: "Slow Tasks", icon: "tortoise") {
            let runningTasks = store.tasks.filter { $0.state == .running }
                .sorted { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }
                .prefix(5)

            if runningTasks.isEmpty {
                Text("No running tasks")
                    .font(.inter(12))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(Array(runningTasks)) { task in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 6, height: 6)
                        Text(task.title)
                            .font(.inter(12))
                            .lineLimit(1)
                        Spacer()
                        if let ts = task.createdAt {
                            Text(relativeTime(ts))
                                .font(.inter(10))
                                .foregroundColor(.ancMuted)
                        }
                    }
                }
            }
        }
    }

    // MARK: - New Objective Sheet

    private var newObjectiveSheet: some View {
        VStack(spacing: 16) {
            Text("New Objective")
                .font(.inter(16, weight: .semibold))

            TextField("Title", text: $newObjectiveTitle)
                .textFieldStyle(.roundedBorder)

            TextField("Description (optional)", text: $newObjectiveDescription)
                .textFieldStyle(.roundedBorder)

            HStack {
                Spacer()
                Button("Cancel") {
                    showNewObjective = false
                    newObjectiveTitle = ""
                    newObjectiveDescription = ""
                }
                Button("Create") {
                    let title = newObjectiveTitle
                    let desc = newObjectiveDescription
                    showNewObjective = false
                    newObjectiveTitle = ""
                    newObjectiveDescription = ""
                    Task {
                        await store.createObjective(
                            title: title,
                            description: desc.isEmpty ? nil : desc,
                            quarter: nil
                        )
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(newObjectiveTitle.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 400)
    }

    // MARK: - New Decision Sheet

    @State private var newDecisionTags = ""

    private var newDecisionSheet: some View {
        VStack(spacing: 16) {
            Text("New Decision")
                .font(.inter(16, weight: .semibold))

            TextField("Title", text: $newDecisionTitle)
                .textFieldStyle(.roundedBorder)

            TextField("Rationale", text: $newDecisionRationale)
                .textFieldStyle(.roundedBorder)

            TextField("Tags (comma-separated)", text: $newDecisionTags)
                .textFieldStyle(.roundedBorder)

            HStack {
                Spacer()
                Button("Cancel") {
                    showNewDecision = false
                    newDecisionTitle = ""
                    newDecisionRationale = ""
                    newDecisionTags = ""
                }
                Button("Create") {
                    let title = newDecisionTitle
                    let rationale = newDecisionRationale
                    let tags = newDecisionTags
                        .split(separator: ",")
                        .map { $0.trimmingCharacters(in: .whitespaces) }
                        .filter { !$0.isEmpty }
                    showNewDecision = false
                    newDecisionTitle = ""
                    newDecisionRationale = ""
                    newDecisionTags = ""
                    Task {
                        await store.createDecision(
                            title: title,
                            rationale: rationale.isEmpty ? nil : rationale,
                            tags: tags
                        )
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(newDecisionTitle.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 400)
    }
}

// MARK: - Dashboard Card

struct DashboardCard<Content: View>: View {
    let title: String
    let icon: String
    let content: () -> Content

    init(title: String, icon: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.inter(12))
                    .foregroundColor(.ancAccent)
                Text(title)
                    .font(.inter(12, weight: .semibold))
            }

            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.ancSurface)
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.ancBorder, lineWidth: 1))
    }
}
