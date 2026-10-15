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
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import dev.respondkit.core.MemoryPersistence
import dev.respondkit.core.RespondKitConfiguration
import dev.respondkit.core.RespondKitStore
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

    private fun assertTranslated(languageTags: String, visible: List<String>, attach: String, menu: List<String>) {
        LocalizedActivity.languageTags = languageTags
        ActivityScenario.launch(LocalizedActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                activity.setContent {
                    val scope = rememberCoroutineScope()
                    val store = remember {
                        RespondKitStore(
                            RespondKitConfiguration("https://support.example.com", "inbox_test", "https://example.com"),
                            persistence = MemoryPersistence(), api = RespondKitScreenTest.Api(), scope = scope,
                        )
                    }
                    RespondKitScreen(store, onClose = {})
                }
            }
            for (text in visible) compose.onNodeWithText(text).assertIsDisplayed()
            compose.onNodeWithContentDescription(attach).performClick()
            for (item in menu) compose.onNodeWithText(item).assertIsDisplayed()
        }
    }

    @Test
    fun japaneseScreenAndAttachMenu() =
        assertTranslated(
            "ja-JP",
            listOf("何でもお気軽にどうぞ", "どのようなご用件ですか？", "メッセージを送信して、このページを開いたままお待ちください。すぐにお返事します。"),
            "ファイルを添付",
            listOf("フォトライブラリ", "ファイル"),
        )

    @Test
    fun simplifiedChineseScreenAndAttachMenu() =
        assertTranslated(
            "zh-Hans-CN",
            listOf("有问题尽管问", "有什么可以帮您？", "发送消息后请保持此页面打开，以便及时收到回复。"),
            "添加附件",
            listOf("照片图库", "文件"),
        )
}
