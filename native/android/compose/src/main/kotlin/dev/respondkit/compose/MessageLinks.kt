package dev.respondkit.compose

import android.net.Uri
import android.text.SpannableString
import android.text.style.URLSpan
import android.text.util.Linkify
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration

/** Preserve message text verbatim; only explicit web URLs receive link annotations. */
internal fun linkedMessage(text: String, accent: Color): AnnotatedString {
    val detected = SpannableString(text)
    Linkify.addLinks(detected, Linkify.WEB_URLS)
    return buildAnnotatedString {
        append(text)
        for (span in detected.getSpans(0, text.length, URLSpan::class.java)) {
            val start = detected.getSpanStart(span)
            var end = detected.getSpanEnd(span)
            // Android's detector includes sentence punctuation and unmatched brackets.
            while (end > start) {
                val last = text[end - 1]
                val opening = when (last) { ')' -> '('; ']' -> '['; '}' -> '{'; else -> null }
                val candidate = text.substring(start, end)
                val unbalanced = opening != null && candidate.count { it == last } > candidate.count { it == opening }
                if (last !in ".,!?;:。，！？；：" && !unbalanced) break
                end--
            }
            val label = text.substring(start, end)
            if (label.any { it.isWhitespace() }) continue
            val www = label.startsWith("www.", ignoreCase = true)
            if (!www && !label.startsWith("https://", true) && !label.startsWith("http://", true)) continue
            val url = if (www) "https://$label" else label
            if (Uri.parse(url).host.isNullOrBlank()) continue
            addLink(
                LinkAnnotation.Url(
                    url,
                    TextLinkStyles(SpanStyle(color = accent, textDecoration = TextDecoration.Underline)),
                ),
                start,
                end,
            )
        }
    }
}
