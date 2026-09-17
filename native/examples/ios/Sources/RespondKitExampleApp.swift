import RespondKitCore
import RespondKitUI
import SwiftUI

@main
struct RespondKitExampleApp: App {
  var body: some Scene { WindowGroup { ExampleRoot() } }
}

private struct ExampleRoot: View {
  @State private var store: RespondKitStore?
  @State private var error: String?
  @State private var showingSupport = false

  var body: some View {
    Group {
      if let store {
        VStack(spacing: 24) {
          Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 48)).foregroundStyle(
            .tint)
          Text("Your app, your controls").font(.title.bold())
          Text("RespondKit supplies the conversation. You choose how people open it.")
            .multilineTextAlignment(.center).foregroundStyle(.secondary)
          Button {
            showingSupport = true
          } label: {
            HStack {
              Text("Contact support")
              if store.hasUnreadReplies {
                Circle().fill(.red).frame(width: 8, height: 8)
                  .accessibilityLabel("Unread support reply").accessibilityIdentifier("host-unread")
              }
            }
          }
          .buttonStyle(.borderedProminent).accessibilityIdentifier("host-support")
          Button("Report a problem") { showingSupport = true }
            .accessibilityIdentifier("host-secondary-trigger")
          Text("Local demo · localhost:8789").font(.caption).foregroundStyle(.secondary)
        }
        .padding(32)
        .respondKitLifecycle(store)
        .fullScreenCover(isPresented: $showingSupport) {
          RespondKitScreen(store: store, title: "Example support")
        }
      } else if let error {
        ContentUnavailableView(
          "Support setup failed", systemImage: "exclamationmark.bubble", description: Text(error))
      } else {
        ProgressView()
      }
    }
    .task {
      guard store == nil else { return }
      do {
        let configuration = try RespondKitConfiguration(
          baseURL: URL(string: "http://127.0.0.1:8789")!, inboxID: "inbox_demo",
          origin: "http://localhost:8789", pollInterval: .seconds(2))
        store = try RespondKitStore(
          configuration: configuration, context: .init(locale: "en"),
          persistence: ProcessInfo.processInfo.arguments.contains("--uitesting")
            ? MemoryPersistence() : nil)
      } catch { self.error = error.localizedDescription }
    }
  }
}
