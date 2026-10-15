package dev.respondkit.compose

import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import dev.respondkit.core.*
import kotlinx.coroutines.*
import org.junit.Rule
import org.junit.Test

class RespondKitScreenTest {
    @get:Rule val compose = createComposeRule()

    private class Api(val replyText: String = "We can help") : RespondKitApi {
        var thread: SupportThread? = null
        val messages = mutableListOf<SupportMessage>()
        var readCount = 0

        override suspend fun createSession(
            installationId: String,
            context: CustomerContext,
            identityToken: String?,
        ) = ClientSession("session", "token_1234567890123456", "visitor", "2099-01-01T00:00:00Z")

        override suspend fun statuses(token: String, after: String?) =
            StatusPage(thread?.let { listOf(ThreadStatus(it, messages.size.toString())) }.orEmpty())

        override suspend fun createThread(token: String, clientThreadId: String): SupportThread {
            val value =
                SupportThread(
                    "thread_test",
                    clientThreadId,
                    "open",
                    "2026-09-17T00:00:00Z",
                    "2026-09-17T00:00:00Z",
                )
            thread = value
            return value
        }

        override suspend fun messages(token: String, threadId: String, after: String) =
            MessagePage(threadId, messages.drop(after.toInt()), messages.size.toString(), false)

        override suspend fun send(
            token: String,
            threadId: String,
            clientMessageId: String,
            text: String,
        ): Acceptance {
            val sent =
                SupportMessage(
                    "message_sent",
                    threadId,
                    clientMessageId,
                    "customer_to_operator",
                    text,
                    acceptedAt = "2026-09-17T00:00:00Z",
                    state = "available",
                )
            messages += sent
            messages +=
                SupportMessage(
                    "message_reply",
                    threadId,
                    direction = "operator_to_customer",
                    text = replyText,
                    acceptedAt = "2026-09-17T00:00:01Z",
                    state = "available",
                )
            return Acceptance(sent.id, clientMessageId, "available", sent)
        }

        override suspend fun markRead(token: String, threadId: String, cursor: String) {
            readCount++
        }

        override suspend fun logout(token: String) {}
    }

    @Test
    fun webLinkDetectionPreservesMessageText() {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val fixtures = JSONArray(assets.open("message-links.json").bufferedReader().use { it.readText() })
        for (i in 0 until fixtures.length()) {
            val fixture = fixtures.getJSONObject(i)
            val text = fixture.getString("text")
            val result = linkedMessage(text, Color.Magenta)
            org.junit.Assert.assertEquals(text, result.text)
            val links = result.getLinkAnnotations(0, result.length)
            val expected = fixture.getJSONArray("links")
            org.junit.Assert.assertEquals(text, expected.length(), links.size)
            links.forEachIndexed { index, link ->
                org.junit.Assert.assertEquals(text, expected.getJSONObject(index).getString("text"), text.substring(link.start, link.end))
                org.junit.Assert.assertEquals(text, expected.getJSONObject(index).getString("url"), (link.item as LinkAnnotation.Url).url)
                org.junit.Assert.assertEquals(Color.Magenta, link.item.styles?.style?.color)
            }
        }
    }

