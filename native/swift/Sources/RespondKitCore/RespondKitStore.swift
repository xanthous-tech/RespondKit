import Foundation
import Observation

/// Retain one store in the host app, independently of the presented screen.
@MainActor @Observable public final class RespondKitStore {
  public private(set) var statuses: [ThreadStatus] = []
  public private(set) var hasUnreadReplies = false
  public private(set) var activeThreadID: String?
  public private(set) var messages: [SupportMessage] = []
  public private(set) var pendingMessages: [PendingMessage] = []
  public private(set) var draft = ""
  public private(set) var loadedCursor = "0"
  public private(set) var isLoading = false
  public private(set) var errorMessage: String?
  public private(set) var isForeground = false
  public var activeThread: SupportThread? {
    statuses.first { $0.thread.id == activeThreadID }?.thread
  }

  @ObservationIgnored private let configuration: RespondKitConfiguration
  @ObservationIgnored private let api: any RespondKitAPI
  @ObservationIgnored private let persistence: any RespondKitPersistence
  @ObservationIgnored private var context: CustomerContext
  @ObservationIgnored private var identityToken: (@Sendable () async throws -> String)?
  @ObservationIgnored private var state: StoredState
  @ObservationIgnored private var session: ClientSession?
  @ObservationIgnored private var epoch = 0
  @ObservationIgnored private var pollTask: Task<Void, Never>?
  @ObservationIgnored private var screenVisible = false
  @ObservationIgnored private var locked = false
  @ObservationIgnored private var waiters: [CheckedContinuation<Void, Never>] = []

  public init(
    configuration: RespondKitConfiguration, context: CustomerContext = .init(),
    persistence: (any RespondKitPersistence)? = nil, api: (any RespondKitAPI)? = nil,
    identityToken: (@Sendable () async throws -> String)? = nil
  ) throws {
    self.configuration = configuration
    self.context = context
    self.identityToken = identityToken
    self.api = api ?? RespondKitClient(configuration: configuration)
    let storage = persistence ?? KeychainPersistence(scope: configuration.storageScope)
    self.persistence = storage
    var saved =
      try storage.load().map { try JSONDecoder().decode(StoredState.self, from: $0) }
      ?? StoredState(userID: context.userId)
    if saved.userID != context.userId { saved = StoredState(userID: context.userId) }
    // A process can terminate before acceptance arrives; retry the immutable pending payload.
    for key in saved.pending.keys {
      saved.pending[key] = saved.pending[key]?.map { message in
        var message = message
        if message.delivery == "sending" { message.delivery = "acceptance_unknown" }
        return message
      }
    }
    self.state = saved
    try storage.save(JSONEncoder().encode(saved))
    publish()
  }

  public func setForeground(_ active: Bool) {
    guard active != isForeground else { return }
    isForeground = active
    pollTask?.cancel()
    pollTask = nil
    guard active else { return }
    pollTask = Task { [weak self, interval = configuration.pollInterval] in
      while !Task.isCancelled {
        guard let self else { return }
        await self.refresh()
        do { try await Task.sleep(for: interval) } catch { return }
      }
    }
  }
  public func setScreenVisible(_ visible: Bool) { screenVisible = visible }
  public func selectThread(_ id: String?) {
    activeThreadID = id
    publish()
  }
  public func setDraft(_ text: String) {
    state.drafts[activeThreadID ?? "new"] = text
    persistOrReport()
    publish()
  }
  public func isUnread(_ threadID: String) -> Bool {
    guard let status = statuses.first(where: { $0.thread.id == threadID }) else { return false }
    return (Int64(status.latestReplyCursor) ?? 0) > (Int64(state.readCursors[threadID] ?? "0") ?? 0)
  }
  public func clearError() { errorMessage = nil }

  /// Call only after host authentication settles. A subject change isolates all cached state immediately.
  public func updateIdentity(
    context: CustomerContext, identityToken: (@Sendable () async throws -> String)? = nil
  ) throws {
    epoch += 1
    let oldSession = session
    let changed = self.context.userId != context.userId
    self.context = context
    self.identityToken = identityToken
    session = nil
    if changed {
      state = StoredState(userID: context.userId)
      activeThreadID = nil
      publish()
      try persist()
      if let oldSession {
        Task { [api] in
          // Revocation failure is observable, but never restores the old account's UI.
          do { try await api.logout(token: oldSession.token) } catch {
            self.errorMessage =
              "Previous support session could not be revoked. It will expire automatically."
          }
        }
      }
    }
    publish()
  }

