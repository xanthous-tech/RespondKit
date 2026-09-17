package dev.respondkit.core

import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Host-owned, main-thread-confined store. Retain above the screen; cancel its scope on disposal.
 */
class RespondKitStore(
    private val configuration: RespondKitConfiguration,
    private var context: CustomerContext = CustomerContext(),
    private val persistence: RespondKitPersistence,
    private val api: RespondKitApi = RespondKitClient(configuration),
    private val scope: CoroutineScope,
    private var identityToken: (suspend () -> String)? = null,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private var stored =
        persistence.load()?.let { json.decodeFromString<StoredState>(it) }
            ?: StoredState(userId = context.userId)
    private val mutableState = MutableStateFlow(SupportState())
    val state: StateFlow<SupportState> = mutableState.asStateFlow()
    private var session: ClientSession? = null
    private var epoch = 0L
    private var pollJob: Job? = null
    private var screenVisible = false
    private val mutex = Mutex()

    init {
        if (stored.userId != context.userId) stored = StoredState(userId = context.userId)
        stored =
            stored.copy(
                pending =
                    stored.pending.mapValues { (_, messages) ->
                        messages.map {
                            if (it.delivery == "sending") it.copy(delivery = "acceptance_unknown")
                            else it
                        }
                    }
            )
        persist()
        publish()
    }

    fun setForeground(active: Boolean) {
        if (state.value.isForeground == active) return
        mutableState.update { it.copy(isForeground = active) }
        pollJob?.cancel()
        pollJob = null
        if (active)
            pollJob =
                scope.launch {
                    while (isActive) {
                        refresh()
                        delay(configuration.pollIntervalMillis)
                    }
                }
    }

    fun setScreenVisible(visible: Boolean) {
        screenVisible = visible
    }

    fun selectThread(id: String?) {
        mutableState.update { it.copy(activeThreadId = id) }
        publish()
    }

    fun setDraft(text: String) {
        stored =
            stored.copy(drafts = stored.drafts + ((state.value.activeThreadId ?: "new") to text))
        persistOrReport()
        publish()
    }

    fun clearError() {
        mutableState.update { it.copy(errorMessage = null) }
    }

    /**
     * Call after host auth settles. Account changes isolate UI synchronously, before network
     * revocation.
     */
    fun updateIdentity(context: CustomerContext, identityToken: (suspend () -> String)? = null) {
        epoch++
        val previous = session
        val changed = this.context.userId != context.userId
        this.context = context
        this.identityToken = identityToken
        session = null
        if (changed) {
            stored = StoredState(userId = context.userId)
            mutableState.update { it.copy(activeThreadId = null) }
            publish()
            persist()
            if (previous != null)
                scope.launch {
                    try {
                        api.logout(previous.token)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Exception) {
                        mutableState.update {
                            it.copy(
                                errorMessage =
                                    "Previous support session could not be revoked. It will expire automatically."
                            )
                        }
                    }
                }
        }
        publish()
    }

    suspend fun refresh() = operate { generation ->
        val statuses = mutableListOf<ThreadStatus>()
        var after: String? = null
        val seen = mutableSetOf<String>()
        do {
            val page = authorized(generation) { api.statuses(it, after) }
            check(generation)
            page.threads.forEach { replyCursor(it.latestReplyCursor) }
            statuses += page.threads
            after = page.nextCursor
            if (after != null && !seen.add(after))
                throw RespondKitException("Repeated history cursor.")
        } while (after != null)
        stored = stored.copy(statuses = statuses.sortedByDescending { it.thread.updatedAt })
        persist()
        publish()
        state.value.activeThreadId?.takeIf { screenVisible }?.let { loadMessages(it, generation) }
        flushReads(generation)
    }

    suspend fun sendDraft() {
        val text = state.value.draft
        val id = state.value.activeThreadId
        if (text.isBlank() || text.length > 6_000) {
            mutableState.update {
                it.copy(errorMessage = "Enter a message of up to 6,000 characters.")
            }
            return
        }
        operate { generation ->
            if (
                id != null &&
                    stored.statuses.firstOrNull { it.thread.id == id }?.thread?.state == "closed"
            )
                throw RespondKitException("This conversation is closed. Start a new conversation.")
            val key = id ?: "new"
            val pending = PendingMessage(newId("cmsg"), text, now(), "sending")
            stored =
                stored.copy(
                    pending = stored.pending + (key to (stored.pending[key].orEmpty() + pending)),
                    drafts =
                        if (stored.drafts[key] == text) stored.drafts + (key to "")
                        else stored.drafts,
                )
            persist()
            publish()
            deliver(pending, id, generation)
        }
    }

    suspend fun retry(messageId: String) {
        val id = state.value.activeThreadId
        operate { generation ->
            stored.pending[id ?: "new"]
                ?.firstOrNull { it.id == messageId }
                ?.let { deliver(it, id, generation) }
        }
    }

    suspend fun markDisplayed(threadId: String, cursor: String) {
        val current = state.value
        if (
            !current.isForeground ||
                !screenVisible ||
                current.activeThreadId != threadId ||
                current.loadedCursor != cursor ||
                current.messages.none { it.isReply }
        )
            return
        operate { generation ->
            val latest = state.value
            if (
                !latest.isForeground ||
                    !screenVisible ||
                    latest.activeThreadId != threadId ||
                    latest.loadedCursor != cursor
            )
                return@operate
            if (replyCursor(cursor) <= replyCursor(stored.readCursors[threadId] ?: "0"))
                return@operate
            stored =
                stored.copy(
                    readCursors = stored.readCursors + (threadId to cursor),
                    pendingReads = stored.pendingReads + (threadId to cursor),
                )
            persist()
            publish()
            flushReads(generation)
        }
    }

    private suspend fun deliver(pending: PendingMessage, threadId: String?, generation: Long) {
        var id = threadId
        try {
            if (id == null) {
                val created =
                    authorized(generation) { api.createThread(it, stored.newClientThreadId) }
                check(generation)
                id = created.id
                stored =
                    stored.copy(
                        statuses =
                            listOf(ThreadStatus(created, "0")) +
                                stored.statuses.filterNot { it.thread.id == created.id },
                        pending =
                            (stored.pending - "new") +
                                (created.id to
                                    (stored.pending[created.id].orEmpty() +
                                        stored.pending["new"].orEmpty())),
                        drafts =
                            (stored.drafts - "new") +
                                (created.id to stored.drafts["new"].orEmpty()),
                        newClientThreadId = newId("cthread"),
                    )
                mutableState.update { it.copy(activeThreadId = created.id) }
                persist()
                publish()
            }
            val actualId = id
            setDelivery(pending.id, actualId, "sending")
            persist()
            publish()
            val accepted =
                authorized(generation) { api.send(it, actualId, pending.id, pending.text) }
            check(generation)
            setDelivery(
                pending.id,
                actualId,
                when (accepted.status) {
                    "failed" -> "failed"
                    "acceptance_unknown" -> "acceptance_unknown"
                    else -> "accepted"
                },
            )
            persist()
            publish()
            loadMessages(actualId, generation)
        } catch (error: Exception) {
            if (generation != epoch) throw error
            setDelivery(pending.id, id ?: "new", "acceptance_unknown")
            persist()
            publish()
            throw error
        }
    }

    private suspend fun loadMessages(id: String, generation: Long) {
        var cursor = stored.cursors[id] ?: "0"
        val messages = stored.messages[id].orEmpty().associateBy { it.id }.toMutableMap()
        var more: Boolean
        do {
            val page = authorized(generation) { api.messages(it, id, cursor) }
            check(generation)
            val next = replyCursor(page.nextCursor)
            if (next < replyCursor(cursor) || (page.hasMore && next <= replyCursor(cursor)))
                throw RespondKitException("Invalid message pagination.")
            page.messages.forEach { messages[it.id] = it }
            cursor = page.nextCursor
            more = page.hasMore
        } while (more)
        val canonical =
            messages.values
                .mapNotNull { message -> message.clientMessageId?.let { it to message } }
                .toMap()
        val pending =
            stored.pending[id].orEmpty().mapNotNull { pending ->
                val message = canonical[pending.id]
                when {
                    message == null -> pending
                    message.state == "failed" -> pending.copy(delivery = "failed")
                    else -> null
                }
            }
        val failed =
            messages.values
                .filter {
                    it.state == "failed" &&
                        it.clientMessageId != null &&
                        pending.none { p -> p.id == it.clientMessageId }
                }
                .map { PendingMessage(it.clientMessageId!!, it.text, it.acceptedAt, "failed") }
        stored =
            stored.copy(
                messages = stored.messages + (id to messages.values.sortedBy { it.acceptedAt }),
                cursors = stored.cursors + (id to cursor),
                pending = stored.pending + (id to (pending + failed)),
            )
        persist()
        publish()
    }

    private suspend fun flushReads(generation: Long) {
        for ((id, cursor) in stored.pendingReads) {
            authorized(generation) { api.markRead(it, id, cursor) }
            check(generation)
            stored = stored.copy(pendingReads = stored.pendingReads - id)
            persist()
        }
    }

    private suspend fun validToken(generation: Long): String {
        persist()
        session
            ?.takeIf { Instant.parse(it.expiresAt).isAfter(Instant.now().plusSeconds(15)) }
            ?.let {
                return it.token
            }
        val assertion = identityToken?.invoke()
        check(generation)
        if (identityToken != null && assertion.isNullOrBlank())
            throw RespondKitException("Support identity could not be verified.")
        val created = api.createSession(stored.installationId, context, assertion)
        check(generation)
        session = created
        return created.token
    }

    private suspend fun <T> authorized(generation: Long, action: suspend (String) -> T): T =
        try {
            action(validToken(generation))
        } catch (error: RespondKitException) {
            if (error.status != 401) throw error
            check(generation)
            session = null
            action(validToken(generation))
        }

    private suspend fun check(expected: Long) {
        currentCoroutineContext().ensureActive()
        if (expected != epoch) throw CancellationException("Support identity changed")
    }

    private suspend fun operate(action: suspend (Long) -> Unit) {
        val generation = epoch
        mutex.withLock {
            if (generation != epoch) return
            mutableState.update { it.copy(isLoading = true) }
            try {
                action(generation)
                check(generation)
                clearError()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (generation == epoch)
                    mutableState.update {
                        it.copy(errorMessage = error.message ?: "Support request failed.")
                    }
            } finally {
                mutableState.update { it.copy(isLoading = false) }
            }
        }
    }

    private fun setDelivery(messageId: String, threadId: String, value: String) {
        stored =
            stored.copy(
                pending =
                    stored.pending +
                        (threadId to
                            stored.pending[threadId].orEmpty().map {
                                if (it.id == messageId) it.copy(delivery = value) else it
                            })
            )
    }

    private fun persist() {
        persistence.save(json.encodeToString(stored))
    }

    private fun persistOrReport() {
        try {
            persist()
        } catch (error: Exception) {
            mutableState.update {
                it.copy(errorMessage = error.message ?: "Could not save support history.")
            }
        }
    }

    private fun publish() {
        val key = state.value.activeThreadId ?: "new"
        mutableState.update {
            it.copy(
                statuses = stored.statuses,
                unreadThreadIds =
                    stored.statuses
                        .filter { status ->
                            replyCursor(status.latestReplyCursor) >
                                replyCursor(stored.readCursors[status.thread.id] ?: "0")
                        }
                        .map { status -> status.thread.id }
                        .toSet(),
                messages = stored.messages[key].orEmpty(),
                pendingMessages = stored.pending[key].orEmpty(),
                draft = stored.drafts[key].orEmpty(),
                loadedCursor = stored.cursors[key] ?: "0",
            )
        }
    }
}
