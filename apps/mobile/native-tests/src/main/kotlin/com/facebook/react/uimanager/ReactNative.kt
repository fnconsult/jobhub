// Stand in for the two classes of React Native that ExpoView names (build.gradle.kts). Neither takes part in layout:
// one holds a view's Fabric state, the other clips its drawing to rounded borders.
package com.facebook.react.uimanager

import android.graphics.Canvas
import android.view.View

interface StateWrapper

object BackgroundStyleApplicator {
  @Suppress("UNUSED_PARAMETER")
  fun clipToPaddingBox(view: View, canvas: Canvas) = Unit
}
