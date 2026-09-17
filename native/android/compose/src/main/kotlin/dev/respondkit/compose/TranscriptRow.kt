package dev.respondkit.compose

import dev.respondkit.core.SupportState
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

internal data class TranscriptRow(
    val id: String,
    val text: String,
    val customer: Boolean,
    val date: ZonedDateTime?,
    val status: String?,
    val retryId: String?,
    val failed: Boolean,
)

internal fun transcriptRows(state: SupportState): List<TranscriptRow> {
    val canonical = state.messages.mapNotNull { it.clientMessageId }.toSet()
    fun date(value: String) =
        runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()) }.getOrNull()
    return state.messages.map { message ->
        val customer = message.direction == "customer_to_operator"
        val pending = state.pendingMessages.firstOrNull { it.id == message.clientMessageId }
        TranscriptRow(
            message.id,
            message.text,
            customer,
            date(message.acceptedAt),
            if (customer) if (message.state == "failed") "Failed" else "Sent" else null,
            pending?.takeIf { it.delivery in listOf("failed", "acceptance_unknown") }?.id,
            message.state == "failed",
        )
    } +
        state.pendingMessages
            .filter { it.id !in canonical }
            .map { pending ->
                TranscriptRow(
                    pending.id,
                    pending.text,
                    true,
                    date(pending.acceptedAt),
                    when (pending.delivery) {
                        "sending" -> "Sending…"
                        "accepted" -> "Sent"
                        "failed" -> "Failed"
                        else -> "Confirming…"
                    },
                    pending.id.takeIf {
                        pending.delivery in listOf("failed", "acceptance_unknown")
                    },
                    pending.delivery == "failed",
                )
            }
}
