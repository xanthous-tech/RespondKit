package dev.respondkit.core

import kotlinx.serialization.Serializable

/** Use EncryptedFilePersistence on Android. Failures must propagate, never reset identity silently. */
interface RespondKitPersistence {
    fun load(): String?
    fun save(value: String)
}
class MemoryPersistence : RespondKitPersistence {
    private var value: String? = null
    override fun load() = value
    override fun save(value: String) { this.value = value }
}
@Serializable
internal data class StoredState(
    val userId: String? = null,
    val installationId: String = newId("install"),
    val newClientThreadId: String = newId("cthread"),
    val statuses: List<ThreadStatus> = emptyList(),
    val messages: Map<String, List<SupportMessage>> = emptyMap(),
    val cursors: Map<String, String> = emptyMap(),
    val readCursors: Map<String, String> = emptyMap(),
    val pendingReads: Map<String, String> = emptyMap(),
    val drafts: Map<String, String> = emptyMap(),
    val pending: Map<String, List<PendingMessage>> = emptyMap(),
)
data class SupportState(
    val statuses: List<ThreadStatus> = emptyList(),
    val unreadThreadIds: Set<String> = emptySet(),
    val activeThreadId: String? = null,
    val messages: List<SupportMessage> = emptyList(),
    val pendingMessages: List<PendingMessage> = emptyList(),
    val draft: String = "",
    val loadedCursor: String = "0",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val isForeground: Boolean = false,
) {
    val hasUnreadReplies: Boolean get() = unreadThreadIds.isNotEmpty()
    val activeThread: SupportThread? get() = statuses.firstOrNull { it.thread.id == activeThreadId }?.thread
}
