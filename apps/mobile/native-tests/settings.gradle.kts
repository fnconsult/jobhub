// The app's own Android views on the Android framework's real layout code, on the JVM (#835). See build.gradle.kts.
rootProject.name = "jobbbox-native-tests"

pluginManagement {
  repositories {
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositories {
    mavenCentral()
    // AndroidX Test, which Robolectric runs on.
    google()
  }
}
