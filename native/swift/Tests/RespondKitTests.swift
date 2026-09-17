import Foundation
import Testing

@testable import RespondKitCore

private func fixture<T: Decodable>(_ key: String, as: T.Type = T.self) throws -> T {
  let url = Bundle.module.url(
    forResource: "protocol", withExtension: "json", subdirectory: "fixtures")!
  let root = try JSONDecoder().decode([String: JSONValue].self, from: Data(contentsOf: url))
  return try JSONDecoder().decode(T.self, from: JSONEncoder().encode(root[key]!))
}

actor FakeAPI: RespondKitAPI {
  var statusPages: [String: StatusPage] = [:]
  var messagePages: [String: MessagePage] = [:]
  var sessionCalls = 0
  var sent: [(String, String)] = []
  var reads: [(String, String)] = []
  var createIDs: [String] = []
  var failSend = false
  var failRead = false
  var failStatuses = false
  var unauthorizedOnce = false
  var suspendStatuses = false
  var statusContinuation: CheckedContinuation<Void, Never>?
  func seed() throws {
    let page: StatusPage = try fixture("statuses")
    statusPages[""] = StatusPage(threads: page.threads, nextCursor: "page_two")
    let second = SupportThread(
      id: "thread_two", clientThreadId: "cthread_two", state: "closed",
      createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z")
    statusPages["page_two"] = StatusPage(
      threads: [ThreadStatus(thread: second, latestReplyCursor: "2")], nextCursor: nil)
    messagePages["thread_one"] = try fixture("messages")
  }
  func configure(
    failSend: Bool = false, failRead: Bool = false, failStatuses: Bool = false,
    unauthorizedOnce: Bool = false
  ) {
    self.failSend = failSend
    self.failRead = failRead
    self.failStatuses = failStatuses
    self.unauthorizedOnce = unauthorizedOnce
  }
  func createSession(installationID: String, context: CustomerContext, identityToken: String?)
    async throws -> ClientSession
  {
    sessionCalls += 1
    let result: SessionResponse = try fixture("session")
    return result.session
  }
  func statuses(token: String, after: String?) async throws -> StatusPage {
    if suspendStatuses { await withCheckedContinuation { statusContinuation = $0 } }
    if unauthorizedOnce {
      unauthorizedOnce = false
      throw RespondKitError("Expired", status: 401)
    }
    if failStatuses { throw RespondKitError("Offline", retryable: true) }
    return statusPages[after ?? ""] ?? StatusPage(threads: [], nextCursor: nil)
  }
  func createThread(token: String, clientThreadID: String) async throws -> SupportThread {
    createIDs.append(clientThreadID)
    return SupportThread(
      id: "thread_new", clientThreadId: clientThreadID, state: "open",
      createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z")
  }
  func messages(token: String, threadID: String, after: String) async throws -> MessagePage {
    messagePages[threadID]
      ?? MessagePage(threadId: threadID, messages: [], nextCursor: "0", hasMore: false)
  }
  func send(token: String, threadID: String, clientMessageID: String, text: String) async throws
    -> Acceptance
  {
    sent.append((clientMessageID, text))
    if failSend { throw RespondKitError("Connection lost after acceptance", retryable: true) }
    return Acceptance(
      messageId: "message_new", clientMessageId: clientMessageID, status: "accepted", message: nil,
      failureCode: nil)
  }
  func markRead(token: String, threadID: String, cursor: String) async throws {
    reads.append((threadID, cursor))
    if failRead { throw RespondKitError("Offline", retryable: true) }
  }
  func logout(token: String) async throws {}
  func setSuspend(_ value: Bool) { suspendStatuses = value }
  func resume() {
    suspendStatuses = false
    statusContinuation?.resume()
    statusContinuation = nil
  }
  func replaceMessages(_ value: MessagePage) { messagePages[value.threadId] = value }
}

@MainActor
struct StoreTests {
  func make(_ api: FakeAPI, storage: MemoryPersistence = MemoryPersistence()) throws
    -> RespondKitStore
  {
    let config = try RespondKitConfiguration(
      baseURL: URL(string: "https://support.example.com")!, inboxID: "inbox_test",
      origin: "https://example.com")
    return try RespondKitStore(configuration: config, persistence: storage, api: api)
  }
  @Test func contractAndNumericCursors() throws {
    let page: MessagePage = try fixture("messages")
    #expect(page.messages[0].text == "你好！我們可以幫忙。")
    #expect(try replyCursor("10") > replyCursor("2"))
    for invalid in ["01", "-1", "1.2", "9007199254740992", "", "１２"] {
      #expect(throws: RespondKitError.self) { try replyCursor(invalid) }
    }
    let accepted: SendResponse = try fixture("acceptance")
    #expect(accepted.acceptance.status == "acceptance_unknown")
  }
  @Test func unopenedScreenRestoresPaginatedUnreadAndSurvivesOfflineRestart() async throws {
    let api = FakeAPI()
    try await api.seed()
    let storage = MemoryPersistence()
    let store = try make(api, storage: storage)
    await store.refresh()
    #expect(store.statuses.count == 2)
    #expect(store.hasUnreadReplies)
    #expect(await api.reads.isEmpty)
    await api.configure(failStatuses: true)
    let restored = try make(api, storage: storage)
    await restored.refresh()
    #expect(restored.hasUnreadReplies)
    #expect(restored.errorMessage != nil)
  }
  @Test func openingHistoryDoesNotReadAndOnlyDisplayedThreadClears() async throws {
    let api = FakeAPI()
    try await api.seed()
    let store = try make(api)
    store.setForeground(true)
    defer { store.setForeground(false) }
    store.setScreenVisible(true)
    await store.refresh()
    #expect(await api.reads.isEmpty)
    store.selectThread("thread_one")
    await store.refresh()
    await store.markDisplayed(threadID: "thread_one", cursor: "10")
    #expect(!store.isUnread("thread_one"))
    #expect(store.isUnread("thread_two"))
    #expect(store.hasUnreadReplies)
    #expect(await api.reads.contains { $0.0 == "thread_one" && $0.1 == "10" })
  }
  @Test func staleOrBackgroundVisibilityNeverMarksRead() async throws {
    let api = FakeAPI()
    try await api.seed()
    let store = try make(api)
    store.setScreenVisible(true)
    store.selectThread("thread_one")
    await store.refresh()
    await store.markDisplayed(threadID: "thread_one", cursor: "10")
    #expect(await api.reads.isEmpty)
    store.setForeground(true)
    defer { store.setForeground(false) }
    await store.markDisplayed(threadID: "thread_one", cursor: "2")
    #expect(store.isUnread("thread_one"))
  }
  @Test func readAckRetriesWithoutRelightingLocalBadge() async throws {
    let api = FakeAPI()
    try await api.seed()
    await api.configure(failRead: true)
    let storage = MemoryPersistence()
    let store = try make(api, storage: storage)
    store.setForeground(true)
    defer { store.setForeground(false) }
    store.setScreenVisible(true)
    store.selectThread("thread_one")
    await store.refresh()
    await store.markDisplayed(threadID: "thread_one", cursor: "10")
    #expect(!store.isUnread("thread_one"))
    let restored = try make(api, storage: storage)
    #expect(!restored.isUnread("thread_one"))
    await api.configure()
    await restored.refresh()
    #expect(await api.reads.count >= 2)
  }
  @Test func ambiguousSendKeepsIDAndTextAcrossRestart() async throws {
    let api = FakeAPI()
    await api.configure(failSend: true)
    let storage = MemoryPersistence()
    let store = try make(api, storage: storage)
    store.setDraft("Original text")
    await store.sendDraft()
    let pending = try #require(store.pendingMessages.first)
    #expect(pending.delivery == "acceptance_unknown")
    let restored = try make(api, storage: storage)
    restored.selectThread("thread_new")
    restored.setDraft("Different draft")
    await api.configure()
    await restored.retry(pending.id)
    let sent = await api.sent
    #expect(sent.count == 2)
    #expect(sent[0].0 == sent[1].0 && sent[0].1 == sent[1].1)
    #expect(restored.draft == "Different draft")
    #expect(await api.createIDs.count == 1)
  }
  @Test func unauthorizedRenewsOnce() async throws {
    let api = FakeAPI()
    try await api.seed()
    await api.configure(unauthorizedOnce: true)
    let store = try make(api)
    await store.refresh()
    #expect(store.hasUnreadReplies)
    #expect(await api.sessionCalls == 2)
  }
  @Test func identitySwitchRejectsLateResponses() async throws {
    let api = FakeAPI()
    try await api.seed()
    await api.setSuspend(true)
    let store = try make(api)
    let task = Task { await store.refresh() }
    while await api.statusContinuation == nil { await Task.yield() }
    try store.updateIdentity(context: CustomerContext(userId: "bob"))
    await api.resume()
    await task.value
    #expect(store.statuses.isEmpty)
    #expect(!store.hasUnreadReplies)
    #expect(store.messages.isEmpty)
  }
  @Test func messageRevisionsReplaceRatherThanAppend() async throws {
    let api = FakeAPI()
    try await api.seed()
    let store = try make(api)
    store.setScreenVisible(true)
    store.selectThread("thread_one")
    await store.refresh()
    let revised = SupportMessage(
      id: "message_one", threadId: "thread_one", clientMessageId: nil,
      direction: "operator_to_customer", text: "Revised", language: "en",
      acceptedAt: "2026-09-17T00:00:00Z", state: "available")
    await api.replaceMessages(
      MessagePage(threadId: "thread_one", messages: [revised], nextCursor: "11", hasMore: false))
    await store.refresh()
    #expect(store.messages.count == 1)
    #expect(store.messages[0].text == "Revised")
  }
  @Test func failedCanonicalMessageCanStillBeRetried() async throws {
    let api = FakeAPI()
    try await api.seed()
    let failed = SupportMessage(
      id: "failed_one", threadId: "thread_one", clientMessageId: "cmsg_failed",
      direction: "customer_to_operator", text: "Original", language: nil,
      acceptedAt: "2026-09-17T00:00:00Z", state: "failed")
    await api.replaceMessages(
      MessagePage(threadId: "thread_one", messages: [failed], nextCursor: "10", hasMore: false))
    let store = try make(api)
    store.selectThread("thread_one")
    store.setScreenVisible(true)
    await store.refresh()
    #expect(store.pendingMessages.first?.id == "cmsg_failed")
    await store.retry("cmsg_failed")
    #expect(await api.sent.first?.0 == "cmsg_failed")
    #expect(await api.sent.first?.1 == "Original")
  }

}
