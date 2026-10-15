import type { RespondKitClient } from "@respondkit/api-client";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { RespondKitScreen } from "./screen";
import { memoryPersistence, RespondKitStore, type SupportSnapshot } from "./store";

const native = vi.hoisted(() => ({
  alert: vi.fn(),
  pressables: [] as { children?: ReactNode; onPress: () => void; accessibilityLabel?: string }[],
}));
vi.mock("react-native", () => {
  const host =
    (tag: string) =>
    ({ children, accessibilityLabel }: { children?: ReactNode; accessibilityLabel?: string }) =>
      createElement(tag, { "aria-label": accessibilityLabel }, children);
  const subscription = { remove() {} };
  return {
    ActivityIndicator: () => null,
    Alert: { alert: native.alert },
    AppState: { currentState: "active", addEventListener: () => subscription },
    BackHandler: { addEventListener: () => subscription },
    FlatList: ({
      data,
      ListEmptyComponent,
      renderItem,
    }: {
      data: unknown[];
      ListEmptyComponent?: ReactNode;
      renderItem: (info: { item: unknown; index: number }) => ReactNode;
    }) =>
      createElement(
        "div",
        null,
        data.length
          ? data.map((item, index) =>
              createElement(Fragment, { key: index }, renderItem({ item, index })),
            )
          : ListEmptyComponent,
      ),
    KeyboardAvoidingView: host("div"),
    Linking: { openURL: vi.fn() },
    Modal: () => null,
    NativeModules: {},
    Platform: { OS: "ios" },
    Pressable: (props: {
      children?: ReactNode;
      onPress: () => void;
      accessibilityLabel?: string;
    }) => {
      native.pressables.push(props);
      return createElement("button", { "aria-label": props.accessibilityLabel }, props.children);
    },
    processColor: () => 0x432dd7,
    ScrollView: host("div"),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: host("span"),
    TextInput: ({
      accessibilityLabel,
      placeholder,
    }: {
      accessibilityLabel?: string;
      placeholder?: string;
    }) => createElement("input", { "aria-label": accessibilityLabel, placeholder }),
    View: host("div"),
  };
});
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

afterEach(() => {
  vi.restoreAllMocks();
  native.alert.mockReset();
  native.pressables.length = 0;
});

async function renderIn(
  locale: string,
  snapshot: (current: SupportSnapshot) => SupportSnapshot = (current) => current,
) {
  const device = { ...new Intl.DateTimeFormat().resolvedOptions(), locale };
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue(device);
  const store = await RespondKitStore.create({
    apiBaseUrl: "https://api.example.com",
    inboxId: "inbox_test",
    origin: "https://app.example.com",
    persistence: memoryPersistence(),
    createId: (prefix) => `${prefix}_test`,
    client: {} as RespondKitClient,
  });
  vi.spyOn(store, "getSnapshot").mockReturnValue(snapshot(store.getSnapshot()));
  const markup = renderToStaticMarkup(<RespondKitScreen store={store} onClose={() => {}} />);
  store.dispose();
  return markup;
}

it.each([
  [
    "ja-JP",
    [
      "何でもお気軽にどうぞ",
      "どのようなご用件ですか？",
      "メッセージを送信して、このページを開いたままお待ちください。すぐにお返事します。",
    ],
    ["ファイルを添付", "フォトライブラリ", "ファイル", "キャンセル"],
  ],
  [
    "zh-Hans-CN",
    ["有问题尽管问", "有什么可以帮您？", "发送消息后请保持此页面打开，以便及时收到回复。"],
    ["添加附件", "照片图库", "文件", "取消"],
  ],
])(
  "renders the %s empty state, subtitle and attach menu from the device locale",
  async (locale, screen, menu) => {
    const markup = await renderIn(locale);
    for (const text of screen) expect(markup).toContain(text);
    expect(markup).toContain(menu[0]);
    const attach = native.pressables.find((pressable) =>
      renderToStaticMarkup(<div>{pressable.children}</div>).includes(menu[0]!),
    );
    attach!.onPress();
    const [title, , buttons] = native.alert.mock.calls[0]!;
    expect([title, ...buttons.map((button: { text: string }) => button.text)]).toEqual(menu);
  },
);

it.each([
  [
    "ja-JP",
    [
      "返信をお送りするメールアドレスを教えてください",
      'aria-label="メールアドレス"',
      "メールアドレスを保存",
      'aria-label="メッセージ" placeholder="メッセージを入力…"',
      'aria-label="メッセージを送信"',
      "送信済み",
      'aria-label="サポートチャットを閉じる"',
    ],
  ],
  [
    "zh-Hans-CN",
    [
      "我们该把回复发送到哪个邮箱？",
      'aria-label="邮箱地址"',
      "保存邮箱",
      'aria-label="消息" placeholder="输入消息…"',
      'aria-label="发送消息"',
      "已发送",
      'aria-label="关闭客服聊天"',
    ],
  ],
])(
  "renders the %s email ask, composer, delivery status and close control",
  async (locale, expected) => {
    const markup = await renderIn(locale, (current) => ({
      ...current,
      asksForEmail: true,
      pending: [
        {
          id: "cmsg_sent",
          text: "Hello",
          acceptedAt: "2026-10-16T10:00:00.000Z",
          delivery: "accepted",
        },
      ],
    }));
    for (const text of expected) expect(markup).toContain(text);
  },
);
