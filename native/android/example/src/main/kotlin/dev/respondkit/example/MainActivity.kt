package dev.respondkit.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.respondkit.compose.*
import dev.respondkit.core.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(
                colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()
            ) {
                val scope = rememberCoroutineScope()
                val result = remember {
                    runCatching {
                        val configuration =
                            RespondKitConfiguration(
                                "http://10.0.2.2:8789",
                                "inbox_demo",
                                "http://localhost:8789",
                                2_000,
                            )
                        RespondKitStore(
                            configuration,
                            CustomerContext(locale = "en"),
                            EncryptedFilePersistence(
                                applicationContext,
                                configuration.storageScope,
                            ),
                            scope = scope,
                        )
                    }
                }
                val store = result.getOrNull()
                if (store == null)
                    Text(
                        "Support setup failed: ${result.exceptionOrNull()?.message}",
                        Modifier.safeDrawingPadding().padding(24.dp),
                    )
                else {
                    RespondKitLifecycle(store)
                    val state by store.state.collectAsStateWithLifecycle()
                    var showSupport by rememberSaveable { mutableStateOf(false) }
                    if (showSupport)
                        RespondKitScreen(
                            store,
                            onClose = { showSupport = false },
                            title = "Example support",
                        )
                    else
                        Surface(Modifier.fillMaxSize()) {
                            Column(
                                Modifier.safeDrawingPadding().padding(32.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center,
                            ) {
                                Text(
                                    "Your app, your controls",
                                    style = MaterialTheme.typography.headlineMedium,
                                )
                                Spacer(Modifier.height(16.dp))
                                Text(
                                    "RespondKit supplies the conversation. You choose how people open it."
                                )
                                Spacer(Modifier.height(24.dp))
                                Button(onClick = { showSupport = true }) {
                                    Text("Contact support")
                                    if (state.hasUnreadReplies) {
                                        Spacer(Modifier.width(8.dp))
                                        Box(
                                            Modifier.size(8.dp)
                                                .background(Color.Red, CircleShape)
                                                .semantics {
                                                    contentDescription = "Unread support reply"
                                                }
                                        )
                                    }
                                }
                                TextButton(onClick = { showSupport = true }) {
                                    Text("Report a problem")
                                }
                                Text(
                                    "Local demo · host:8789",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                }
            }
        }
    }
}
