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
  @State private var showingSupport = ProcessInfo.processInfo.arguments.contains("--open-support")
  @State private var accent = "Indigo"
  private let options = ["Inherit", "Indigo", "Rose", "Teal"]
  private var accentColor: Color? {
    switch accent {
    case "Indigo": Color(red: 67 / 255, green: 45 / 255, blue: 215 / 255)
    case "Rose": Color(red: 199 / 255, green: 0, blue: 54 / 255)
    case "Teal": Color(red: 0, green: 120 / 255, blue: 111 / 255)
    default: nil
    }
  }
  private func argument(_ key: String, fallback: String) -> String {
    let args = ProcessInfo.processInfo.arguments
    guard let index = args.firstIndex(of: key), index + 1 < args.count else { return fallback }
    return args[index + 1]
  }
  private var apiURL: String { argument("--api-url", fallback: "http://127.0.0.1:8789") }
  private var inboxID: String { argument("--inbox-id", fallback: "inbox_demo") }

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
          Picker("Widget accent", selection: $accent) {
            ForEach(options, id: \.self) { Text($0).tag($0) }
          }.pickerStyle(.segmented)
          Text("Widget accent · Inherit uses the app tint").font(.caption).foregroundStyle(
            .secondary)
          Text(apiURL + "\n" + inboxID).font(.caption).foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        .padding(32)
        .respondKitLifecycle(store)
        .fullScreenCover(isPresented: $showingSupport) {
          RespondKitScreen(store: store, title: "Example support", accentColor: accentColor)
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
          baseURL: URL(string: apiURL)!, inboxID: inboxID,
          origin: argument("--origin", fallback: "http://localhost:8789"), pollInterval: .seconds(2)
        )
        store = try RespondKitStore(
          configuration: configuration, context: .init(locale: "en"),
          persistence: ProcessInfo.processInfo.arguments.contains("--uitesting")
            ? MemoryPersistence() : nil)
      } catch { self.error = error.localizedDescription }
    }
  }
}
