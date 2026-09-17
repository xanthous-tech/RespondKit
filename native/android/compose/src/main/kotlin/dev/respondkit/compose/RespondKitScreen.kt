package dev.respondkit.compose

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.respondkit.core.*
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

private val WidgetInk = Color(0xFF171717)
private val WidgetMuted = Color(0xFF737373)
private val WidgetBorder = Color(0xFFE5E5E5)
private val WidgetFill = Color(0xFFF5F5F5)
private val WidgetError = Color(0xFFDC2626)

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

/**
 * One full-screen conversation. Accent inherits the host; neutral surfaces match the web widget.
 */
@Composable
fun RespondKitScreen(
    store: RespondKitStore,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = stringResource(R.string.respondkit_support),
    accentColor: Color? = null,
) {
    val accent = (accentColor ?: MaterialTheme.colorScheme.primary).compositeOver(Color.White)
    MaterialTheme(
        colorScheme =
            lightColorScheme(
                primary = accent,
                onPrimary = if (accent.luminance() > 0.179f) Color.Black else Color.White,
                primaryContainer = accent.copy(alpha = 0.1f).compositeOver(Color.White),
                onPrimaryContainer = WidgetInk,
                background = Color.White,
                surface = Color.White,
                onSurface = WidgetInk,
                surfaceVariant = WidgetFill,
                onSurfaceVariant = WidgetMuted,
                outline = WidgetBorder,
                error = WidgetError,
            )
    ) {
        RespondKitContent(store, onClose, modifier, title)
    }
}

@Composable
private fun RespondKitContent(
    store: RespondKitStore,
    onClose: () -> Unit,
    modifier: Modifier,
    title: String,
) {
    val state by store.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    DisposableEffect(store) {
        store.setScreenVisible(true)
        onDispose { store.setScreenVisible(false) }
    }
    LaunchedEffect(store) { store.openConversation() }
    BackHandler(onBack = onClose)
    Column(modifier.fillMaxSize().background(Color.White).safeDrawingPadding().imePadding()) {
        Row(
            Modifier.fillMaxWidth()
                .heightIn(min = 64.dp)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(0.dp)) {
                Text(
                    title,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = WidgetInk,
                    maxLines = 1,
                )
                Text("Ask us anything", fontSize = 14.sp, lineHeight = 20.sp, color = WidgetMuted)
            }
            IconButton(
                onClick = onClose,
                modifier = Modifier.size(40.dp).testTag("respondkit-close"),
            ) {
                Icon(
                    painterResource(R.drawable.respondkit_close),
                    "Close support chat",
                    Modifier.size(16.dp),
                    tint = WidgetInk,
                )
            }
        }
        HorizontalDivider(color = WidgetBorder)
        state.errorMessage?.let { error ->
            Row(
                Modifier.fillMaxWidth().background(WidgetFill).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(error, Modifier.weight(1f), fontSize = 14.sp, color = WidgetInk)
                TextButton(onClick = { scope.launch { store.refresh() } }) { Text("Retry") }
            }
        }
        Conversation(store, state, Modifier.weight(1f))
    }
}

@Composable
private fun Conversation(store: RespondKitStore, state: SupportState, modifier: Modifier) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val rows = remember(state.messages, state.pendingMessages) { transcriptRows(state) }
    val bottomKey = "bottom-${state.loadedCursor}"
    var atBottom by remember(state.activeThreadId) { mutableStateOf(true) }
    var unseen by remember(state.activeThreadId) { mutableIntStateOf(0) }
    var previousIds by remember(state.activeThreadId) { mutableStateOf(emptyList<String>()) }
    val ids = rows.map { it.id }
    LaunchedEffect(state.activeThreadId, ids) {
        if (ids.isNotEmpty()) {
            if (previousIds.isEmpty() || atBottom) {
                listState.scrollToItem(rows.size)
                unseen = 0
            } else {
                unseen += ids.count { it !in previousIds }
            }
        }
        previousIds = ids
    }
    LaunchedEffect(state.activeThreadId, state.loadedCursor, state.isForeground, ids.isEmpty()) {
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
            .collect { visible ->
                atBottom = visible || ids.isEmpty()
                if (visible) {
                    unseen = 0
                    state.activeThreadId?.let { store.markDisplayed(it, state.loadedCursor) }
                }
            }
    }
    Column(modifier.fillMaxWidth()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                Modifier.fillMaxSize().testTag("respondkit-messages"),
                state = listState,
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.Bottom),
            ) {
                itemsIndexed(rows, key = { _, row -> row.id }) { index, row ->
                    Column {
                        if (
                            row.date != null &&
                                (index == 0 ||
                                    rows[index - 1].date?.toLocalDate() != row.date.toLocalDate())
                        ) {
                            Text(
                                row.date.format(
                                    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
                                        .withLocale(Locale.getDefault())
                                ),
                                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                                textAlign = TextAlign.Center,
                                fontSize = 12.sp,
                                lineHeight = 16.sp,
                                color = WidgetMuted,
                            )
                            Spacer(Modifier.height(12.dp))
                        }
                        Bubble(row, state.isSending) { scope.launch { store.retry(it) } }
                    }
                }
                item(key = bottomKey) { Spacer(Modifier.height(2.dp)) }
            }
            if (rows.isEmpty()) {
                if (state.isLoading && !state.isSending) {
                    Column(
                        Modifier.fillMaxWidth().align(Alignment.TopStart).padding(16.dp).semantics {
                            contentDescription = "Loading messages"
                        },
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        listOf(0.75f to 56.dp, 0.8f to 80.dp, 0.67f to 48.dp).forEachIndexed {
                            index,
                            (width, height) ->
                            Box(
                                Modifier.fillMaxWidth(width)
                                    .height(height)
                                    .align(if (index == 1) Alignment.Start else Alignment.End)
                                    .background(WidgetFill, RoundedCornerShape(10.dp))
                            )
                        }
                    }
                } else
                    Column(
                        Modifier.align(Alignment.Center).padding(horizontal = 16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            "How can we help?",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            color = WidgetInk,
                        )
                        Text(
                            "Send a message and keep this page open for a quick reply.",
                            fontSize = 14.sp,
                            color = WidgetMuted,
                            textAlign = TextAlign.Center,
                        )
                    }
            }
            if (unseen > 0)
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            listState.animateScrollToItem(rows.size)
                            unseen = 0
                        }
                    },
                    modifier =
                        Modifier.align(Alignment.BottomEnd).padding(12.dp).semantics {
                            contentDescription = "Latest messages"
                        },
                    colors =
                        ButtonDefaults.outlinedButtonColors(
                            containerColor = Color.White,
                            contentColor = WidgetInk,
                        ),
                ) {
                    Icon(painterResource(R.drawable.respondkit_down), null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("$unseen new", fontSize = 14.sp)
                }
        }
        HorizontalDivider(color = WidgetBorder)
        if (state.activeThread?.state == "closed") {
            Column(Modifier.padding(12.dp)) {
                Text(
                    stringResource(R.string.respondkit_closed_help),
                    fontSize = 14.sp,
                    color = WidgetMuted,
                )
                TextButton(onClick = { store.selectThread(null) }) {
                    Text(stringResource(R.string.respondkit_another_message))
                }
            }
        } else Composer(store, state)
    }
}

