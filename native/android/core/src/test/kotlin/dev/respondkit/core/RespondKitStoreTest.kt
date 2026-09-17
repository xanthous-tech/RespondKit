package dev.respondkit.core

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import java.io.File
import kotlin.test.*

private val json = Json { ignoreUnknownKeys = true }
private inline fun <reified T> fixture(key: String): T {
    val root = json.parseToJsonElement(File(System.getProperty("respondkit.fixtures"), "protocol.json").readText()).jsonObject
    return json.decodeFromJsonElement<T>(root.getValue(key))
}
private class FakeApi : RespondKitApi {
    var sessionCalls = 0
    val sent = mutableListOf<Pair<String, String>>()
    val reads = mutableListOf<Pair<String, String>>()
    val created = mutableListOf<String>()
    var failSend = false
    var failRead = false
    var failStatuses = false
    var unauthorizedOnce = false
    var waitForStatuses: CompletableDeferred<Unit>? = null
    val statusesEntered = CompletableDeferred<Unit>()
    var firstPage = StatusPage(emptyList())
    var secondPage = StatusPage(emptyList())
    var messagePage = MessagePage("thread_one", emptyList(), "0", false)
    fun seed() {
        firstPage = fixture<StatusPage>("statuses").copy(nextCursor = "page_two")
        secondPage = StatusPage(listOf(ThreadStatus(SupportThread("thread_two", "cthread_two", "closed", "2026-09-17T00:00:00Z", "2026-09-17T00:00:00Z"), "2")))
        messagePage = fixture("messages")
    }
    override suspend fun createSession(installationId: String, context: CustomerContext, identityToken: String?): ClientSession {
        sessionCalls++; return fixture<SessionResponse>("session").session
    }
    override suspend fun statuses(token: String, after: String?): StatusPage {
        statusesEntered.complete(Unit); waitForStatuses?.await()
        if (unauthorizedOnce) { unauthorizedOnce = false; throw RespondKitException("Expired", status = 401) }
        if (failStatuses) throw RespondKitException("Offline", retryable = true)
        return if (after == null) firstPage else secondPage
    }
    override suspend fun createThread(token: String, clientThreadId: String): SupportThread {
        created += clientThreadId
        return SupportThread("thread_new", clientThreadId, "open", "2026-09-17T00:00:00Z", "2026-09-17T00:00:00Z")
    }
    override suspend fun messages(token: String, threadId: String, after: String) = if (threadId == "thread_one") messagePage else MessagePage(threadId, emptyList(), "0", false)
    override suspend fun send(token: String, threadId: String, clientMessageId: String, text: String): Acceptance {
        sent += clientMessageId to text
        if (failSend) throw RespondKitException("Connection lost after acceptance", retryable = true)
        return Acceptance("message_new", clientMessageId, "accepted")
    }
    override suspend fun markRead(token: String, threadId: String, cursor: String) {
        reads += threadId to cursor
        if (failRead) throw RespondKitException("Offline", retryable = true)
    }
    override suspend fun logout(token: String) {}
}

