#if os(macOS)
  import Foundation
  import Testing

  struct LocalizationTests {
    static let catalog = URL(filePath: #filePath).deletingLastPathComponent()
      .appending(path: "../Sources/RespondKitUI/Resources/RespondKit.xcstrings").standardizedFileURL

    static let compiled: URL = {
      let output = FileManager.default.temporaryDirectory.appending(path: "respondkit-\(UUID())")
      let process = Process()
      process.executableURL = URL(filePath: "/usr/bin/xcrun")
      process.arguments = ["xcstringstool", "compile", catalog.path, "--output-directory", output.path]
      try! process.run()
      process.waitUntilExit()
      precondition(process.terminationStatus == 0, "xcstringstool failed")
      return output
    }()

    static var localizations: [String] {
      let json = try! JSONSerialization.jsonObject(with: Data(contentsOf: catalog)) as! [String: Any]
      let strings = json["strings"] as! [String: [String: Any]]
      let locales = strings["respondkit_help"]!["localizations"] as! [String: Any]
      return ["en"] + locales.keys.filter { $0 != "en" }.sorted()
    }

    static func localized(_ key: String, preferring languages: [String]) -> String {
      let localization = Bundle.preferredLocalizations(from: localizations, forPreferences: languages)[0]
      let bundle = Bundle(url: compiled.appending(path: "\(localization).lproj"))!
      return bundle.localizedString(forKey: key, value: nil, table: "RespondKit")
    }

    static let screenKeys = [
      "respondkit_help", "respondkit_intro", "respondkit_ask_anything", "respondkit_attach_files",
      "respondkit_photo_library", "respondkit_files",
    ]

    @Test(arguments: [
      (
        "ja-JP",
        ["どのようなご用件ですか？", "メッセージを送信して、このページを開いたままお待ちください。すぐにお返事します。", "何でもお気軽にどうぞ", "ファイルを添付", "フォトライブラリ", "ファイル"]
      ),
      (
        "zh-Hans-CN",
        ["有什么可以帮您？", "发送消息后请保持此页面打开，以便及时收到回复。", "有问题尽管问", "添加附件", "照片图库", "文件"]
      ),
    ])
    func emptyStateSubtitleAndAttachMenuAreTranslated(language: String, expected: [String]) {
      #expect(Self.screenKeys.map { Self.localized($0, preferring: [language]) } == expected)
    }

    static let composerKeys = [
      "respondkit_email_prompt", "respondkit_email_address", "respondkit_save_email",
      "respondkit_write_message", "respondkit_send_message", "respondkit_sent",
      "respondkit_close_chat",
    ]

    @Test(arguments: [
      (
        "ja-JP",
        ["返信をお送りするメールアドレスを教えてください", "メールアドレス", "メールアドレスを保存", "メッセージを入力…", "メッセージを送信", "送信済み", "サポートチャットを閉じる"]
      ),
      (
        "zh-Hans-CN",
        ["我们该把回复发送到哪个邮箱？", "邮箱地址", "保存邮箱", "输入消息…", "发送消息", "已发送", "关闭客服聊天"]
      ),
    ])
    func emailAskComposerStatusAndCloseAreTranslated(language: String, expected: [String]) {
      #expect(Self.composerKeys.map { Self.localized($0, preferring: [language]) } == expected)
    }

    @Test(arguments: [
      ("zh-TW", "zh-Hant"), ("zh-HK", "zh-Hant"), ("zh-Hant-MO", "zh-Hant"), ("zh-CN", "zh-Hans"),
      ("zh-SG", "zh-Hans"), ("he-IL", "he"), ("iw", "he"), ("id-ID", "id"), ("in", "id"),
      ("nb-NO", "nb"), ("no", "nb"), ("fil-PH", "fil"), ("tl", "fil"), ("pt", "pt-BR"),
      ("pt-BR", "pt-BR"), ("pt-PT", "pt-PT"), ("pt-AO", "pt-PT"), ("fr-CA", "fr-CA"),
      ("fr-BE", "fr"), ("de-AT", "de"), ("es-MX", "es"), ("en-GB", "en"), ("xx", "en"),
    ])
    func deviceLanguagesFallBackToTheClosestCatalog(language: String, catalog: String) {
      #expect(
        Self.localized("respondkit_ask_anything", preferring: [language])
          == Self.localized("respondkit_ask_anything", preferring: [catalog]))
      if catalog != "en" {
        #expect(
          Self.localized("respondkit_ask_anything", preferring: [catalog])
            != Self.localized("respondkit_ask_anything", preferring: ["en"]))
      }
    }
  }
#endif