  public func refresh() async {
    await operate { epoch in
      var all: [ThreadStatus] = []
      var after: String?
      var seen = Set<String>()
      repeat {
        let page = try await self.authorized(epoch) {
          try await self.api.statuses(token: $0, after: after)
        }
        try self.check(epoch)
        for status in page.threads { _ = try replyCursor(status.latestReplyCursor) }
        all += page.threads
        after = page.nextCursor
        if let after, !seen.insert(after).inserted {
          throw RespondKitError("Repeated history cursor.")
        }
      } while after != nil
      self.state.statuses = all.sorted { $0.thread.updatedAt > $1.thread.updatedAt }
      try self.persist()
      self.publish()
      if self.screenVisible, let id = self.activeThreadID { try await self.loadMessages(id, epoch) }
      try await self.flushReads(epoch)
    }
  }

  public func sendDraft() async {
    let text = draft
    let threadID = activeThreadID
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf16.count <= 6_000
    else {
      errorMessage = "Enter a message of up to 6,000 characters."
      return
    }
    await operate { epoch in
      if let threadID,
        self.state.statuses.first(where: { $0.thread.id == threadID })?.thread.state == "closed"
      {
        throw RespondKitError("This conversation is closed. Start a new conversation.")
      }
      let key = threadID ?? "new"
      let pending = PendingMessage(
        id: newID("cmsg"), text: text, acceptedAt: Date().ISO8601Format(), delivery: "sending")
      self.state.pending[key, default: []].append(pending)
      // Preserve edits made while another operation was finishing.
      if self.state.drafts[key] == text { self.state.drafts[key] = "" }
      try self.persist()
      self.publish()
      try await self.deliver(pending, threadID: threadID, epoch: epoch)
    }
  }
  public func retry(_ messageID: String) async {
    let id = activeThreadID
    await operate { epoch in
      guard let pending = self.state.pending[id ?? "new"]?.first(where: { $0.id == messageID })
      else { return }
      try await self.deliver(pending, threadID: id, epoch: epoch)
    }
  }

  /// Called by the SDK screen only after the end of the displayed transcript is visible.
  public func markDisplayed(threadID: String, cursor: String) async {
    guard isForeground, screenVisible, activeThreadID == threadID, loadedCursor == cursor,
      messages.contains(where: \.isReply)
    else { return }
    await operate { epoch in
      guard self.isForeground, self.screenVisible, self.activeThreadID == threadID,
        self.loadedCursor == cursor
      else { return }
      let value = try replyCursor(cursor)
      guard value > (Int64(self.state.readCursors[threadID] ?? "0") ?? 0) else { return }
      self.state.readCursors[threadID] = cursor
      self.state.pendingReads[threadID] = cursor
      try self.persist()
      self.publish()
      try await self.flushReads(epoch)
    }
  }

