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
 * Takes the first thing dropped on it from another app beside it (multi-window): a PDF or Word file, read under the
 * activity's drag-and-drop permissions, copied into the app's cache and sent as its file; a link or text, sent as its
 * text. The app decides what to do with it (src/attach/attachment.ts), the server what it is.
 *
 * The box is one drop target, its text field included: a ViewGroup hands a drop to the child under it that took the
 * drag, and an editable EditText takes every drag, so it would insert a dropped file's content:// URI or a link into
 * the draft instead. The box keeps such a drag from its children. A drag started in this app (text dragged within the
 * field) still goes to them, so the field moves its own text as before.
 *
 * React Native lays out what the box holds (« + », the field, « Envoyer »), as it does any view's children (#835).
 * ExpoView is a LinearLayout, which would lay them out again in a row by its own measure of each, and a React view
 * measures as wide as it is let: « + » took the whole box, the field and « Envoyer » went past its edge, undrawn and out
 * of the accessibility tree. The box keeps the size React Native gives it and leaves its children where they are put.
 */
class DropTargetView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onDropItems by EventDispatcher()

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) =
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun dispatchDragEvent(event: DragEvent): Boolean =
    if (event.localState != null) super.dispatchDragEvent(event) else onDrag(event)

  private fun onDrag(event: DragEvent): Boolean =
    when (event.action) {
      DragEvent.ACTION_DRAG_STARTED -> event.clipDescription?.let(::accepts) ?: false
      DragEvent.ACTION_DROP -> drop(event)
      else -> true
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