@OptIn(ExperimentalCoroutinesApi::class)
class RespondKitStoreTest {
    private fun TestScope.store(api: FakeApi, storage: MemoryPersistence = MemoryPersistence()) = RespondKitStore(
        RespondKitConfiguration("https://support.example.com", "inbox_test", "https://example.com"),
        persistence = storage, api = api, scope = backgroundScope,
    )
    @Test fun contractAndCursorValidation() {
        assertEquals("你好！我們可以幫忙。", fixture<MessagePage>("messages").messages.single().text)
        assertTrue(replyCursor("10") > replyCursor("2"))
        listOf("01", "-1", "1.2", "9007199254740992", "", "１２").forEach { assertFailsWith<RespondKitException> { replyCursor(it) } }
        assertEquals("acceptance_unknown", fixture<SendResponse>("acceptance").acceptance.status)
    }
    @Test fun unreadWithoutMountingScreenSurvivesOfflineRestart() = runTest {
        val api = FakeApi().apply { seed() }; val storage = MemoryPersistence()
        val store = store(api, storage); store.refresh()
        assertEquals(2, store.state.value.statuses.size); assertTrue(store.state.value.hasUnreadReplies)
        assertTrue(api.reads.isEmpty())
        api.failStatuses = true
        val restored = store(api, storage); restored.refresh()
        assertTrue(restored.state.value.hasUnreadReplies); assertNotNull(restored.state.value.errorMessage)
    }
    @Test fun openingHistoryDoesNotReadAndReadingOneThreadKeepsOtherBadge() = runTest {
        val api = FakeApi().apply { seed() }; val store = store(api)
        store.setForeground(true); store.setScreenVisible(true); store.refresh()
        assertTrue(api.reads.isEmpty())
        store.selectThread("thread_one"); store.refresh()
        store.markDisplayed("thread_one", "10")
        assertEquals(setOf("thread_two"), store.state.value.unreadThreadIds)
        assertTrue(api.reads.contains("thread_one" to "10"))
        store.setForeground(false)
    }
    @Test fun staleCursorAndBackgroundDoNotRead() = runTest {
        val api = FakeApi().apply { seed() }; val store = store(api)
        store.setScreenVisible(true); store.selectThread("thread_one"); store.refresh()
        store.markDisplayed("thread_one", "10"); assertTrue(api.reads.isEmpty())
        store.setForeground(true)
        store.markDisplayed("thread_one", "2"); assertTrue(api.reads.isEmpty())
        store.setForeground(false)
    }
    @Test fun failedReadAckPersistsAndRetriesWithoutRestoringDot() = runTest {
        val api = FakeApi().apply { seed(); failRead = true }; val storage = MemoryPersistence()
        val store = store(api, storage)
        store.setForeground(true); store.setScreenVisible(true); store.selectThread("thread_one"); store.refresh()
        store.markDisplayed("thread_one", "10")
        assertFalse("thread_one" in store.state.value.unreadThreadIds)
        store.setForeground(false)
        val restored = store(api, storage)
        assertFalse("thread_one" in restored.state.value.unreadThreadIds)
        api.failRead = false; restored.refresh()
        assertTrue(api.reads.size >= 2)
    }
    @Test fun uncertainSendRetriesImmutablePayloadAfterRestart() = runTest {
        val api = FakeApi().apply { failSend = true }; val storage = MemoryPersistence()
        val store = store(api, storage)
        store.setDraft("Original text"); store.sendDraft()
        val pending = store.state.value.pendingMessages.single()
        assertEquals("acceptance_unknown", pending.delivery)
        val restored = store(api, storage); restored.selectThread("thread_new"); restored.setDraft("Different draft")
        api.failSend = false; restored.retry(pending.id)
        assertEquals(2, api.sent.size); assertEquals(api.sent[0], api.sent[1])
        assertEquals("Different draft", restored.state.value.draft); assertEquals(1, api.created.size)
    }
    @Test fun unauthorizedRenewsExactlyOnce() = runTest {
        val api = FakeApi().apply { seed(); unauthorizedOnce = true }; val store = store(api)
        store.refresh(); assertTrue(store.state.value.hasUnreadReplies); assertEquals(2, api.sessionCalls)
    }
    @Test fun accountSwitchRejectsLateResponses() = runTest {
        val api = FakeApi().apply { seed(); waitForStatuses = CompletableDeferred() }; val store = store(api)
        val request = launch { store.refresh() }
        api.statusesEntered.await()
        store.updateIdentity(CustomerContext(userId = "bob"))
        api.waitForStatuses?.complete(Unit); request.join()
        assertTrue(store.state.value.statuses.isEmpty()); assertFalse(store.state.value.hasUnreadReplies)
    }
    @Test fun messageRevisionReplacesExistingRow() = runTest {
        val api = FakeApi().apply { seed() }; val store = store(api)
        store.setScreenVisible(true); store.selectThread("thread_one"); store.refresh()
        api.messagePage = api.messagePage.copy(messages = api.messagePage.messages.map { it.copy(text = "Revised") }, nextCursor = "11")
        store.refresh(); assertEquals(1, store.state.value.messages.size); assertEquals("Revised", store.state.value.messages.single().text)
    }
    @Test fun repeatedForegroundDoesNotStartDuplicatePollingAndBackgroundStopsIt() = runTest {
        val api = FakeApi().apply { seed() }; val store = store(api)
        store.setForeground(true); store.setForeground(true); runCurrent()
        assertEquals(1, api.sessionCalls)
        store.setForeground(false); advanceTimeBy(30_000); runCurrent()
        assertEquals(1, api.sessionCalls)
    }
    @Test fun failedCanonicalMessageCanStillBeRetried() = runTest {
        val api = FakeApi().apply { seed() }
        api.messagePage = MessagePage("thread_one", listOf(SupportMessage("failed_one", "thread_one", "cmsg_failed", "customer_to_operator", "Original", acceptedAt = "2026-09-17T00:00:00Z", state = "failed")), "10", false)
        val store = store(api); store.selectThread("thread_one"); store.setScreenVisible(true); store.refresh()
        assertEquals("cmsg_failed", store.state.value.pendingMessages.single().id)
        store.retry("cmsg_failed"); assertEquals("cmsg_failed" to "Original", api.sent.single())
    }

}
