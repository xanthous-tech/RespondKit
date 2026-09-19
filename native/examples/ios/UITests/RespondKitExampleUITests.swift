import XCTest

@MainActor
final class RespondKitExampleUITests: XCTestCase {
  func testVisibleReplyAcknowledgesRead() async throws {
    let existingThreads = Set(try await readCursors().keys)
    let app = XCUIApplication()
    app.launchArguments = ["--uitesting"]
    app.launch()
    XCTAssertTrue(app.buttons["host-support"].waitForExistence(timeout: 10))
    app.buttons["host-support"].tap()
    let composer = app.descendants(matching: .any)["respondkit-composer"].firstMatch
    XCTAssertTrue(composer.waitForExistence(timeout: 10))
    composer.tap()
    composer.typeText("Read receipt local diagnostic")
    app.buttons["respondkit-send"].tap()
    XCTAssertTrue(
      app.staticTexts["Thanks! This is a local demo reply."].waitForExistence(timeout: 10))
    try await assertReadCursor("2", excluding: existingThreads)

    var request = URLRequest(url: URL(string: "http://127.0.0.1:8789/demo/reply")!)
    request.httpMethod = "POST"
    request.httpBody = Data("{\"text\":\"A second visible reply\"}".utf8)
    _ = try await URLSession.shared.data(for: request)
    XCTAssertTrue(app.staticTexts["A second visible reply"].waitForExistence(timeout: 10))
    try await assertReadCursor("3", excluding: existingThreads)

    app.buttons["respondkit-close"].tap()
    request.httpBody = Data("{\"text\":\"A reply while chat is closed\"}".utf8)
    _ = try await URLSession.shared.data(for: request)
    XCTAssertTrue(
      app.descendants(matching: .any)["host-unread"].firstMatch.waitForExistence(timeout: 10))
    let closedReads = try await readCursors().filter { !existingThreads.contains($0.key) }
    XCTAssertEqual(Array(closedReads.values), ["3"])
    app.buttons["host-support"].tap()
    XCTAssertTrue(app.staticTexts["A reply while chat is closed"].waitForExistence(timeout: 10))
    try await assertReadCursor("4", excluding: existingThreads)
  }

  private func readCursors() async throws -> [String: String] {
    struct Reads: Decodable { let cursors: [String: String] }
    let (data, _) = try await URLSession.shared.data(
      from: URL(string: "http://127.0.0.1:8789/demo/reads")!)
    return try JSONDecoder().decode(Reads.self, from: data).cursors
  }

  private func assertReadCursor(_ expected: String, excluding existingThreads: Set<String>)
    async throws
  {
    for _ in 0..<20 {
      let reads = try await readCursors().filter { !existingThreads.contains($0.key) }
      if reads.values.contains(expected) { return }
      try await Task.sleep(for: .milliseconds(250))
    }
    XCTFail("Visible reply did not acknowledge read cursor \(expected)")
  }

  func testOperatorLinkOpensThroughHostHandler() async throws {
    let app = XCUIApplication()
    app.launchArguments = ["--uitesting", "--uitesting-links"]
    app.launch()
    XCTAssertTrue(app.buttons["host-support"].waitForExistence(timeout: 10))
    app.buttons["host-support"].tap()
    let composer = app.descendants(matching: .any)["respondkit-composer"].firstMatch
    XCTAssertTrue(composer.waitForExistence(timeout: 10))
    composer.tap()
    composer.typeText("Please send the guide")
    app.buttons["respondkit-send"].tap()
    XCTAssertTrue(
      app.staticTexts["Thanks! This is a local demo reply."].waitForExistence(timeout: 10))
    let destination = "https://example.com/help?from=support#start"
    var request = URLRequest(url: URL(string: "http://127.0.0.1:8789/demo/reply")!)
    request.httpMethod = "POST"
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "text": "Read " + destination + "."
    ])
    _ = try await URLSession.shared.data(for: request)
    let link = app.links[destination]
    XCTAssertTrue(link.waitForExistence(timeout: 10))
    link.tap()
    XCTAssertEqual(app.staticTexts["host-opened-url"].label, destination)
    XCTAssertTrue(composer.exists)
  }

  func testSimulatorCanLoadSecurePersistence() {
    let app = XCUIApplication()
    // No --uitesting flag: exercise the real Keychain rather than MemoryPersistence.
    app.launch()
    XCTAssertTrue(app.buttons["host-support"].waitForExistence(timeout: 10))
    app.buttons["host-support"].tap()
    XCTAssertTrue(
      app.descendants(matching: .any)["respondkit-composer"].firstMatch.waitForExistence(
        timeout: 10))
  }

  func testCustomTriggersFullScreenSendAndDraftPersistence() async throws {
    let app = XCUIApplication()
    app.launchArguments = ["--uitesting"]
    app.launch()
    XCTAssertTrue(app.buttons["host-support"].waitForExistence(timeout: 10))
    app.buttons["Rose"].tap()
    app.buttons["host-support"].tap()
    XCTAssertTrue(
      app.descendants(matching: .any)["respondkit-composer"].firstMatch.waitForExistence(
        timeout: 10))
    XCTAssertFalse(app.buttons["host-support"].isHittable)
    XCTAssertFalse(app.buttons["respondkit-new"].exists)
    let composer = app.descendants(matching: .any)["respondkit-composer"].firstMatch
    XCTAssertTrue(composer.waitForExistence(timeout: 5))
    composer.tap()
    composer.typeText("Hello from the SwiftUI widget")
    app.buttons["respondkit-send"].tap()
    XCTAssertTrue(
      app.staticTexts["Thanks! This is a local demo reply."].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Ask us anything"].exists)
    XCTAssertTrue(app.staticTexts["Sent"].exists)
    XCTAssertFalse(app.buttons["Latest messages"].exists)
    composer.tap()
    composer.typeText("Draft survives closing")
    app.buttons["respondkit-close"].tap()
    var request = URLRequest(url: URL(string: "http://127.0.0.1:8789/demo/reply")!)
    request.httpMethod = "POST"
    request.httpBody = Data("{\"text\":\"Reply received while chat was closed\"}".utf8)
    _ = try await URLSession.shared.data(for: request)
    let unread = app.descendants(matching: .any)["host-unread"].firstMatch
    XCTAssertTrue(unread.waitForExistence(timeout: 10))
    app.buttons["host-secondary-trigger"].tap()
    XCTAssertTrue(composer.waitForExistence(timeout: 10))
    XCTAssertEqual(composer.value as? String, "Draft survives closing")
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Native SwiftUI conversation"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
