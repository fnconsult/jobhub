// The app's own Android views (modules/*/android), compiled as they are and run on the Android framework's real layout
// code on the JVM (#835): Robolectric's Android 16, no device, no emulator, no Android SDK. Around them, Expo's ExpoView
// is compiled from the installed expo-modules-core; the few classes of Expo, React Native and AndroidX that it and the
// views name stand in for theirs (src/main/kotlin: none takes part in layout); and React Native lays out their children
// as its mounting does (src/test/kotlin/ai/jobbbox/reactnative). `npm run test:android -w @jobhub/mobile` (JDK 21,
// Maven Central and Google's Maven reachable); CI runs it (.github/workflows/ci.yml, job `android-views`).
import java.util.zip.ZipFile

plugins {
  kotlin("jvm") version "2.2.21"
}

// Expo's base class of every native view, as installed, alone: the rest of expo-modules-core needs React Native's native
// code.
val expoView = tasks.register<Sync>("expoView") {
  from(rootDir.resolve("../../../node_modules/expo-modules-core/android/src/main/java")) {
    include("expo/modules/kotlin/views/ExpoView.kt")
  }
  into(layout.buildDirectory.dir("generated/expo-view"))
}

kotlin {
  jvmToolchain(21)
}

sourceSets {
  main {
    kotlin {
      // The app's views, as prebuild compiles them into the app.
      srcDir("../modules/drop-target/android/src/main/java")
      srcDir(expoView)
    }
  }
}

// Android 16 (API 36), the app's target, as Robolectric builds it.
val androidAll = "16-robolectric-13921718"

dependencies {
  compileOnly("org.robolectric:android-all:$androidAll")
  testImplementation("org.robolectric:android-all:$androidAll")
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.robolectric:robolectric:4.16.1")
}

// AndroidX Test, which Robolectric runs on, ships Android libraries (.aar): the JVM reads the classes inside.
abstract class AarClasses : TransformAction<TransformParameters.None> {
  @get:InputArtifact
  abstract val aar: Provider<FileSystemLocation>

  override fun transform(outputs: TransformOutputs) {
    val input = aar.get().asFile
    ZipFile(input).use { zip ->
      zip.getInputStream(zip.getEntry("classes.jar")).use { classes ->
        outputs.file("${input.nameWithoutExtension}.jar").outputStream().use(classes::copyTo)
      }
    }
  }
}

val artifactType = Attribute.of("artifactType", String::class.java)

dependencies.registerTransform(AarClasses::class) {
  from.attribute(artifactType, "aar")
  to.attribute(artifactType, "jar")
}

listOf(configurations.testCompileClasspath, configurations.testRuntimeClasspath).forEach {
  it { attributes.attribute(artifactType, "jar") }
}

tasks.test {
  systemProperty("robolectric.logging.enabled", "false")
  testLogging {
    events("passed", "failed")
    exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
  }
}