@Composable
private fun Composer(store: RespondKitStore, state: SupportState) {
    val scope = rememberCoroutineScope()
    var focused by remember { mutableStateOf(false) }
    val canSend =
        !state.isLoading &&
            !state.isSending &&
            state.draft.isNotBlank() &&
            state.draft.length <= 6_000
    Row(
        Modifier.fillMaxWidth().padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        BasicTextField(
            state.draft,
            store::setDraft,
            Modifier.weight(1f)
                .heightIn(min = 44.dp)
                .testTag("respondkit-composer")
                .semantics { contentDescription = "Message" }
                .onFocusChanged { focused = it.isFocused }
                .border(
                    1.dp,
                    if (focused) MaterialTheme.colorScheme.primary else WidgetBorder,
                    RoundedCornerShape(12.dp),
                )
                .padding(horizontal = 10.dp, vertical = 10.dp),
            textStyle = TextStyle(fontSize = 16.sp, lineHeight = 20.sp, color = WidgetInk),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            maxLines = 6,
            decorationBox = { input ->
                Box {
                    if (state.draft.isEmpty())
                        Text(
                            "Write a message…",
                            fontSize = 16.sp,
                            lineHeight = 20.sp,
                            color = WidgetMuted,
                        )
                    input()
                }
            },
        )
        Button(
            onClick = { scope.launch { store.sendDraft() } },
            enabled = canSend,
            modifier = Modifier.size(44.dp).testTag("respondkit-send"),
            shape = RoundedCornerShape(12.dp),
            contentPadding = PaddingValues(0.dp),
            colors =
                ButtonDefaults.buttonColors(
                    disabledContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
                    disabledContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
        ) {
            Icon(painterResource(R.drawable.respondkit_send), "Send message", Modifier.size(16.dp))
        }
    }
}

@Composable
private fun Bubble(row: TranscriptRow, isSending: Boolean, retry: (String) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        Column(
            Modifier.widthIn(max = maxWidth * 0.84f)
                .align(if (row.customer) Alignment.CenterEnd else Alignment.CenterStart),
            horizontalAlignment = if (row.customer) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SelectionContainer {
                Text(
                    row.text,
                    fontSize = 14.sp,
                    lineHeight = 23.sp,
                    color = if (row.failed) WidgetError else WidgetInk,
                    modifier =
                        Modifier.background(
                                if (row.failed) WidgetError.copy(alpha = 0.1f)
                                else if (row.customer) MaterialTheme.colorScheme.primaryContainer
                                else WidgetFill,
                                RoundedCornerShape(
                                    topStart = 16.dp,
                                    topEnd = 16.dp,
                                    bottomEnd = if (row.customer) 4.dp else 16.dp,
                                    bottomStart = if (row.customer) 16.dp else 4.dp,
                                ),
                            )
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
            Row(
                Modifier.heightIn(min = 20.dp).padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                row.date?.let {
                    Text(
                        it.format(
                            DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
                                .withLocale(Locale.getDefault())
                        ),
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        color = WidgetMuted,
                    )
                }
                row.status?.let { Text(it, fontSize = 12.sp, color = WidgetMuted) }
                row.retryId?.let { id ->
                    TextButton(
                        onClick = { retry(id) },
                        enabled = !isSending,
                        contentPadding = PaddingValues(0.dp),
                    ) {
                        Text(
                            "Try again",
                            fontSize = 12.sp,
                            lineHeight = 16.sp,
                            color =
                                if (row.failed) WidgetError else MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
}
