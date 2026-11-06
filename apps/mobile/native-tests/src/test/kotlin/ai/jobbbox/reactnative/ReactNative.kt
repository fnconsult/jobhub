// How React Native lays out the views of the app's screens on Android (Fabric), as react-native 0.88 does it
// (ReactAndroid: fabric/mounting/SurfaceMountingManager.kt, views/view/ReactViewGroup.kt,
// views/textinput/ReactEditText.kt). Yoga computes every view's frame in its parent; the mounting gives each view that
// frame, parents before children, and only to the views whose frame changed since the last commit.
package ai.jobbbox.reactnative

import android.content.Context
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.EditText

/** SurfaceMountingManager.updateLayout: a view gets its frame, measured exactly then laid out. */
fun updateLayout(view: View, x: Int, y: Int, width: Int, height: Int) {
  view.measure(
    MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
    MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
  )
  // Its parent's view manager does not lay out its children itself (needsCustomLayoutForChildren is false: React
  // Native's View and Expo's views alike).
  view.layout(x, y, x + width, y + height)
}

/**
 * A `<View>` (ReactViewGroup), « + » and « Envoyer » among them (Control, a Pressable): as large as it is let, it lays
 * out none of its children and stops a child's request for a layout.
 */
class ReactView(context: Context) : ViewGroup(context) {
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // MeasureSpecAssertions.assertExplicitMeasureSpec
    check(MeasureSpec.getMode(widthMeasureSpec) != MeasureSpec.UNSPECIFIED && MeasureSpec.getMode(heightMeasureSpec) != MeasureSpec.UNSPECIFIED) {
      "A catalyst view must have an explicit width and height given to it."
    }
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun requestLayout() = Unit
}

/** A `<TextInput>` (ReactEditText), « Votre message »: an EditText that asks for a layout as its text changes. */
class ReactTextInput(context: Context) : EditText(context) {
  override fun isLayoutRequested(): Boolean = false

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit
}
