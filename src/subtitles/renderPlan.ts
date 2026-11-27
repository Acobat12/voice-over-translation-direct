import {
  type SubtitleInlineStyle,
  type SubtitleToken,
  subtitleStylesEqual,
} from "./types";

export type SubtitleRenderPlanPart =
  | {
      kind: "word";
      text: string;
      style?: SubtitleInlineStyle;
    }
  | {
      kind: "text";
      text: string;
      style?: SubtitleInlineStyle;
    }
  | {
      kind: "break";
    };

/**
 * Build a render plan for subtitle tokens preserving existing grouping rules.
 *
 * Important detail: leading punctuation before a word (for example "(" or "\"")
 * should be visually highlighted together with that word.
 */
export function buildSubtitleRenderPlan(
  tokens: SubtitleToken[],
  renderEndTokenIndex: number,
  breakAfterTokenIndexSet: Set<number> | null,
): SubtitleRenderPlanPart[] {
  const plan: SubtitleRenderPlanPart[] = [];
  let pendingPrefix = "";
  let pendingPrefixStyle: SubtitleInlineStyle | undefined;

  for (let i = 0; i <= renderEndTokenIndex; ) {
    const token = tokens[i];
    const tokenText = token?.text ?? "";
    if (!tokenText) {
      i += 1;
      continue;
    }

    if (tokenText === "\n") {
      if (pendingPrefix) {
        plan.push({
          kind: "text",
          text: pendingPrefix,
          style: pendingPrefixStyle,
        });
        pendingPrefix = "";
        pendingPrefixStyle = undefined;
      }
      plan.push({ kind: "break" });
      i += 1;
      continue;
    }

    if (token.isWordLike) {
      let text = pendingPrefix + tokenText;
      const style = pendingPrefix ? pendingPrefixStyle : token.style;
      pendingPrefix = "";
      pendingPrefixStyle = undefined;

      let endIndex = i;
      const hasBreakAfterWord = Boolean(breakAfterTokenIndexSet?.has(i));
      let breakTokenIndex: number | null = hasBreakAfterWord ? i : null;

      while (breakTokenIndex === null && endIndex + 1 <= renderEndTokenIndex) {
        const next = tokens[endIndex + 1];
        if (
          !next ||
          next.isWordLike ||
          next.text === "\n" ||
          !subtitleStylesEqual(next.style, style)
        )
          break;
        text += next.text;
        endIndex += 1;
        if (breakAfterTokenIndexSet?.has(endIndex)) {
          breakTokenIndex = endIndex;
          break;
        }
      }

      if (breakTokenIndex !== null) {
        plan.push(
          {
            kind: "word",
            text,
            style,
          },
          { kind: "break" },
        );
        i = breakTokenIndex + 1;
        while (
          i <= renderEndTokenIndex &&
          !tokens[i]?.isWordLike &&
          !tokens[i]?.text.trim()
        ) {
          i += 1;
        }
        continue;
      }

      plan.push({
        kind: "word",
        text,
        style,
      });
      i = endIndex + 1;
      continue;
    }

    const hasBreakAfter = Boolean(breakAfterTokenIndexSet?.has(i));
    const isWhitespaceOnly = tokenText.trim().length === 0;

    if (!isWhitespaceOnly) {
      if (hasBreakAfter) {
        plan.push(
          {
            kind: "text",
            text: pendingPrefix + tokenText,
            style: pendingPrefix ? pendingPrefixStyle : token.style,
          },
          { kind: "break" },
        );
        pendingPrefix = "";
        pendingPrefixStyle = undefined;
      } else {
        if (
          pendingPrefix &&
          !subtitleStylesEqual(pendingPrefixStyle, token.style)
        ) {
          plan.push({
            kind: "text",
            text: pendingPrefix,
            style: pendingPrefixStyle,
          });
          pendingPrefix = "";
        }
        pendingPrefix += tokenText;
        pendingPrefixStyle = token.style;
      }

      i += 1;
      continue;
    }

    if (pendingPrefix) {
      plan.push({
        kind: "text",
        text: pendingPrefix,
        style: pendingPrefixStyle,
      });
      pendingPrefix = "";
      pendingPrefixStyle = undefined;
    }

    if (hasBreakAfter) {
      plan.push(
        {
          kind: "text",
          text: tokenText,
          style: token.style,
        },
        { kind: "break" },
      );
    } else {
      plan.push({
        kind: "text",
        text: tokenText,
        style: token.style,
      });
    }

    i += 1;
  }

  if (pendingPrefix) {
    plan.push({
      kind: "text",
      text: pendingPrefix,
      style: pendingPrefixStyle,
    });
  }

  return plan;
}
