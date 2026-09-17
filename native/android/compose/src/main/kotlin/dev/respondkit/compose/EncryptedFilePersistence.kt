package dev.respondkit.compose

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import dev.respondkit.core.RespondKitPersistence
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Atomic, Android Keystore-encrypted state, excluded from cloud backup. A lost key is a surfaced
 * error.
 */
class EncryptedFilePersistence(context: Context, scope: String) : RespondKitPersistence {
    private val digest =
        MessageDigest.getInstance("SHA-256").digest(scope.toByteArray()).joinToString("") {
            "%02x".format(it)
        }
    private val alias = "dev.respondkit.$digest"
    private val file = AtomicFile(File(context.noBackupFilesDir, "respondkit-$digest"))

    private fun key(create: Boolean): SecretKey {
        val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keys.getKey(alias, null) as? SecretKey)?.let {
            return it
        }
        check(create) { "Support storage key is unavailable." }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            alias,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
            }
            .generateKey()
    }

    override fun load(): String? {
        val bytes =
            try {
                file.readFully()
            } catch (error: java.io.FileNotFoundException) {
                return null
            }
        check(bytes.size > 12) { "Support storage is damaged." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key(false),
            GCMParameterSpec(128, bytes.copyOfRange(0, 12)),
        )
        return cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
    }

    override fun save(value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true))
        val bytes = cipher.iv + cipher.doFinal(value.toByteArray())
        val stream = file.startWrite()
        try {
            stream.write(bytes)
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }
}
