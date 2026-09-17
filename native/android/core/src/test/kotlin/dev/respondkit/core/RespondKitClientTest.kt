package dev.respondkit.core

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.*

class RespondKitClientTest {
    @Test fun nativeOriginAndBearerAreSentAndMalformedResponsesFail() = runTest {
        MockWebServer().use { server ->
            server.start()
            val client = RespondKitClient(RespondKitConfiguration(server.url("/").toString(), "inbox_test", "https://captioner.io"))
            server.enqueue(MockResponse().setBody("""{"threads": []}"""))
            client.statuses("respondkit_token", null)
            val request = server.takeRequest()
            assertEquals("/v1/thread-statuses", request.path)
            assertEquals("https://captioner.io", request.getHeader("Origin"))
            assertEquals("Bearer respondkit_token", request.getHeader("Authorization"))
            server.enqueue(MockResponse().setBody("not-json"))
            assertFailsWith<RespondKitException> { client.statuses("token", null) }
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":"unauthorized","message":"Expired","retryable":false}}"""))
            assertEquals(401, assertFailsWith<RespondKitException> { client.statuses("token", null) }.status)
        }
    }
    @Test fun mismatchedThreadResponsesAreRejected() = runTest {
        MockWebServer().use { server ->
            server.start()
            val client = RespondKitClient(RespondKitConfiguration(server.url("/").toString(), "inbox_test", "https://captioner.io"))
            server.enqueue(MockResponse().setBody("""{"threadId":"someone_else","messages":[],"nextCursor":"0","hasMore":false}"""))
            assertFailsWith<RespondKitException> { client.messages("token", "thread_one", "0") }
        }
    }
}
