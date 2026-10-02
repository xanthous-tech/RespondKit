package dev.respondkit.compose

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.respondkit.core.*
import java.io.File
import java.util.UUID
import kotlinx.coroutines.*

private data class PickedFile(val id: String, val uri: Uri, val name: String, val file: File? = null,
    val type: String = "application/octet-stream", val attachment: SupportAttachment? = null, val error: String? = null)

@Composable
internal fun AttachmentPicker(store: RespondKitStore, clear: Int, onChange: (List<SupportAttachment>, Boolean) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var picked by remember(store.attachmentScope, clear) { mutableStateOf(emptyList<PickedFile>()) }
    var expanded by remember { mutableStateOf(false) }
    var requestedScope by remember { mutableStateOf<String?>(null) }
    val jobs = remember { mutableMapOf<String, Job>() }
    DisposableEffect(store.attachmentScope, clear) { onDispose { jobs.values.forEach { it.cancel() }; jobs.clear() } }
    LaunchedEffect(picked) { onChange(picked.mapNotNull { it.attachment }, picked.any { it.attachment == null }) }
    fun update(id: String, action: (PickedFile) -> PickedFile) { picked = picked.map { if (it.id == id) action(it) else it } }
    fun upload(item: PickedFile) {
        update(item.id) { it.copy(error = null) }
        jobs[item.id] = scope.launch {
            try {
                val staged = withContext(Dispatchers.IO) {
                    if (item.file != null) item else {
                        val resolver = context.contentResolver
                        var name = item.name
                        resolver.query(item.uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                            if (it.moveToFirst()) name = it.getString(0) ?: name
                        }
                        val directory = File(context.cacheDir, "respondkit-${item.id}").apply { mkdirs() }
                        val destination = File(directory, File(name).name.ifBlank { "file" })
                        resolver.openInputStream(item.uri)?.use { input -> destination.outputStream().use { input.copyTo(it) } }
                            ?: throw RespondKitException("Cannot open the selected file.")
                        item.copy(file = destination, name = destination.name, type = resolver.getType(item.uri) ?: "application/octet-stream")
                    }
                }
                update(item.id) { staged }
                val attachment = store.upload(staged.file!!, staged.type, item.id)
                update(item.id) { it.copy(attachment = attachment) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                update(item.id) { it.copy(error = error.message ?: "Upload failed") }
            } finally { jobs.remove(item.id) }
        }
    }
    fun select(uris: List<Uri>) {
        val items = uris.map { PickedFile(UUID.randomUUID().toString(), it, "Selected file") }
        picked = picked + items
        items.forEach { upload(it) }
    }
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { if (requestedScope == store.attachmentScope) select(it); requestedScope = null }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { if (requestedScope == store.attachmentScope) select(it); requestedScope = null }
    Column(Modifier.fillMaxWidth()) {
        Box {
            TextButton(onClick = { expanded = true }, enabled = !store.state.value.isSending) { Text("Attach files") }
            DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
                DropdownMenuItem(text = { Text("Photo library") }, onClick = {
                    expanded = false; requestedScope = store.attachmentScope; photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                })
                DropdownMenuItem(text = { Text("Files") }, onClick = { expanded = false; requestedScope = store.attachmentScope; files.launch(arrayOf("*/*")) })
            }
        }
        Column(Modifier.heightIn(max = 128.dp).verticalScroll(rememberScrollState())) {
        picked.forEach { item ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(item.name, Modifier.weight(1f), maxLines = 1, style = MaterialTheme.typography.bodySmall)
                if (item.attachment == null && item.error == null) CircularProgressIndicator(Modifier.size(18.dp))
                if (item.error != null) TextButton(onClick = { upload(item) }) { Text("Retry") }
                TextButton(onClick = { jobs[item.id]?.cancel(); picked = picked.filter { it.id != item.id } }) { Text("Remove") }
            }
            if (item.error != null) Text(item.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        }
    }
}
