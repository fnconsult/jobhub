// Stands in for expo-modules-core's module definition DSL (build.gradle.kts): the part the app's modules write. What a
// module declares is kept, for a test to read.
package expo.modules.kotlin.modules

import android.view.View
import kotlin.reflect.KClass

abstract class Module {
  abstract fun definition(): ModuleDefinitionData
}

class ModuleDefinitionData(val name: String?, val views: Map<KClass<out View>, List<String>>)

class ModuleDefinitionBuilder {
  var name: String? = null
  val views = mutableMapOf<KClass<out View>, List<String>>()

  fun Name(name: String) {
    this.name = name
  }

  fun <T : View> View(viewClass: KClass<T>, body: ViewDefinitionBuilder.() -> Unit) {
    views[viewClass] = ViewDefinitionBuilder().apply(body).events
  }
}

class ViewDefinitionBuilder {
  val events = mutableListOf<String>()

  fun Events(vararg callbacks: String) {
    events += callbacks
  }
}

@Suppress("FunctionName")
fun Module.ModuleDefinition(block: ModuleDefinitionBuilder.() -> Unit): ModuleDefinitionData =
  ModuleDefinitionBuilder().apply(block).let { ModuleDefinitionData(it.name, it.views) }
