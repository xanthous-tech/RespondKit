package dev.respondkit.compose

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import dev.respondkit.core.*
import kotlinx.coroutines.*
import org.junit.Rule
import org.junit.Test

class RespondKitScreenTest {
    @get:Rule val compose = createComposeRule()

    private class Api : RespondKitApi {
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
                    text = "We can help",
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
        compose.onNodeWithTag("respondkit-new").performClick()
        compose.onNodeWithTag("respondkit-composer").performTextInput("Please help")
        compose.onNodeWithTag("respondkit-send").performClick()
        compose.waitUntil(5_000) { store.state.value.messages.any { it.text == "We can help" } }
        compose.onNodeWithText("Latest messages").performClick()
        compose.waitUntil(5_000) { api.readCount > 0 }
        compose.onNodeWithTag("respondkit-composer").performTextInput("Preserved draft")
        compose.onNodeWithTag("respondkit-close").performClick()
        compose.onNodeWithTag("host-unread").assertDoesNotExist()
        compose.onNodeWithTag("host-trigger").performClick()
        compose.onNodeWithTag("respondkit-thread-thread_test").performClick()
        compose.onNodeWithTag("respondkit-composer").assertTextContains("Preserved draft")
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
            }
            MaterialTheme(colorScheme = lightColorScheme(primary = inherited)) {
                RespondKitScreen(store, onClose = {}, accentColor = accent.value)
            }
        }
        fun assertButtonColor(expected: Color) {
            val pixels = compose.onNodeWithTag("respondkit-new").captureToImage().toPixelMap()
            // Interior background, away from rounded corners and the centered label.
            val actual = pixels[pixels.width / 8, pixels.height / 2]
            org.junit.Assert.assertEquals(expected.red, actual.red, 0.01f)
            org.junit.Assert.assertEquals(expected.green, actual.green, 0.01f)
            org.junit.Assert.assertEquals(expected.blue, actual.blue, 0.01f)
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
