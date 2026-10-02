package dev.respondkit.files

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.*
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.Executors

class RespondKitFilesModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private var pending: Promise? = null
    private val executor = Executors.newSingleThreadExecutor()
    override fun getName() = "RespondKitFiles"
    init {
        context.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode != 6321) return
                val promise = pending ?: return
                pending = null
                if (resultCode != Activity.RESULT_OK || data == null) { promise.resolve(Arguments.createArray()); return }
                val uris = data.clipData?.let { clips -> (0 until clips.itemCount).map { clips.getItemAt(it).uri } }
                    ?: listOfNotNull(data.data)
                executor.execute {
                    try {
                        val files = Arguments.createArray()
                        for (uri in uris) {
                            val resolver = context.contentResolver
                            var name = "file"
                            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                                if (it.moveToFirst()) name = it.getString(0) ?: name
                            }
                            val directory = File(context.cacheDir, "respondkit-${UUID.randomUUID()}").apply { mkdirs() }
                            val file = File(directory, File(name).name.ifBlank { "file" })
                            resolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } }
                                ?: error("Cannot read selected file")
                            files.pushMap(Arguments.createMap().apply {
                                putString("uri", Uri.fromFile(file).toString()); putString("name", file.name)
                                putDouble("size", file.length().toDouble()); putString("contentType", resolver.getType(uri) ?: "application/octet-stream")
                            })
                        }
                        promise.resolve(files)
                    } catch (error: Exception) { promise.reject("file_import", error) }
                }
            }
        })
    }
    @ReactMethod fun pick(kind: String, promise: Promise) {
        val activity = context.currentActivity
        if (activity == null || pending != null) { promise.reject("file_import", "File picker unavailable"); return }
        pending = promise
        activity.runOnUiThread {
            try {
                val intent = if (kind == "photos" && Build.VERSION.SDK_INT >= 33) {
                    Intent(MediaStore.ACTION_PICK_IMAGES).putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit())
                } else {
                    Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE); putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        if (kind == "photos") putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
                    }
                }
                activity.startActivityForResult(intent, 6321)
            } catch (error: Exception) { pending = null; promise.reject("file_import", error) }
        }
    }
    @ReactMethod fun readChunk(uri: String, offset: Double, length: Double, promise: Promise) {
        executor.execute {
            try {
                val file = File(Uri.parse(uri).path!!).canonicalFile
                require(file.path.startsWith(context.cacheDir.canonicalPath + "/respondkit-"))
                val bytes = ByteArray(length.toInt())
                RandomAccessFile(file, "r").use { it.seek(offset.toLong()); it.readFully(bytes) }
                promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
            } catch (error: Exception) { promise.reject("file_read", error) }
        }
    }
}
