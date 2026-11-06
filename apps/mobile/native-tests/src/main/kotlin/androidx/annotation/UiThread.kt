// Stands in for AndroidX's annotation (build.gradle.kts), which ExpoView names: it only documents the thread.
package androidx.annotation

@Retention(AnnotationRetention.BINARY)
annotation class UiThread
