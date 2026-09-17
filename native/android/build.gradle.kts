import com.vanniktech.maven.publish.MavenPublishBaseExtension

plugins {
    kotlin("jvm") version "2.2.0" apply false
    kotlin("android") version "2.2.0" apply false
    kotlin("plugin.serialization") version "2.2.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.0" apply false
    id("com.android.library") version "8.11.1" apply false
    id("com.android.application") version "8.11.1" apply false
    id("com.vanniktech.maven.publish") version "0.34.0" apply false
    id("org.jetbrains.dokka") version "2.0.0" apply false
}

val releaseVersion = rootProject.file("../../VERSION").readText().trim()
require(Regex("\\d+\\.\\d+\\.\\d+").matches(releaseVersion)) { "VERSION must be a stable semantic version" }

allprojects {
    group = "dev.respondkit"
    version = releaseVersion
}

subprojects {
    plugins.withId("com.vanniktech.maven.publish") {
        extensions.configure<MavenPublishBaseExtension> {
            coordinates("dev.respondkit", "respondkit-${project.name}", releaseVersion)
            publishToMavenCentral()
            // Local package verification needs no credentials. Release CI requires this key.
            if (providers.gradleProperty("signingInMemoryKey").isPresent) signAllPublications()
            pom {
                name.set("RespondKit ${project.name}")
                description.set("Native customer support conversations for RespondKit")
                url.set("https://respondkit.dev")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/license/mit")
                        distribution.set("repo")
                    }
                }
                developers {
                    developer {
                        id.set("xanthous-tech")
                        name.set("Xanthous Tech")
                        url.set("https://github.com/xanthous-tech")
                    }
                }
                scm {
                    url.set("https://github.com/xanthous-tech/RespondKit")
                    connection.set("scm:git:https://github.com/xanthous-tech/RespondKit.git")
                    developerConnection.set("scm:git:ssh://git@github.com/xanthous-tech/RespondKit.git")
                }
            }
        }
        extensions.configure<PublishingExtension> {
            repositories {
                maven {
                    name = "verification"
                    url = rootProject.layout.buildDirectory.dir("verification-repository").get().asFile.toURI()
                }
            }
        }
        tasks.withType<Jar>().configureEach {
            from(rootProject.file("../../LICENSE")) { into("META-INF") }
        }
        tasks.withType<Zip>().matching { it.name == "bundleReleaseAar" }.configureEach {
            from(rootProject.file("../../LICENSE")) { into("META-INF") }
        }
    }
}
