import Foundation

public struct RespondKitConfiguration: Sendable {
  public let baseURL: URL
  public let inboxID: String
  public let origin: String
  public let pollInterval: Duration
  public init(baseURL: URL, inboxID: String, origin: String, pollInterval: Duration = .seconds(10))
    throws
  {
    guard let scheme = baseURL.scheme, let host = baseURL.host,
      scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)),
      baseURL.user == nil, baseURL.password == nil, baseURL.query == nil, baseURL.fragment == nil,
      !inboxID.isEmpty, let originURL = URL(string: origin),
      ["http", "https"].contains(originURL.scheme), originURL.host != nil,
      originURL.user == nil, originURL.password == nil,
      originURL.query == nil, originURL.fragment == nil,
      originURL.path.isEmpty || originURL.path == "/", pollInterval >= .seconds(1)
    else {
      throw RespondKitError("Invalid RespondKit configuration.")
    }
    self.baseURL = baseURL
    self.inboxID = inboxID
    self.origin = origin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    self.pollInterval = pollInterval
  }
  public var storageScope: String {
    baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "|" + inboxID
  }
}

public protocol RespondKitAPI: Sendable {
  func createSession(installationID: String, context: CustomerContext, identityToken: String?)
    async throws -> ClientSession
  func statuses(token: String, after: String?) async throws -> StatusPage
  func createThread(token: String, clientThreadID: String) async throws -> SupportThread
  func messages(token: String, threadID: String, after: String) async throws -> MessagePage
  func send(token: String, threadID: String, clientMessageID: String, text: String) async throws
    -> Acceptance
  func markRead(token: String, threadID: String, cursor: String) async throws
  func logout(token: String) async throws
}

public final class RespondKitClient: RespondKitAPI, Sendable {
  private struct APIError: Decodable {
    let code: String
    let message: String
    let retryable: Bool
  }
  private struct Envelope: Decodable { let error: APIError }
  private let configuration: RespondKitConfiguration
  private let session: URLSession
  public init(configuration: RespondKitConfiguration, session: URLSession = .shared) {
    self.configuration = configuration
    self.session = session
  }
  private func request<T: Decodable & Sendable>(
    _ path: String, method: String = "GET", token: String? = nil,
    body: [String: JSONValue]? = nil, after: String? = nil
  ) async throws -> T {
    var components = URLComponents(
      url: configuration.baseURL.appendingPathComponent("v1/" + path),
      resolvingAgainstBaseURL: false)!
    if let after { components.queryItems = [URLQueryItem(name: "after", value: after)] }
    var request = URLRequest(url: components.url!)
    request.httpMethod = method
    request.timeoutInterval = 30
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(configuration.origin, forHTTPHeaderField: "Origin")
    if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
    if let body { request.httpBody = try JSONEncoder().encode(body) }
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else {
      throw RespondKitError("Invalid HTTP response.")
    }
    guard (200..<300).contains(response.statusCode) else {
      let error = try? JSONDecoder().decode(Envelope.self, from: data).error
      throw RespondKitError(
        error?.message ?? "Support request failed (HTTP \(response.statusCode)).",
        code: error?.code ?? "http_error",
        retryable: error?.retryable
          ?? (response.statusCode >= 500 || [408, 429].contains(response.statusCode)),
        status: response.statusCode)
    }
    do { return try JSONDecoder().decode(T.self, from: data) } catch {
      throw RespondKitError("Support returned an invalid response.")
    }
  }
  public func createSession(
    installationID: String, context: CustomerContext, identityToken: String?
  ) async throws -> ClientSession {
    let object = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(context))
    var body: [String: JSONValue] = [
      "inboxId": .string(configuration.inboxID), "installationId": .string(installationID),
      "context": object,
    ]
    if let identityToken { body["identityToken"] = .string(identityToken) }
    let response: SessionResponse = try await request("client/sessions", method: "POST", body: body)
    guard timestamp(response.session.expiresAt) != nil, !response.session.token.isEmpty else {
      throw RespondKitError("Invalid support session.")
    }
    return response.session
  }
  public func statuses(token: String, after: String?) async throws -> StatusPage {
    try await request("thread-statuses", token: token, after: after)
  }
  public func createThread(token: String, clientThreadID: String) async throws -> SupportThread {
    let response: ThreadResponse = try await request(
      "threads", method: "POST", token: token, body: ["clientThreadId": .string(clientThreadID)])
    guard response.thread.clientThreadId == clientThreadID else {
      throw RespondKitError("Mismatched support conversation.")
    }
    return response.thread
  }
  private func threadPath(_ id: String) throws -> String {
    guard !id.isEmpty,
      id.utf8.allSatisfy({
        (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45
          || $0 == 95
      })
    else {
      throw RespondKitError("Invalid support thread ID.")
    }
    return "threads/" + id
  }
  public func messages(token: String, threadID: String, after: String) async throws -> MessagePage {
    let response: MessagePage = try await request(
      try threadPath(threadID) + "/messages", token: token, after: after)
    guard response.threadId == threadID, response.messages.allSatisfy({ $0.threadId == threadID })
    else { throw RespondKitError("Mismatched support messages.") }
    _ = try replyCursor(response.nextCursor)
    return response
  }
  public func send(token: String, threadID: String, clientMessageID: String, text: String)
    async throws -> Acceptance
  {
    let response: SendResponse = try await request(
      try threadPath(threadID) + "/messages", method: "POST", token: token,
      body: ["clientMessageId": .string(clientMessageID), "text": .string(text)])
    let a = response.acceptance
    guard a.clientMessageId == clientMessageID,
      ["accepted", "already_accepted", "acceptance_unknown", "processing", "available", "failed"]
        .contains(a.status),
      a.message == nil
        || (a.message?.threadId == threadID && a.message?.clientMessageId == clientMessageID
          && a.message?.id == a.messageId)
    else {
      throw RespondKitError("Mismatched message acceptance.")
    }
    return a
  }
  private struct OK: Decodable, Sendable { let ok: Bool }
  public func markRead(token: String, threadID: String, cursor: String) async throws {
    _ = try replyCursor(cursor)
    let result: OK = try await request(
      try threadPath(threadID) + "/read", method: "POST", token: token,
      body: ["cursor": .string(cursor)])
    guard result.ok else { throw RespondKitError("Read acknowledgement failed.") }
  }
  public func logout(token: String) async throws {
    let result: OK = try await request("client/logout", method: "POST", token: token)
    guard result.ok else { throw RespondKitError("Logout failed.") }
  }
}
