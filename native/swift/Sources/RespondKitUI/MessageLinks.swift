import Foundation
import SwiftUI

private let webLinkDetector = try! NSDataDetector(
  types: NSTextCheckingResult.CheckingType.link.rawValue)

/// Preserve message text verbatim; only explicit web URLs receive link attributes.
func linkedMessage(_ text: String) -> AttributedString {
  var result = AttributedString(text)
  for match in webLinkDetector.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
    guard var range = Range(match.range, in: text) else { continue }
    // Detectors can include sentence punctuation or an unmatched closing bracket.
    while let last = text[range].last {
      let opening: Character? = [")": "(", "]": "[", "}": "{"][last]
      let unbalanced = opening.map { opener in
        text[range].filter { $0 == last }.count > text[range].filter { $0 == opener }.count
      } ?? false
      guard ".,!?;:。，！？；：".contains(last) || unbalanced else { break }
      range = range.lowerBound..<text.index(before: range.upperBound)
    }
    let label = String(text[range])
    let lower = label.lowercased()
    guard lower.hasPrefix("https://") || lower.hasPrefix("http://") || lower.hasPrefix("www."),
      let url = URL(string: lower.hasPrefix("www.") ? "https://" + label : label),
      let start = AttributedString.Index(range.lowerBound, within: result),
      let end = AttributedString.Index(range.upperBound, within: result)
    else { continue }
    result[start..<end].link = url
    result[start..<end].underlineStyle = .single
  }
  return result
}
