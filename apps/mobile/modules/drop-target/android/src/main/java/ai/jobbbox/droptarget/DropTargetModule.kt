package ai.jobbbox.droptarget

import android.app.Activity
import android.content.ClipDescription
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.view.DragEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.UUID

/** The conversation's box as a drop target on an Android tablet (#696): the view the box sits in (src/attach/DropTarget.tsx). */
class DropTargetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("JobbboxDropTarget")

    View(DropTargetView::class) {
      Events("onDropItems")
    }
  }
}

/**
 * Takes the first thing dropped on it, from this app or another one beside it (multi-window): a PDF or Word file, read
 * under the activity's drag-and-drop permissions, copied into the app's cache and sent as its file; a link or text, sent
 * as its text. The app decides what to do with it (src/attach/attachment.ts), the server what it is.
 */
class DropTargetView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onDropItems by EventDispatcher()

  init {
    setOnDragListener { _, event ->
      when (event.action) {
        DragEvent.ACTION_DRAG_STARTED -> event.clipDescription?.let(::accepts) ?: false
        DragEvent.ACTION_DROP -> drop(event)
        else -> true
      }
    }
  }

  private fun accepts(description: ClipDescription): Boolean =
    ACCEPTED.any { description.hasMimeType(it) }

  private fun drop(event: DragEvent): Boolean {
    val item = event.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0) ?: return false
    val uri = item.uri
    if (uri == null) {
      val text = item.text?.toString() ?: return false
      onDropItems(mapOf("items" to listOf(mapOf("kind" to "text", "text" to text))))
      return true
    }
    val activity = appContext.currentActivity as Activity? ?: return false
    val permissions = activity.requestDragAndDropPermissions(event)
    try {
      val file = cached(uri) ?: return false
      onDropItems(
        mapOf(
          "items" to listOf(
            mapOf(
              "kind" to "file",
              "uri" to Uri.fromFile(file.first).toString(),
              "name" to file.first.name,
              "size" to file.first.length().toDouble(),
              "mimeType" to file.second,
            ),
          ),
        ),
      )
      return true
    } finally {
      permissions?.release()
    }
  }

  /** The dropped content, copied into the app's cache under its own name, and its type; null if it cannot be read. */
  private fun cached(uri: Uri): Pair<File, String?>? {
    val resolver = context.contentResolver
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: uri.lastPathSegment ?: "document"
    val folder = File(File(context.cacheDir, "dropped"), UUID.randomUUID().toString()).apply { mkdirs() }
    val copy = File(folder, File(name).name)
    return try {
      resolver.openInputStream(uri)?.use { input -> copy.outputStream().use { input.copyTo(it) } } ?: return null
      copy to resolver.getType(uri)
    } catch (error: Exception) {
      null
    }
  }

  companion object {
    private val ACCEPTED = arrayOf(
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ClipDescription.MIMETYPE_TEXT_PLAIN,
      ClipDescription.MIMETYPE_TEXT_URILIST,
    )
  }
}
