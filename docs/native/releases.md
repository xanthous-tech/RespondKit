# Releasing RespondKit

RespondKit has one version across npm, SwiftPM, and Maven Central. `VERSION` is the
source for Android; every workspace package manifest must match it, and the Swift
package uses the matching `v<version>` Git tag. The next shared release is
**0.5.3**, fixing iOS read acknowledgements when replies become visible. Preparing a
version change does not publish it.

## Coordinates

| Distribution | Package |
| --- | --- |
| SwiftPM | `https://github.com/xanthous-tech/RespondKit.git`, tag `v0.5.3` |
| Maven Central | `dev.respondkit:respondkit-core:0.5.3` (JVM JAR) |
| Maven Central | `dev.respondkit:respondkit-compose:0.5.3` (Android release AAR) |
| npm | `@respondkit/protocol`, `@respondkit/api-client`, `@respondkit/react`, all `0.5.3` |

The Compose package exposes core as a transitive API dependency. Consumers need
only the Compose dependency, `google()` and `mavenCentral()`; no credentials or
custom Maven repository are required. Android requires API 26+, JDK 17, and a
Kotlin toolchain compatible with the SDK's Kotlin 2.2 metadata. SwiftUI requires
Swift 6 and iOS 18+.

## One-time setup

The Central Portal namespace `dev.respondkit` is verified using an apex TXT record
on `respondkit.dev`. Keep the verification record in Cloudflare. Sign in using
the same GitHub account used to register: Sonatype treats different login methods
as separate accounts.

GitHub repository secrets used by `.github/workflows/publish.yml`:

| Secret | Value |
| --- | --- |
| `MAVEN_CENTRAL_USERNAME` | Username from a Central Portal user token |
| `MAVEN_CENTRAL_PASSWORD` | Password from the same user token |
| `MAVEN_SIGNING_KEY` | ASCII-armored private GPG signing key |

The token named **RespondKit GitHub Actions** expires **2027-03-17**. Before then,
generate a replacement in [Central Portal](https://central.sonatype.com/usertoken),
update both token secrets, verify a staging upload, and revoke the old token.
These are publishing credentials, not the Sonatype login password.

The dedicated automation signing key has fingerprint
`96D68CAC003A4E24186BCDE3548D5C6567CDDF2B` and expires **2028-09-16**.
Its public key is on `keyserver.ubuntu.com` and in [release-signing-key.asc](release-signing-key.asc).
The private key is a GitHub secret; the restricted local GPG backup is outside the
repository at `~/.local/share/respondkit-release/gnupg`. It is dedicated to
artifact signing and has no passphrase for unattended CI. Back it up as a secret;
never add it to Git. Renew or rotate the key before expiration and update Central's
public key server and the repository secret together.

npm retains the existing trusted publisher configuration for `publish.yml` and
uses GitHub OIDC. SwiftPM needs no publishing account or signing credential.

## Prepare a release

1. Run `pnpm version:set 0.5.3` (substitute the next shared version). This updates
   `VERSION` and every workspace manifest. Run `pnpm install --lockfile-only`.
2. Run `pnpm release:check`, `pnpm ready`, `pnpm build:npm`, `pnpm check:npm`,
   and `pnpm pack:npm`. Native checks also run in CI.
3. Verify the Maven artifacts locally:

   ```sh
   native/android/gradlew -p native/android :core:test :compose:lintRelease \
     :core:publishAllPublicationsToVerificationRepository \
     :compose:publishAllPublicationsToVerificationRepository
   python3 scripts/check-android-publication.py
   native/android/gradlew -p native/android :example:assembleDebug \
     -PpublishedSdkVersion="$(cat VERSION)"
   ```

   This builds an example against the real Maven packages instead of Gradle
   project dependencies, checking the core dependency, sources, API docs, license,
   and metadata. No publishing credentials are needed. Set `JAVA_HOME` and
   `ANDROID_HOME` to the installed JDK and Android SDK when needed.
4. Merge the release preparation PR once all checks pass. Create the matching Git
   tag on that commit and publish its GitHub release. Do not reuse an old tag.

## Release workflow

`publish.yml` validates npm tarballs, the Swift package, and the Android Maven
packages **before either registry publish job runs**. Pull requests and default
manual workflow runs only validate; publishing a GitHub release triggers publication.
The optional manual `stage_android` input also uploads a signed deployment to
Central for server-side validation, without publishing it or any npm package.

Android uses `com.vanniktech.maven.publish` 0.34.0, pinned to the repository's
Gradle 8.14.3 / AGP 8.11.1 toolchain. It signs the artifacts, POM and Gradle metadata,
then uploads and releases both libraries together through Central Portal. Sources
and generated Dokka API documentation accompany both libraries. Only the release
AAR is published; the example app is never published.

SwiftPM resolves the source directly from the shared Git tag. npm publishes the
three verified tarballs in dependency order. The registries are not transactional:
if one fails after another succeeds, inspect the existing versions and resume only
the missing publication. Never overwrite or move a released version. Central
publication can take time to appear to consumers.

For a manual Central staging upload, provide the three Gradle environment variables
shown in the workflow and run `publishToMavenCentral` instead of
`publishAndReleaseToMavenCentral`. Inspect the validated deployment in Central
Portal before pressing Publish. Do not print credentials in logs.

After publication, verify both Android coordinates resolve from Maven Central,
SwiftPM resolves the tag, and all three npm packages report the same version.
Then update Captioner to that version and run its native integration smoke tests.

References: [Central requirements](https://central.sonatype.org/publish/requirements/),
[namespace verification](https://central.sonatype.org/register/namespace/),
[publishing plugin](https://vanniktech.github.io/gradle-maven-publish-plugin/central/).
