import { useId, useState } from "react";
import { Button } from "#components/ui/button";

import { messages } from "./messages";

export function EmailPrompt({
  locale,
  onSave,
}: {
  readonly locale?: string | undefined;
  readonly onSave: (email: string) => Promise<void>;
}) {
  const t = messages(locale);
  const id = useId();
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <form
      className="ac:border-t ac:border-border ac:px-3 ac:py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError(undefined);
        void onSave(email.trim())
          .catch(() => setError(t.respondkit_email_failed()))
          .finally(() => setSaving(false));
      }}
    >
      <label htmlFor={id} className="ac:block ac:text-sm ac:text-muted-foreground">
        {t.respondkit_email_prompt()}
      </label>
      <div className="ac:mt-2 ac:flex ac:gap-2">
        <input
          id={id}
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={saving}
          className="ac:min-w-0 ac:flex-1 ac:rounded-lg ac:border ac:border-border ac:bg-background ac:px-3 ac:py-2 ac:text-base"
          placeholder="you@example.com"
        />
        <Button type="submit" disabled={saving}>
          {saving ? t.respondkit_saving() : t.respondkit_save_email()}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="ac:mt-2 ac:text-sm ac:text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