  private func deliver(_ pending: PendingMessage, threadID: String?, epoch: Int) async throws {
    var id = threadID
    do {
      if id == nil {
        let created = try await authorized(epoch) {
          try await self.api.createThread(token: $0, clientThreadID: self.state.newClientThreadID)
        }
        try check(epoch)
        id = created.id
        state.statuses.removeAll { $0.thread.id == created.id }
        state.statuses.insert(ThreadStatus(thread: created, latestReplyCursor: "0"), at: 0)
        state.pending[created.id, default: []] += state.pending.removeValue(forKey: "new") ?? []
        state.drafts[created.id] = state.drafts.removeValue(forKey: "new")
        state.newClientThreadID = newID("cthread")
        activeThreadID = created.id
        try persist()
        publish()
      }
      guard let id else { return }
      setDelivery(pending.id, threadID: id, value: "sending")
      try persist()
      publish()
      let accepted = try await authorized(epoch) {
        try await self.api.send(
          token: $0, threadID: id, clientMessageID: pending.id, text: pending.text)
      }
      try check(epoch)
      setDelivery(
        pending.id, threadID: id,
        value: accepted.status == "failed"
          ? "failed" : accepted.status == "acceptance_unknown" ? "acceptance_unknown" : "accepted")
      try persist()
      publish()
      try await loadMessages(id, epoch)
    } catch {
      guard epoch == self.epoch else { throw error }
      setDelivery(pending.id, threadID: id ?? "new", value: "acceptance_unknown")
      try persist()
      publish()
      throw error
    }
  }
  private func loadMessages(_ id: String, _ epoch: Int) async throws {
    var cursor = state.cursors[id] ?? "0"
    var ordered = state.messages[id] ?? []
    var more: Bool
    repeat {
      let page = try await authorized(epoch) {
        try await self.api.messages(token: $0, threadID: id, after: cursor)
      }
      try check(epoch)
      let next = try replyCursor(page.nextCursor)
      let previous = try replyCursor(cursor)
      guard next >= previous, !page.hasMore || next > previous else {
        throw RespondKitError("Invalid message pagination.")
      }
      for message in page.messages {
        if let index = ordered.firstIndex(where: { $0.id == message.id }) {
          ordered[index] = message
        } else {
          ordered.append(message)
        }
      }
      cursor = page.nextCursor
      more = page.hasMore
    } while more
    // Preserve transcript order when two messages have the same acceptance timestamp.
    state.messages[id] = ordered.sorted { $0.acceptedAt < $1.acceptedAt }
    state.cursors[id] = cursor
    let canonical = Dictionary(
      (state.messages[id] ?? []).compactMap { message in
        message.clientMessageId.map { ($0, message) }
      }, uniquingKeysWith: { _, new in new })
    state.pending[id] = (state.pending[id] ?? []).compactMap { pending in
      guard let message = canonical[pending.id] else { return pending }
      if message.state != "failed" { return nil }
      var pending = pending
      pending.delivery = "failed"
      return pending
    }
    // A customer message can fail after its optimistic row was reconciled away.
    for message in state.messages[id] ?? [] where message.state == "failed" {
      if let clientID = message.clientMessageId,
        !(state.pending[id] ?? []).contains(where: { $0.id == clientID })
      {
        state.pending[id, default: []].append(
          PendingMessage(
            id: clientID, text: message.text, acceptedAt: message.acceptedAt, delivery: "failed"))
      }
    }
    try persist()
    publish()
  }
  private func flushReads(_ epoch: Int) async throws {
    for (id, cursor) in state.pendingReads {
      try await authorized(epoch) {
        try await self.api.markRead(token: $0, threadID: id, cursor: cursor)
      }
      try check(epoch)
      state.pendingReads.removeValue(forKey: id)
      try persist()
    }
  }
  private func validToken(_ epoch: Int) async throws -> String {
    try persist()
    if let session, let expiry = timestamp(session.expiresAt),
      expiry > Date().addingTimeInterval(15)
    {
      return session.token
    }
    let assertion = try await identityToken?()
    try check(epoch)
    if identityToken != nil && (assertion?.isEmpty ?? true) {
      throw RespondKitError("Support identity could not be verified.")
    }
    let value = try await api.createSession(
      installationID: state.installationID, context: context, identityToken: assertion)
    try check(epoch)
    session = value
    return value.token
  }
  private func authorized<T>(_ epoch: Int, _ action: (String) async throws -> T) async throws -> T {
    do { return try await action(validToken(epoch)) } catch let error as RespondKitError
      where error.status == 401
    {
      try check(epoch)
      session = nil
      return try await action(validToken(epoch))
    }
  }
  private func check(_ expected: Int) throws {
    try Task.checkCancellation()
    guard expected == epoch else { throw CancellationError() }
  }
  private func operate(_ action: (Int) async throws -> Void) async {
    let expected = epoch
    if locked { await withCheckedContinuation { waiters.append($0) } } else { locked = true }
    defer {
      isLoading = false
      if waiters.isEmpty { locked = false } else { waiters.removeFirst().resume() }
    }
    guard expected == epoch, !Task.isCancelled else { return }
    isLoading = true
    do {
      try await action(expected)
      try check(expected)
      errorMessage = nil
    } catch is CancellationError {} catch {
      if expected == epoch { errorMessage = error.localizedDescription }
    }
  }
  private func setDelivery(_ messageID: String, threadID: String, value: String) {
    guard let index = state.pending[threadID]?.firstIndex(where: { $0.id == messageID }) else {
      return
    }
    state.pending[threadID]?[index].delivery = value
  }
  private func persist() throws { try persistence.save(JSONEncoder().encode(state)) }
  private func persistOrReport() {
    do { try persist() } catch { errorMessage = error.localizedDescription }
  }
  private func publish() {
    statuses = state.statuses
    hasUnreadReplies = statuses.contains { isUnread($0.thread.id) }
    let key = activeThreadID ?? "new"
    messages = state.messages[key] ?? []
    pendingMessages = state.pending[key] ?? []
    draft = state.drafts[key] ?? ""
    loadedCursor = state.cursors[key] ?? "0"
  }
}
