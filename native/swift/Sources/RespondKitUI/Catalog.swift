import Foundation
import RespondKitCore

func catalog(_ key: String.LocalizationValue) -> String {
  String(localized: key, table: "RespondKit", bundle: .module)
}

func catalog(_ key: String.LocalizationValue, count: Int) -> String {
  String.localizedStringWithFormat(catalog(key), Int64(count))
}

extension RespondKitStrings {
  static var catalog: Self {
    var strings = Self()
    strings.attachedFiles = RespondKitUI.catalog("respondkit_attached_files")
    strings.messageTooLong = RespondKitUI.catalog("respondkit_message_too_long")
    strings.conversationClosed = RespondKitUI.catalog("respondkit_closed_start_new")
    strings.logoutFailed = RespondKitUI.catalog("respondkit_logout_failed")
    strings.identityUnverified = RespondKitUI.catalog("respondkit_identity_unverified")
    strings.requestFailed = RespondKitUI.catalog("respondkit_request_failed")
    strings.historySaveFailed = RespondKitUI.catalog("respondkit_history_save_failed")
    return strings
  }
}
