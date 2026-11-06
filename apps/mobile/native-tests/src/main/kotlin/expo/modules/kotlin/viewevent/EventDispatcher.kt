// Stands in for expo-modules-core's view events (build.gradle.kts): an event a view sends is kept, for a test to read.
package expo.modules.kotlin.viewevent

import android.view.View
import kotlin.reflect.KProperty

fun interface ViewEventCallback<T> {
  operator fun invoke(arg: T)
}

class ViewEventDelegate<T>(private val view: View) {
  operator fun getValue(thisRef: View, property: KProperty<*>): ViewEventCallback<T> =
    ViewEventCallback { arg -> SentEvents.of(view) += property.name to arg }
}

object SentEvents {
  private val sent = mutableMapOf<View, MutableList<Pair<String, Any?>>>()

  fun of(view: View): MutableList<Pair<String, Any?>> = sent.getOrPut(view) { mutableListOf() }
}

@Suppress("FunctionName")
fun View.EventDispatcher(): ViewEventDelegate<Map<String, Any>> = ViewEventDelegate(this)
