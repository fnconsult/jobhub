package ai.jobbbox.keycommands

import android.app.Activity
import android.os.Build
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo
import android.view.Menu
import android.view.Window
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** A shortcut as the app's JavaScript registers it (src/keyboard/key-commands.tsx). */
class KeyCommandRecord : Record {
  @Field var id: String = ""

  /** "n", "Enter", "\\", "i", "w" or "Escape". */
  @Field var input: String = ""

  /** "control", or none for Escape. */
  @Field var modifier: String? = null

  @Field var title: String = ""
}

/** A shortcut as Android matches it: a key, with Ctrl or with no modifier. */
data class KeyCommand(val id: String, val keyCodes: List<Int>, val withCtrl: Boolean, val title: String) {
  fun matches(event: KeyEvent): Boolean =
    event.keyCode in keyCodes && if (withCtrl) event.hasModifiers(KeyEvent.META_CTRL_ON) else event.hasNoModifiers()

  fun shortcutInfo() = KeyboardShortcutInfo(title, keyCodes.first(), if (withCtrl) KeyEvent.META_CTRL_ON else 0)

  companion object {
    private val KEY_CODES = mapOf(
      "n" to listOf(KeyEvent.KEYCODE_N),
      "Enter" to listOf(KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER),
      "\\" to listOf(KeyEvent.KEYCODE_BACKSLASH),
      "i" to listOf(KeyEvent.KEYCODE_I),
      "w" to listOf(KeyEvent.KEYCODE_W),
      "Escape" to listOf(KeyEvent.KEYCODE_ESCAPE),
    )

    fun from(record: KeyCommandRecord): KeyCommand? =
      KEY_CODES[record.input]?.let { KeyCommand(record.id, it, record.modifier != null, record.title) }
  }
}

/**
 * The hardware keyboard's shortcuts on Android (#700): the activity's window sees every key event first, a focused text
 * field's included, so Ctrl+Enter sends from the box; a shortcut the app offers is taken there and its id sent to
 * JavaScript (`onKeyCommand`), any other key goes on as before. Meta+/ lists them in the Keyboard Shortcuts Helper.
 */
class KeyCommandsModule : Module() {
  @Volatile private var commands: List<KeyCommand> = emptyList()

  override fun definition() = ModuleDefinition {
    Name("JobbboxKeyCommands")

    Events("onKeyCommand")

    Function("setCommands") { records: List<KeyCommandRecord> ->
      commands = records.mapNotNull(KeyCommand::from)
    }

    OnActivityEntersForeground {
      appContext.currentActivity?.let(::listenTo)
    }
  }

  private fun listenTo(activity: Activity) {
    val window = activity.window ?: return
    val callback = window.callback ?: return
    if (callback is KeyCommandsWindowCallback) return
    val group = activity.applicationInfo.loadLabel(activity.packageManager)
    window.callback = KeyCommandsWindowCallback(callback, group, { commands }) { id -> sendEvent("onKeyCommand", mapOf("id" to id)) }
  }
}

/** The activity's own window callback, with the shortcuts taken before it. */
class KeyCommandsWindowCallback(
  private val wrapped: Window.Callback,
  private val group: CharSequence,
  private val commands: () -> List<KeyCommand>,
  private val fire: (String) -> Unit,
) : Window.Callback by wrapped {
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val command = commands().firstOrNull { it.matches(event) } ?: return wrapped.dispatchKeyEvent(event)
    // Once per press: on the key going down, the key coming up taken too so nothing else sees half of it.
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) fire(command.id)
    return true
  }

  override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>, menu: Menu?, deviceId: Int) {
    wrapped.onProvideKeyboardShortcuts(data, menu, deviceId)
    val shortcuts = commands()
    if (shortcuts.isNotEmpty()) data.add(KeyboardShortcutGroup(group, shortcuts.map(KeyCommand::shortcutInfo)))
  }

  override fun onPointerCaptureChanged(hasCapture: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) wrapped.onPointerCaptureChanged(hasCapture)
  }
}
