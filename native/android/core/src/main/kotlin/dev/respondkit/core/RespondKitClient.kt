package dev.respondkit.core

import java.io.IOException
import java.time.Instant
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class RespondKitConfiguration(
    val baseUrl: String,
    val inboxId: String,
    val origin: String,
    val pollIntervalMillis: Long = 10_000,
) {
    init {
        val url = baseUrl.toHttpUrl()
        val originUrl = origin.toHttpUrl()
        require(url.isHttps || url.host in listOf("localhost", "127.0.0.1", "::1", "10.0.2.2")) {
            "HTTPS is required outside local development."
        }
        require(
            url.username.isEmpty() &&
                url.password.isEmpty() &&
                url.query == null &&
                url.fragment == null
        )
        require(
            originUrl.username.isEmpty() &&
                originUrl.password.isEmpty() &&
                originUrl.encodedPath == "/" &&
                originUrl.query == null &&
                originUrl.fragment == null
        )
        require(inboxId.isNotBlank() && pollIntervalMillis >= 1_000)
    }

    val storageScope: String
        get() = baseUrl.trimEnd('/') + "|" + inboxId
}

interface RespondKitApi {
    suspend fun createSession(
        installationId: String,
        context: CustomerContext,
        identityToken: String?,
    ): ClientSession

    suspend fun statuses(token: String, after: String?): StatusPage

    suspend fun createThread(token: String, clientThreadId: String): SupportThread

    suspend fun messages(token: String, threadId: String, after: String): MessagePage

    suspend fun send(
        token: String,
        threadId: String,
        clientMessageId: String,
        text: String,
    ): Acceptance

    suspend fun markRead(token: String, threadId: String, cursor: String)

    suspend fun logout(token: String)
}

class RespondKitClient(
    private val configuration: RespondKitConfiguration,
    private val http: OkHttpClient =
        OkHttpClient.Builder().callTimeout(java.time.Duration.ofSeconds(30)).build(),
) : RespondKitApi {
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    private data class ErrorBody(val code: String, val message: String, val retryable: Boolean)

    @Serializable private data class ErrorEnvelope(val error: ErrorBody)

    @Serializable private data class Ok(val ok: Boolean)

    private suspend inline fun <reified T> request(
        path: String,
        token: String? = null,
        body: JsonObject? = null,
        after: String? = null,
        post: Boolean = body != null,
    ): T {
        val url =
            configuration.baseUrl.trimEnd('/').toHttpUrl().newBuilder().addPathSegments("v1/$path")
        if (after != null) url.addQueryParameter("after", after)
        val request =
            Request.Builder()
                .url(url.build())
                .header("Origin", configuration.origin.trimEnd('/'))
                .header("Accept", "application/json")
        if (token != null) request.header("Authorization", "Bearer $token")
        if (post)
            request.post((body?.toString() ?: "{}").toRequestBody("application/json".toMediaType()))
        return withContext(Dispatchers.IO) {
            execute(request.build()).use {
                val text = it.body?.string().orEmpty()
                if (!it.isSuccessful) {
                    val error =
                        runCatching { json.decodeFromString<ErrorEnvelope>(text).error }.getOrNull()
                    throw RespondKitException(
                        error?.message ?: "Support request failed (HTTP ${it.code}).",
                        error?.code ?: "http_error",
                        error?.retryable ?: (it.code >= 500 || it.code in listOf(408, 429)),
                        it.code,
                    )
                }
                try {
                    json.decodeFromString<T>(text)
                } catch (error: kotlinx.serialization.SerializationException) {
                    throw RespondKitException("Support returned an invalid response.")
                }
            }
        }
    }

    private suspend fun execute(request: Request): Response =
        suspendCancellableCoroutine { continuation ->
            val call = http.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(
                object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        if (continuation.isActive) continuation.resumeWithException(e)
                    }

                    override fun onResponse(call: Call, response: Response) {
                        continuation.resume(
                            response,
                            onCancellation = { _, value, _ -> value.close() },
                        )
                    }
                }
            )
        }

    override suspend fun createSession(
        installationId: String,
        context: CustomerContext,
        identityToken: String?,
    ): ClientSession {
        val response =
            request<SessionResponse>(
                "client/sessions",
                body =
                    buildJsonObject {
                        put("inboxId", configuration.inboxId)
                        put("installationId", installationId)
                        put("context", json.encodeToJsonElement(context))
                        if (identityToken != null) put("identityToken", identityToken)
                    },
            )
        try {
            Instant.parse(response.session.expiresAt)
        } catch (error: java.time.format.DateTimeParseException) {
            throw RespondKitException("Invalid session expiry.")
        }
        if (response.session.token.isEmpty()) throw RespondKitException("Invalid support session.")
        return response.session
    }

    override suspend fun statuses(token: String, after: String?) =
        request<StatusPage>("thread-statuses", token, after = after)

    override suspend fun createThread(token: String, clientThreadId: String): SupportThread {
        val result =
            request<ThreadResponse>(
                    "threads",
                    token,
                    buildJsonObject { put("clientThreadId", clientThreadId) },
                )
                .thread
        if (result.clientThreadId != clientThreadId)
            throw RespondKitException("Mismatched support conversation.")
        return result
    }

    private fun path(id: String): String {
        if (!Regex("[A-Za-z0-9_-]+").matches(id))
            throw RespondKitException("Invalid support thread ID.")
        return "threads/$id"
    }

    override suspend fun messages(token: String, threadId: String, after: String): MessagePage {
        val result = request<MessagePage>(path(threadId) + "/messages", token, after = after)
        if (result.threadId != threadId || result.messages.any { it.threadId != threadId })
            throw RespondKitException("Mismatched support messages.")
        replyCursor(result.nextCursor)
        return result
    }

    override suspend fun send(
        token: String,
        threadId: String,
        clientMessageId: String,
        text: String,
    ): Acceptance {
        val result =
            request<SendResponse>(
                    path(threadId) + "/messages",
                    token,
                    buildJsonObject {
                        put("clientMessageId", clientMessageId)
                        put("text", text)
                    },
                )
                .acceptance
        if (
            result.clientMessageId != clientMessageId ||
                result.status !in
                    listOf(
                        "accepted",
                        "already_accepted",
                        "acceptance_unknown",
                        "processing",
                        "available",
                        "failed",
                    ) ||
                result.message?.let {
                    it.threadId != threadId ||
                        it.clientMessageId != clientMessageId ||
                        it.id != result.messageId
                } == true
        )
            throw RespondKitException("Mismatched message acceptance.")
        return result
    }

    override suspend fun markRead(token: String, threadId: String, cursor: String) {
        replyCursor(cursor)
        if (
            !request<Ok>(path(threadId) + "/read", token, buildJsonObject { put("cursor", cursor) })
                .ok
        )
            throw RespondKitException("Read acknowledgement failed.")
    }

    override suspend fun logout(token: String) {
        if (!request<Ok>("client/logout", token, post = true).ok)
            throw RespondKitException("Logout failed.")
    }
}
