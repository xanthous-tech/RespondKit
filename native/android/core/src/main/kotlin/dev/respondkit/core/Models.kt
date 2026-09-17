package dev.respondkit.core

import java.time.Instant
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class CustomerContext(
    val userId: String? = null,
    val email: String? = null,
    val posthogDistinctId: String? = null,
    val posthogSessionId: String? = null,
    val locale: String? = null,
    val timezone: String? = null,
    val metadata: Map<String, JsonElement>? = null,
)

@Serializable
data class SupportThread(
    val id: String,
    val clientThreadId: String,
    val state: String,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class SupportMessage(
    val id: String,
    val threadId: String,
    val clientMessageId: String? = null,
    val direction: String,
    val text: String,
    val language: String? = null,
    val acceptedAt: String,
    val state: String,
) {
    val isReply: Boolean
        get() = direction == "operator_to_customer" && state == "available"
}

@Serializable
data class ClientSession(
    val id: String,
    val token: String,
    val visitorId: String,
    val expiresAt: String,
)

@Serializable data class SessionResponse(val session: ClientSession)

@Serializable data class ThreadResponse(val thread: SupportThread)

@Serializable data class ThreadStatus(val thread: SupportThread, val latestReplyCursor: String)

@Serializable
data class StatusPage(val threads: List<ThreadStatus>, val nextCursor: String? = null)

@Serializable
data class MessagePage(
    val threadId: String,
    val messages: List<SupportMessage>,
    val nextCursor: String,
    val hasMore: Boolean,
)

@Serializable
data class Acceptance(
    val messageId: String,
    val clientMessageId: String,
    val status: String,
    val message: SupportMessage? = null,
    val failureCode: String? = null,
)

@Serializable data class SendResponse(val acceptance: Acceptance)

@Serializable
data class PendingMessage(
    val id: String,
    val text: String,
    val acceptedAt: String,
    val delivery: String,
)

class RespondKitException(
    message: String,
    val code: String = "invalid_response",
    val retryable: Boolean = false,
    val status: Int? = null,
) : Exception(message)

fun replyCursor(value: String): Long {
    val number = value.toLongOrNull()
    if (
        !Regex("0|[1-9][0-9]*").matches(value) || number == null || number > 9_007_199_254_740_991L
    ) {
        throw RespondKitException("Invalid reply cursor.")
    }
    return number
}

internal fun newId(prefix: String) = prefix + "_" + UUID.randomUUID().toString().replace("-", "")

internal fun now() = Instant.now().toString()
