import Foundation
import Testing

@testable import RespondKitCore

private final class HTTPFixture: @unchecked Sendable {
  private let lock = NSLock()
  private var result: (Int, String) = (200, "{}")
  private var requests: [URLRequest] = []
  func configure(_ status: Int, _ body: String) {
    lock.withLock {
      result = (status, body)
      requests = []
    }
  }
  func respond(_ request: URLRequest) -> (Int, String) {
    lock.withLock {
      requests.append(request)
      return result
    }
  }
  func lastRequest() -> URLRequest? { lock.withLock { requests.last } }
}
private final class FixtureURLProtocol: URLProtocol, @unchecked Sendable {
  static let fixture = HTTPFixture()
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let (code, body) = Self.fixture.respond(request)
    let response = HTTPURLResponse(
      url: request.url!, statusCode: code, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

@Suite(.serialized)
struct ClientTests {
  private func client() throws -> RespondKitClient {
    let urlSession = URLSessionConfiguration.ephemeral
    urlSession.protocolClasses = [FixtureURLProtocol.self]
    let configuration = try RespondKitConfiguration(
      baseURL: URL(string: "https://support.example.com")!, inboxID: "inbox_test",
      origin: "https://captioner.io")
    return RespondKitClient(
      configuration: configuration, session: URLSession(configuration: urlSession))
  }
  @Test func nativeOriginBearerAndErrorEnvelope() async throws {
    let client = try client()
    FixtureURLProtocol.fixture.configure(200, "{\"threads\":[]}")
    _ = try await client.statuses(token: "respondkit_session", after: nil)
    let request = try #require(FixtureURLProtocol.fixture.lastRequest())
    #expect(request.url?.path == "/v1/thread-statuses")
    #expect(request.value(forHTTPHeaderField: "Origin") == "https://captioner.io")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer respondkit_session")
    FixtureURLProtocol.fixture.configure(
      401, "{\"error\":{\"code\":\"unauthorized\",\"message\":\"Expired\",\"retryable\":false}}")
    do {
      _ = try await client.statuses(token: "session", after: nil)
      Issue.record("Expected 401")
    } catch let error as RespondKitError {
      #expect(error.status == 401)
      #expect(error.code == "unauthorized")
    }
  }
  @Test func malformedAndMismatchedResponsesAreRejected() async throws {
    let client = try client()
    FixtureURLProtocol.fixture.configure(200, "not-json")
    await #expect(throws: RespondKitError.self) {
      try await client.statuses(token: "session", after: nil)
    }
    FixtureURLProtocol.fixture.configure(
      200, "{\"threadId\":\"someone_else\",\"messages\":[],\"nextCursor\":\"0\",\"hasMore\":false}")
    await #expect(throws: RespondKitError.self) {
      try await client.messages(token: "session", threadID: "thread_one", after: "0")
    }
  }
}
