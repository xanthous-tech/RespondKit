import CryptoKit
import Foundation
import Security

/// Persistence failures are surfaced: the SDK never silently falls back to a new identity.
@MainActor public protocol RespondKitPersistence {
  func load() throws -> Data?
  func save(_ data: Data) throws
}

/// A namespaced Keychain item; tokens are deliberately memory-only. Not synchronized via iCloud.
@MainActor public final class KeychainPersistence: RespondKitPersistence {
  private let account: String
  public init(scope: String) {
    account = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "dev.respondkit.native",
      kSecAttrAccount as String: account,
    ]
  }
  public func load() throws -> Data? {
    var query = query
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw failure(status) }
    return data
  }
  public func save(_ data: Data) throws {
    let attributes: [String: Any] = [kSecValueData as String: data]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      var item = query
      item[kSecValueData as String] = data
      item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let inserted = SecItemAdd(item as CFDictionary, nil)
      guard inserted == errSecSuccess else { throw failure(inserted) }
    } else if status != errSecSuccess {
      throw failure(status)
    }
  }
  private func failure(_ status: OSStatus) -> RespondKitError {
    RespondKitError(
      "Could not securely save or restore support history (\(status)).", code: "storage_error",
      retryable: true)
  }
}

@MainActor public final class MemoryPersistence: RespondKitPersistence {
  private var data: Data?
  public init() {}
  public func load() -> Data? { data }
  public func save(_ data: Data) { self.data = data }
}

struct StoredState: Codable {
  var selectedThreadID: String?
  var isStartingNewConversation: Bool?
  var userID: String?
  var installationID = newID("install")
  var newClientThreadID = newID("cthread")
  var statuses: [ThreadStatus] = []
  var messages: [String: [SupportMessage]] = [:]
  var cursors: [String: String] = [:]
  var readCursors: [String: String] = [:]
  var pendingReads: [String: String] = [:]
  var drafts: [String: String] = [:]
  var pending: [String: [PendingMessage]] = [:]
}
