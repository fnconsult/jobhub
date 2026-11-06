// Stands in for expo-modules-core's AppContext (build.gradle.kts): what the app's views read of it.
package expo.modules.kotlin

import android.app.Activity

open class AppContext {
  open val currentActivity: Activity? = null
}
