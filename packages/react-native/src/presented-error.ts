/** An error whose message is already presentation text in the user's language. */
export class PresentedError extends Error {}

export function presentedMessage(error: unknown, fallback: string) {
  return error instanceof PresentedError ? error.message : fallback;
}
