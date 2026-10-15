package dev.respondkit.compose

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import dev.respondkit.core.MemoryPersistence
import dev.respondkit.core.RespondKitApi
import dev.respondkit.core.RespondKitConfiguration
import dev.respondkit.core.RespondKitException
import dev.respondkit.core.RespondKitStore
import dev.respondkit.core.StatusPage
import org.junit.Rule
import org.junit.Test

/** Applies the app language the way per-app locales do: on the activity's base context. */
class LocalizedActivity : ComponentActivity() {
    override fun attachBaseContext(base: Context) {
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocales(LocaleList.forLanguageTags(languageTags))
        super.attachBaseContext(base.createConfigurationContext(configuration))
    }

    companion object {
        var languageTags = "en"
    }
}

class LocalizedScreenTest {
    @get:Rule val compose = createEmptyComposeRule()

    private class Composer(val placeholder: String, val send: String, val sent: String, val close: String)

    private fun assertTranslated(
        languageTags: String,
        visible: List<String>,
        attach: String,
        menu: List<String>,
        composer: Composer,
        emailAsk: List<String>,
    ) {
        launch(languageTags, RespondKitScreenTest.Api()) {
            for (text in visible) compose.onNodeWithText(text).assertIsDisplayed()
            compose.onNodeWithText(composer.placeholder).assertIsDisplayed()
            compose.onNodeWithContentDescription(composer.send).assertIsDisplayed()
            compose.onNodeWithContentDescription(composer.close).assertIsDisplayed()
            compose.onNodeWithTag("respondkit-composer").performTextInput("Hello")
            compose.onNodeWithContentDescription(composer.send).performClick()
            compose.waitUntil(5_000) { compose.onAllNodesWithText(composer.sent).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(composer.sent).assertIsDisplayed()
            compose.waitUntil(5_000) { compose.onAllNodesWithText(emailAsk.first()).fetchSemanticsNodes().isNotEmpty() }
            for (text in emailAsk) compose.onNodeWithText(text).assertIsDisplayed()
            compose.onNodeWithContentDescription(attach).performClick()
            for (item in menu) compose.onNodeWithText(item).assertIsDisplayed()
        }
    }

    private fun launch(languageTags: String, api: RespondKitApi, assertions: () -> Unit) {
        LocalizedActivity.languageTags = languageTags
        ActivityScenario.launch(LocalizedActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                activity.setContent {
                    val scope = rememberCoroutineScope()
                    val store = remember {
                        RespondKitStore(
                            RespondKitConfiguration("https://support.example.com", "inbox_test", "https://example.com"),
                            persistence = MemoryPersistence(), api = api, scope = scope,
                        )
                    }
                    RespondKitScreen(store, onClose = {})
                }
            }
            assertions()
        }
    }

    private fun assertFailedRequestTranslated(languageTags: String, expected: String) {
        val failing = object : RespondKitApi by RespondKitScreenTest.Api() {
            override suspend fun statuses(token: String, after: String?): StatusPage =
                throw RespondKitException("Support request failed (HTTP 500).", status = 500)
        }
        launch(languageTags, failing) {
            compose.waitUntil(5_000) { compose.onAllNodesWithText(expected).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(expected).assertIsDisplayed()
            compose.onNodeWithText("Support request failed (HTTP 500).").assertDoesNotExist()
        }
    }

    @Test
    fun japaneseFailedRequest() = assertFailedRequestTranslated("ja-JP", "サポートへのリクエストに失敗しました。")

    @Test
    fun simplifiedChineseFailedRequest() = assertFailedRequestTranslated("zh-Hans-CN", "客服请求失败。")

    @Test
    fun japaneseScreenAndAttachMenu() =
        assertTranslated(
            "ja-JP",
            listOf("何でもお気軽にどうぞ", "どのようなご用件ですか？", "メッセージを送信して、このページを開いたままお待ちください。すぐにお返事します。"),
            "ファイルを添付",
            listOf("フォトライブラリ", "ファイル"),
            Composer("メッセージを入力…", "メッセージを送信", "送信済み", "サポートチャットを閉じる"),
            listOf("返信をお送りするメールアドレスを教えてください", "メールアドレス", "メールアドレスを保存"),
        )

    @Test
    fun simplifiedChineseScreenAndAttachMenu() =
        assertTranslated(
            "zh-Hans-CN",
            listOf("有问题尽管问", "有什么可以帮您？", "发送消息后请保持此页面打开，以便及时收到回复。"),
            "添加附件",
            listOf("照片图库", "文件"),
            Composer("输入消息…", "发送消息", "已发送", "关闭客服聊天"),
            listOf("我们该把回复发送到哪个邮箱？", "邮箱地址", "保存邮箱"),
        )
}
