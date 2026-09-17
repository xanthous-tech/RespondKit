pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        if (providers.gradleProperty("publishedSdkVersion").isPresent) {
            maven {
                url = uri("build/verification-repository")
                content { includeGroup("dev.respondkit") }
            }
        }
        google()
        mavenCentral()
    }
}

rootProject.name = "RespondKitNative"

include(":core", ":compose", ":example")