    @Test
    fun operatorLinkOpensThroughHostUriHandler() {
        val reply = "Read https://example.com/help?from=support#start."
        val opened = mutableListOf<String>()
        val handler = object : UriHandler {
            override fun openUri(uri: String) { opened += uri }
        }
        lateinit var store: RespondKitStore
        compose.setContent {
            val scope = rememberCoroutineScope()
            store = remember {
                RespondKitStore(
                    RespondKitConfiguration("https://support.example.com", "inbox_test", "https://example.com"),
                    persistence = MemoryPersistence(), api = Api(reply), scope = scope,
                )
            }
            CompositionLocalProvider(LocalUriHandler provides handler) {
                MaterialTheme { RespondKitScreen(store, onClose = {}) }
            }
        }
        compose.onNodeWithTag("respondkit-composer").performTextInput("Please send instructions")
        compose.onNodeWithTag("respondkit-send").performClick()
        compose.waitUntil(5_000) { store.state.value.messages.any { it.text == reply } }
        val layout = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(reply).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layout) }
        compose.onNodeWithText(reply).performTouchInput {
            click(layout.single().getBoundingBox(reply.indexOf("https")).center)
        }
        compose.runOnIdle { org.junit.Assert.assertEquals(listOf("https://example.com/help?from=support#start"), opened) }
    }

    @Test
    fun customTriggerFullScreenReadAndDraftPersistence() {
        val api = Api()
        lateinit var store: RespondKitStore
        compose.setContent {
            val scope = rememberCoroutineScope()
            store = remember {
                RespondKitStore(
                    RespondKitConfiguration(
                        "https://support.example.com",
                        "inbox_test",
                        "https://example.com",
                    ),
                    persistence = MemoryPersistence(),
                    api = api,
                    scope = scope,
                )
            }
            RespondKitLifecycle(store)
            var showing by remember { mutableStateOf(false) }
            val state by store.state.collectAsState()
            MaterialTheme {
                if (showing) RespondKitScreen(store, onClose = { showing = false })
                else
                    Column {
                        Button(
                            onClick = { showing = true },
                            modifier = Modifier.testTag("host-trigger"),
                        ) {
                            Text("Ask us")
                        }
                        if (state.hasUnreadReplies) Text("Unread", Modifier.testTag("host-unread"))
                    }
            }
        }
        compose.onNodeWithTag("host-trigger").performClick()
        compose.onNodeWithTag("host-trigger").assertDoesNotExist()
        compose.onNodeWithTag("respondkit-history").assertDoesNotExist()
        compose.onNodeWithTag("respondkit-composer").performTextInput("Please help")
        compose.onNodeWithTag("respondkit-send").performClick()
        compose.waitUntil(5_000) { store.state.value.messages.any { it.text == "We can help" } }
        compose.onNodeWithText("Ask us anything").assertIsDisplayed()
        compose.onNodeWithText("Sent").assertIsDisplayed()
        compose.onNodeWithContentDescription("Latest messages").assertDoesNotExist()
        compose.waitUntil(5_000) { api.readCount > 0 }
        compose.onNodeWithTag("respondkit-composer").performTextInput("Preserved draft")
        compose.onNodeWithTag("respondkit-close").performClick()
        compose.onNodeWithTag("host-unread").assertDoesNotExist()
        compose.onNodeWithTag("host-trigger").performClick()
        compose.onNodeWithTag("respondkit-composer").assertTextContains("Preserved draft")
    }

    @Test
    fun attachIconSitsLeftOfTheMessageFieldInTheSendRow() {
        compose.setContent {
            val scope = rememberCoroutineScope()
            val store = remember {
                RespondKitStore(
                    RespondKitConfiguration(
                        "https://support.example.com",
                        "inbox_test",
                        "https://example.com",
                    ),
                    persistence = MemoryPersistence(),
                    api = Api(),
                    scope = scope,
                )
            }
            RespondKitScreen(store, onClose = {})
        }
        val attach = compose.onNodeWithContentDescription("Attach files").assertHasClickAction()
            .getUnclippedBoundsInRoot()
        val field = compose.onNodeWithTag("respondkit-composer").getUnclippedBoundsInRoot()
        val send = compose.onNodeWithTag("respondkit-send").getUnclippedBoundsInRoot()
        org.junit.Assert.assertTrue("attach is left of the field", attach.right <= field.left)
        org.junit.Assert.assertEquals(send.top, attach.top)
        org.junit.Assert.assertEquals(send.bottom, attach.bottom)
        org.junit.Assert.assertTrue("attach shares the field row", attach.top < field.bottom && attach.bottom > field.top)
        compose.onNodeWithText("Attach files").assertDoesNotExist()
        compose.onNodeWithContentDescription("Attach files").performClick()
        compose.onNodeWithText("Photo library").assertExists()
        compose.onNodeWithText("Files").assertExists()
    }

    private fun localized(languageTags: String): android.content.Context {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val configuration = android.content.res.Configuration(context.resources.configuration)
        configuration.setLocales(android.os.LocaleList.forLanguageTags(languageTags))
        return context.createConfigurationContext(configuration)
    }

    private fun assertScreenTranslated(languageTags: String, help: String, intro: String, subtitle: String, attach: String, photos: String, files: String) {
        val context = localized(languageTags)
        compose.setContent {
            val scope = rememberCoroutineScope()
            val store = remember {
                RespondKitStore(
                    RespondKitConfiguration("https://support.example.com", "inbox_test", "https://example.com"),
                    persistence = MemoryPersistence(), api = Api(), scope = scope,
                )
            }
            val owner = LocalActivityResultRegistryOwner.current!!
            CompositionLocalProvider(
                LocalContext provides context,
                LocalConfiguration provides context.resources.configuration,
                LocalActivityResultRegistryOwner provides owner,
            ) {
                RespondKitScreen(store, onClose = {})
            }
        }
        compose.onNodeWithText(subtitle).assertIsDisplayed()
        compose.onNodeWithText(help).assertIsDisplayed()
        compose.onNodeWithText(intro).assertIsDisplayed()
        compose.onNodeWithContentDescription(attach).assertHasClickAction()
        org.junit.Assert.assertEquals(photos, context.getString(R.string.respondkit_photo_library))
        org.junit.Assert.assertEquals(files, context.getString(R.string.respondkit_files))
    }

    @Test
    fun japaneseScreenIsTranslated() =
        assertScreenTranslated("ja-JP", "どのようなご用件ですか？", "メッセージを送信して、このページを開いたままお待ちください。すぐにお返事します。", "何でもお気軽にどうぞ", "ファイルを添付", "フォトライブラリ", "ファイル")

    @Test
    fun simplifiedChineseScreenIsTranslated() =
        assertScreenTranslated("zh-Hans-CN", "有什么可以帮您？", "发送消息后请保持此页面打开，以便及时收到回复。", "有问题尽管问", "添加附件", "照片图库", "文件")

    @Test
    fun deviceLocalesFallBackToTheClosestCatalog() {
        val cases = listOf(
            "zh-TW" to "zh-Hant", "zh-HK" to "zh-Hant", "zh-MO" to "zh-Hant", "zh-CN" to "zh-Hans", "zh-SG" to "zh-Hans",
            "he-IL" to "he", "iw" to "he", "id-ID" to "id", "in" to "id", "nb-NO" to "nb", "no" to "nb",
            "fil-PH" to "fil", "tl" to "fil", "pt" to "pt-BR", "pt-BR" to "pt-BR", "pt-PT" to "pt-PT", "pt-AO" to "pt-PT",
            "fr-CA" to "fr-CA", "fr-BE" to "fr", "de-AT" to "de", "es-MX" to "es", "en-GB" to "en", "xx" to "en",
        )
        val english = localized("en").getString(R.string.respondkit_ask_anything)
        for ((device, catalog) in cases) {
            val expected = localized(catalog).getString(R.string.respondkit_ask_anything)
            org.junit.Assert.assertEquals(device, expected, localized(device).getString(R.string.respondkit_ask_anything))
            if (catalog != "en") org.junit.Assert.assertNotEquals(catalog, english, expected)
        }
    }

    @Test
    fun screenInheritsHostAccentAndSupportsOverride() {
        val inherited = Color(0xFF14B8A6)
        val override = Color(0xFFF43F5E)
        val accent = mutableStateOf<Color?>(null)
        compose.setContent {
            val scope = rememberCoroutineScope()
            val store = remember {
                RespondKitStore(
                        RespondKitConfiguration(
                            "https://support.example.com",
                            "inbox_test",
                            "https://example.com",
                        ),
                        persistence = MemoryPersistence(),
                        api = Api(),
                        scope = scope,
                    )
                    .also { it.setDraft("Ready to send") }
            }
            MaterialTheme(colorScheme = lightColorScheme(primary = inherited)) {
                RespondKitScreen(store, onClose = {}, accentColor = accent.value)
            }
        }
        fun assertButtonColor(expected: Color) {
            compose.onNodeWithTag("respondkit-send").assertIsEnabled()
            val pixels = compose.onNodeWithTag("respondkit-send").captureToImage().toPixelMap()
            var matching = 0
            for (y in 0 until pixels.height) for (x in 0 until pixels.width) {
                val actual = pixels[x, y]
                if (
                    kotlin.math.abs(expected.red - actual.red) < 0.01f &&
                        kotlin.math.abs(expected.green - actual.green) < 0.01f &&
                        kotlin.math.abs(expected.blue - actual.blue) < 0.01f
                )
                    matching++
            }
            org.junit.Assert.assertTrue("Send text uses the selected accent", matching > 5)
        }
        assertButtonColor(inherited)
        compose.runOnIdle { accent.value = override }
        assertButtonColor(override)
        compose.runOnIdle { accent.value = null }
        assertButtonColor(inherited)
    }

    @Test
    fun networkResponseBodyIsReadOffMainThread() = runBlocking {
        okhttp3.mockwebserver.MockWebServer().use { server ->
            server.start()
            server.enqueue(okhttp3.mockwebserver.MockResponse().setBody("{\"threads\":[]}"))
            val client =
                RespondKitClient(
                    RespondKitConfiguration(
                        server.url("/").toString(),
                        "inbox_test",
                        "https://example.com",
                    )
                )
            val page = withContext(Dispatchers.Main) { client.statuses("session_token", null) }
            org.junit.Assert.assertTrue(page.threads.isEmpty())
        }
    }
}
