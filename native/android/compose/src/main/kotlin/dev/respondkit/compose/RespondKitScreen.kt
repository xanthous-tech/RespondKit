package dev.respondkit.compose

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.respondkit.core.*
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/** Mount once at the app root, not inside the conditionally presented support destination. */
@Composable
fun RespondKitLifecycle(store: RespondKitStore) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(store, lifecycle) {
        val observer = LifecycleEventObserver { _, _ ->
            store.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        }
        lifecycle.addObserver(observer)
        store.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        onDispose {
            lifecycle.removeObserver(observer)
            store.setForeground(false)
        }
    }
}

/** Full-screen content; the host owns its trigger, badge and presentation/navigation. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RespondKitScreen(
    store: RespondKitStore,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = stringResource(R.string.respondkit_support),
) {
    val state by store.state.collectAsStateWithLifecycle()
    var conversation by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    DisposableEffect(store) {
        store.setScreenVisible(true)
        onDispose { store.setScreenVisible(false) }
    }
    LaunchedEffect(store) { store.refresh() }
    val back = {
        if (conversation) {
            conversation = false
            store.selectThread(null)
        } else onClose()
    }
    BackHandler(onBack = back)
    Scaffold(
        modifier.fillMaxSize().imePadding(),
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    TextButton(onClick = back) {
                        Text(
                            stringResource(
                                if (conversation) R.string.respondkit_conversations
                                else R.string.respondkit_close
                            )
                        )
                    }
                },
                actions = {
                    if (conversation)
                        TextButton(
                            onClick = onClose,
                            modifier = Modifier.testTag("respondkit-close"),
                        ) {
                            Text(stringResource(R.string.respondkit_close))
                        }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            state.errorMessage?.let { error ->
                Row(
                    Modifier.fillMaxWidth()
                        .background(MaterialTheme.colorScheme.errorContainer)
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(error, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { scope.launch { store.refresh() } }) {
                        Text(stringResource(R.string.respondkit_retry))
                    }
                }
            }
            if (state.isLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (conversation) Conversation(store, state, Modifier.weight(1f))
            else
                LazyColumn(
                    Modifier.fillMaxSize().testTag("respondkit-history"),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        FilledTonalButton(
                            onClick = {
                                store.selectThread(null)
                                conversation = true
                            },
                            modifier = Modifier.fillMaxWidth().testTag("respondkit-new"),
                        ) {
                            Text(stringResource(R.string.respondkit_new))
                        }
                    }
                    items(state.statuses, key = { it.thread.id }) { status ->
                        Card(
                            onClick = {
                                store.selectThread(status.thread.id)
                                conversation = true
                                scope.launch { store.refresh() }
                            },
                            modifier =
                                Modifier.fillMaxWidth()
                                    .testTag("respondkit-thread-${status.thread.id}"),
                        ) {
                            Row(
                                Modifier.padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        stringResource(
                                            R.string.respondkit_conversation,
                                            status.thread.id.takeLast(6),
                                        )
                                    )
                                    Text(
                                        stringResource(
                                            if (status.thread.state == "closed")
                                                R.string.respondkit_closed
                                            else R.string.respondkit_open
                                        ),
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                                if (status.thread.id in state.unreadThreadIds) {
                                    val label = stringResource(R.string.respondkit_unread)
                                    Box(
                                        Modifier.size(8.dp)
                                            .background(Color.Red, CircleShape)
                                            .semantics { contentDescription = label }
                                    )
                                }
                            }
                        }
                    }
                    item {
                        Text(
                            stringResource(R.string.respondkit_return),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
        }
    }
}

@Composable
private fun Conversation(store: RespondKitStore, state: SupportState, modifier: Modifier) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val bottomKey = "bottom-${state.loadedCursor}"
    var initialScroll by remember(state.activeThreadId) { mutableStateOf(false) }
    LaunchedEffect(state.activeThreadId, state.messages.size, state.pendingMessages.size) {
        if (!initialScroll && (state.messages.isNotEmpty() || state.pendingMessages.isNotEmpty())) {
            // Layout includes a final visibility marker; never auto-scroll later replies over older
            // history.
            listState.scrollToItem(listState.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1)
            initialScroll = true
        }
    }
    LaunchedEffect(state.activeThreadId, state.loadedCursor, state.isForeground) {
        val id = state.activeThreadId ?: return@LaunchedEffect
        snapshotFlow {
                listState.layoutInfo.let { layout ->
                    layout.visibleItemsInfo.any {
                        it.key == bottomKey &&
                            it.offset >= layout.viewportStartOffset &&
                            it.offset + it.size <= layout.viewportEndOffset
                    }
                }
            }
            .distinctUntilChanged()
            .collect { if (it) store.markDisplayed(id, state.loadedCursor) }
    }
    Column(modifier.fillMaxWidth()) {
        Box(Modifier.weight(1f)) {
            LazyColumn(
                Modifier.fillMaxSize().testTag("respondkit-messages"),
                state = listState,
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.messages.isEmpty() && state.pendingMessages.isEmpty())
                    item {
                        Text(
                            stringResource(R.string.respondkit_help),
                            style = MaterialTheme.typography.titleLarge,
                        )
                        Text(stringResource(R.string.respondkit_intro))
                    }
                items(state.messages, key = { it.id }) { message ->
                    Bubble(
                        message.text,
                        message.direction == "customer_to_operator",
                        if (message.state == "failed") stringResource(R.string.respondkit_failed)
                        else null,
                    )
                }
                items(
                    state.pendingMessages.filter { pending ->
                        state.messages.none { it.clientMessageId == pending.id }
                    },
                    key = { it.id },
                ) { pending ->
                    Bubble(
                        pending.text,
                        true,
                        stringResource(
                            when (pending.delivery) {
                                "sending" -> R.string.respondkit_sending
                                "accepted" -> R.string.respondkit_sent
                                "failed" -> R.string.respondkit_failed
                                else -> R.string.respondkit_unknown
                            }
                        ),
                    )
                }
                items(
                    state.pendingMessages.filter {
                        it.delivery in listOf("failed", "acceptance_unknown")
                    },
                    key = { "retry-${it.id}" },
                ) { pending ->
                    TextButton(
                        onClick = { scope.launch { store.retry(pending.id) } },
                        enabled = !state.isLoading,
                    ) {
                        Text(stringResource(R.string.respondkit_retry_message))
                    }
                }
                item(key = bottomKey) { Spacer(Modifier.height(2.dp)) }
            }
            TextButton(
                onClick = {
                    scope.launch {
                        listState.animateScrollToItem(
                            (listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)
                        )
                    }
                },
                modifier = Modifier.align(Alignment.BottomEnd),
            ) {
                Text(stringResource(R.string.respondkit_latest))
            }
        }
        HorizontalDivider()
        if (state.activeThread?.state == "closed")
            Text(stringResource(R.string.respondkit_closed_help), Modifier.padding(16.dp))
        else
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Bottom) {
                OutlinedTextField(
                    value = state.draft,
                    onValueChange = store::setDraft,
                    modifier = Modifier.weight(1f).testTag("respondkit-composer"),
                    label = { Text(stringResource(R.string.respondkit_message)) },
                    maxLines = 6,
                    isError = state.draft.length > 6_000,
                )
                TextButton(
                    onClick = { scope.launch { store.sendDraft() } },
                    enabled =
                        !state.isLoading && state.draft.isNotBlank() && state.draft.length <= 6_000,
                    modifier = Modifier.testTag("respondkit-send"),
                ) {
                    Text(stringResource(R.string.respondkit_send))
                }
            }
    }
}

@Composable
private fun Bubble(text: String, customer: Boolean, status: String?) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (customer) Alignment.End else Alignment.Start,
    ) {
        SelectionContainer {
            Text(
                text,
                Modifier.widthIn(max = 320.dp)
                    .background(
                        if (customer) MaterialTheme.colorScheme.primaryContainer
                        else MaterialTheme.colorScheme.surfaceVariant,
                        RoundedCornerShape(16.dp),
                    )
                    .padding(12.dp),
            )
        }
        if (status != null) Text(status, style = MaterialTheme.typography.labelSmall)
    }
}
