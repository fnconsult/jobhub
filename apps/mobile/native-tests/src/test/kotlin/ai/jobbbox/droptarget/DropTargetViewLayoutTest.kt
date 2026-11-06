package ai.jobbbox.droptarget

import ai.jobbbox.reactnative.ReactTextInput
import ai.jobbbox.reactnative.ReactView
import ai.jobbbox.reactnative.updateLayout
import android.app.Activity
import android.graphics.Rect
import android.os.Looper
import android.view.View
import expo.modules.kotlin.AppContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The conversation's box on Android (Conversation.tsx, #835): the drop target (#696) holding « + », the field « Votre
 * message » and « Envoyer » in a row, laid out by React Native. The box once drew « + » alone, across its whole width:
 * the field and « Envoyer » were past its edge, undrawn and out of the accessibility tree.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w800dp-h1280dp-mdpi")
class DropTargetViewLayoutTest {
  private lateinit var box: DropTargetView
  private lateinit var plus: ReactView
  private lateinit var field: ReactTextInput
  private lateinit var send: ReactView

  @Before
  fun mount() {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val screen = ReactView(activity)
    box = DropTargetView(activity, AppContext())
    plus = ReactView(activity)
    field = ReactTextInput(activity)
    send = ReactView(activity)
    // React Native adds a view's children as a ViewGroup's addView does, with that ViewGroup's default layout params.
    listOf(plus, field, send).forEach(box::addView)
    screen.addView(box)
    activity.setContentView(screen)
    shadowOf(Looper.getMainLooper()).idle()
  }

  /**
   * A commit of React Native: the box gets its frame on the screen, then those of its children, in it, that changed
   * (`children`), as Yoga computes them for a box `width` wide: padding 4, gap 4, alignItems flex-end, « + » and
   * « Envoyer » 44 × 44, the field the rest of the row (flex 1).
   */
  private fun commit(y: Int, width: Int, height: Int = 60, children: List<View> = listOf(plus, field, send)) {
    updateLayout(box, 16, y, width, height)
    if (plus in children) updateLayout(plus, 4, height - 48, 44, 44)
    if (field in children) updateLayout(field, 52, 4, width - 104, height - 8)
    if (send in children) updateLayout(send, width - 48, height - 48, 44, 44)
  }

  private fun frame(view: View) = Rect(view.left, view.top, view.right, view.bottom)

  private fun assertInTheBox(width: Int, height: Int = 60) {
    assertEquals("« + »", Rect(4, height - 48, 48, height - 4), frame(plus))
    assertEquals("« Votre message »", Rect(52, 4, width - 52, height - 4), frame(field))
    assertEquals("« Envoyer »", Rect(width - 48, height - 48, width - 4, height - 4), frame(send))
    for ((name, view) in listOf("« + »" to plus, "« Votre message »" to field, "« Envoyer »" to send)) {
      val drawn = Rect()
      assertTrue("$name is drawn on the screen", view.getGlobalVisibleRect(drawn) && !drawn.isEmpty)
    }
  }

  /** Typing, or React Native setting the field's text: the EditText asks for a layout, which reaches the box. */
  private fun type(text: String) {
    field.setText(text)
    assertTrue("the box was asked for a layout", box.isLayoutRequested)
  }

  @Test
  fun `React Native places « + », the field and « Envoyer » in the box`() {
    commit(y = 1000, width = 288)

    assertInTheBox(width = 288)
  }

  @Test
  fun `they stay in place when the box moves up, the keyboard open, its children keeping their frames in it`() {
    commit(y = 1000, width = 288)
    type("Bonjour")
    commit(y = 600, width = 288, children = emptyList())

    assertInTheBox(width = 288)
  }

  @Test
  fun `they stay in place when the box widens, the foldable unfolded, « + » keeping its frame in it`() {
    commit(y = 1000, width = 288)
    type("Bonjour")
    // The field widens with the box and « Envoyer » moves to its new end; « + » keeps its frame.
    commit(y = 1000, width = 568, children = listOf(field, send))

    assertInTheBox(width = 568)
  }

  @Test
  fun `they stay in place when the box grows a line taller, the text larger, around the field`() {
    commit(y = 1000, width = 288)
    type("Bonjour")
    // The field a line taller: the box with it, « + » and « Envoyer » down to its foot.
    commit(y = 980, width = 288, height = 80)

    assertInTheBox(width = 288, height = 80)
  }
}
