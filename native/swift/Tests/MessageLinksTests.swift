import Foundation
import Testing

@testable import RespondKitUI

struct MessageLinksTests {
  private struct Fixture: Decodable {
    let text: String
    let links: [Link]
    struct Link: Decodable, Equatable {
      let text: String
      let url: String
    }
  }

  @Test func detectsWebLinksWithoutChangingMessageText() throws {
    let url = try #require(Bundle.module.url(
      forResource: "message-links", withExtension: "json", subdirectory: "fixtures"))
    let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    for fixture in fixtures {
      let attributed = linkedMessage(fixture.text)
      #expect(String(attributed.characters) == fixture.text)
      let links = attributed.runs.compactMap { run -> Fixture.Link? in
        guard let url = run.link else { return nil }
        return Fixture.Link(text: String(attributed[run.range].characters), url: url.absoluteString)
      }
      #expect(links == fixture.links, "\(fixture.text)")
    }
  }
}
