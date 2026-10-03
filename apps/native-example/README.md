# React Native example

This app opens RespondKit with a custom greeting, email capture, native model/OS context, persisted local UI state, and a host-owned unread indicator. Its injected transport echoes a canned support reply without keys or external network requests. Demo server state resets when the JS process restarts; use a real inbox for end-to-end history restoration.

Run `pnpm install` at the repository root, then `pnpm --dir apps/native-example start` and `pnpm --dir apps/native-example android` in separate terminals. Android SDK 37/build tools 37 and the Gradle-selected NDK are needed for React Native 0.87.1. iOS: run `bundle install` here, `bundle exec pod install` in `ios`, then `pnpm --dir apps/native-example ios`.

The sample uses AsyncStorage; production apps can pass their encrypted storage implementation through `storagePersistence`. Read [the SDK guide](../../packages/react-native/README.md) for integration and parity details.

The native file/photo pickers work without adding permissions. Uploading requires a real API/R2 inbox: remove the injected `client` and `fetch` options and configure your inbox. The default demo fails uploads locally with an explicit setup message and does not send selected files externally.
