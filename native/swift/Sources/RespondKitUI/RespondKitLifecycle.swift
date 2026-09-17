#if os(iOS)
  import SwiftUI
  import RespondKitCore

  private struct RespondKitLifecycle: ViewModifier {
    let store: RespondKitStore
    @Environment(\.scenePhase) private var scenePhase
    func body(content: Content) -> some View {
      content
        .onChange(of: scenePhase, initial: true) { _, phase in store.setForeground(phase == .active)
        }
    }
  }
  extension View {
    /// Apply to a stable root outside fullScreenCover so unread state refreshes while chat is closed.
    public func respondKitLifecycle(_ store: RespondKitStore) -> some View {
      modifier(RespondKitLifecycle(store: store))
    }
  }
#endif
