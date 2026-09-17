#if os(iOS)
  import SwiftUI
  import RespondKitCore

  /// Present with the host's fullScreenCover. No launcher, badge or global presentation is installed.
  public struct RespondKitScreen: View {
    private let store: RespondKitStore
    private let title: String
    private let accentColor: Color?
    @Environment(\.dismiss) private var dismiss
    @State private var conversation = false

    /// Omit accentColor to inherit the host tint (or the system/app accent).
    public init(store: RespondKitStore, title: String = "Support", accentColor: Color? = nil) {
      self.store = store
      self.title = title
      self.accentColor = accentColor
    }

    public var body: some View {
      if let accentColor {
        screen.tint(accentColor)
      } else {
        screen
      }
    }

    private var screen: some View {
      NavigationStack {
        Group {
          if conversation { ConversationView(store: store) } else { history }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            if conversation {
              Button {
                conversation = false
                store.selectThread(nil)
              } label: {
                Image(systemName: "chevron.left")
              }
              .accessibilityLabel("Conversations")
            } else {
              Button("Close") { dismiss() }.accessibilityIdentifier("respondkit-close")
            }
          }
          if conversation {
            ToolbarItem(placement: .confirmationAction) { Button("Close") { dismiss() } }
          }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
          if let error = store.errorMessage {
            HStack {
              Text(error).font(.footnote)
              Spacer()
              Button("Retry") { Task { await store.refresh() } }
            }
            .padding().background(.regularMaterial)
            .accessibilityIdentifier("respondkit-error")
          }
        }
        .overlay {
          if store.isLoading && store.statuses.isEmpty && !conversation { ProgressView() }
        }
      }
      .task {
        store.setScreenVisible(true)
        await store.refresh()
      }
      .onDisappear { store.setScreenVisible(false) }
    }

    private var history: some View {
      List {
        Section {
          Button {
            store.selectThread(nil)
            conversation = true
          } label: {
            Label("New conversation", systemImage: "square.and.pencil")
          }
          .accessibilityIdentifier("respondkit-new")
        }
        Section {
          ForEach(store.statuses, id: \.thread.id) { status in
            Button {
              store.selectThread(status.thread.id)
              conversation = true
              Task { await store.refresh() }
            } label: {
              HStack {
                VStack(alignment: .leading, spacing: 4) {
                  Text("Conversation \(String(status.thread.id.suffix(6)))")
                  Text(status.thread.state == "closed" ? "Closed" : "Open")
                    .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if store.isUnread(status.thread.id) {
                  Circle().fill(.red).frame(width: 8, height: 8)
                    .accessibilityLabel("Unread support reply")
                }
                Image(systemName: "chevron.right").foregroundStyle(.secondary)
              }
            }
            .accessibilityIdentifier("respondkit-thread-\(status.thread.id)")
          }
        } footer: {
          Text("Your replies will appear here when you return to the app.")
        }
      }
      .refreshable { await store.refresh() }
    }
  }

  private struct ConversationView: View {
    let store: RespondKitStore
    var body: some View {
      VStack(spacing: 0) {
        ScrollViewReader { reader in
          ScrollView {
            LazyVStack(spacing: 14) {
              if store.messages.isEmpty && store.pendingMessages.isEmpty {
                ContentUnavailableView(
                  "How can we help?", systemImage: "bubble.left.and.bubble.right",
                  description: Text("Send a message to start a conversation."))
              }
              ForEach(store.messages) { message in
                MessageBubble(
                  text: message.text, customer: message.direction == "customer_to_operator",
                  status: message.state == "failed" ? "Failed" : nil)
              }
              ForEach(
                store.pendingMessages.filter { pending in
                  !store.messages.contains { $0.clientMessageId == pending.id }
                }
              ) { pending in
                MessageBubble(
                  text: pending.text, customer: true, status: delivery(pending.delivery))
              }
              ForEach(
                store.pendingMessages.filter {
                  ["failed", "acceptance_unknown"].contains($0.delivery)
                }
              ) { pending in
                Button("Retry message") { Task { await store.retry(pending.id) } }
                  .frame(maxWidth: .infinity, alignment: .trailing)
              }
              Color.clear.frame(height: 2)
                .id("bottom-" + store.loadedCursor)
                .onScrollVisibilityChange(threshold: 1) { visible in
                  guard visible, let id = store.activeThreadID else { return }
                  let cursor = store.loadedCursor
                  Task { await store.markDisplayed(threadID: id, cursor: cursor) }
                }
            }.padding()
          }
          .defaultScrollAnchor(.bottom, for: .initialOffset)
          .overlay(alignment: .bottomTrailing) {
            Button {
              withAnimation { reader.scrollTo("bottom-" + store.loadedCursor, anchor: .bottom) }
            } label: {
              Image(systemName: "arrow.down.circle.fill").font(.title)
            }
            .padding().accessibilityLabel("Latest messages")
          }
        }
        Divider()
        if store.activeThread?.state == "closed" {
          Text("This conversation is closed. Start a new conversation for more help.")
            .font(.footnote).foregroundStyle(.secondary).padding()
        } else {
          HStack(alignment: .bottom) {
            TextField(
              "Message", text: Binding(get: { store.draft }, set: { store.setDraft($0) }),
              axis: .vertical
            )
            .lineLimit(1...6).textFieldStyle(.roundedBorder)
            .accessibilityIdentifier("respondkit-composer")
            Button {
              Task { await store.sendDraft() }
            } label: {
              Image(systemName: "arrow.up.circle.fill").font(.title)
            }
            .disabled(
              store.isLoading || store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || store.draft.utf16.count > 6_000
            )
            .accessibilityLabel("Send message").accessibilityIdentifier("respondkit-send")
          }.padding()
        }
      }
    }
    private func delivery(_ value: String) -> String {
      switch value {
      case "sending": "Sending…"
      case "accepted": "Sent"
      case "failed": "Failed"
      default: "Not confirmed — retry safely"
      }
    }
  }
  private struct MessageBubble: View {
    let text: String
    let customer: Bool
    let status: String?
    var body: some View {
      HStack {
        if customer { Spacer(minLength: 36) }
        VStack(alignment: customer ? .trailing : .leading, spacing: 4) {
          Text(text).textSelection(.enabled).padding(12)
            .background(
              customer
                ? AnyShapeStyle(.tint.opacity(0.15)) : AnyShapeStyle(Color.secondary.opacity(0.12)),
              in: RoundedRectangle(cornerRadius: 16))
          if let status { Text(status).font(.caption).foregroundStyle(.secondary) }
        }
        if !customer { Spacer(minLength: 36) }
      }
    }
  }
#endif
