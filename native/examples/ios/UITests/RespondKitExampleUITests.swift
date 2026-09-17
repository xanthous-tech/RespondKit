import XCTest

@MainActor
final class RespondKitExampleUITests: XCTestCase {
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
