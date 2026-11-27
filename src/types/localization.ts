import type localeHashes from "../localization/hashes.json";
import type defaultLocale from "../localization/locales/en.json";

export type Locale = keyof typeof localeHashes;
export type Hashes = Record<Locale, string>;
export type Phrases = typeof defaultLocale;

type LeafKeys<T, Prefix extends string = ""> = {
  [Key in keyof T & string]: T[Key] extends object
    ? LeafKeys<T[Key], `${Prefix}${Key}.`>
    : `${Prefix}${Key}`;
}[keyof T & string];

export type Phrase = LeafKeys<Phrases>;
export type FlatPhrases = Record<Phrase, string>;
