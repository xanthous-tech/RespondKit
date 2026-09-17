import { LinkifyIt } from "linkify-it";
import { Fragment, memo } from "react";

const detector = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false });

/** Detect links without interpreting message content as HTML or Markdown. */
export const MessageText = memo(function MessageText({ text }: { readonly text: string }) {
  const links = (detector.match(text) ?? []).filter((match) =>
    /^(https?:\/\/|www\.)/i.test(match.raw),
  );
  let end = 0;
  return (
    <>
      {links.map((link) => {
        const before = text.slice(end, link.index);
        end = link.lastIndex;
        return (
          <Fragment key={link.index}>
            {before}
            <a
              href={/^www\./i.test(link.raw) ? `https://${link.raw}` : link.raw}
              target="_blank"
              rel="noopener noreferrer"
              className="ac:text-primary ac:underline ac:underline-offset-2 ac:break-all ac:focus-visible:outline-2 ac:focus-visible:outline-offset-2"
            >
              {link.raw}
            </a>
          </Fragment>
        );
      })}
      {text.slice(end)}
    </>
  );
});
