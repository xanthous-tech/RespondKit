#if os(iOS)
  import Foundation
  import RespondKitCore

  struct TranscriptRow: Identifiable {
    let id: String
    let text: String
    let customer: Bool
    let date: Date?
    let status: String?
    let retryID: String?
    let failed: Bool

    @MainActor static func rows(_ store: RespondKitStore) -> [Self] {
      let canonical = Set(store.messages.compactMap(\.clientMessageId))
      return store.messages.map { message in
        let pending = store.pendingMessages.first { $0.id == message.clientMessageId }
        return Self(
          id: message.id, text: message.text, customer: message.direction == "customer_to_operator",
          date: parseDate(message.acceptedAt),
          status: message.direction == "customer_to_operator"
            ? (message.state == "failed" ? "Failed" : "Sent") : nil,
          retryID: pending.flatMap {
            ["failed", "acceptance_unknown"].contains($0.delivery) ? $0.id : nil
          },
          failed: message.state == "failed")
      }
        + store.pendingMessages.filter { !canonical.contains($0.id) }.map { pending in
          Self(
            id: pending.id, text: pending.text, customer: true, date: parseDate(pending.acceptedAt),
            status: pending.delivery == "sending"
              ? "Sending…"
              : pending.delivery == "accepted"
                ? "Sent" : pending.delivery == "failed" ? "Failed" : "Confirming…",
            retryID: ["failed", "acceptance_unknown"].contains(pending.delivery) ? pending.id : nil,
            failed: pending.delivery == "failed")
        }
    }

    private static func parseDate(_ value: String) -> Date? {
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
  }
#endif
