// Stands in for expo-modules-core's ShadowNodeProxy (build.gradle.kts), which reaches React Native's native code: it
// sizes a view's shadow node only for a view that uses Android's layout, and is not part of how a view lays out.
package expo.modules.kotlin.views

class ShadowNodeProxy(@Suppress("UNUSED_PARAMETER") expoView: ExpoView)
