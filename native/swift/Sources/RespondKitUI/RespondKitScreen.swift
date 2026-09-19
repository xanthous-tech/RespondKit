#if os(iOS)
  import SwiftUI
  import RespondKitCore

  private enum WidgetStyle {
    static let foreground = Color(white: 0.09)
    static let muted = Color(white: 0.45)
    static let fill = Color(white: 0.97)
    static let border = Color(white: 0.90)
    static let failure = Color(red: 0.86, green: 0.15, blue: 0.15)
  }

  /// One conversation, presented by the host's fullScreenCover. Matches the web widget's surfaces.
  public struct RespondKitScreen: View {
    private let store: RespondKitStore
    private let title: String
    private let accentColor: Color?
    private let accentForegroundColor: Color
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .body) private var titleSize = 16
    @ScaledMetric(relativeTo: .body) private var textSize = 14

    /// Omit accentColor to inherit the host tint (or system/app accent).
    /// Set accentForegroundColor to a dark color when using a light accent.
    public init(
      store: RespondKitStore, title: String = "Support", accentColor: Color? = nil,
      accentForegroundColor: Color = .white
    ) {
      self.store = store
      self.title = title
      self.accentColor = accentColor
      self.accentForegroundColor = accentForegroundColor
    }

    public var body: some View {
      Group {
        if let accentColor { screen.tint(accentColor) } else { screen }
      }
      .preferredColorScheme(.light)
    }

    private var screen: some View {
      VStack(spacing: 0) {
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.system(size: titleSize, weight: .semibold)).lineLimit(1).frame(
              minHeight: 24)
            Text("Ask us anything").font(.system(size: textSize)).foregroundStyle(WidgetStyle.muted)
              .frame(minHeight: 20)
          }
          Spacer(minLength: 0)
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark").font(.system(size: 16))
              .frame(width: 40, height: 40).contentShape(Rectangle())
          }
          .buttonStyle(.plain).accessibilityLabel("Close support chat")
          .accessibilityIdentifier("respondkit-close")
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        Rectangle().fill(WidgetStyle.border).frame(height: 1)
        if let error = store.errorMessage {
          HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle")
            Text(error).font(.system(size: textSize))
            Spacer(minLength: 0)
            Button("Retry") { Task { await store.refresh() } }
          }
          .padding(12).background(WidgetStyle.fill)
          .accessibilityIdentifier("respondkit-error")
        }
        ConversationView(store: store, accentForegroundColor: accentForegroundColor)
      }
      .foregroundStyle(WidgetStyle.foreground)
      .background(Color.white.ignoresSafeArea())
      .task { await store.openConversation() }
      .onDisappear { store.setScreenVisible(false) }
    }
  }

  private struct ConversationView: View {
    let store: RespondKitStore
    let accentForegroundColor: Color
    @State private var atBottom = true
    @State private var unseen = 0
    @ScaledMetric(relativeTo: .body) private var textSize = 14

    var body: some View {
      let rows = TranscriptRow.rows(store)
      VStack(spacing: 0) {
        GeometryReader { geometry in
          ScrollViewReader { reader in
            ScrollView {
              LazyVStack(spacing: 12) {
                if rows.isEmpty {
                  if store.isLoading && !store.isSending {
                    VStack(spacing: 16) {
                      ForEach(0..<3) { index in
                        RoundedRectangle(cornerRadius: 10).fill(WidgetStyle.fill)
                          .frame(
                            width: max(0, geometry.size.width - 32) * [0.75, 0.8, 0.67][index],
                            height: [56.0, 80.0, 48.0][index]
                          )
                          .frame(maxWidth: .infinity, alignment: index == 1 ? .leading : .trailing)
                      }
                    }.accessibilityLabel("Loading messages")
                  } else {
                    VStack(spacing: 4) {
                      Text("How can we help?").fontWeight(.medium)
                      Text("Send a message and keep this page open for a quick reply.")
                        .foregroundStyle(WidgetStyle.muted)
                    }
                    .font(.system(size: textSize)).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                  }
                }
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                  if let date = row.date,
                    index == 0
                      || rows[index - 1].date.map({
                        !Calendar.current.isDate($0, inSameDayAs: date)
                      }) != false
                  {
                    Text(date.formatted(date: .abbreviated, time: .omitted))
                      .font(.caption).foregroundStyle(WidgetStyle.muted).padding(.vertical, 8)
                  }
                  MessageBubble(
                    row: row, maxWidth: max(0, (geometry.size.width - 32) * 0.84),
                    isSending: store.isSending
                  ) { id in Task { await store.retry(id) } }
                }
                if !rows.isEmpty {
                  Color.clear.frame(height: 2)
                    .onScrollVisibilityChange(threshold: 1) { visible in
                      atBottom = visible
                      if visible { unseen = 0 }
                      guard visible, let id = store.activeThreadID else { return }
                      let cursor = store.loadedCursor
                      Task { await store.markDisplayed(threadID: id, cursor: cursor) }
                    }
                    // Recreate the visibility observer when a new transcript cursor loads.
                    .id("bottom-" + store.loadedCursor)
                }
              }
              .frame(
                maxWidth: .infinity, minHeight: max(0, geometry.size.height - 40),
                alignment: rows.isEmpty
                  ? (store.isLoading && !store.isSending ? .top : .center) : .bottom
              )
              .padding(.horizontal, 16).padding(.vertical, 20)
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .onChange(of: rows.map(\.id)) { old, new in
              if atBottom || old.isEmpty {
                reader.scrollTo("bottom-" + store.loadedCursor, anchor: .bottom)
              } else {
                unseen += new.filter { !old.contains($0) }.count
              }
            }
            .onChange(of: store.activeThreadID) { _, _ in
              atBottom = true
              unseen = 0
            }
            .overlay(alignment: .bottomTrailing) {
              if unseen > 0 {
                Button {
                  withAnimation { reader.scrollTo("bottom-" + store.loadedCursor, anchor: .bottom) }
                  unseen = 0
                } label: {
                  Label("\(unseen) new", systemImage: "arrow.down")
                    .font(.system(size: textSize)).padding(.horizontal, 12).padding(.vertical, 8)
                    .background(.white, in: Capsule()).overlay(Capsule().stroke(WidgetStyle.border))
                }
                .buttonStyle(.plain).padding(12).accessibilityLabel("Latest messages")
              }
            }
          }
        }
        Rectangle().fill(WidgetStyle.border).frame(height: 1)
        if store.activeThread?.state == "closed" {
          VStack(spacing: 8) {
            Text("This conversation is closed.").foregroundStyle(WidgetStyle.muted)
            Button("Send another message") { store.selectThread(nil) }
          }.font(.system(size: textSize)).padding(12)
        } else {
          Composer(store: store, accentForegroundColor: accentForegroundColor)
        }
      }
    }
  }

  private struct Composer: View {
    let store: RespondKitStore
    let accentForegroundColor: Color
    @FocusState private var focused: Bool
    @ScaledMetric(relativeTo: .body) private var inputSize = 16
    private var canSend: Bool {
      !store.isLoading && !store.isSending
        && !store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && store.draft.utf16.count <= 6_000
    }
    var body: some View {
      HStack(alignment: .bottom, spacing: 8) {
        TextField(
          "Write a message…", text: Binding(get: { store.draft }, set: { store.setDraft($0) }),
          axis: .vertical
        )
        .font(.system(size: inputSize)).lineLimit(1...6).focused($focused)
        .padding(.horizontal, 10).padding(.vertical, 10).frame(minHeight: 44)
        .overlay(
          RoundedRectangle(cornerRadius: 12).strokeBorder(
            focused ? AnyShapeStyle(.tint) : AnyShapeStyle(WidgetStyle.border))
        )
        .accessibilityLabel("Message").accessibilityIdentifier("respondkit-composer")
        Button {
          Task { await store.sendDraft() }
        } label: {
          Image(systemName: "paperplane").font(.system(size: 16))
            .foregroundStyle(accentForegroundColor).frame(width: 44, height: 44)
            .background(.tint, in: RoundedRectangle(cornerRadius: 12))
            .opacity(canSend ? 1 : 0.5)
        }
        .buttonStyle(.plain).disabled(!canSend)
        .accessibilityLabel("Send message").accessibilityIdentifier("respondkit-send")
      }.padding(12)
    }
  }

  private struct MessageBubble: View {
    let row: TranscriptRow
    let maxWidth: CGFloat
    let isSending: Bool
    let retry: (String) -> Void
    @ScaledMetric(relativeTo: .body) private var textSize = 14
    @ScaledMetric(relativeTo: .caption) private var captionSize = 12
    var body: some View {
      VStack(alignment: row.customer ? .trailing : .leading, spacing: 4) {
        Text(linkedMessage(row.text)).font(.system(size: textSize)).lineSpacing(5).textSelection(.enabled)
          .foregroundStyle(row.failed ? WidgetStyle.failure : WidgetStyle.foreground)
          .padding(.horizontal, 12).padding(.vertical, 10)
          .background(
            row.failed
              ? AnyShapeStyle(WidgetStyle.failure.opacity(0.1))
              : row.customer
                ? AnyShapeStyle(.tint.opacity(0.1)) : AnyShapeStyle(WidgetStyle.fill),
            in: UnevenRoundedRectangle(
              topLeadingRadius: 16, bottomLeadingRadius: row.customer ? 16 : 4,
              bottomTrailingRadius: row.customer ? 4 : 16, topTrailingRadius: 16))
        HStack(spacing: 8) {
          if let date = row.date { Text(date.formatted(date: .omitted, time: .shortened)) }
          if let status = row.status { Text(status) }
          if let id = row.retryID {
            Button {
              retry(id)
            } label: {
              Label("Try again", systemImage: "exclamationmark.circle")
            }
            .buttonStyle(.plain).foregroundStyle(
              row.failed ? AnyShapeStyle(WidgetStyle.failure) : AnyShapeStyle(.tint)
            )
            .disabled(isSending)
          }
        }.font(.system(size: captionSize)).frame(minHeight: 20).foregroundStyle(WidgetStyle.muted)
          .padding(
            .horizontal, 4)
      }
      .frame(maxWidth: maxWidth, alignment: row.customer ? .trailing : .leading)
      .frame(maxWidth: .infinity, alignment: row.customer ? .trailing : .leading)
    }
  }
#endif
