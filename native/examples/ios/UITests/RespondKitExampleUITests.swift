import XCTest

@MainActor
final class RespondKitExampleUITests: XCTestCase {
  func testCustomTriggersFullScreenSendAndDraftPersistence() async throws {
    let app = XCUIApplication()
    app.launchArguments = ["--uitesting"]
    app.launch()
    XCTAssertTrue(app.buttons["host-support"].waitForExistence(timeout: 10))
    app.buttons["host-support"].tap()
    XCTAssertTrue(app.buttons["respondkit-new"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["host-support"].isHittable)
    app.buttons["respondkit-new"].tap()
    let composer = app.descendants(matching: .any)["respondkit-composer"].firstMatch
    XCTAssertTrue(composer.waitForExistence(timeout: 5))
    composer.tap()
    composer.typeText("Hello from the SwiftUI widget")
    app.buttons["respondkit-send"].tap()
    XCTAssertTrue(
      app.staticTexts["Thanks! This is a local demo reply."].waitForExistence(timeout: 10))
    composer.tap()
    composer.typeText("Draft survives closing")
    app.buttons["Close"].firstMatch.tap()
    var request = URLRequest(url: URL(string: "http://127.0.0.1:8789/demo/reply")!)
    request.httpMethod = "POST"
    request.httpBody = Data("{\"text\":\"Reply received while chat was closed\"}".utf8)
    _ = try await URLSession.shared.data(for: request)
    let unread = app.descendants(matching: .any)["host-unread"].firstMatch
    XCTAssertTrue(unread.waitForExistence(timeout: 10))
    app.buttons["host-secondary-trigger"].tap()
    XCTAssertTrue(
      app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "respondkit-thread-"))
        .firstMatch.waitForExistence(timeout: 10))
    app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "respondkit-thread-"))
      .firstMatch.tap()
    XCTAssertEqual(composer.value as? String, "Draft survives closing")
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Native SwiftUI conversation"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
