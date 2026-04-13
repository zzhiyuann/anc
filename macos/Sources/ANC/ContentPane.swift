import SwiftUI

struct ContentPane: View {
    @EnvironmentObject var store: AppStore
    let selection: NavItem

    var body: some View {
        Group {
            switch selection {
            case .tasks:
                TaskListView()
            case .inbox:
                InboxView()
            case .dashboard:
                PulseView()
            case .projects:
                projectsContent
            case .members:
                membersContent
            case .views:
                placeholder("Views", subtitle: "Custom views coming soon")
            case .settings:
                SettingsView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.ancBackground)
    }

    // MARK: - Projects with detail navigation

    @ViewBuilder
    private var projectsContent: some View {
        if let projectId = store.selectedProjectId {
            VStack(spacing: 0) {
                // Back button
                HStack {
                    Button {
                        store.selectedProjectId = nil
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 11))
                            Text("Projects")
                                .font(.system(size: 12))
                        }
                    }
                    .buttonStyle(.borderless)
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                Divider()

                ProjectDetailView(projectId: projectId)
            }
        } else {
            ProjectsView()
        }
    }

    // MARK: - Members with detail navigation

    @ViewBuilder
    private var membersContent: some View {
        if let role = store.selectedAgentRole {
            VStack(spacing: 0) {
                // Back button
                HStack {
                    Button {
                        store.selectedAgentRole = nil
                        store.agentDetail = nil
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 11))
                            Text("Members")
                                .font(.system(size: 12))
                        }
                    }
                    .buttonStyle(.borderless)
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                Divider()

                AgentDetailView(role: role)
            }
        } else {
            MembersView()
        }
    }

    @ViewBuilder
    private func placeholder(_ title: String, subtitle: String) -> some View {
        VStack(spacing: 6) {
            Text(title).font(.system(size: 22, weight: .semibold))
            Text(subtitle).font(.system(size: 13)).foregroundColor(.ancMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
