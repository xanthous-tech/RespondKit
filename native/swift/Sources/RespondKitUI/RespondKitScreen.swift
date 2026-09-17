#if os(iOS)
  import SwiftUI
  import RespondKitCore

  /// Present with the host's fullScreenCover. No launcher, badge or global presentation is installed.
  public struct RespondKitScreen: View {
    private let store: RespondKitStore
    private let title: String
    private let accentColor: Color?
    @Environment(\.dismiss) private var dismiss

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
        ConversationView(store: store)
          .navigationTitle(title)
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button("Close") { dismiss() }.accessibilityIdentifier("respondkit-close")
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
            if store.isLoading && store.messages.isEmpty && !store.isSending { ProgressView() }
          }
      }
      .task {
        await store.openConversation()
      }
      .onDisappear { store.setScreenVisible(false) }
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
                  .disabled(store.isSending)
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
          VStack {
            Text("This conversation is closed.").font(.footnote).foregroundStyle(.secondary)
            Button("Send another message") { store.selectThread(nil) }
          }.padding()
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
              store.isLoading || store.isSending
                || store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
