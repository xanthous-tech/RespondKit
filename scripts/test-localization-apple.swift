import Foundation
let bundle = Bundle(path: CommandLine.arguments[1] + "/en.lproj")!
let format = bundle.localizedString(forKey: "respondkit_show_new", value: nil, table: "RespondKit")
for count in [0, 1, 2, 21] {
  let actual = String.localizedStringWithFormat(format, Int64(count))
  let expected = "Show \(count) new \(count == 1 ? "message" : "messages")"
  precondition(actual == expected, "\(actual) != \(expected)")
}
let fileFormat = bundle.localizedString(forKey: "respondkit_remove_file", value: nil, table: "RespondKit")
precondition(String.localizedStringWithFormat(fileFormat, "receipt.pdf") == "Remove receipt.pdf")
print("Native Apple resource lookup, substitution, and plural selection passed.")
