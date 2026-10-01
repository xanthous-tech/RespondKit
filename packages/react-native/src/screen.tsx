import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  processColor,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinkifyIt } from "linkify-it";
import { useRespondKit } from "./hooks";
import type { RespondKitStore, SupportSnapshot } from "./store";

const links = new LinkifyIt().set({ fuzzyEmail: false, fuzzyIP: false });
export interface RespondKitScreenProps {
  readonly store: RespondKitStore;
  readonly onClose: () => void;
  readonly title?: string;
  readonly greeting?: string;
  readonly accentColor?: string;
  readonly accentForegroundColor?: string;
}
interface Row {
  id: string;
  text: string;
  customer: boolean;
  date: string;
  status?: string;
  retryId?: string;
  failed: boolean;
}
export function transcriptRows(state: SupportSnapshot): Row[] {
  const canonicalIds = new Set(state.messages.map((m) => m.clientMessageId));
  return [
    ...state.messages.map((m) => ({
      id: m.id,
      text: m.text,
      customer: m.direction === "customer_to_operator",
      date: m.acceptedAt,
      ...(m.direction === "customer_to_operator"
        ? { status: m.state === "failed" ? "Failed" : "Sent" }
        : {}),
      ...(m.state === "failed" && m.clientMessageId ? { retryId: m.clientMessageId } : {}),
      failed: m.state === "failed",
    })),
    ...state.pending
      .filter((m) => !canonicalIds.has(m.id))
      .map((m) => ({
        id: m.id,
        text: m.text,
        customer: true,
        date: m.acceptedAt,
        status:
          m.delivery === "sending"
            ? "Sending…"
            : m.delivery === "acceptance_unknown"
              ? "Confirming…"
              : m.delivery === "failed"
                ? "Failed"
                : "Sent",
        ...(m.delivery === "failed" || m.delivery === "acceptance_unknown"
          ? { retryId: m.id }
          : {}),
        failed: m.delivery === "failed",
      })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
function MessageText({ text, accent }: { readonly text: string; readonly accent: string }) {
  const matches = links.match(text) ?? [];
  const parts = [];
  let end = 0;
  for (const match of matches) {
    if (!/^https?:\/\//i.test(match.url)) continue;
    parts.push(text.slice(end, match.index));
    parts.push(
      <Text
        key={match.index}
        accessibilityRole="link"
        style={{ color: accent, textDecorationLine: "underline" }}
        onPress={() => {
          void Linking.openURL(match.url).catch(() => undefined);
        }}
      >
        {match.raw}
      </Text>,
    );
    end = match.lastIndex;
  }
  parts.push(text.slice(end));
  return <Text selectable>{parts}</Text>;
}
function Action({
  label,
  onPress,
  disabled = false,
  accent,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly accent: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}
    >
      <Text style={{ color: accent, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function RespondKitScreen({
  store,
  onClose,
  title = "Support",
  greeting,
  accentColor = "#432dd7",
  accentForegroundColor = "#ffffff",
}: RespondKitScreenProps) {
  const state = useRespondKit(store);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const accentFill = useMemo(() => {
    const color = processColor(accentColor);
    if (typeof color !== "number") return "#f5f5f5";
    return `rgba(${(color >>> 16) & 255}, ${(color >>> 8) & 255}, ${color & 255}, 0.1)`;
  }, [accentColor]);
  const rows = useMemo(() => transcriptRows(state), [state.messages, state.pending]);
  const list = useRef<FlatList<Row>>(null);
  const nearBottom = useRef(true);
  const visibleIds = useRef(new Set<string>());
  const acknowledgeRef = useRef<() => void>(() => {});
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 1 });
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { item: Row; isViewable: boolean }[] }) => {
      visibleIds.current = new Set(
        viewableItems.filter((item) => item.isViewable).map((item) => item.item.id),
      );
      acknowledgeRef.current();
    },
  );
  const previousIds = useRef(new Set<string>());
  const [unseen, setUnseen] = useState(0);
  const [history, setHistory] = useState(false);
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);
  const welcome = state.fresh ? greeting?.trim() : undefined;
  const canSend =
    !state.loading &&
    !state.sending &&
    state.draft.trim().length > 0 &&
    state.draft.trim().length <= 6_000;

  useEffect(() => {
    void store.openConversation();
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      onCloseRef.current();
      return true;
    });
    return () => {
      back.remove();
      store.closeConversation();
    };
  }, [store]);
  useEffect(() => {
    nearBottom.current = true;
    previousIds.current = new Set();
    setUnseen(0);
  }, [state.activeThread?.id]);
  useEffect(() => {
    const next = new Set(rows.map((row) => row.id));
    const added = rows.filter((row) => !previousIds.current.has(row.id)).length;
    previousIds.current = next;
    if (nearBottom.current) list.current?.scrollToEnd({ animated: true });
    else if (added) setUnseen((n) => n + added);
  }, [rows]);
  // Wait for rendered content/layout and foreground visibility before acknowledging its cursor.
  function acknowledge() {
    if (
      !history &&
      nearBottom.current &&
      visibleIds.current.has(rows.at(-1)?.id ?? "") &&
      AppState.currentState === "active" &&
      state.activeThread
    )
      void store.markDisplayed(state.activeThread.id, state.cursor);
  }
  acknowledgeRef.current = acknowledge;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (current) => {
      if (current === "active") acknowledge();
    });
    return () => subscription.remove();
  });
  useEffect(() => {
    const frame = requestAnimationFrame(acknowledge);
    return () => cancelAnimationFrame(frame);
  }, [state.cursor, state.activeThread?.id, history]);
  function scroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 72;
    if (nearBottom.current) {
      setUnseen(0);
      acknowledge();
    }
  }
  function latest() {
    nearBottom.current = true;
    setUnseen(0);
    list.current?.scrollToEnd({ animated: true });
    acknowledge();
  }
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.muted}>Ask us anything</Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close support chat"
            style={styles.icon}
          >
            <Text style={styles.close}>×</Text>
          </Pressable>
        </View>
        {state.error ? (
          <View style={styles.notice}>
            <Text accessibilityRole="alert" style={[styles.text, styles.grow]}>
              {state.error}
            </Text>
            <Action label="Reconnect" accent={accentColor} onPress={() => void store.refresh()} />
          </View>
        ) : null}
        {state.threads.length > 1 ? (
          <View style={styles.historyBar}>
            <Action
              label={`Conversations${state.unreadThreadIds.size ? ` · ${state.unreadThreadIds.size} unread` : ""}`}
              accent={accentColor}
              onPress={() => setHistory(true)}
            />
          </View>
        ) : null}
        <View style={styles.transcript}>
          <FlatList
            ref={list}
            data={rows}
            keyExtractor={(row) => row.id}
            style={styles.transcript}
            contentContainerStyle={styles.messages}
            viewabilityConfig={viewabilityConfig.current}
            onViewableItemsChanged={onViewableItemsChanged.current}
            accessibilityLabel="Support messages"
            keyboardShouldPersistTaps="handled"
            onScroll={scroll}
            scrollEventThrottle={32}
            onContentSizeChange={() => {
              if (nearBottom.current) {
                list.current?.scrollToEnd({ animated: false });
                acknowledge();
              }
            }}
            onLayout={acknowledge}
            ListHeaderComponent={
              welcome ? (
                <View style={[styles.bubble, styles.operator, { maxWidth: "84%" }]}>
                  <Text style={styles.text}>
                    <MessageText text={welcome} accent={accentColor} />
                  </Text>
                </View>
              ) : undefined
            }
            ListEmptyComponent={
              !welcome ? (
                state.loading ? (
                  <View accessibilityLabel="Loading messages" style={styles.skeletons}>
                    {[0.75, 0.8, 0.67].map((width, i) => (
                      <View
                        key={width}
                        style={[
                          styles.skeleton,
                          {
                            width: `${width * 100}%`,
                            height: i === 1 ? 80 : 56,
                            alignSelf: i === 1 ? "flex-start" : "flex-end",
                          },
                        ]}
                      />
                    ))}
                  </View>
                ) : (
                  <View style={styles.empty}>
                    <Text style={[styles.text, { fontWeight: "500" }]}>How can we help?</Text>
                    <Text style={[styles.muted, { textAlign: "center" }]}>
                      Send a message and keep this page open for a quick reply.
                    </Text>
                  </View>
                )
              ) : undefined
            }
            renderItem={({ item, index }) => {
              const date = new Date(item.date);
              const previous = rows[index - 1];
              return (
                <View>
                  {!previous || new Date(previous.date).toDateString() !== date.toDateString() ? (
                    <Text style={styles.day}>
                      {date.toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </Text>
                  ) : null}
                  <View
                    style={[styles.row, { alignSelf: item.customer ? "flex-end" : "flex-start" }]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        item.customer
                          ? { backgroundColor: accentFill, borderBottomRightRadius: 4 }
                          : styles.operator,
                        item.failed && { backgroundColor: "#fef2f2" },
                      ]}
                    >
                      <Text style={[styles.text, item.failed && { color: "#dc2626" }]}>
                        <MessageText text={item.text} accent={accentColor} />
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.delivery,
                        { justifyContent: item.customer ? "flex-end" : "flex-start" },
                      ]}
                    >
                      <Text style={styles.caption}>
                        {date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </Text>
                      {item.status ? <Text style={styles.caption}>{item.status}</Text> : null}
                      {item.retryId ? (
                        <Action
                          label="Try again"
                          disabled={state.sending}
                          accent={item.failed ? "#dc2626" : accentColor}
                          onPress={() => void store.retry(item.retryId!)}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            }}
          />
          {unseen > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show ${unseen} new messages`}
              onPress={latest}
              style={styles.latest}
            >
              <Text style={styles.text}>↓ {unseen} new</Text>
            </Pressable>
          ) : null}
        </View>
        {state.activeThread?.state === "closed" ? (
          <View style={styles.closed}>
            <Text style={styles.muted}>This conversation is closed.</Text>
            <Action
              label="Send another message"
              accent={accentColor}
              onPress={() => void store.selectThread()}
            />
          </View>
        ) : (
          <>
            {!state.email ? (
              <View style={styles.email}>
                <Text style={styles.muted}>Where can we email you a reply?</Text>
                <View style={styles.emailRow}>
                  <TextInput
                    accessibilityLabel="Email address"
                    placeholder="you@example.com"
                    placeholderTextColor="#737373"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    maxLength={320}
                    value={email}
                    onChangeText={setEmail}
                    style={[styles.input, styles.grow]}
                  />
                  <Action
                    label={state.loading ? "Saving…" : "Save email"}
                    accent={accentColor}
                    disabled={state.loading || !email.trim()}
                    onPress={() => void store.saveEmail(email)}
                  />
                </View>
              </View>
            ) : null}
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Message"
                placeholder="Write a message…"
                placeholderTextColor="#737373"
                multiline
                value={state.draft}
                onChangeText={(text) => {
                  void store.setDraft(text);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={[
                  styles.input,
                  styles.grow,
                  { maxHeight: 144, borderColor: focused ? accentColor : "#e5e5e5" },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                disabled={!canSend}
                onPress={() => void store.sendDraft()}
                style={[styles.send, { backgroundColor: accentColor, opacity: canSend ? 1 : 0.5 }]}
              >
                {state.sending ? (
                  <ActivityIndicator color={accentForegroundColor} />
                ) : (
                  <Text style={{ fontSize: 22, color: accentForegroundColor }}>➤</Text>
                )}
              </Pressable>
            </View>
            {state.draft.trim().length > 6_000 ? (
              <Text accessibilityRole="alert" style={styles.limit}>
                Messages can contain up to 6,000 characters.
              </Text>
            ) : null}
          </>
        )}
        <Modal visible={history} animationType="slide" onRequestClose={() => setHistory(false)}>
          <SafeAreaView style={styles.root}>
            <View style={styles.header}>
              <Text style={[styles.title, styles.grow]}>Conversations</Text>
              <Action label="Done" accent={accentColor} onPress={() => setHistory(false)} />
            </View>
            <FlatList
              data={state.threads}
              keyExtractor={(thread) => thread.id}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setHistory(false);
                    void store.selectThread(item.id);
                  }}
                  style={styles.historyItem}
                >
                  <Text style={styles.text}>
                    {new Date(item.createdAt).toLocaleDateString()} · {item.state}
                  </Text>
                  {state.unreadThreadIds.has(item.id) ? (
                    <Text style={{ color: accentColor }}>Unread reply</Text>
                  ) : null}
                </Pressable>
              )}
            />
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  grow: { flex: 1 },
  transcript: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: "#e5e5e5",
  },
  title: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: "#171717" },
  text: { fontSize: 14, lineHeight: 23, color: "#171717" },
  muted: { fontSize: 14, lineHeight: 20, color: "#737373" },
  caption: { fontSize: 12, color: "#737373" },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  close: { fontSize: 28, color: "#171717" },
  action: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  notice: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: "#f5f5f5" },
  historyBar: { borderBottomWidth: 1, borderColor: "#e5e5e5", paddingHorizontal: 8 },
  historyItem: { padding: 20, borderBottomWidth: 1, borderColor: "#e5e5e5" },
  messages: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 12,
  },
  row: { maxWidth: "84%" },
  bubble: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  operator: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: "#f5f5f5",
    borderBottomLeftRadius: 4,
  },
  delivery: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 20,
    paddingHorizontal: 4,
  },
  day: {
    textAlign: "center",
    fontSize: 12,
    color: "#737373",
    paddingVertical: 8,
    marginBottom: 12,
  },
  latest: {
    position: "absolute",
    right: 12,
    bottom: 12,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 24,
    padding: 12,
  },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 4, paddingVertical: 64 },
  skeletons: { flex: 1, gap: 16 },
  skeleton: { backgroundColor: "#f5f5f5", borderRadius: 10 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderTopWidth: 1,
    borderColor: "#e5e5e5",
    padding: 12,
  },
  input: {
    minHeight: 44,
    fontSize: 16,
    color: "#171717",
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  send: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  email: { padding: 12, gap: 8, borderTopWidth: 1, borderColor: "#e5e5e5" },
  emailRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  closed: { padding: 12, alignItems: "center" },
  limit: { fontSize: 12, color: "#dc2626", paddingHorizontal: 12, paddingBottom: 8 },
});
