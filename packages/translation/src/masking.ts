import { PlaceholderIntegrityError } from "./errors";

export type ProtectedFragmentKind =
  | "app_route"
  | "code"
  | "coupon"
  | "email"
  | "glossary"
  | "identifier"
  | "url";

export interface ProtectedFragment {
  kind: ProtectedFragmentKind;
  placeholder: string;
  value: string;
}

export interface MaskedText {
  fragments: readonly ProtectedFragment[];
  text: string;
}

interface Candidate {
  end: number;
  kind: ProtectedFragmentKind;
  priority: number;
  start: number;
  value: string;
}

const PLACEHOLDER_PATTERN = /\[\[\[AC_TOKEN_\d{4,}\]\]\]/gu;

const matchers: readonly {
  kind: ProtectedFragmentKind;
  pattern: RegExp;
}[] = [
  { kind: "code", pattern: /```[\s\S]*?```|~~~[\s\S]*?~~~/gu },
  { kind: "code", pattern: /(`{1,2})(?!`)[^\n]*?\1(?!`)/gu },
  {
    kind: "url",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/giu,
  },
  { kind: "url", pattern: /\bmailto:[^\s<>"'`]+/giu },
  {
    kind: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  },
  {
    kind: "identifier",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
  },
  {
    kind: "identifier",
    pattern: /\{\{[^{}\n]+\}\}|\$\{[^{}\n]+\}|%\([^)\n]+\)[#0 +-]?[a-z]|%[sdif]/giu,
  },
  {
    kind: "app_route",
    pattern:
      /(?:^|(?<=[\s("'=]))\/(?:[A-Za-z0-9._~!$&()*+,;=:@%-]+(?:\/[A-Za-z0-9._~!$&()*+,;=:@%-]+)*\/?)(?:\?[^\s<>"'`]+)?(?:#[^\s<>"'`]+)?/gu,
  },
  {
    kind: "identifier",
    pattern: /--?[a-z][a-z0-9-]*(?:=[^\s<>"'`]+)?/giu,
  },
  {
    kind: "identifier",
    pattern: /\b[a-z][a-z0-9]{1,15}_[A-Za-z0-9_-]{3,}\b/gu,
  },
  {
    kind: "identifier",
    pattern: /\b(?:[a-z][a-z0-9_-]*\.){2,}[a-z][a-z0-9_-]*\b/giu,
  },
  {
    kind: "identifier",
    pattern: /\b[a-z]+(?:[A-Z][A-Za-z0-9]*)+\b/gu,
  },
  {
    kind: "identifier",
    pattern: /\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/giu,
  },
  {
    kind: "coupon",
    pattern: /\b(?=[A-Z0-9_-]{4,}\b)(?=[A-Z0-9_-]*(?:\d|[_-]))[A-Z][A-Z0-9_-]*\b/gu,
  },
  { kind: "identifier", pattern: /\b[0-9a-f]{7,64}\b/giu },
  { kind: "identifier", pattern: PLACEHOLDER_PATTERN },
];

function collectRegexCandidates(source: string): Candidate[] {
  const candidates: Candidate[] = [];

  for (const [priority, matcher] of matchers.entries()) {
    for (const match of source.matchAll(matcher.pattern)) {
      const value = match[0];
      if (match.index === undefined || value.length === 0) {
        continue;
      }

      candidates.push({
        end: match.index + value.length,
        kind: matcher.kind,
        priority,
        start: match.index,
        value,
      });
    }
  }

  return candidates;
}

function collectGlossaryCandidates(source: string, preserve: readonly string[]): Candidate[] {
  const candidates: Candidate[] = [];

  for (const value of preserve) {
    if (value.length === 0) {
      continue;
    }

    let start = source.indexOf(value);
    while (start !== -1) {
      candidates.push({
        end: start + value.length,
        kind: "glossary",
        priority: -1,
        start,
        value,
      });
      start = source.indexOf(value, start + value.length);
    }
  }

  return candidates;
}

function selectNonOverlapping(candidates: readonly Candidate[]): Candidate[] {
  const sorted = [...candidates].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      left.priority - right.priority,
  );
  const selected: Candidate[] = [];
  let cursor = 0;

  for (const candidate of sorted) {
    if (candidate.start < cursor) {
      continue;
    }

    selected.push(candidate);
    cursor = candidate.end;
  }

  return selected;
}

function createPlaceholder(index: number): string {
  return `[[[AC_TOKEN_${index.toString().padStart(4, "0")}]]]`;
}

/** Masks spans that translation must preserve byte-for-byte. */
export function maskProtectedText(
  source: string,
  options: { preserve?: readonly string[] } = {},
): MaskedText {
  const candidates = [
    ...collectRegexCandidates(source),
    ...collectGlossaryCandidates(source, options.preserve ?? []),
  ];
  const selected = selectNonOverlapping(candidates);
  const fragments: ProtectedFragment[] = [];
  const output: string[] = [];
  let cursor = 0;

  for (const candidate of selected) {
    const placeholder = createPlaceholder(fragments.length);
    output.push(source.slice(cursor, candidate.start), placeholder);
    fragments.push({
      kind: candidate.kind,
      placeholder,
      value: candidate.value,
    });
    cursor = candidate.end;
  }

  output.push(source.slice(cursor));
  return { fragments, text: output.join("") };
}

export interface PlaceholderValidation {
  duplicate: readonly string[];
  missing: readonly string[];
  unknown: readonly string[];
  valid: boolean;
}

/** Every expected token must occur once, and the model may not invent tokens. */
export function validateProtectedPlaceholders(
  text: string,
  fragments: readonly ProtectedFragment[],
): PlaceholderValidation {
  const expected = new Set(fragments.map((fragment) => fragment.placeholder));
  const counts = new Map<string, number>();

  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholder = match[0];
    counts.set(placeholder, (counts.get(placeholder) ?? 0) + 1);
  }

  const missing = [...expected].filter((placeholder) => (counts.get(placeholder) ?? 0) === 0);
  const duplicate = [...expected].filter((placeholder) => (counts.get(placeholder) ?? 0) > 1);
  const unknown = [...counts.keys()].filter((placeholder) => !expected.has(placeholder));

  return {
    duplicate,
    missing,
    unknown,
    valid: missing.length === 0 && duplicate.length === 0 && unknown.length === 0,
  };
}

export function restoreProtectedText(
  text: string,
  fragments: readonly ProtectedFragment[],
): string {
  const validation = validateProtectedPlaceholders(text, fragments);
  if (!validation.valid) {
    throw new PlaceholderIntegrityError(validation);
  }

  const byPlaceholder = new Map(
    fragments.map((fragment) => [fragment.placeholder, fragment.value]),
  );

  return text.replaceAll(
    PLACEHOLDER_PATTERN,
    (placeholder) => byPlaceholder.get(placeholder) ?? placeholder,
  );
}
