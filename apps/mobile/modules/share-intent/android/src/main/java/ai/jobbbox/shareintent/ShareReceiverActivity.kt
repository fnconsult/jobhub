package ai.jobbbox.shareintent

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/** The share link's address, `jobbbox://partage` (APP_SCHEME and SHARE_PATH in @jobhub/shared). */
private const val SCHEME = "jobbbox"
private const val SHARE_HOST = "partage"

/** As much text as the web app takes (MAX_SHARED_TEXT_CHARS). */
private const val MAX_TEXT = 100_000

/**
 * The share link of a share (`Intent.ACTION_SEND`, text), as the app reads it (`readShareLink` in @jobhub/shared):
 * `jobbbox://partage?text=…`, the text shared (`EXTRA_TEXT`) with the page's title before it when the sharing app gives
 * one apart (`EXTRA_SUBJECT`). The app finds the link in the text. Null for anything else, or nothing.
 */
fun shareLinkOf(intent: Intent?): Uri? {
  if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return null
  val shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim().orEmpty()
  val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
  val text = if (subject.isEmpty() || shared.contains(subject)) shared else listOf(subject, shared).filter { it.isNotEmpty() }.joinToString("\n")
  if (text.isEmpty()) return null
  return Uri.Builder().scheme(SCHEME).authority(SHARE_HOST).appendQueryParameter("text", text.take(MAX_TEXT)).build()
}

/**
 * « Partager → Jobbbox » on Android (#697): the share sheet starts this activity, which has no screen of its own. It
 * opens the app on the share link, as a link in the app's scheme opens it (the capture screen, signed in first if need
 * be), then ends: nothing is read from the page, sent anywhere or kept here.
 */
class ShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    shareLinkOf(intent)?.let { link ->
      startActivity(Intent(Intent.ACTION_VIEW, link).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    finish()
  }
}
